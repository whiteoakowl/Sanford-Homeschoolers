// Coverage for the Members tab's Class Schedule "View All" feature: the
// Family Member dropdown gets an "All" choice that shows every family
// member's schedule on the profile page, and its Print link renders every
// family member's own name-headed schedule section (routes/admin-
// schedule.js's /schedule/print with a familyId filter, the shared
// partials/member-schedule-table.ejs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `members-schedule-view-all-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `members-schedule-view-all-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.ADMIN_USERNAME = 'testadmin';
process.env.ADMIN_PASSWORD = 'testpassword123';

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

async function loginAsAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: process.env.MAIN_ADMIN_EMAIL || 'mainadmin@coop.local', password: process.env.MAIN_ADMIN_PASSWORD || 'changeme123' });
  return loginRes.headers['set-cookie'];
}

test('Members Class Schedule tab: "View All" and its compact family print', async (t) => {
  const cookie = await loginAsAdmin();

  const familyId = (await db.prepare("INSERT INTO families (name) VALUES ('View All Test Family')").run()).lastInsertRowid;
  const parentId = (
    await db.prepare("INSERT INTO members (name, barcode, member_type, family_id) VALUES ('View All Parent', 'view-all-parent', 'parent', ?)").run(familyId)
  ).lastInsertRowid;
  const studentId = (
    await db.prepare("INSERT INTO members (name, barcode, member_type, family_id) VALUES ('View All Student', 'view-all-student', 'student', ?)").run(familyId)
  ).lastInsertRowid;
  const otherFamilyId = (await db.prepare("INSERT INTO families (name) VALUES ('Other Family')").run()).lastInsertRowid;
  const otherParentId = (
    await db.prepare("INSERT INTO members (name, barcode, member_type, family_id) VALUES ('Other Family Parent', 'other-family-parent', 'parent', ?)").run(otherFamilyId)
  ).lastInsertRowid;

  const classId = await createClass({ day: 'monday', hourPosition: 1, className: 'View All Test Class', startTime: '9:00 AM', endTime: '9:45 AM' });
  await addStaff(classId, parentId, 'teacher');
  await setEnrollment(classId, [studentId]);

  await t.test('the dropdown offers an "All" option', async () => {
    const res = await request(app).get(`/admin/members/${parentId}?tab=schedule`).set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.match(res.text, /<option value="all"[^>]*>All<\/option>/);
  });

  await t.test('family=all shows both family members\' schedules on the page', async () => {
    const res = await request(app).get(`/admin/members/${parentId}?tab=schedule&family=all`).set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.match(res.text, /View All Parent/);
    assert.match(res.text, /View All Student/);
    assert.match(res.text, /View All Test Class/);
    // A real request: "print all schedules ... should be at the top of
    // the page" - now the shared Export/PDF/Print row (a later request:
    // "All member schedule pages, tabs etc. Should have export, pdf and
    // print icons, in a row side by side"), still ahead of every member.
    assert.doesNotMatch(res.text, /Print All Schedules/);
    const actionsIdx = res.text.indexOf('member-schedule-actions');
    const firstMemberIdx = res.text.indexOf('<section class="member-schedule">');
    assert.ok(actionsIdx > -1 && actionsIdx < firstMemberIdx, 'Export/PDF/Print should come before the family members\' own schedules');
    assert.match(res.text, new RegExp(`/admin/schedule/print\\?familyId=${familyId}`));
    assert.match(res.text, new RegExp(`/admin/schedule/export\\.csv\\?familyId=${familyId}`));
  });

  await t.test('the family print shows a name-headed schedule section per family member, not the other family\'s parent', async () => {
    const res = await request(app).get(`/admin/schedule/print?familyId=${familyId}`).set('Cookie', cookie);
    assert.equal(res.status, 200);
    // A real bug report ("bleeds off the page... put the name above each
    // members class schedule section") - each member is its own section,
    // name as a heading above their table (the shared member schedule
    // table every on-screen schedule uses).
    assert.match(res.text, /<section class="member-schedule">\s*<h2 class="member-schedule-name">View All Parent<\/h2>/);
    assert.match(res.text, /<section class="member-schedule">\s*<h2 class="member-schedule-name">View All Student<\/h2>/);
    assert.match(res.text, /View All Test Class/);
    assert.doesNotMatch(res.text, /Other Family Parent/, 'a different family\'s member must not appear in this family\'s print');
    // Parents first, then students.
    assert.ok(res.text.indexOf('>View All Parent<') < res.text.indexOf('>View All Student<'));
  });

  await t.test('a solo member (no family) never gets the "All" option', async () => {
    const res = await request(app).get(`/admin/members/${otherParentId}?tab=schedule`).set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.text, /<option value="all"/);
  });
});
