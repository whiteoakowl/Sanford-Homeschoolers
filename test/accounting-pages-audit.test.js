// A real request: "Run a full audit on the entire payment and accounting
// pages and system to make sure everything works." Fills accounting with
// every kind of invoice (class, event, store, manual), part payments, a
// split invoice, a card payment and a refund waiting for approval, then
// opens every Main Admin Accounting page and the family's own Accounting
// page - each must load without an error.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `acct-audit-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `acct-audit-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');
const payments = require('../utils/payments');
const { createClass, createSemester, setSemesterFeesDueDate } = require('../utils/classSchedule');
const onlinePayments = require('../utils/onlinePayments');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

test('every accounting page loads with every kind of invoice and payment on file', async () => {
  await onlinePayments.setEnabled(true);
  const fam = (await db.prepare("INSERT INTO families (name) VALUES ('Audit') RETURNING id").get()).id;
  const parent = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, is_primary_parent, active) VALUES ('Ava Audit', 'AA1', 'parent', ?, 1, 1) RETURNING id").get(fam)).id;
  const acct = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, 'audit@example.com', ?, 'active', now_text()) RETURNING id").get(parent, hashPassword('testpassword123'))).id;
  await db.prepare("INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = 'parent'))").run(acct);

  const sem = await createSemester('Audit Fall');
  await setSemesterFeesDueDate(sem.id, '2027-09-01');
  const cls = await createClass({ day: 'wednesday', hourPosition: 1, className: 'Audit Art', semesterId: sem.id, priceCents: 4500 });
  const ev = (await db.prepare("INSERT INTO events (title, starts_at, status, price_cents) VALUES ('Audit Trip', '2027-05-01 10:00:00', 'published', 1200) RETURNING id").get()).id;
  const classCharge = await payments.createCharge(parent, acct, 'class_registration', cls, 'Audit Art', 4500);
  const eventCharge = await payments.createCharge(parent, acct, 'event_registration', ev, 'Audit Trip', 1200);
  const storeCharge = await payments.createCharge(parent, acct, 'store_order', null, 'Store order #1', 1500);
  const manual = await payments.createCharge(parent, acct, 'manual', null, 'Annual membership', 2000);
  await payments.setChargeDetails(manual, { dueDate: '2027-08-15' }); // what the admin invoice form's Due Date does
  for (const id of [classCharge, eventCharge, storeCharge, manual]) assert.ok((await payments.getCharge(id)).due_date, `invoice ${id} has a due date`);

  await payments.recordPayment(classCharge, 2000, 'manual', null, 'cash part 1');
  await payments.splitCharge(manual, 1000, '2027-10-01', null);
  await payments.recordPayment(storeCharge, 1500, 'stripe', acct, 'Paid online by card (Stripe)');
  await db.prepare("UPDATE payment_payments SET stripe_payment_intent = 'pi_audit' WHERE charge_id = ?").run(storeCharge);
  await require('../utils/refundRequests').requestRefund({ chargeId: storeCharge, amountCents: 1500, reason: 'Audit refund', source: 'automatic' });

  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const pages = ['/', '/print', '/export.csv', '/categories', '/invoices/new', `/invoices/${manual}/edit`, '/invoices', '/payments', '/payments/new', '/adjustments', '/logs', '/settings', '/refunds',
    `/members/${parent}`, `/members/${parent}/print`, '/transactions', '/receipts', '/reports', '/reports/profit-and-loss', '/reports/cash-flow', '/reports/balance-sheet'];
  for (const p of pages) {
    const res = await admin.get('/main-admin/accounting' + p);
    assert.equal(res.status, 200, `${p} -> ${res.status}`);
    assert.doesNotMatch(res.text, /Something went wrong/i, p);
  }
  const memberPage = await admin.get(`/main-admin/accounting/members/${parent}`);
  assert.match(memberPage.text, /partially paid/);
  assert.match(memberPage.text, /Annual membership \(part 2\)/);
  assert.match((await admin.get('/main-admin/accounting/refunds')).text, /Audit refund/);

  const fam1 = request.agent(app);
  await fam1.post('/login').type('form').send({ email: 'audit@example.com', password: 'testpassword123' });
  for (const p of ['/accounting', '/accounting/print', '/accounting?year=all']) {
    const res = await fam1.get(p);
    assert.equal(res.status, 200, p);
    assert.doesNotMatch(res.text, /Something went wrong/i, p);
  }
  const home = await fam1.get('/accounting');
  assert.match(home.text, /Pay Online/);
  assert.match(home.text, /Due 09\/01\/2027/);
  assert.match(home.text, /partially paid/);
});
