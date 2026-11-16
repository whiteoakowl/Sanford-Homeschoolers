// A real bug report: "When creating a new class the dropdown for choosing a
// room number doesn't work. It should also not require a teacher to create
// a new class."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `add-class-room-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `add-class-room-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { createClass } = require('../utils/classSchedule');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

const csrfOf = (html) => /name="csrf-token" content="([^"]*)"/.exec(html)[1];

test('Add Class: a real room dropdown (plus Other), and no teacher required', async () => {
  await createClass({ day: 'monday', hourPosition: 1, className: 'Existing', room: 'Room 7' });
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const page = await admin.get('/admin/schedule?tab=monday');
  const dialog = /<dialog id="add-class-dialog-monday"[\s\S]*?<\/dialog>/.exec(page.text)[0];
  assert.match(dialog, /<select name="room"[^>]*>[\s\S]*?<option value="Room 7">Room 7<\/option>[\s\S]*?<option value="__other">Other&hellip;<\/option>/);
  assert.doesNotMatch(dialog, /<datalist/);
  assert.match(dialog, /<select name="teacherId">\s*<option value="" selected>No teacher yet<\/option>/);
  assert.doesNotMatch(dialog, /name="teacherId" required/);

  const csrf = csrfOf(page.text);
  await admin.post('/admin/class-schedule/classes/new').type('form').send({ _csrf: csrf, className: 'No Teacher Picked', color: '#f6b26b', day: 'monday', hourPosition: '2', room: 'Room 7', teacherId: '' });
  const a = await db.prepare("SELECT id, room FROM classes WHERE class_name = 'No Teacher Picked'").get();
  assert.ok(a, 'created without a teacher');
  assert.equal(a.room, 'Room 7');
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM class_staff WHERE class_id = ? AND role = 'teacher'").get(a.id)).n), 0);

  await admin.post('/admin/class-schedule/classes/new').type('form').send({ _csrf: csrf, className: 'Typed Room', color: '#f6b26b', day: 'monday', hourPosition: '3', room: '__other', roomOther: 'Gym' });
  assert.equal((await db.prepare("SELECT room FROM classes WHERE class_name = 'Typed Room'").get()).room, 'Gym');
});

// A real bug report: "When editing a class if you uncheck the lock by grade
// level or lock by age level and save. When you edit it again the boxes are
// checked again and they shouldn't be."
test('unchecking Lock class by grade/age sticks after saving', async () => {
  const id = await createClass({ day: 'monday', hourPosition: 4, className: 'Lock Sticks', room: 'R1' });
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const page = await admin.get(`/admin/class-schedule/classes/${id}/manage`);
  assert.match(page.text, /name="lockByGrade" value="1" checked/);
  const save = await admin.post(`/admin/class-schedule/classes/${id}`).set('X-CSRF-Token', csrfOf(page.text)).field('className', 'Lock Sticks').field('hourPosition', '4').field('room', 'R1');
  assert.equal(save.status, 302);
  const again = await admin.get(`/admin/class-schedule/classes/${id}/manage`);
  assert.match(again.text, /<input type="checkbox" name="lockByGrade" value="1"\s+\/>/);
  assert.match(again.text, /<input type="checkbox" name="lockByAge" value="1"\s+\/>/);
});

// A real request: "Should be able to lock grade or age levels per class.
// But also be able to lock age or grade levels for all classes. That
// setting override the rest."
test('Lock all classes by grade overrides a class that is not locked itself, and turning it off restores the class setting', async () => {
  const { saveClassGlobalSettings, classGlobalSettings } = require('../utils/classSchedule');
  const { registerForClass } = require('../utils/classRegistration');
  const id = await createClass({ day: 'monday', hourPosition: 4, className: 'Grade Five Only', ageGroup: 'Grade 5', registrationOpen: true });
  await db.prepare('UPDATE classes SET lock_by_grade = 0, registration_open = 1 WHERE id = ?').run(id);
  const fam = (await db.prepare("INSERT INTO families (name) VALUES ('Override') RETURNING id").get()).id;
  const kid = (await db.prepare("INSERT INTO members (name, barcode, member_type, active, family_id, grade_level) VALUES ('Second Grader', 'SG-1', 'student', 1, ?, 'Grade 2') RETURNING id").get(fam)).id;
  const parentId = (await db.prepare("INSERT INTO members (name, barcode, member_type, active, family_id, is_primary_parent) VALUES ('Override Parent', 'OP-1', 'parent', 1, ?, 1) RETURNING id").get(fam)).id;
  const acct = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, 'override@example.com', 'x', 'active', now_text()) RETURNING id").get(parentId)).id;

  await saveClassGlobalSettings({ ...(await classGlobalSettings()), defaultLockByGrade: true });
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const page = await admin.get(`/admin/class-schedule/classes/${id}/manage`);
  assert.match(page.text, /<input type="hidden" name="lockByGrade" value="0" \/>/, 'the class keeps its own (unlocked) choice');
  assert.match(page.text, /<input type="checkbox" checked disabled \/> Lock class by grade <span class="hint">\(locked for all classes/);
  const blocked = await registerForClass({ classId: id, studentId: kid, accountId: acct, portalRoles: ['parent', 'admin', 'main_admin'], registrantType: 'parent' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /eligible grade level/);

  await saveClassGlobalSettings({ ...(await classGlobalSettings()), defaultLockByGrade: false });
  const page2 = await admin.get(`/admin/class-schedule/classes/${id}/manage`);
  assert.match(page2.text, /<input type="checkbox" name="lockByGrade" value="1"\s+\/> Lock class by grade/);
  const allowed = await registerForClass({ classId: id, studentId: kid, accountId: acct, portalRoles: ['parent', 'admin', 'main_admin'], registrantType: 'parent' });
  assert.doesNotMatch(String(allowed.error || ''), /eligible grade level/, 'not grade-blocked once the override is off');
});
