// A real request: "Make a schedule change request form. Should be listed
// under co-op classes. As a family list log. Request form will show
// students current classes. Parent can choose cancel next to the classes
// they want to cancel. Then below they can add classes from list of
// available classes that have room. Admin can approve switch. When it is
// approved the member is removed from the canceled classes and added to
// the roster of the new classes. Can decline individual classes additions
// admin. This also follows invoice/class payment settings. This form can
// be found on the parent portal under class registration tab as a
// subpage. Quick links is added under the quicklink links tab in settings
// for co-op admin. This will also automatically trigger a name tag
// request."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `schedule-change-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `schedule-change-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');
const { createClass, setEnrollment } = require('../utils/classSchedule');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

const csrfOf = (html) => /name="csrf-token" content="([^"]*)"/.exec(html)[1];

test('parent requests a switch; admin approves it, declining one addition; rosters, charges and a name tag request follow', async () => {
  const fam = (await db.prepare("INSERT INTO families (name) VALUES ('Switch') RETURNING id").get()).id;
  const parent = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, is_primary_parent, active) VALUES ('Pat Switch', 'PS', 'parent', ?, 1, 1) RETURNING id").get(fam)).id;
  const kid = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, active) VALUES ('Kim Switch', 'KS', 'student', ?, 1) RETURNING id").get(fam)).id;
  const acct = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, 'switch@example.com', ?, 'active', now_text()) RETURNING id").get(parent, hashPassword('testpassword123'))).id;
  await db.prepare("INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = 'parent'))").run(acct);

  const oldClass = await createClass({ day: 'monday', hourPosition: 1, className: 'Old Pottery', room: 'Room 1' });
  const newArt = await createClass({ day: 'monday', hourPosition: 1, className: 'New Painting', room: 'Room 2' });
  const newChess = await createClass({ day: 'monday', hourPosition: 2, className: 'New Chess', room: 'Room 3' });
  const full = await createClass({ day: 'monday', hourPosition: 3, className: 'Full Class', room: 'Room 4' });
  await db.prepare('UPDATE classes SET registration_open = 1 WHERE id IN (?, ?, ?, ?)').run(oldClass, newArt, newChess, full);
  await db.prepare('UPDATE classes SET price_cents = 2500, capacity = 10 WHERE id = ?').run(newArt);
  await db.prepare('UPDATE classes SET capacity = 1 WHERE id = ?').run(full);
  const other = (await db.prepare("INSERT INTO members (name, barcode, member_type, active) VALUES ('Other Kid', 'OK', 'student', 1) RETURNING id").get()).id;
  await setEnrollment(full, [other]);
  await setEnrollment(oldClass, [kid]);

  const parentAgent = request.agent(app);
  await parentAgent.post('/login').type('form').send({ email: 'switch@example.com', password: 'testpassword123', next: '/parent' });
  // A real request: "schedule change request form shouldn't be a subpage
  // it should be a button on the classroom dashboard. It should say
  // schedule changes/withdraw."
  const nav = await parentAgent.get('/parent/classes');
  assert.doesNotMatch(nav.text, /Schedule Change Request</, 'no longer its own subpage');
  const old = await parentAgent.get('/parent/classes/schedule-change');
  assert.equal(old.headers.location, '/parent/classes/dashboard?changes=1', 'old links open the popup');
  const form = await parentAgent.get('/parent/classes/dashboard?changes=1');
  assert.match(form.text, /data-open-schedule-changes>[\s\S]*Schedule Changes\/Withdraw<\/button>/);
  assert.match(form.text, /Would you like to change your classes\?/);
  assert.match(form.text, /Would you like to withdraw from all classes\?/);
  assert.match(form.text, /data-open-on-load/);
  assert.match(form.text, new RegExp(`name="drop" value="${kid}:${oldClass}" /> Delete`), 'current class with Delete');
  assert.match(form.text, new RegExp(`name="add" value="${kid}:${newArt}"`), 'class with room offered');
  assert.doesNotMatch(form.text, new RegExp(`name="add" value="${kid}:${full}"`), 'a full class is not offered');
  assert.doesNotMatch(form.text, new RegExp(`name="add" value="${kid}:${oldClass}"`), 'not a class they already have');

  await parentAgent.post('/parent/classes/schedule-change').type('form').send({ _csrf: csrfOf(form.text), drop: `${kid}:${oldClass}`, add: [`${kid}:${newArt}`, `${kid}:${newChess}`], note: 'Pottery conflicts with nap time' });
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM class_enrollments WHERE student_id = ? AND class_id = ?').get(kid, oldClass)).n), 1, 'nothing changes until approved');

  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const settings = await admin.get('/admin/settings?tab=quicklinks');
  assert.match(settings.text, /href="\/parent\/classes\/dashboard\?changes=1" target="_blank">Schedule Changes\/Withdraw</);
  const log = await admin.get('/admin/schedule-changes');
  assert.match(log.text, /href="\/admin\/schedule-changes">Schedule Change Requests/);
  assert.match(log.text, /Switch Family/);
  const id = /href="\/admin\/schedule-changes\?id=(\d+)"/.exec(log.text)[1];
  const detail = await admin.get(`/admin/schedule-changes?id=${id}`);
  assert.match(detail.text, /Pottery conflicts with nap time/);
  const chessItem = (await db.prepare("SELECT id FROM schedule_change_items WHERE request_id = ? AND class_id = ?").get(id, newChess)).id;
  assert.match(detail.text, new RegExp(`name="decline" value="${chessItem}" /> Decline`));

  await admin.post(`/admin/schedule-changes/${id}/approve`).type('form').send({ _csrf: csrfOf(detail.text), decline: String(chessItem) });

  const classesNow = (await db.prepare('SELECT class_id FROM class_enrollments WHERE student_id = ? ORDER BY class_id').all(kid)).map((r) => r.class_id);
  assert.deepEqual(classesNow, [newArt], 'out of the cancelled class, into the approved one, not the declined one');
  const reg = await db.prepare("SELECT status, charge_id FROM class_registrations WHERE student_id = ? AND class_id = ?").get(kid, newArt);
  assert.equal(reg.status, 'confirmed');
  assert.ok(reg.charge_id, 'the class price is charged, same as a normal registration');
  const roster = await db.prepare('SELECT 1 FROM roster_members rm JOIN classes c ON c.roster_id = rm.roster_id WHERE c.id = ? AND rm.member_id = ?').get(newArt, kid);
  assert.ok(roster, 'on the new class roster');
  const tag = await db.prepare("SELECT * FROM name_tag_requests WHERE member_id = ? AND request_type = 'schedule_change'").get(kid);
  assert.ok(tag, 'a name tag reprint was requested');
  assert.equal((await db.prepare('SELECT status FROM schedule_change_requests WHERE id = ?').get(id)).status, 'partial');

  const history = await parentAgent.get('/parent/classes/dashboard');
  assert.match(history.text, /Add: Kim Switch &ndash; New Chess[^<]*<span class="hint">\(Declined\)/);
});

// A real request: "the classes should be in day and time order for easy
// reading... Clear division between days."
test('Schedule Changes lists each student\'s classes in day and time order with a heading per day', async () => {
  const fam = (await db.prepare("INSERT INTO families (name) VALUES ('Order') RETURNING id").get()).id;
  const parent = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, is_primary_parent, active) VALUES ('Olive Order', 'OO', 'parent', ?, 1, 1) RETURNING id").get(fam)).id;
  const kid = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, active) VALUES ('Otto Order', 'OT', 'student', ?, 1) RETURNING id").get(fam)).id;
  const acct = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, 'order@example.com', ?, 'active', now_text()) RETURNING id").get(parent, hashPassword('testpassword123'))).id;
  await db.prepare("INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = 'parent'))").run(acct);
  const wedLate = await createClass({ day: 'wednesday', hourPosition: 3, className: 'Wed Late Class' });
  const monEarly = await createClass({ day: 'monday', hourPosition: 1, className: 'Mon Early Class' });
  const wedEarly = await createClass({ day: 'wednesday', hourPosition: 1, className: 'Wed Early Class' });
  await setEnrollment(wedLate, [kid]);
  await setEnrollment(monEarly, [kid]);
  await setEnrollment(wedEarly, [kid]);
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'order@example.com', password: 'testpassword123' });
  const page = (await agent.get('/parent/classes/dashboard')).text;
  const current = page.slice(page.indexOf('Current Class Schedule'), page.indexOf('Replacement Class Options'));
  const order = ['<li class="sc-day">Monday', 'Mon Early Class', '<li class="sc-day">Wednesday', 'Wed Early Class', 'Wed Late Class'].map((t) => current.indexOf(t));
  assert.ok(order.every((v) => v >= 0), 'all present');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'day headings and classes in day/time order');

  // Parent Information subpage.
  const nav = await agent.get('/parent/classes');
  assert.match(nav.text, /href="\/parent\/classes\/info">Parent Information</);
  assert.ok(nav.text.indexOf('>Parent Information<') < nav.text.indexOf('>Class Registration<'), 'Parent Information is the first Co-op Classes subpage');
  const info = await agent.get('/parent/classes/info');
  assert.equal(info.status, 200);
  assert.match(info.text, /href="\/volunteers"[^>]*>[\s\S]*?Floater Assignments/);
  assert.match(info.text, /href="\/setup"[^>]*>[\s\S]*?Setup\/Cleanup Assignments/);
  assert.match(info.text, /href="\/parent\/handbook"[\s\S]*?Policy Handbook/);
  assert.match(info.text, /Steps for Participating in Co-op Classes/);
});
