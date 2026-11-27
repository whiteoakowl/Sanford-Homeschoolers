// A real request: "Under parent settings. There should be a tab for
// delete account, in red. When member clicks this button there is a pop
// up that says, are you sure... Add delete account notification to main
// admin notification menu. Member delete requests is a subpage under
// members."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `member-delete-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `member-delete-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');
const payments = require('../utils/payments');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));
const csrfOf = (html) => /name="csrf-token" content="([^"]*)"/.exec(html)[1];

test('a parent deletes their account from Settings; Main Admin is notified and finishes it from Member Delete Requests', async () => {
  const fam = (await db.prepare("INSERT INTO families (name) VALUES ('Leaving') RETURNING id").get()).id;
  const parent = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, is_primary_parent, active) VALUES ('Lee Leaving', 'LL1', 'parent', ?, 1, 1) RETURNING id").get(fam)).id;
  const acct = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, 'leaving@example.com', ?, 'active', now_text()) RETURNING id").get(parent, hashPassword('testpassword123'))).id;
  await db.prepare("INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = 'parent'))").run(acct);
  await payments.createCharge(parent, acct, 'manual', null, 'Fall dues', 2000);

  const member = request.agent(app);
  await member.post('/login').type('form').send({ email: 'leaving@example.com', password: 'testpassword123' });
  const hub = await member.get('/parent/family-school/settings-hub');
  assert.match(hub.text, /settings-delete-account-card/);
  assert.match(hub.text, /Delete Account/);
  assert.match(hub.text, /This cannot be reversed\. If you want to return to Sanford Homeschoolers you will have to create a new account\. We hope you have a wonderful school year and we wish you luck on your homeschool journey\./);

  const done = await member.post('/portal/delete-account').type('form').send({ _csrf: csrfOf(hub.text), confirm: '1' });
  assert.match(done.text, /Your account has been deleted/);
  assert.equal((await db.prepare('SELECT status FROM member_accounts WHERE id = ?').get(acct)).status, 'closed');
  const after = await member.get('/portal');
  assert.equal(after.status, 302, 'signed out');
  const relogin = await request(app).post('/login').type('form').send({ email: 'leaving@example.com', password: 'testpassword123' });
  assert.match(relogin.text, /Incorrect email or password/, 'the old login no longer works and the email is free to sign up again');

  const note = await db.prepare("SELECT * FROM notifications WHERE type_key = 'member_delete_request'").get();
  assert.ok(note, 'Main Admin notified');
  assert.equal(note.link_url, '/main-admin/members/delete-requests');
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const types = await admin.get('/main-admin/notifications');
  assert.match(types.text, /Member Account Deleted/, 'in the Main Admin notification menu');
  const page = await admin.get('/main-admin/members/delete-requests');
  assert.match(page.text, /Member Delete Requests/);
  assert.match(page.text, /Lee Leaving/);
  assert.match(page.text, /\$20\.00/, 'shows the balance still owed');
  assert.match(page.text, /href="\/main-admin\/members\/delete-requests"/, 'subpage under Members');
  const reqId = (await db.prepare('SELECT id FROM member_delete_requests').get()).id;
  await admin.post(`/main-admin/members/delete-requests/${reqId}/complete`).type('form').send({ _csrf: csrfOf(page.text) });
  const kept = await db.prepare('SELECT active, archived_at FROM members WHERE id = ?').get(parent);
  assert.equal(Number(kept.active), 0, 'archived, not deleted, since they have accounting history');
  assert.ok(kept.archived_at);
  assert.equal(await payments.balanceForMember(parent), 2000, 'their charge is still on the books');
  assert.equal(await db.prepare('SELECT id FROM member_accounts WHERE id = ?').get(acct), undefined);
  assert.equal((await db.prepare('SELECT status FROM member_delete_requests WHERE id = ?').get(reqId)).status, 'deleted');
});
