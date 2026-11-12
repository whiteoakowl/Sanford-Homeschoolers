// A real request: "Under diplomas/transcripts tab on all portals. Add a
// subpage called grade level awards. Add a creator for each grade level.
// Be able to add name and parent names or leave blank for handwritten
// after printing. Allow for choosing 1 of these designs for any grade
// level. Choose grade level drop down. Preview updates when you click
// update preview. Then a print button. These should all be landscape,
// full page."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `grade-awards-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');
const { GRADE_LEVELS, AWARD_DESIGNS, awardFromQuery } = require('../utils/gradeAwards');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

test('15 grade levels, 15 designs, each grade starts on its own design, any design works for any grade', () => {
  assert.equal(GRADE_LEVELS.length, 15);
  assert.equal(AWARD_DESIGNS.length, 15);
  assert.equal(awardFromQuery({ grade: '12' }).design, 'blackgold');
  assert.equal(awardFromQuery({ grade: 'preschool', design: 'neon' }).design, 'neon');
  assert.equal(awardFromQuery({ grade: 'nope', design: 'nope' }).grade, 'preschool');
  assert.equal(awardFromQuery({ grade: 'k' }).gradeDisplay, 'Kindergarten!');
});

test('Family School Management Grade Level Awards: builder, preview with names, blank lines, landscape print', async () => {
  const familyId = (await db.prepare("INSERT INTO families (name) VALUES ('Awards Family') RETURNING id").get()).id;
  const parentId = (await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, is_primary_parent, active) VALUES ('Award Parent', 'ap1', 'ap1', 'parent', ?, 1, 1) RETURNING id").get(familyId)).id;
  await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, active) VALUES ('Award Kid', 'ak1', 'ak1', 'student', ?, 1)").run(familyId);
  const acc = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, 'ap@example.com', ?, 'active', now_text()) RETURNING id").get(parentId, hashPassword('pw123456'))).id;
  await db.prepare("INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = 'parent'))").run(acc);
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'ap@example.com', password: 'pw123456', next: '/parent/family-school' });

  const nav = await agent.get('/parent/family-school');
  assert.match(nav.text, /href="\/parent\/academics\/awards"/);

  const page = await agent.get('/parent/academics/awards?grade=3');
  assert.equal(page.status, 200);
  assert.match(page.text, /<h1>Grade Level Awards<\/h1>/);
  assert.match(page.text, /<select name="grade">/);
  assert.match(page.text, /<option value="3" selected>3rd Grade<\/option>/);
  assert.equal((page.text.match(/<label class="dip-choice ga-choice/g) || []).length, 15);
  assert.match(page.text, /name="design" value="turtle" checked/);
  assert.match(page.text, /<option value="Award Kid">/);
  assert.match(page.text, /Update Preview/);
  assert.match(page.text, /formaction="\/parent\/academics\/awards\/print" formtarget="_blank"/);
  assert.match(page.text, /3rd Grade!/);

  const preview = await agent.get('/parent/academics/awards?grade=12&design=rainbow&studentName=Award%20Kid&parent1=Award%20Parent');
  assert.match(preview.text, /grade-award-rainbow/);
  assert.match(preview.text, />Award Kid<\/text>/);
  assert.match(preview.text, />Award Parent<\/text>/);

  const print = await agent.get('/parent/academics/awards/print?grade=12&design=rainbow&studentName=Award%20Kid');
  assert.equal(print.status, 200);
  assert.match(print.text, /@page \{ size: letter landscape; margin: 0; \}/);
  assert.match(print.text, /12th Grade!/);
  assert.match(print.text, />Award Kid<\/text>/);
  assert.match(print.text, /Student Name:/);
  assert.equal((print.text.match(/Parent\/Teacher:/g) || []).length, 2, 'blank parent lines stay for handwriting');
});

test('Main Admin Family School Management has a Grade Level Awards subpage', async () => {
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/main-admin' });
  const page = await admin.get('/main-admin/family-school/awards?grade=k');
  assert.equal(page.status, 200);
  assert.match(page.text, /href="\/main-admin\/family-school\/awards"[^>]*>Grade Level Awards/);
  assert.match(page.text, /Kindergarten!/);
  const print = await admin.get('/main-admin/family-school/awards/print?grade=k&design=apple');
  assert.equal(print.status, 200);
  assert.match(print.text, /grade-award-apple/);
});
