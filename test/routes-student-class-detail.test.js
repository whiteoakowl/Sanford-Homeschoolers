// HTTP-level coverage for the Student Portal's new "Classes" card list +
// class detail page (a real request: a card list with a Monday/Wednesday/
// All filter, plus a class detail view with tabs for Assignments/Lessons/
// Class Forum/Resources/Attendance/Assessments/Grades). This first pass is
// read-only: Assignments/Grades/Attendance reuse real existing data
// (utils/academics.js, the class's own auto-roster attendance), Class
// Forum links to the class's real /forums/:id category when a Main Admin
// has created one, and Lessons/Assessments/Resources are simple stubs
// since there's no per-class content model for those yet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `student-class-detail-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `student-class-detail-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');
const classSchedule = require('../utils/classSchedule');
const academics = require('../utils/academics');
const forums = require('../utils/forums');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

let counter = 0;

async function createStudent(name) {
  counter++;
  const barcode = `class-detail-test-${counter}`;
  const email = `class-detail-test-${counter}@example.com`;
  const memberId = (
    await db.prepare('INSERT INTO members (name, barcode, member_type) VALUES (?, ?, ?)').run(name, barcode, 'student')
  ).lastInsertRowid;
  const accountId = (
    await db
      .prepare("INSERT INTO member_accounts (member_id, email, password_hash, status) VALUES (?, ?, ?, 'active')")
      .run(memberId, email, hashPassword('testpassword123'))
  ).lastInsertRowid;
  const role = await db.prepare("SELECT id FROM roles WHERE key = 'student'").get();
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountId, role.id);
  const res = await request(app).post('/login').type('form').send({ email, password: 'testpassword123' });
  return { memberId, cookie: res.headers['set-cookie'] };
}

async function createClassWithTeacher(day, className, teacherName) {
  const classId = await classSchedule.createClass({ day, hourPosition: 1, className, room: 'Room 1' });
  const teacherId = (
    await db.prepare("INSERT INTO members (name, barcode, member_type) VALUES (?, ?, 'admin')").run(teacherName, `teacher-${classId}`)
  ).lastInsertRowid;
  await classSchedule.addStaff(classId, teacherId, 'teacher');
  return classId;
}

// A later real request ("this is not the page to view the classes the
// student is registered for. It is for viewing the current class
// schedules of classes available") reworked /student/classes from a
// filtered "My Classes" list into the exact same read-only Room x Hour
// schedule grid as Parent Portal's own Class Registration page (views/
// partials/member-class-schedule-grid.ejs, shared by both) - every class
// scheduled that day shows now, not just this student's own; a passive
// "Registered" badge (not a button/action) marks this student's own
// enrolled class. A still later real request ("should be able to click
// on each class and view the information, student is not able to
// register for classes") made each card clickable again (clickable:
// true), opening the same read-only info popup Co-op Teacher Portal's
// own identical grid already uses (public/js/student-class-view.js,
// /student/classes/:id/fragment) - still no Register/Cancel controls
// anywhere on this page.
test('Co-op Schedule page shows every class scheduled that day, badging this student\'s own enrolled class as "Registered", and every card is clickable to view (never to register)', async () => {
  const { memberId, cookie } = await createStudent('Classes Card Student');
  const enrolledId = await classSchedule.createClass({ day: 'monday', hourPosition: 1, className: 'Enrolled Art Class', room: 'Room 1' });
  const otherId = await classSchedule.createClass({ day: 'monday', hourPosition: 1, className: 'Not Enrolled Science Class', room: 'Room 2' });
  await classSchedule.setEnrollment(enrolledId, [memberId]);

  const res = await request(app).get('/student/classes?day=monday').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /Enrolled Art Class/);
  assert.match(res.text, /Not Enrolled Science Class/, 'every class scheduled this day should show, not just this student\'s own');

  const enrolledNameIndex = res.text.indexOf('Enrolled Art Class');
  const enrolledCardStart = res.text.lastIndexOf('class="class-card', enrolledNameIndex);
  assert.match(res.text.slice(enrolledCardStart, enrolledNameIndex + 400), /badge-pill-present" title="You are enrolled in this class">Registered</);

  const otherNameIndex = res.text.indexOf('Not Enrolled Science Class');
  const otherCardStart = res.text.lastIndexOf('class="class-card', otherNameIndex);
  assert.doesNotMatch(res.text.slice(otherCardStart, otherNameIndex + 400), />Registered</);

  // Clickable to view, never to register - data-view-class (opens the
  // read-only popup) is present, but no Register/Cancel form action ever is.
  assert.match(res.text, new RegExp(`data-view-class="${enrolledId}"`));
  assert.doesNotMatch(res.text, /action="\/student\/classes\/\d+\/register"/);
  assert.doesNotMatch(res.text, /action="\/student\/classes\/\d+\/unregister"/);
  void otherId;
});

// Same read-only info popup Co-op Teacher Portal's own identical grid
// uses (routes/teacher-portal.js's own /classes/:id/fragment) - not
// gated to classes this student is enrolled in, and never any register/
// join control.
test('Co-op Schedule class-info fragment shows teacher/room/time/description for any scheduled class, enrolled or not, with no register control', async () => {
  const student = await createStudent('Fragment Student');
  const classId = await createClassWithTeacher('monday', 'Pottery Basics', 'Ms. Clay');
  await db.prepare('UPDATE classes SET description = ? WHERE id = ?').run('Hand-building and glazing for beginners.', classId);

  const res = await request(app).get(`/student/classes/${classId}/fragment`).set('Cookie', student.cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /Pottery Basics/);
  assert.match(res.text, /Ms\. Clay/);
  assert.match(res.text, /Room 1/);
  assert.match(res.text, /Hand-building and glazing for beginners\./);
  assert.doesNotMatch(res.text, /action="\/student\/classes\/\d+\/register"/);
  assert.doesNotMatch(res.text, />Register</);
});

test('Co-op Schedule class-info fragment 404s for an unknown class id', async () => {
  const student = await createStudent('Fragment 404 Student');
  const res = await request(app).get('/student/classes/999999/fragment').set('Cookie', student.cookie);
  assert.equal(res.status, 404);
});

// A real request: "Student portal. Classes, remove the name tag form and
// absence form sub pages. Students don't need access to those" - both
// are a parent-facing concern (reporting a child's absence, printing a
// child's name tag), not something a student fills out for themself.
// Their own /absence and /student/name-tag routes are untouched - never
// part of this group to begin with.
//
// A later real request renamed Classes to "Co-op Schedule" (still its
// own standing tab, with the same Class Schedule/Classroom Dashboard
// subpages as before). A separate real request gave Classroom Dashboard
// its own full standing tab too (a different, consolidated hub tab -
// see portal-nav.ejs's own STUDENT_NAV_LINKS for both).
test('Student Portal nav offers Co-op Schedule and Classroom Dashboard as standing tabs, not Absence/Late Form or Name Tag Form', async () => {
  const { cookie } = await createStudent('Nav Subpages Student');
  const res = await request(app).get('/student').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /Co-op Schedule/, 'Class Schedule was renamed and promoted to its own tab');
  assert.match(res.text, /Classroom Dashboard/, 'Classroom Dashboard is its own tab too, starting the new "Classroom" section');
  assert.doesNotMatch(res.text, /Absence\/Late Form/);
  assert.doesNotMatch(res.text, /Name Tag Form/);
});

test('a class detail page 404s for a class this student is not enrolled in', async () => {
  const { cookie } = await createStudent('Not Enrolled Student');
  const classId = await createClassWithTeacher('monday', 'Someone Else\'s Class', 'Ms. Teacher');
  const res = await request(app).get(`/student/classes/dashboard/${classId}`).set('Cookie', cookie);
  assert.equal(res.status, 404);
});

// A real bug report: "on this page it switches back to co-op schedule
// tab. It should stay under classroom dashboard tab." This page used to
// live at the bare /student/classes/:id, a literal URL prefix of Co-op
// Schedule's own /student/classes - the nav's own longest-prefix
// highlighting (public/js/admin-nav.js) always picked Co-op Schedule
// over Classroom Dashboard there. Moved under /student/classes/
// dashboard/:id - the old bare path is gone entirely, and the
// Classroom Dashboard nav link now carries a data-match claiming that
// whole namespace back.
test('class detail page lives under /classes/dashboard/:id (not the bare /classes/:id, which is gone), and Classroom Dashboard\'s own nav link claims that namespace via data-match', async () => {
  const { memberId, cookie } = await createStudent('Nav Match Student');
  const classId = await createClassWithTeacher('monday', 'Nav Match Class', 'Ms. Match');
  await classSchedule.setEnrollment(classId, [memberId]);

  const oldPath = await request(app).get(`/student/classes/${classId}`).set('Cookie', cookie);
  assert.equal(oldPath.status, 404, 'the old bare /classes/:id route should no longer exist');

  const newPath = await request(app).get(`/student/classes/dashboard/${classId}`).set('Cookie', cookie);
  assert.equal(newPath.status, 200);
  assert.match(newPath.text, /Nav Match Class/);

  const home = await request(app).get('/student').set('Cookie', cookie);
  // A desktopAsSection nav entry (Classroom Dashboard) renders no real
  // top-level link inside #admin-nav-links itself (its real links live
  // in their own titled section below) - this hidden anchor exists
  // purely so public/js/admin-nav.js's own longest-prefix matcher has a
  // real, longer-matching candidate to compete with Co-op Schedule's own
  // href (a literal prefix of /student/classes/dashboard/*) inside that
  // SAME container, instead of Co-op Schedule winning uncontested.
  assert.match(home.text, /<a href="\/student\/family-school\/portfolio" data-match="\/student\/classes\/dashboard" hidden><\/a>/);
  // Its own titled section's own real "Classes" link - public/js/admin-
  // nav.js's own generic `nav[id$="-nav-links"]` sweep highlights this
  // container too, not just the four pages had before.
  assert.match(home.text, /<nav id="classroom-dashboard-nav-links">[\s\S]*?<a href="\/student\/classes\/dashboard">/);
});

// A real request: "click on the class, it shows tabs for the class such
// as details, assignments, lessons etc. All the tabs should be green
// buttons in two clean rows, shrink to fit text properly on mobile."
test('class detail page\'s 8 tabs render as green roster-action-btn tiles (the same roster-btn-row-grid.js system lays them out as 2 rows of 4 on mobile), not the old blue file-tab strip', async () => {
  const { memberId, cookie } = await createStudent('Green Tabs Student');
  const classId = await createClassWithTeacher('monday', 'Green Tabs Class', 'Ms. Green');
  await classSchedule.setEnrollment(classId, [memberId]);

  const res = await request(app).get(`/student/classes/dashboard/${classId}`).set('Cookie', cookie);
  assert.equal(res.status, 200);
  const rowMatch = /<div class="roster-btn-row class-detail-tab-row no-print">([\s\S]*?)<\/div>/.exec(res.text);
  assert.ok(rowMatch, 'expected the green tab row');
  const row = rowMatch[1];
  for (const label of ['Details', 'Assignments', 'Lessons', 'Class Forum', 'Resources', 'Attendance', 'Assessments', 'Grades']) {
    assert.match(row, new RegExp(`class="roster-action-btn roster-action-btn-green${label === 'Details' ? ' active' : ''}" href="\\?tab=${label === 'Class Forum' ? 'forum' : label.toLowerCase()}">${label}`));
  }
});

// A real request: "Filter button should turn into a pill slider toggle
// switching from co-op classes to homeschool family classes."
test('Classroom Dashboard\'s own Classes list offers a Co-op/Family pill toggle instead of the old Filter dropdown', async () => {
  const { cookie } = await createStudent('Pill Toggle Student');
  const res = await request(app).get('/student/classes/dashboard').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, /<summary class="roster-action-btn">Filter<\/summary>/, 'the old Filter popover should be gone');
  assert.match(res.text, /class="day-toggle no-print" role="group" aria-label="Co-op or homeschool family classes"/);
  assert.match(res.text, /class="day-toggle-option active" href="\/student\/classes\/dashboard\?type=coop">Co-op Classes/);
  assert.match(res.text, /class="day-toggle-option" href="\/student\/classes\/dashboard\?type=family">Homeschool Family Classes/);

  const familyView = await request(app).get('/student/classes/dashboard?type=family').set('Cookie', cookie);
  assert.match(familyView.text, /class="day-toggle-option" href="\/student\/classes\/dashboard\?type=coop">Co-op Classes/);
  assert.match(familyView.text, /class="day-toggle-option active" href="\/student\/classes\/dashboard\?type=family">Homeschool Family Classes/);
});

// A later real request ("Parent and student portal. On classroom
// dashboard when you click on a Class card it take you to that class.
// Details should have teachers, assistants, room number, start and end
// dates, start and end time, day of the week, class description, supply
// list") made Details the new default landing tab here, matching Parent
// Portal's own class detail page - Assignments is now reached via its
// own ?tab=assignments, same as every other tab.
test('class detail page defaults to Details', async () => {
  const { memberId, cookie } = await createStudent('Details Default Student');
  const classAId = await createClassWithTeacher('monday', 'Class A', 'Teacher A');
  await classSchedule.setEnrollment(classAId, [memberId]);

  const res = await request(app).get(`/student/classes/dashboard/${classAId}`).set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /class="roster-action-btn roster-action-btn-green active" href="\?tab=details">Details/);
});

test('Assignments tab shows only this class\'s own assignments', async () => {
  const { memberId, cookie } = await createStudent('Assignments Student');
  const classAId = await createClassWithTeacher('monday', 'Class A', 'Teacher A');
  const classBId = await createClassWithTeacher('wednesday', 'Class B', 'Teacher B');
  await classSchedule.setEnrollment(classAId, [memberId]);
  await classSchedule.setEnrollment(classBId, [memberId]);
  await academics.createAssignment({ classId: classAId, className: 'Class A', title: 'Class A Homework', dueDate: '2026-09-05', pointsPossible: 10 });
  await academics.createAssignment({ classId: classBId, className: 'Class B', title: 'Class B Homework', dueDate: '2026-09-06', pointsPossible: 10 });

  const res = await request(app).get(`/student/classes/dashboard/${classAId}?tab=assignments`).set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /Class A Homework/);
  assert.doesNotMatch(res.text, /Class B Homework/);
  assert.match(res.text, /Not graded yet/);
});

test('Grades tab shows only graded assignments with their score', async () => {
  const { memberId, cookie } = await createStudent('Grades Student');
  const classId = await createClassWithTeacher('monday', 'Graded Class', 'Teacher G');
  await classSchedule.setEnrollment(classId, [memberId]);
  const ungradedId = await academics.createAssignment({ classId, className: 'Graded Class', title: 'Ungraded Work', pointsPossible: 10 });
  const gradedId = await academics.createAssignment({ classId, className: 'Graded Class', title: 'Graded Work', pointsPossible: 20 });
  await academics.saveGrade({ assignmentId: gradedId, studentId: memberId, pointsEarned: 18, feedback: 'Great job!' });
  void ungradedId;

  const res = await request(app).get(`/student/classes/dashboard/${classId}?tab=grades`).set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /Graded Work/);
  assert.match(res.text, /18\s*\/\s*20/);
  assert.match(res.text, /Great job!/);
  assert.doesNotMatch(res.text, /Ungraded Work/);
});

test('Attendance tab shows this student\'s own attendance for the class\'s own roster', async () => {
  const { memberId, cookie } = await createStudent('Attendance Student');
  const classId = await createClassWithTeacher('monday', 'Attendance Class', 'Teacher A');
  await classSchedule.setEnrollment(classId, [memberId]);
  const cls = await classSchedule.getClass(classId);
  assert.ok(cls.roster_id, 'a class should always have its own auto-roster');
  await db
    .prepare("INSERT INTO attendance (member_id, roster_id, session_date, status, check_in_time, source) VALUES (?, ?, '2026-09-07', 'present', ?, 'kiosk')")
    .run(memberId, cls.roster_id, Date.now());

  const res = await request(app).get(`/student/classes/dashboard/${classId}?tab=attendance`).set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /status-badge-present/);
  assert.match(res.text, /Present/);
});

test('Class Forum tab links to the class\'s own forum category when one exists, otherwise says none is set up', async () => {
  const { memberId, cookie } = await createStudent('Forum Student');
  const classId = await createClassWithTeacher('monday', 'Forum Class', 'Teacher F');
  await classSchedule.setEnrollment(classId, [memberId]);

  const noForumRes = await request(app).get(`/student/classes/dashboard/${classId}?tab=forum`).set('Cookie', cookie);
  assert.equal(noForumRes.status, 200);
  assert.match(noForumRes.text, /No chat has been set up/);

  const categoryId = await forums.createCategory({ name: 'Forum Class Chat', scope: 'class', classId });
  const withForumRes = await request(app).get(`/student/classes/dashboard/${classId}?tab=forum`).set('Cookie', cookie);
  assert.equal(withForumRes.status, 200);
  assert.match(withForumRes.text, new RegExp(`/forums/${categoryId}`));
});

test('Lessons tab renders the real lesson-content view (no lessons yet); Assessments still renders a stub without crashing', async () => {
  const { memberId, cookie } = await createStudent('Stub Tabs Student');
  const classId = await createClassWithTeacher('monday', 'Stub Class', 'Teacher S');
  await classSchedule.setEnrollment(classId, [memberId]);

  const lessonsRes = await request(app).get(`/student/classes/dashboard/${classId}?tab=lessons`).set('Cookie', cookie);
  assert.equal(lessonsRes.status, 200);
  assert.match(lessonsRes.text, /No lessons yet/);

  const assessmentsRes = await request(app).get(`/student/classes/dashboard/${classId}?tab=assessments`).set('Cookie', cookie);
  assert.equal(assessmentsRes.status, 200);
  assert.match(assessmentsRes.text, /Coming soon/);
});

test('Resources tab links out to the global Resource Links page instead of fabricating class-scoped data', async () => {
  const { memberId, cookie } = await createStudent('Resources Student');
  const classId = await createClassWithTeacher('monday', 'Resources Class', 'Teacher R');
  await classSchedule.setEnrollment(classId, [memberId]);

  const res = await request(app).get(`/student/classes/dashboard/${classId}?tab=resources`).set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /href="\/student\/resources"/);
});
