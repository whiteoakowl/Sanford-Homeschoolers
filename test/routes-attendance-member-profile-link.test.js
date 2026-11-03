// A real request: "Co-op admin attendance. When you click on a member it
// should show the same member profile that has been created under the
// profile icon and elsewhere." Attendance member names link to the full
// profile page (no more mini pop-up), whose Back link returns to the
// Attendance page it came from - kept across the profile's own tabs, and
// forgotten when the profile is opened fresh from the Members list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `attendance-profile-link-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `attendance-profile-link-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { ensureDayRoster } = require('../utils/classSchedule');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

test('attendance names open the full profile, and its Back link returns to Attendance', async () => {
  const memberId = (await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, active) VALUES ('Attendance Profile Kid', 'apk1', 'apk1', 'student', 1)").run()).lastInsertRowid;
  const rosterId = await ensureDayRoster('monday', 'student');
  await db.prepare("INSERT INTO roster_members (roster_id, member_id, source) VALUES (?, ?, 'manual') ON CONFLICT DO NOTHING").run(rosterId, memberId);

  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/admin' });

  const roster = await agent.get('/admin/rosters?tab=monday-student');
  assert.equal(roster.status, 200);
  const link = new RegExp(`<a class="member-name-link" href="(/admin/members/${memberId}\\?from=[^"]+)">Attendance Profile Kid</a>`).exec(roster.text);
  assert.ok(link, 'the member name is a link to the full profile');
  assert.doesNotMatch(roster.text, new RegExp(`id="profile-dialog-${memberId}"`), 'the old mini pop-up is gone');

  const profile = await agent.get(link[1].replace(/&amp;/g, '&'));
  assert.equal(profile.status, 200);
  assert.match(profile.text, /href="\/admin\/rosters\?tab=monday-student(&amp;semesterId=[^"]*)?">&larr; (Back to )?Attendance<\/a>/);

  const otherTab = await agent.get(`/admin/members/${memberId}?tab=schedule`);
  assert.match(otherTab.text, /href="\/admin\/rosters\?tab=monday-student(&amp;semesterId=[^"]*)?">&larr; (Back to )?Attendance<\/a>/, 'Back still goes to Attendance after switching tabs');

  const fresh = await agent.get(`/admin/members/${memberId}`);
  assert.match(fresh.text, /&larr; (Back to )?Members<\/a>/, 'opened fresh (from the Members list), Back goes to Members');

  const offsite = await agent.get(`/admin/members/${memberId}?from=${encodeURIComponent('https://evil.example')}`);
  assert.doesNotMatch(offsite.text, /evil\.example/, 'only Attendance URLs are accepted as a back target');
});
