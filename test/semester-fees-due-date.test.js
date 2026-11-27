// A real request: "Add/edit semester. Be able to add a due date for all
// fees charged for classes that are linked to that semester. Class fees
// get billed to the members account and due date is shown, students stay
// registered."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `semester-fees-due-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `semester-fees-due-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const payments = require('../utils/payments');
const { createClass } = require('../utils/classSchedule');
const { hashPassword } = require('../utils/portalAuth');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

const csrfOf = (html) => /name="csrf-token" content="([^"]*)"/.exec(html)[1];

test('a semester fees due date is set on its class charges, moves with edits, and shows on the family account', async () => {
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  let page = await admin.get('/admin/settings?tab=semesters');
  assert.match(page.text, /Class Fees Due Date/);
  await admin.post('/admin/schedule/semesters').type('form').send({ _csrf: csrfOf(page.text), title: 'Due Fall 2026', feesDueDate: '2026-09-15' });
  const sem = await db.prepare("SELECT * FROM semesters WHERE title = 'Due Fall 2026'").get();
  assert.equal(sem.fees_due_date, '2026-09-15');
  page = await admin.get('/admin/settings?tab=semesters');
  assert.match(page.text, /09\/15\/2026/);

  const classId = await createClass({ day: 'monday', hourPosition: 1, className: 'Due Pottery', semesterId: sem.id, priceCents: 4000 });
  const fam = (await db.prepare("INSERT INTO families (name) VALUES ('Due') RETURNING id").get()).id;
  const parent = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, is_primary_parent, active) VALUES ('Dana Due', 'DD1', 'parent', ?, 1, 1) RETURNING id").get(fam)).id;
  const acct = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, 'due@example.com', ?, 'active', now_text()) RETURNING id").get(parent, hashPassword('testpassword123'))).id;
  await db.prepare("INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = 'parent'))").run(acct);

  const chargeId = await payments.createCharge(parent, acct, 'class_registration', classId, 'Due Pottery', 4000);
  assert.equal((await payments.getCharge(chargeId)).due_date, '2026-09-15');
  const other = await payments.createCharge(parent, acct, 'manual', null, 'Field Trip', 1000);
  assert.equal((await payments.getCharge(other)).due_date, null, 'only class fees pick up the semester date');

  await admin.post(`/admin/schedule/semesters/${sem.id}/update`).type('form').send({ _csrf: csrfOf(page.text), title: 'Due Fall 2026', feesDueDate: '2026-10-01' });
  assert.equal((await payments.getCharge(chargeId)).due_date, '2026-10-01', 'unpaid class fees follow the new date');

  const family = request.agent(app);
  await family.post('/login').type('form').send({ email: 'due@example.com', password: 'testpassword123', next: '/accounting' });
  const acctPage = await family.get('/accounting');
  assert.match(acctPage.text, /<th>Due<\/th>/);
  assert.match(acctPage.text, /10\/01\/2026/);
});
