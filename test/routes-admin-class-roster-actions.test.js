// A real request: "Co-op admin portal, attendance, class rosters. When you
// click on each class it should show check in and out buttons, as well as
// view lesson plan, view sub plan buttons." (routes/admin-rosters.js's
// /rosters/classes/:id/*, utils/classScan.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `admin-class-roster-actions-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `admin-class-roster-actions-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { createClass, ensureDayRoster } = require('../utils/classSchedule');
const { createAssignment } = require('../utils/academics');
const { createSubstitutePlan } = require('../utils/substitutePlans');
const { todayISO } = require('../utils/dates');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

async function loginAsAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  return loginRes.headers['set-cookie'];
}

test('class roster: View Lesson Plan / View Substitute Plan above Check In / Check Out, all working', async () => {
  const cookie = await loginAsAdmin();
  const classId = await createClass({ day: 'monday', hourPosition: 1, className: 'Roster Actions Class', room: 'Room 1' });
  const cls = await db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  assert.ok(cls.roster_id, 'the class has a roster');

  // A student on the class roster, with today as a session day.
  const student = (await db.prepare("INSERT INTO members (name, barcode, member_type) VALUES ('Roster Kid', 'RK-100', 'student') RETURNING id").get()).id;
  await db.prepare("INSERT INTO roster_members (roster_id, member_id, source) VALUES (?, ?, 'auto')").run(cls.roster_id, student);
  const studentRosterId = await ensureDayRoster('monday', 'student', cls.semester_id);
  await db.prepare('INSERT INTO roster_dates (roster_id, session_date) VALUES (?, ?) ON CONFLICT DO NOTHING').run(studentRosterId, todayISO());

  const page = await request(app).get(`/admin/rosters?tab=class-${classId}`).set('Cookie', cookie);
  assert.equal(page.status, 200);
  const main = page.text.slice(page.text.indexOf('<main id="main-content"'));
  const lp = main.indexOf(`/admin/rosters/classes/${classId}/view-lesson-plan`);
  const sp = main.indexOf(`/admin/rosters/classes/${classId}/view-substitute-plan`);
  const ci = main.indexOf(`/admin/rosters/classes/${classId}/scan?mode=checkin`);
  const co = main.indexOf(`/admin/rosters/classes/${classId}/scan?mode=checkout`);
  assert.ok(lp > 0 && sp > lp && ci > sp && co > ci, 'View Lesson Plan, View Substitute Plan, then Check In, Check Out');

  // The day-level Parent/Student rosters don't get these buttons.
  const dayPage = await request(app).get('/admin/rosters?tab=monday-student').set('Cookie', cookie);
  assert.doesNotMatch(dayPage.text, /\/admin\/rosters\/classes\/\d+\/scan/);

  // Check In / Check Out open the scan screen, coming back to this roster.
  const scan = await request(app).get(`/admin/rosters/classes/${classId}/scan?mode=checkin`).set('Cookie', cookie);
  assert.equal(scan.status, 200);
  assert.match(scan.text, new RegExp(`data-scan-base-url="/admin/rosters/classes/${classId}"`));
  assert.match(scan.text, new RegExp(`data-complete-url="/admin/rosters\\?tab=class-${classId}"`));
  const csrf = /name="csrf-token" content="([^"]*)"/.exec(scan.text)[1];

  const checkin = await request(app).post(`/admin/rosters/classes/${classId}/scan/checkin`).set('Cookie', cookie).set('X-CSRF-Token', csrf).type('form').send({ barcode: 'RK-100' });
  assert.equal(checkin.body.ok, true, JSON.stringify(checkin.body));
  const att = await db.prepare('SELECT * FROM attendance WHERE member_id = ? AND roster_id = ? AND session_date = ?').get(student, cls.roster_id, todayISO());
  assert.equal(att.status, 'present');
  assert.equal(att.source, 'admin_class_checkin');
  assert.ok(att.check_in_time);

  const again = await request(app).post(`/admin/rosters/classes/${classId}/scan/checkin`).set('Cookie', cookie).set('X-CSRF-Token', csrf).type('form').send({ barcode: 'RK-100' });
  assert.equal(again.body.alreadyChecked, true);

  const checkout = await request(app).post(`/admin/rosters/classes/${classId}/scan/checkout`).set('Cookie', cookie).set('X-CSRF-Token', csrf).type('form').send({ barcode: 'RK-100' });
  assert.equal(checkout.body.ok, true);
  assert.ok(await db.prepare('SELECT check_out_time FROM checkouts WHERE member_id = ? AND roster_id = ? AND session_date = ?').get(student, cls.roster_id, todayISO()));

  const unknown = await request(app).post(`/admin/rosters/classes/${classId}/scan/checkin`).set('Cookie', cookie).set('X-CSRF-Token', csrf).type('form').send({ barcode: 'NOPE-999' });
  assert.equal(unknown.body.ok, false);

  // Someone not on this class's roster is refused.
  await db.prepare("INSERT INTO members (name, barcode, member_type) VALUES ('Other Kid', 'OK-200', 'student')").run();
  const notEnrolled = await request(app).post(`/admin/rosters/classes/${classId}/scan/checkin`).set('Cookie', cookie).set('X-CSRF-Token', csrf).type('form').send({ barcode: 'OK-200' });
  assert.equal(notEnrolled.body.ok, false);
  assert.match(notEnrolled.body.message, /not enrolled/);

  // View Lesson Plan / View Substitute Plan: read-only, every status.
  await createAssignment({ classId, className: 'Roster Actions Class', title: 'Draft Week', approvalStatus: 'draft' });
  await createSubstitutePlan({ classId, title: 'Snow Day Plan', teacherNotes: 'Mittens in the bin.', approvalStatus: 'pending' });
  const lessonView = await request(app).get(`/admin/rosters/classes/${classId}/view-lesson-plan`).set('Cookie', cookie);
  assert.equal(lessonView.status, 200);
  assert.match(lessonView.text, /Roster Actions Class Lesson Plan/);
  assert.match(lessonView.text, /Draft Week/);
  assert.match(lessonView.text, /badge-pill-gray">Draft</);
  assert.match(lessonView.text, new RegExp(`href="/admin/rosters\\?tab=class-${classId}"`));
  const subView = await request(app).get(`/admin/rosters/classes/${classId}/view-substitute-plan`).set('Cookie', cookie);
  assert.equal(subView.status, 200);
  assert.match(subView.text, /Snow Day Plan/);
  assert.match(subView.text, /Mittens in the bin\./);
  assert.match(subView.text, /badge-pill-orange">Submitted</);
  assert.doesNotMatch(subView.text, />Edit Substitute Plan</);

  // Not logged in: no access.
  assert.notEqual((await request(app).get(`/admin/rosters/classes/${classId}/view-lesson-plan`)).status, 200);
  assert.notEqual((await request(app).post(`/admin/rosters/classes/${classId}/scan/checkin`).type('form').send({ barcode: 'RK-100' })).status, 200);
});

// A real request: "click on a class, click lessons tab, there shouldn't be
// a quiz review button... Add an attendance tab to the classes. Click the
// attendance tab and its will show the attendance grid. Be able to
// manually check attendance and check in and out buttons."
test('class page: no Quiz Review on Lessons; Attendance tab with the grid, manual P/L/A and Check In/Out', async () => {
  const cookie = await loginAsAdmin();
  const classId = await createClass({ day: 'monday', hourPosition: 2, className: 'Attendance Tab Class', room: 'Room 2' });
  const cls = await db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  const student = (await db.prepare("INSERT INTO members (name, barcode, member_type) VALUES ('Tab Kid', 'TK-300', 'student') RETURNING id").get()).id;
  await db.prepare("INSERT INTO roster_members (roster_id, member_id, source) VALUES (?, ?, 'auto')").run(cls.roster_id, student);
  const studentRosterId = await ensureDayRoster('monday', 'student', cls.semester_id);
  await db.prepare('INSERT INTO roster_dates (roster_id, session_date) VALUES (?, ?) ON CONFLICT DO NOTHING').run(studentRosterId, todayISO());

  const lessons = await request(app).get(`/admin/class-schedule/classes/${classId}/manage?tab=assignments`).set('Cookie', cookie);
  assert.equal(lessons.status, 200);
  assert.doesNotMatch(lessons.text, />Quiz Review</);
  assert.match(lessons.text, /href="\?tab=attendance">Attendance</);

  const tab = await request(app).get(`/admin/class-schedule/classes/${classId}/manage?tab=attendance`).set('Cookie', cookie);
  assert.equal(tab.status, 200);
  assert.match(tab.text, /class="view-tab active" href="\?tab=attendance">Attendance</);
  assert.match(tab.text, /Tab Kid/);
  assert.match(tab.text, new RegExp(`data-endpoint="/admin/rosters/class-${classId}/attendance" data-member="${student}" data-date="${todayISO()}"`));
  assert.match(tab.text, new RegExp(`href="/admin/rosters/classes/${classId}/scan\\?mode=checkin&from=manage"`));
  assert.match(tab.text, new RegExp(`href="/admin/rosters/classes/${classId}/scan\\?mode=checkout&from=manage"`));
  assert.match(tab.text, /\/js\/attendance-grid\.js/);

  // Manually marking attendance saves through the class roster.
  const csrf = /name="csrf-token" content="([^"]*)"/.exec(tab.text)[1];
  const save = await request(app)
    .post(`/admin/rosters/class-${classId}/attendance`)
    .set('Cookie', cookie)
    .set('X-Requested-With', 'fetch')
    .set('X-CSRF-Token', csrf)
    .type('form')
    .send({ [`status:${student}:${todayISO()}`]: 'late' });
  assert.equal(save.body.ok, true);
  assert.equal((await db.prepare('SELECT status FROM attendance WHERE member_id = ? AND roster_id = ? AND session_date = ?').get(student, cls.roster_id, todayISO())).status, 'late');

  // The scan screen opened from here comes back to this tab.
  const scan = await request(app).get(`/admin/rosters/classes/${classId}/scan?mode=checkin&from=manage`).set('Cookie', cookie);
  assert.match(scan.text, new RegExp(`data-complete-url="/admin/class-schedule/classes/${classId}/manage\\?tab=attendance"`));
});
