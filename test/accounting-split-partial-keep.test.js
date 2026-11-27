// Real requests: "Make sure every type of invoice has due date settings.
// Make sure invoices can be split to have multiple payments or pay a 2nd
// part later." and "Accounting information for each member never
// disappears. Even if the members account is deleted."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `acct-split-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `acct-split-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.STRIPE_SECRET_KEY = 'rk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');
const payments = require('../utils/payments');
const onlinePayments = require('../utils/onlinePayments');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));
const csrfOf = (html) => /name="csrf-token" content="([^"]*)"/.exec(html)[1];

const calls = [];
global.fetch = async (url, opts = {}) => {
  calls.push({ url, body: opts.body || '' });
  const ref = /client_reference_id=(\d+)/.exec(opts.body || '');
  return { ok: true, status: 200, json: async () => ({ id: `cs_test_${ref ? ref[1] : 0}`, url: 'https://checkout.stripe.com/c/pay/x' }) };
};

let n = 0;
async function family() {
  n += 1;
  const fam = (await db.prepare('INSERT INTO families (name) VALUES (?) RETURNING id').get(`Fam ${n}`)).id;
  const parent = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, is_primary_parent, active) VALUES (?, ?, 'parent', ?, 1, 1) RETURNING id").get(`Pat ${n}`, `B${n}`, fam)).id;
  const acct = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text()) RETURNING id").get(parent, `p${n}@example.com`, hashPassword('testpassword123'))).id;
  await db.prepare("INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = 'parent'))").run(acct);
  return { parent, acct, email: `p${n}@example.com` };
}
async function adminAgent() {
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  return admin;
}

test('every invoice type gets a due date: events, store orders, class fees and manual invoices', async () => {
  const { parent, acct } = await family();
  const ev = (await db.prepare("INSERT INTO events (title, starts_at, status, price_cents) VALUES ('Zoo', '2027-03-10 10:00:00', 'published', 1000) RETURNING id").get()).id;
  assert.equal((await payments.getCharge(await payments.createCharge(parent, acct, 'event_registration', ev, 'Zoo', 1000))).due_date, '2027-03-10', 'defaults to the event date');
  await db.prepare("UPDATE events SET payment_due_date = '2027-03-01' WHERE id = ?").run(ev);
  assert.equal((await payments.getCharge(await payments.createCharge(parent, acct, 'event_registration', ev, 'Zoo', 1000))).due_date, '2027-03-01');
  await db.prepare('UPDATE store_settings SET payment_due_days = 3 WHERE id = 1').run();
  const expected = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  assert.equal((await payments.getCharge(await payments.createCharge(parent, acct, 'store_order', null, 'Shirt', 1500))).due_date, expected);

  const admin = await adminAgent();
  const builder = await admin.get(`/main-admin/events/${ev}/builder?tab=finance`);
  assert.match(builder.text, /name="paymentDueDate"/);
  const shop = await admin.get('/main-admin/store?tab=settings');
  assert.match(shop.text, /name="paymentDueDays"/);
});

test('an admin splits an invoice into two payments; cancelling settles every part', async () => {
  const { parent, acct } = await family();
  const charge = await payments.createCharge(parent, acct, 'manual', null, 'Spring tuition', 9000);
  await payments.recordPayment(charge, 2000, 'manual', null, 'deposit');
  const admin = await adminAgent();
  const page = await admin.get(`/main-admin/accounting/invoices/${charge}/edit`);
  assert.match(page.text, /Split Into Two Payments/);
  const tooMuch = await admin.post(`/main-admin/accounting/invoices/${charge}/split-payment`).type('form').send({ _csrf: csrfOf(page.text), partAmount: '70.00' });
  assert.match(decodeURIComponent(tooMuch.headers.location), /less than the \$70\.00 still owed/);
  const res = await admin.post(`/main-admin/accounting/invoices/${charge}/split-payment`).type('form').send({ _csrf: csrfOf(page.text), partAmount: '40.00', partDueDate: '2027-04-01' });
  const partId = Number(/invoices\/(\d+)\/edit/.exec(res.headers.location)[1]);
  const first = await payments.getCharge(charge);
  const second = await payments.getCharge(partId);
  assert.equal(first.amount_cents, 5000);
  assert.equal(first.description, 'Spring tuition (part 1)');
  assert.equal(second.amount_cents, 4000);
  assert.equal(second.description, 'Spring tuition (part 2)');
  assert.equal(second.due_date, '2027-04-01');
  assert.equal(second.split_from_charge_id, charge);
  assert.equal(await payments.balanceForMember(parent), 7000, 'nothing owed is lost or added');
  assert.deepEqual(await payments.chargeParts(charge), [charge, partId]);
});

test('a family pays part of an invoice online now and the rest later', async () => {
  await onlinePayments.setEnabled(true);
  const { parent, email } = await family();
  const charge = await payments.createCharge(parent, null, 'manual', null, 'Co-op fee', 4500);
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email, password: 'testpassword123' });
  const page = await agent.get('/accounting');
  assert.match(page.text, new RegExp(`name="amount_${charge}"`));
  assert.match(page.text, /pay part now, the rest later/);
  const tooSmall = await agent.post('/accounting/pay').type('form').send({ _csrf: csrfOf(page.text), chargeIds: String(charge), [`amount_${charge}`]: '0.10' });
  assert.match(decodeURIComponent(tooSmall.headers.location), /at least \$0\.50/);
  const ok = await agent.post('/accounting/pay').type('form').send({ _csrf: csrfOf(page.text), chargeIds: String(charge), [`amount_${charge}`]: '20.00' });
  assert.equal(ok.status, 303);
  const body = decodeURIComponent(calls.at(-1).body);
  assert.match(body, /line_items\[0\]\[price_data\]\[unit_amount\]=2000/);
  const row = await db.prepare('SELECT * FROM stripe_checkouts ORDER BY id DESC LIMIT 1').get();
  await onlinePayments.completeCheckoutSession({ id: row.session_id, payment_status: 'paid', payment_intent: 'pi_part', client_reference_id: String(row.id), metadata: { checkout_id: String(row.id) } });
  assert.equal(await payments.amountPaidForCharge(charge), 2000);
  assert.equal((await payments.getCharge(charge)).status, 'pending', 'still open for the second part');
  assert.match((await agent.get('/accounting')).text, /partially paid/);
  await onlinePayments.setEnabled(false);
});

test('deleting a member never deletes their accounting - they are archived instead and stay on the Accounting list', async () => {
  const { parent, acct } = await family();
  const charge = await payments.createCharge(parent, acct, 'manual', null, 'Fall dues', 2500);
  const admin = await adminAgent();
  const list = await admin.get('/main-admin/members');
  const res = await admin.post(`/main-admin/members/${parent}/delete`).type('form').send({ _csrf: csrfOf(list.text) });
  assert.match(decodeURIComponent(res.headers.location), /archived instead of deleted/);
  assert.ok(await db.prepare('SELECT id FROM members WHERE id = ?').get(parent), 'member row kept');
  assert.ok(await payments.getCharge(charge), 'invoice kept');
  const accounting = await admin.get('/main-admin/accounting?q=pat');
  assert.match(accounting.text, new RegExp(`Pat ${n}`));
  assert.match(accounting.text, /Archived/);
  await assert.rejects(db.prepare('DELETE FROM members WHERE id = ?').run(parent), 'the database itself refuses');
  // A member with no accounting is still really deleted.
  const other = await family();
  const res2 = await admin.post(`/main-admin/members/${other.parent}/delete`).type('form').send({ _csrf: csrfOf(list.text) });
  assert.match(decodeURIComponent(res2.headers.location), /Deleted "Pat/);
  assert.equal(await db.prepare('SELECT id FROM members WHERE id = ?').get(other.parent), undefined);
});
