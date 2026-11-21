// A real request: "Settings gear. Semesters. Add an archive icon to each
// semester. Click and there is a pop up that says are you sure you want to
// archive this semester. All classes, rosters, class chats, and
// registration will be archived for this semester and will not show up on
// ANY portals. Be able to unarchive a semester. Be able to simply view
// anything from an archived semester."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `semester-archive-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `semester-archive-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { generateMemberCode } = require('../utils/members');
const { hashPassword } = require('../utils/portalAuth');
const { createClass, setEnrollment, allClassesList, listSemesters, listScheduleCombos } = require('../utils/classSchedule');
const { registerForClass, classRegistrationLogRows } = require('../utils/classRegistration');
const { schedulesForMembers } = require('../utils/schedule');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

const csrfOf = (html) => /name="csrf-token" content="([^"]*)"/.exec(html)[1];

async function loginAdmin() {
  const res = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  return res.headers['set-cookie'];
}

async function teacherFor(classId) {
  const code = await generateMemberCode();
  const memberId = (await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, active) VALUES ('Archive Teacher', ?, ?, 'parent', 1) RETURNING id").get(code, code)).id;
  await db.prepare("INSERT INTO class_staff (class_id, member_id, role) VALUES (?, ?, 'teacher')").run(classId, memberId);
  const acct = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, 'arch-teacher@example.com', ?, 'active', now_text()) RETURNING id").get(memberId, hashPassword('testpassword123'))).id;
  await db.prepare("INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = 'teacher'))").run(acct);
  const res = await request(app).post('/login').type('form').send({ email: 'arch-teacher@example.com', password: 'testpassword123', next: '/teacher' });
  return { cookie: res.headers['set-cookie'], accountId: acct };
}

test('archive a semester: hidden everywhere, viewable read-only, and unarchive brings it back', async () => {
  const admin = await loginAdmin();
  const fall = (await db.prepare("INSERT INTO semesters (title) VALUES ('Fall 2025 Archive Test') RETURNING id").get()).id;
  const spring = (await db.prepare("INSERT INTO semesters (title) VALUES ('Spring 2027 Archive Test') RETURNING id").get()).id;
  await db.prepare("INSERT INTO class_schedules (title, day_of_week, semester_id) VALUES ('Fall 2025 - Monday', 'monday', ?)").run(fall);
  const oldClass = await createClass({ day: 'monday', hourPosition: 1, className: 'Old Fall Pottery', room: 'Room 1', semesterId: fall });
  const newClass = await createClass({ day: 'monday', hourPosition: 2, className: 'New Spring Robotics', room: 'Room 2', semesterId: spring });
  const kid = (await db.prepare("INSERT INTO members (name, barcode, member_type, active) VALUES ('Archive Kid', 'AK-1', 'student', 1) RETURNING id").get()).id;
  await setEnrollment(oldClass, [kid]);
  const teacher = await teacherFor(oldClass);
  await db.prepare("INSERT INTO class_registrations (class_id, student_id, registered_by_account_id, status) VALUES (?, ?, ?, 'confirmed')").run(oldClass, kid, teacher.accountId);
  await db.prepare('INSERT INTO class_chat_messages (class_id, author_name, body) VALUES (?, ?, ?)').run(oldClass, 'mainadmin', 'See you Monday!');

  // Settings > Semesters: an archive icon with the requested confirm wording.
  const settings = await request(app).get('/admin/settings?tab=semesters').set('Cookie', admin);
  assert.match(settings.text, new RegExp(`action="/admin/schedule/semesters/${fall}/archive"[^>]*data-confirm="Are you sure you want to archive the &quot;Fall 2025 Archive Test&quot; semester\\? All classes, rosters, class chats, and registration will be archived for this semester and will not show up on ANY portals\\.`));
  assert.match(settings.text, /aria-label="Archive Fall 2025 Archive Test"/);

  const archive = await request(app).post(`/admin/schedule/semesters/${fall}/archive`).set('Cookie', admin).type('form').send({ back: '/admin/settings?tab=semesters', _csrf: csrfOf(settings.text) });
  assert.equal(archive.status, 302);
  assert.match(decodeURIComponent(archive.headers.location), /notice=Archived "Fall 2025 Archive Test"/);

  // Hidden everywhere.
  assert.ok(!(await listSemesters()).some((s) => s.id === fall), 'not in semester pickers');
  assert.ok(!(await listScheduleCombos()).some((c) => c.semesterId === fall), 'not in semester/day pickers');
  const all = await allClassesList(null);
  assert.ok(!all.some((c) => c.id === oldClass), 'not in class lists (all portals)');
  assert.ok(all.some((c) => c.id === newClass), 'other semesters unaffected');
  assert.ok(!(await classRegistrationLogRows()).some((r) => r.className === 'Old Fall Pottery'), 'not in the registration log');
  const sched = await schedulesForMembers([kid]);
  assert.ok(!JSON.stringify(sched).includes('Old Fall Pottery'), 'not on member schedules');
  const rostersList = await request(app).get('/admin/rosters?tab=classes').set('Cookie', admin);
  assert.doesNotMatch(rostersList.text, /Old Fall Pottery/, 'not in Attendance > Class Rosters');
  const teacherHome = await request(app).get('/teacher/classes').set('Cookie', teacher.cookie);
  assert.doesNotMatch(teacherHome.text, /Old Fall Pottery/, "not in the teacher's classes");
  assert.equal((await request(app).get(`/teacher/classes/${oldClass}`).set('Cookie', teacher.cookie)).status, 403);
  assert.equal((await request(app).get(`/teacher/classes/${oldClass}/fragment`).set('Cookie', teacher.cookie)).status, 404);
  const reg = await registerForClass({ classId: oldClass, studentId: kid, accountId: teacher.accountId, portalRoles: ['parent'], registrantType: 'parent' });
  assert.equal(reg.ok, false, 'no new registrations');

  // Archived list in Settings, with View and Unarchive.
  const settings2 = await request(app).get('/admin/settings?tab=semesters').set('Cookie', admin);
  assert.match(settings2.text, /Archived Semesters/);
  assert.match(settings2.text, new RegExp(`href="/admin/schedule/semesters/${fall}/archive">View<`));
  assert.match(settings2.text, new RegExp(`action="/admin/schedule/semesters/${fall}/unarchive"`));

  // View page: classes, rosters, chats, registrations.
  const view = await request(app).get(`/admin/schedule/semesters/${fall}/archive`).set('Cookie', admin);
  assert.equal(view.status, 200);
  assert.match(view.text, /Archived semester - view only/);
  assert.match(view.text, new RegExp(`href="/admin/class-schedule/classes/${oldClass}/manage"`));
  assert.match(view.text, /Archive Kid/);
  assert.doesNotMatch(view.text, /New Spring Robotics/);

  // The class page opens, view-only; changes are refused.
  const manage = await request(app).get(`/admin/class-schedule/classes/${oldClass}/manage`).set('Cookie', admin);
  assert.equal(manage.status, 200);
  assert.match(manage.text, /<strong>View only\.<\/strong> This class is in the archived semester/);
  assert.doesNotMatch(manage.text, />Delete Class</, 'no Delete Class on an archived class');
  const edit = await request(app).post(`/admin/class-schedule/classes/${oldClass}/staff/add`).set('Cookie', admin).type('form').send({ _csrf: csrfOf(manage.text), memberId: kid, role: 'assistant' });
  assert.equal(edit.status, 302);
  assert.match(decodeURIComponent(edit.headers.location), /archived semester, so it is view-only/);
  // Copy Class: an archived class can still be copied into an active semester.
  assert.match(manage.text, /Copy Class<\/button>/);
  assert.match(manage.text, /<option value="" selected disabled>Choose an active semester\.\.\.<\/option>/);
  assert.doesNotMatch(manage.text, /<option value="\d+">Fall 2025 Archive Test/, 'archived semester not offered');
  const noTarget = await request(app).post(`/admin/class-schedule/classes/${oldClass}/duplicate`).set('Cookie', admin).type('form').send({ _csrf: csrfOf(manage.text), targetComboId: '' });
  assert.match(decodeURIComponent(noTarget.headers.location), /Choose a semester\/day/);
  const springCombo = (await db.prepare("INSERT INTO class_schedules (title, day_of_week, semester_id) VALUES ('Spring 2027 - Monday', 'monday', ?) RETURNING id").get(spring)).id;
  const copy = await request(app).post(`/admin/class-schedule/classes/${oldClass}/duplicate`).set('Cookie', admin).type('form').send({ _csrf: csrfOf(manage.text), targetComboId: springCombo, copyDescription: '1' });
  assert.match(decodeURIComponent(copy.headers.location), /Copied as "Old Fall Pottery"/);
  const copiedId = parseInt(/classes\/(\d+)\/manage/.exec(copy.headers.location)[1], 10);
  const copied = await db.prepare('SELECT semester_id, class_name FROM classes WHERE id = ?').get(copiedId);
  assert.equal(copied.semester_id, spring);
  assert.ok((await allClassesList(null)).some((c) => c.id === copiedId), 'the copy is active');

  const att = await request(app).post(`/admin/rosters/class-${oldClass}/attendance`).set('Cookie', admin).set('X-Requested-With', 'fetch').set('X-CSRF-Token', csrfOf(manage.text)).type('form').send({ [`status:${kid}:2025-09-01`]: 'present' });
  assert.equal(att.status, 409);

  // The day rosters for that semester open view-only too.
  const dayRoster = await request(app).get(`/admin/rosters?tab=monday-student&semesterId=${fall}`).set('Cookie', admin);
  assert.equal(dayRoster.status, 200);
  assert.match(dayRoster.text, /This roster is in the archived semester/);
  const addDate = await request(app).post(`/admin/rosters/monday-student/dates/add?semesterId=${fall}`).set('Cookie', admin).set('X-Requested-With', 'fetch').set('X-CSRF-Token', csrfOf(manage.text)).type('form').send({ date: '2025-09-08' });
  assert.equal(addDate.status, 409);

  // Unarchive: everything is back.
  const un = await request(app).post(`/admin/schedule/semesters/${fall}/unarchive`).set('Cookie', admin).type('form').send({ back: '/admin/settings?tab=semesters', _csrf: csrfOf(settings2.text) });
  assert.match(decodeURIComponent(un.headers.location), /Unarchived "Fall 2025 Archive Test"/);
  assert.ok((await allClassesList(null)).some((c) => c.id === oldClass));
  assert.ok((await classRegistrationLogRows()).some((r) => r.className === 'Old Fall Pottery'));
  assert.equal((await request(app).get(`/teacher/classes/${oldClass}`).set('Cookie', teacher.cookie)).status, 200);
});
