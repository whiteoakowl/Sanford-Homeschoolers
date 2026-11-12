// A real request: "add a pending request box to co-op admin homepage to
// count lesson plan approvals, teacher reimbursement, name tag requests."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `coop-pending-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

test('Co-op Admin homepage shows a Pending Requests box with lesson plan, reimbursement and name tag counts', async () => {
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/admin' });

  const before = await admin.get('/admin');
  assert.equal(before.status, 200);
  assert.match(before.text, /<h2>Pending Requests<\/h2>/);
  assert.match(before.text, /Manage your pending requests\./);
  for (const [label, href] of [['Lesson Plan Approvals', '/admin/lesson-plans/approval'], ['Teacher Reimbursements', '/admin/teachers/reimbursements?status=submitted'], ['Name Tag Requests', '/admin/design?tab=requests']]) {
    assert.match(before.text, new RegExp(`href="${href.replace(/[?]/g, '\\?')}">[\\s\\S]*?${label}`));
  }
  assert.doesNotMatch(before.text, /class="pr-card-count"/, 'nothing waiting shows no count');

  const m = (await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, active) VALUES ('Tag Kid', 'ptk1', 'ptk1', 'student', 1) RETURNING id").get()).id;
  for (let i = 0; i < 2; i++) await db.prepare("INSERT INTO name_tag_requests (member_id, request_type, day, description) VALUES (?, 'new_tag', 'both', 'x')").run(m);
  await db.prepare("INSERT INTO name_tag_requests (member_id, request_type, day, description, archived) VALUES (?, 'new_tag', 'both', 'done', 1)").run(m);

  const after = await admin.get('/admin');
  assert.match(after.text, /<span class="pr-card-count" aria-label="2 waiting">2<\/span>/);
});

test('Main Admin homepage Pending Requests uses the new card with six request types', async () => {
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/main-admin' });
  const res = await admin.get('/main-admin');
  assert.equal(res.status, 200);
  assert.equal((res.text.match(/<a class="pr-card-item"/g) || []).length, 6);
  for (const color of ['blue', 'purple', 'green', 'orange', 'teal', 'gold']) assert.match(res.text, new RegExp(`pr-card-item-icon pr-color-${color}`));
  assert.match(res.text, /Business Directory Requests/);
});
