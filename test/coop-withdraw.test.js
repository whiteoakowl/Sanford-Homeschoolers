// A real request: "Parent portal, classroom dashboard. At the top add a
// button that says Withdraw from co-op classes. A popup occurs and asks
// are you sure you want to delete your enrollment to co-op and cancel all
// of your students classes? Option to add a note to admins. Confirm and
// cancel buttons. On admin side shows up under classes subpage called
// co-op Withdraw. Listed by family click to view their full schedule and
// note. Confirm or reject buttons. Confirm removes entire family from
// co-op classes, teaching positions, assistant positions, floater,
// setup/cleanup lists etc. They go back to only being listed as a group
// member on main admin portal."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `coop-withdraw-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `coop-withdraw-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');
const { createClass, setEnrollment, addStaff } = require('../utils/classSchedule');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

const csrfOf = (html) => /name="csrf-token" content="([^"]*)"/.exec(html)[1];

test('a family asks to withdraw, the admin sees it with their schedule, and Confirm takes them out of everything co-op', async () => {
  const fam = (await db.prepare("INSERT INTO families (name) VALUES ('Leaving') RETURNING id").get()).id;
  const parent = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, is_primary_parent, active) VALUES ('Lee Leaving', 'LL-P', 'parent', ?, 1, 1) RETURNING id").get(fam)).id;
  const kid = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, active) VALUES ('Kit Leaving', 'LL-K', 'student', ?, 1) RETURNING id").get(fam)).id;
  const stay = (await db.prepare("INSERT INTO members (name, barcode, member_type, active) VALUES ('Stay Kid', 'SK', 'student', 1) RETURNING id").get()).id;
  const acct = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, 'leaving@example.com', ?, 'active', now_text()) RETURNING id").get(parent, hashPassword('testpassword123'))).id;
  await db.prepare("INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = 'parent'))").run(acct);

  const art = await createClass({ day: 'monday', hourPosition: 1, className: 'Leaving Art', room: 'Room 1' });
  const math = await createClass({ day: 'monday', hourPosition: 2, className: 'Leaving Math', room: 'Room 2' });
  await setEnrollment(art, [kid, stay]);
  await addStaff(math, parent, 'teacher');
  await db.prepare("INSERT INTO class_registrations (class_id, student_id, registered_by_account_id, status) VALUES (?, ?, ?, 'confirmed')").run(art, kid, acct);
  const existingList = await db.prepare("SELECT id FROM volunteer_lists WHERE day = 'monday' LIMIT 1").get();
  const list = existingList ? existingList.id : (await db.prepare("INSERT INTO volunteer_lists (day) VALUES ('monday') RETURNING id").get()).id;
  const section = (await db.prepare("INSERT INTO volunteer_sections (volunteer_list_id, position, label) VALUES (?, 99, 'Hour 1') RETURNING id").get(list)).id;
  await db.prepare('INSERT INTO volunteer_members (volunteer_list_id, member_id, section_id) VALUES (?, ?, ?)').run(list, parent, section);
  const team = (await db.prepare("INSERT INTO setup_teams (day, title) VALUES ('monday', 'Setup A') RETURNING id").get()).id;
  await db.prepare('INSERT INTO setup_team_members (team_id, member_id) VALUES (?, ?)').run(team, parent);

  const parentAgent = request.agent(app);
  await parentAgent.post('/login').type('form').send({ email: 'leaving@example.com', password: 'testpassword123', next: '/parent' });
  const dash = await parentAgent.get('/parent/classes/dashboard');
  assert.match(dash.text, /Withdraw from Co-op Classes<\/button>/);
  assert.match(dash.text, /Are you sure you want to delete your enrollment to co-op and cancel all of your students' classes\?/);
  assert.match(dash.text, /<textarea name="note"/);
  await parentAgent.post('/parent/classes/withdraw').type('form').send({ _csrf: csrfOf(dash.text), note: 'Moving out of state' });
  const after = await parentAgent.get('/parent/classes/dashboard');
  assert.match(after.text, /waiting for a co-op admin to review it/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM class_enrollments WHERE student_id = ?').get(kid)).n, 1, 'nothing changes before the admin confirms');

  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const listPage = await admin.get('/admin/coop-withdraw');
  assert.match(listPage.text, /href="\/admin\/coop-withdraw">Co-op Withdraw/);
  assert.match(listPage.text, /Leaving Family/);
  const id = /href="\/admin\/coop-withdraw\?id=(\d+)"/.exec(listPage.text)[1];
  const detail = await admin.get(`/admin/coop-withdraw?id=${id}`);
  assert.match(detail.text, /Moving out of state/);
  assert.match(detail.text, /Leaving Art/, 'their full schedule');
  assert.match(detail.text, /Leaving Math/);

  const confirm = await admin.post(`/admin/coop-withdraw/${id}/confirm`).type('form').send({ _csrf: csrfOf(detail.text) });
  assert.match(decodeURIComponent(confirm.headers.location), /Withdrawal confirmed/);

  const enrolled = (await db.prepare('SELECT student_id FROM class_enrollments WHERE class_id = ?').all(art)).map((r) => r.student_id);
  assert.deepEqual(enrolled, [stay], 'only the family is taken out');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM class_staff WHERE member_id = ?').get(parent)).n, 0);
  assert.equal((await db.prepare('SELECT status FROM class_registrations WHERE student_id = ?').get(kid)).status, 'cancelled');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM volunteer_members WHERE member_id = ?').get(parent)).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM setup_team_members WHERE member_id = ?').get(parent)).n, 0);
  const stillMembers = await db.prepare('SELECT COUNT(*) AS n FROM members WHERE family_id = ? AND active = 1').get(fam);
  assert.equal(Number(stillMembers.n), 2, 'still members of the group');

  const rejectAgain = await db.prepare('SELECT status FROM coop_withdrawals WHERE id = ?').get(id);
  assert.equal(rejectAgain.status, 'confirmed');
});

test('Reject leaves everything as it was', async () => {
  const fam = (await db.prepare("INSERT INTO families (name) VALUES ('Staying') RETURNING id").get()).id;
  const kid = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, active) VALUES ('Sam Staying', 'SS-K', 'student', ?, 1) RETURNING id").get(fam)).id;
  const cls = await createClass({ day: 'monday', hourPosition: 3, className: 'Staying Class', room: 'Room 3' });
  await setEnrollment(cls, [kid]);
  const w = (await db.prepare("INSERT INTO coop_withdrawals (family_id, member_id, note) VALUES (?, ?, 'oops') RETURNING id").get(fam, kid)).id;
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const page = await admin.get(`/admin/coop-withdraw?id=${w}`);
  await admin.post(`/admin/coop-withdraw/${w}/reject`).type('form').send({ _csrf: csrfOf(page.text) });
  assert.equal((await db.prepare('SELECT status FROM coop_withdrawals WHERE id = ?').get(w)).status, 'rejected');
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM class_enrollments WHERE student_id = ?').get(kid)).n), 1);
});
