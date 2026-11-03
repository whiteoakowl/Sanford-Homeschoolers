// A real request on the Member Profile's Schedule tab (both Co-op Admin
// and Main Admin): "each family member's schedule for all days should
// be in one card. Family member name as title in card... print all
// schedules should say print schedules and should be at the top of the
// page." Main Admin's own coverage - Co-op Admin's equivalent is
// test/routes-members-schedule-view-all.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `main-admin-members-schedule-card-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `main-admin-members-schedule-card-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.MAIN_ADMIN_EMAIL = 'mainadmin@coop.local';
process.env.MAIN_ADMIN_PASSWORD = 'changeme123';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { createClass, setEnrollment, addStaff } = require('../utils/classSchedule');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

async function loginAsMainAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: process.env.MAIN_ADMIN_EMAIL, password: process.env.MAIN_ADMIN_PASSWORD, next: '/main-admin' });
  return loginRes.headers['set-cookie'];
}

test('Main Admin member profile Schedule tab "View All": one shared schedule section per family member, name as its heading, Export/PDF/Print at the top', async () => {
  const cookie = await loginAsMainAdmin();

  const familyId = (await db.prepare("INSERT INTO families (name) VALUES ('Schedule Card Test Family') RETURNING id").get()).id;
  const parentInfo = await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, active) VALUES ('Schedule Card Parent', 'schedule-card-parent', 'parent', ?, 1)").run(familyId);
  const studentInfo = await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, active) VALUES ('Schedule Card Student', 'schedule-card-student', 'student', ?, 1)").run(familyId);

  const classId = await createClass({ day: 'monday', hourPosition: 1, className: 'Schedule Card Test Class', startTime: '9:00 AM', endTime: '9:45 AM' });
  await addStaff(classId, parentInfo.lastInsertRowid, 'teacher');
  await setEnrollment(classId, [studentInfo.lastInsertRowid]);

  const res = await request(app).get(`/main-admin/members/${parentInfo.lastInsertRowid}?tab=schedule&family=all`).set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /Schedule Card Test Class/);

  // A later real request ("member profile, schedules should also look
  // like this [image]... export, pdf and print icons, in a row side by
  // side") replaced the Print Schedules button with the shared Export/
  // PDF/Print row - still at the top, ahead of every member's section.
  assert.doesNotMatch(res.text, /Print All Schedules/);
  const actionsIdx = res.text.indexOf('member-schedule-actions');
  const firstSectionIdx = res.text.indexOf('<section class="member-schedule">');
  assert.ok(actionsIdx > -1 && firstSectionIdx > -1 && actionsIdx < firstSectionIdx, 'Export/PDF/Print should come before the family members\' own schedules');
  assert.match(res.text, new RegExp(`href="/main-admin/members/schedule-print\\?familyId=${familyId}" target="_blank" aria-label="Print"`));

  // Each member is one shared member-schedule section, their name as its
  // own heading (the member being viewed isn't a link to themselves).
  const sectionRe = /<section class="member-schedule">\s*<h2 class="member-schedule-name">(?:<a [^>]*>)?([^<]+)(?:<\/a>)?<\/h2>/g;
  const names = [...res.text.matchAll(sectionRe)].map((m) => m[1]);
  assert.deepEqual(names.sort(), ['Schedule Card Parent', 'Schedule Card Student']);
  // The parent teaches it, the student is signed up for it.
  assert.match(res.text, />Teaching</);
  assert.match(res.text, />Signed Up</);
});
