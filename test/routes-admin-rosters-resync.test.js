// Coverage for a live bug report: a family's non-primary parent, auto-
// added to a day's Parent roster before the primary-parent-only scoping
// fix landed (see utils/classSchedule.js's primaryParentIdsByFamily),
// stayed on the roster forever because syncDayMemberRosters only reruns
// reactively on an actual enrollment/staffing/floater edit - a family
// nobody happened to touch since the fix kept showing the stale result.
//
// This used to be covered through a manual "Resync" button (POST
// /admin/rosters/:day/resync) an admin could click to force the same
// sync on demand - a real request ("Co-op admin portal. Attendance.
// Delete sync button and feature it is no longer needed") removed that
// button and route, since syncDayMemberRosters already runs automatically
// on every enrollment/staffing/floater edit and the manual trigger was
// redundant. The underlying sync behavior this test actually cares about
// still matters (it still runs automatically, just never via a button
// now), so this exercises syncDayMemberRosters directly instead of going
// through the now-deleted HTTP route.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `admin-rosters-resync-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `admin-rosters-resync-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.ADMIN_USERNAME = 'testadmin';
process.env.ADMIN_PASSWORD = 'testpassword123';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { createClass, setEnrollment, ensureDayRoster, syncDayMemberRosters } = require('../utils/classSchedule');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

test('syncDayMemberRosters clears a stale non-primary-parent auto entry and keeps a manual one', async () => {
  const familyId = (await db.prepare("INSERT INTO families (name) VALUES ('Resync Family')").run()).lastInsertRowid;
  const primaryParentId = (
    await db
      .prepare("INSERT INTO members (name, barcode, member_type, family_id, is_primary_parent) VALUES ('Primary Resync Parent', 'resync-primary', 'parent', ?, 1)")
      .run(familyId)
  ).lastInsertRowid;
  const staleParentId = (
    await db
      .prepare("INSERT INTO members (name, barcode, member_type, family_id) VALUES ('Stale Resync Parent', 'resync-stale', 'parent', ?)")
      .run(familyId)
  ).lastInsertRowid;
  const studentId = (
    await db.prepare("INSERT INTO members (name, barcode, member_type, family_id) VALUES ('Resync Kid', 'resync-kid', 'student', ?)").run(familyId)
  ).lastInsertRowid;
  const manualParentId = (
    await db.prepare("INSERT INTO members (name, barcode, member_type) VALUES ('Manually Added Parent', 'resync-manual', 'parent')").run()
  ).lastInsertRowid;

  const classId = await createClass({ day: 'monday', hourPosition: 1, className: 'Resync Class' });
  await setEnrollment(classId, [studentId]);

  const parentRosterId = await ensureDayRoster('monday', 'parent');
  // Simulate the stale, pre-fix state directly - a non-primary parent
  // sitting on the roster as an 'auto' entry (as the old, unscoped logic
  // would have put them), plus a parent an admin explicitly added by
  // hand via + Add Member ('manual'), unrelated to this family.
  await db
    .prepare("INSERT INTO roster_members (roster_id, member_id, source) VALUES (?, ?, 'auto') ON CONFLICT (roster_id, member_id) DO NOTHING")
    .run(parentRosterId, staleParentId);
  await db
    .prepare("INSERT INTO roster_members (roster_id, member_id, source) VALUES (?, ?, 'manual') ON CONFLICT (roster_id, member_id) DO NOTHING")
    .run(parentRosterId, manualParentId);

  await syncDayMemberRosters('monday');

  const memberIds = (await db.prepare('SELECT member_id FROM roster_members WHERE roster_id = ?').all(parentRosterId)).map((r) => r.member_id);
  assert.ok(memberIds.includes(primaryParentId), 'the family\'s primary parent should be on the roster after a sync');
  assert.ok(!memberIds.includes(staleParentId), 'the stale auto-added non-primary parent should be removed by a sync');
  assert.ok(memberIds.includes(manualParentId), 'a manually-added parent must survive a sync untouched');
});

test('the manual Resync button/route is gone - POST /admin/rosters/:day/resync no longer exists', async () => {
  const loginRes = await request(app).post('/admin/login').type('form').send({ username: 'testadmin', password: 'testpassword123' });
  const cookie = loginRes.headers['set-cookie'];
  const page = await request(app).get('/admin/rosters?tab=monday-parent').set('Cookie', cookie);
  assert.doesNotMatch(page.text, /\/admin\/rosters\/monday\/resync/, 'the Resync button/form should no longer be on the page');

  const csrfToken = /name="csrf-token" content="([^"]*)"/.exec(page.text)[1];
  const res = await request(app).post('/admin/rosters/monday/resync').set('Cookie', cookie).type('form').send({ tab: 'monday-parent', _csrf: csrfToken });
  assert.equal(res.status, 404);
});
