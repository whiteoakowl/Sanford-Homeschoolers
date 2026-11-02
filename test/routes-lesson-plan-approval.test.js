// Coverage for a real request: "Co-op admin portal. Add a page under
// lesson plans tab called lesson plan approval. Teachers can create
// lesson plans in their teacher portal for a class and click submit for
// approval button, and then it will send a request for approval to the
// co-op admin portal lesson plan approval subpage. When the admin
// approves the lesson plan, it will show on the teacher side on the
// lesson plan approved by admins. Only when it has been approved by
// admins will it be visible to the students who have signed up for the
// class." See supabase/migrations/20261231010000_lesson_plan_approval.sql.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `lesson-plan-approval-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `lesson-plan-approval-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const { PGlite } = require('@electric-sql/pglite');
const app = require('../server');
const db = require('../db');
const { generateMemberCode } = require('../utils/members');
const { hashPassword } = require('../utils/portalAuth');
const { createClass } = require('../utils/classSchedule');
const { createAssignment, createContentItem } = require('../utils/academics');
const { createLessonPlan } = require('../utils/lessonPlans');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

function extractCsrf(html) {
  return /name="csrf-token" content="([^"]*)"/.exec(html)[1];
}

async function loginAsAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const cookie = loginRes.headers['set-cookie'];
  const page = await request(app).get('/admin/lesson-plans').set('Cookie', cookie);
  return { cookie, csrfToken: extractCsrf(page.text) };
}

let counter = 0;

async function makeAccount(memberId, roleKey) {
  counter += 1;
  const email = `approval-${roleKey}-${counter}@example.com`;
  const accountId = (
    await db
      .prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text()) RETURNING id")
      .get(memberId, email, hashPassword('testpassword123'))
  ).id;
  const role = await db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey);
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountId, role.id);
  const loginRes = await request(app).post('/login').type('form').send({ email, password: 'testpassword123', next: `/${roleKey}` });
  return { cookie: loginRes.headers['set-cookie'], accountId, home: `/${roleKey}` };
}

async function makeTeacher(classId) {
  counter += 1;
  const code = await generateMemberCode();
  const memberId = (
    await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, active) VALUES (?, ?, ?, 'parent', 1) RETURNING id").get(`Approval Teacher ${counter}`, code, code)
  ).id;
  await db.prepare("INSERT INTO class_staff (class_id, member_id, role) VALUES (?, ?, 'teacher')").run(classId, memberId);
  const account = await makeAccount(memberId, 'teacher');
  const page = await request(app).get('/teacher').set('Cookie', account.cookie);
  return { ...account, csrfToken: extractCsrf(page.text) };
}

// A family with one enrolled student (Student Portal account) and one
// parent (Parent Portal account).
async function makeFamily(classId) {
  counter += 1;
  const familyId = (await db.prepare('INSERT INTO families (name) VALUES (?)').run(`Approval Family ${counter}`)).lastInsertRowid;
  const studentCode = await generateMemberCode();
  const studentId = (
    await db
      .prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, active) VALUES (?, ?, ?, 'student', ?, 1) RETURNING id")
      .get(`Approval Student ${counter}`, studentCode, studentCode, familyId)
  ).id;
  const parentCode = await generateMemberCode();
  const parentId = (
    await db
      .prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, is_primary_parent, active) VALUES (?, ?, ?, 'parent', ?, 1, 1) RETURNING id")
      .get(`Approval Parent ${counter}`, parentCode, parentCode, familyId)
  ).id;
  await db.prepare('INSERT INTO class_enrollments (class_id, student_id) VALUES (?, ?)').run(classId, studentId);
  const student = await makeAccount(studentId, 'student');
  const parent = await makeAccount(parentId, 'parent');
  return { studentId, student, parent };
}

async function teacherCreatesLesson(teacher, classId, title) {
  const res = await request(app)
    .post(`/teacher/classes/${classId}/assignments`)
    .set('Cookie', teacher.cookie)
    .type('form')
    .send({ title, _csrf: teacher.csrfToken });
  assert.equal(res.status, 302);
  const lesson = await db.prepare('SELECT * FROM class_assignments WHERE class_id = ? AND title = ?').get(classId, title);
  const itemId = await createContentItem({ assignmentId: lesson.id, type: 'text', title: `${title} Reading`, body: 'Read chapter one.' });
  return { lesson, itemId };
}

async function submit(teacher, lessonId) {
  return request(app).post(`/teacher/assignments/${lessonId}/submit-approval`).set('Cookie', teacher.cookie).type('form').send({ _csrf: teacher.csrfToken });
}

async function statusOf(lessonId) {
  return (await db.prepare('SELECT approval_status FROM class_assignments WHERE id = ?').get(lessonId)).approval_status;
}

test('teacher-created lesson starts as a draft, hidden from students and parents (list, direct URL, grades)', async () => {
  const classId = await createClass({ day: 'monday', hourPosition: 1, className: 'Approval Draft Class' });
  const teacher = await makeTeacher(classId);
  const family = await makeFamily(classId);
  const { lesson, itemId } = await teacherCreatesLesson(teacher, classId, 'Draft Lesson');
  assert.equal(lesson.approval_status, 'draft');

  const teacherEdit = await request(app).get(`/teacher/classes/${classId}/edit`).set('Cookie', teacher.cookie);
  assert.match(teacherEdit.text, /badge-pill-gray">Draft</);
  const teacherManage = await request(app).get(`/teacher/assignments/${lesson.id}`).set('Cookie', teacher.cookie);
  assert.match(teacherManage.text, /Submit for Approval/);
  // Teachers still see every status on their own class view.
  const teacherView = await request(app).get(`/teacher/classes/${classId}?tab=lessons`).set('Cookie', teacher.cookie);
  assert.match(teacherView.text, /Draft Lesson/);

  const studentLessons = await request(app).get(`/student/classes/${classId}?tab=lessons`).set('Cookie', family.student.cookie);
  assert.equal(studentLessons.status, 200);
  assert.doesNotMatch(studentLessons.text, /Draft Lesson/);
  const studentAssignments = await request(app).get(`/student/classes/${classId}?tab=assignments`).set('Cookie', family.student.cookie);
  assert.doesNotMatch(studentAssignments.text, /Draft Lesson/);
  const studentAll = await request(app).get('/student/assignments').set('Cookie', family.student.cookie);
  assert.doesNotMatch(studentAll.text, /Draft Lesson/);
  const direct = await request(app).get(`/student/content/${itemId}`).set('Cookie', family.student.cookie);
  assert.equal(direct.status, 404);
  const complete = await request(app).post(`/student/content/${itemId}/complete`).set('Cookie', family.student.cookie).type('form').send({ _csrf: extractCsrf(studentLessons.text) });
  assert.equal(complete.status, 404);

  const parentLessons = await request(app).get(`/parent/classes/dashboard/${classId}?studentId=${family.studentId}&tab=lessons`).set('Cookie', family.parent.cookie);
  assert.equal(parentLessons.status, 200);
  assert.doesNotMatch(parentLessons.text, /Draft Lesson/);
  const parentDirect = await request(app).get(`/parent/content/${itemId}?studentId=${family.studentId}`).set('Cookie', family.parent.cookie);
  assert.equal(parentDirect.status, 404);
});

test('submit -> pending on the approval page; approve -> visible to enrolled student/parent and in Approved by Admins', async () => {
  const classId = await createClass({ day: 'monday', hourPosition: 2, className: 'Approval Happy Class' });
  const teacher = await makeTeacher(classId);
  const family = await makeFamily(classId);
  const { lesson, itemId } = await teacherCreatesLesson(teacher, classId, 'Happy Lesson');

  const submitRes = await submit(teacher, lesson.id);
  assert.equal(submitRes.status, 302);
  assert.equal(await statusOf(lesson.id), 'pending');
  const teacherManage = await request(app).get(`/teacher/assignments/${lesson.id}`).set('Cookie', teacher.cookie);
  assert.match(teacherManage.text, /badge-pill-orange">Submitted</);
  assert.doesNotMatch(teacherManage.text, /Submit for Approval/);
  // Still hidden while pending.
  const pendingStudent = await request(app).get(`/student/classes/${classId}?tab=lessons`).set('Cookie', family.student.cookie);
  assert.doesNotMatch(pendingStudent.text, /Happy Lesson/);

  const admin = await loginAsAdmin();
  const queue = await request(app).get('/admin/lesson-plans/approval').set('Cookie', admin.cookie);
  assert.equal(queue.status, 200);
  assert.match(queue.text, /Happy Lesson/);
  assert.match(queue.text, /Approval Happy Class/);
  assert.match(queue.text, /Approval Teacher \d+/);
  assert.match(queue.text, /href="\/admin\/lesson-plans\/approval">Lesson Plan Approval <span class="badge-pill badge-pill-orange">\d+/);
  const preview = await request(app).get(`/admin/lesson-plans/approval/${lesson.id}`).set('Cookie', admin.cookie);
  assert.equal(preview.status, 200);
  assert.match(preview.text, /Read chapter one\./);

  const approveRes = await request(app).post(`/admin/lesson-plans/approval/${lesson.id}/approve`).set('Cookie', admin.cookie).type('form').send({ _csrf: admin.csrfToken });
  assert.equal(approveRes.status, 302);
  assert.equal(await statusOf(lesson.id), 'approved');
  const approvedTab = await request(app).get('/admin/lesson-plans/approval?status=approved').set('Cookie', admin.cookie);
  assert.match(approvedTab.text, /Happy Lesson/);

  const studentLessons = await request(app).get(`/student/classes/${classId}?tab=lessons`).set('Cookie', family.student.cookie);
  assert.match(studentLessons.text, /Happy Lesson/);
  const direct = await request(app).get(`/student/content/${itemId}`).set('Cookie', family.student.cookie);
  assert.equal(direct.status, 200);
  const parentLessons = await request(app).get(`/parent/classes/dashboard/${classId}?studentId=${family.studentId}&tab=lessons`).set('Cookie', family.parent.cookie);
  assert.match(parentLessons.text, /Happy Lesson/);

  const approvedPage = await request(app).get('/teacher/lesson-plans/approved').set('Cookie', teacher.cookie);
  assert.equal(approvedPage.status, 200);
  assert.match(approvedPage.text, /Happy Lesson/);
  assert.match(approvedPage.text, /Approved by Admins/);

  // Teacher got an in-app notification.
  const note = await db.prepare("SELECT * FROM notifications WHERE member_account_id = ? AND type_key = 'lesson_plan_review'").get(teacher.accountId);
  assert.ok(note);
  assert.match(note.title, /approved/i);

  // Edits to an approved lesson keep it approved.
  await request(app)
    .post(`/teacher/assignments/${lesson.id}/edit`)
    .set('Cookie', teacher.cookie)
    .type('form')
    .send({ title: 'Happy Lesson Fixed', _csrf: teacher.csrfToken });
  assert.equal(await statusOf(lesson.id), 'approved');
});

test('reject requires a message; rejected lesson is hidden from students, message shown to teacher; resubmit keeps history', async () => {
  const classId = await createClass({ day: 'wednesday', hourPosition: 1, className: 'Approval Reject Class' });
  const teacher = await makeTeacher(classId);
  const otherClassId = await createClass({ day: 'wednesday', hourPosition: 3, className: 'Approval Reject Other Class' });
  const otherTeacher = await makeTeacher(otherClassId);
  const family = await makeFamily(classId);
  const { lesson, itemId } = await teacherCreatesLesson(teacher, classId, 'Rejected Lesson');
  await submit(teacher, lesson.id);

  const admin = await loginAsAdmin();
  const review = await request(app).get(`/admin/lesson-plans/approval/${lesson.id}`).set('Cookie', admin.cookie);
  assert.match(review.text, /<dialog id="reject-lesson-dialog"/);
  assert.match(review.text, /<textarea name="message"[^>]*required/);

  // An empty (or whitespace-only) message is refused server-side.
  const empty = await request(app)
    .post(`/admin/lesson-plans/approval/${lesson.id}/reject`)
    .set('Cookie', admin.cookie)
    .type('form')
    .send({ message: '   ', _csrf: admin.csrfToken });
  assert.equal(empty.status, 302);
  assert.match(empty.headers.location, /error=/);
  assert.equal(await statusOf(lesson.id), 'pending');

  const rejectRes = await request(app)
    .post(`/admin/lesson-plans/approval/${lesson.id}/reject`)
    .set('Cookie', admin.cookie)
    .type('form')
    .send({ message: 'Please add a video.', _csrf: admin.csrfToken });
  assert.equal(rejectRes.status, 302);
  assert.equal(await statusOf(lesson.id), 'rejected');
  const rejectedTab = await request(app).get('/admin/lesson-plans/approval?status=rejected').set('Cookie', admin.cookie);
  assert.match(rejectedTab.text, /Rejected Lesson/);
  const allTab = await request(app).get('/admin/lesson-plans/approval?status=all').set('Cookie', admin.cookie);
  assert.match(allTab.text, /Rejected Lesson/);
  // Reject/approve only while pending.
  await request(app).post(`/admin/lesson-plans/approval/${lesson.id}/approve`).set('Cookie', admin.cookie).type('form').send({ _csrf: admin.csrfToken });
  await request(app).post(`/admin/lesson-plans/approval/${lesson.id}/reject`).set('Cookie', admin.cookie).type('form').send({ message: 'again', _csrf: admin.csrfToken });
  assert.equal(await statusOf(lesson.id), 'rejected');

  const note = await db.prepare("SELECT * FROM notifications WHERE member_account_id = ? AND type_key = 'lesson_plan_review' ORDER BY id DESC").get(teacher.accountId);
  assert.match(note.title, /rejected/i);
  assert.match(note.body, /Please add a video\./);

  // Students/parents still can't see it; another teacher can't open it.
  const studentLessons = await request(app).get(`/student/classes/${classId}?tab=lessons`).set('Cookie', family.student.cookie);
  assert.doesNotMatch(studentLessons.text, /Rejected Lesson/);
  assert.equal((await request(app).get(`/student/content/${itemId}`).set('Cookie', family.student.cookie)).status, 404);
  const outsiderView = await request(app).get(`/teacher/assignments/${lesson.id}`).set('Cookie', otherTeacher.cookie);
  assert.equal(outsiderView.status, 403);
  assert.doesNotMatch(outsiderView.text, /Please add a video\./);
  assert.equal((await submit(otherTeacher, lesson.id)).status, 403);
  assert.equal(await statusOf(lesson.id), 'rejected');

  const teacherManage = await request(app).get(`/teacher/assignments/${lesson.id}`).set('Cookie', teacher.cookie);
  assert.match(teacherManage.text, /badge-pill-red">Rejected</);
  assert.match(teacherManage.text, /id="lesson-rejection"[\s\S]*Please add a video\.[\s\S]*Edit &amp; Resubmit/);
  assert.match(teacherManage.text, /Resubmit for Approval/);
  const teacherList = await request(app).get('/teacher/assignments').set('Cookie', teacher.cookie);
  assert.match(teacherList.text, /Please add a video\./);
  assert.match(teacherList.text, /badge-pill-red">Rejected</);

  // Edit then resubmit -> back to Pending; earlier rejection message kept.
  await request(app)
    .post(`/teacher/assignments/${lesson.id}/edit`)
    .set('Cookie', teacher.cookie)
    .type('form')
    .send({ title: 'Rejected Lesson v2', _csrf: teacher.csrfToken });
  const resubmit = await submit(teacher, lesson.id);
  assert.equal(resubmit.status, 302);
  assert.equal(await statusOf(lesson.id), 'pending');
  const queue = await request(app).get('/admin/lesson-plans/approval').set('Cookie', admin.cookie);
  assert.match(queue.text, /Rejected Lesson v2/);
  // Submitting an already-pending lesson is a no-op.
  const again = await submit(teacher, lesson.id);
  assert.match(again.headers.location, /error=/);

  // Second rejection; both messages remain in history.
  await request(app)
    .post(`/admin/lesson-plans/approval/${lesson.id}/reject`)
    .set('Cookie', admin.cookie)
    .type('form')
    .send({ message: 'Video link is broken.', _csrf: admin.csrfToken });
  const events = await db.prepare('SELECT action, message FROM lesson_approval_events WHERE assignment_id = ? ORDER BY id').all(lesson.id);
  assert.deepEqual(events.map((e) => e.action), ['submitted', 'rejected', 'submitted', 'rejected']);
  const reviewAfter = await request(app).get(`/admin/lesson-plans/approval/${lesson.id}`).set('Cookie', admin.cookie);
  assert.match(reviewAfter.text, /Approval History/);
  assert.match(reviewAfter.text, /Please add a video\./);
  assert.match(reviewAfter.text, /Video link is broken\./);
  const teacherAfter = await request(app).get(`/teacher/assignments/${lesson.id}`).set('Cookie', teacher.cookie);
  assert.match(teacherAfter.text, /Rejection History[\s\S]*Video link is broken\.[\s\S]*Please add a video\./);
});

test('teachers can only submit their own classes; non-admins cannot approve or open the approval page', async () => {
  const classId = await createClass({ day: 'monday', hourPosition: 3, className: 'Approval Owner Class' });
  const otherClassId = await createClass({ day: 'monday', hourPosition: 4, className: 'Approval Other Class' });
  const owner = await makeTeacher(classId);
  const outsider = await makeTeacher(otherClassId);
  const family = await makeFamily(classId);
  const { lesson } = await teacherCreatesLesson(owner, classId, 'Owned Lesson');

  const outsiderSubmit = await submit(outsider, lesson.id);
  assert.equal(outsiderSubmit.status, 403);
  assert.equal(await statusOf(lesson.id), 'draft');

  await submit(owner, lesson.id);
  for (const actor of [owner, family.student, family.parent]) {
    const page = await request(app).get('/admin/lesson-plans/approval').set('Cookie', actor.cookie);
    assert.notEqual(page.status, 200);
    const csrf = actor.csrfToken || extractCsrf((await request(app).get(actor.home).set('Cookie', actor.cookie)).text);
    await request(app).post(`/admin/lesson-plans/approval/${lesson.id}/approve`).set('Cookie', actor.cookie).type('form').send({ _csrf: csrf });
    assert.equal(await statusOf(lesson.id), 'pending');
  }
});

test('admin-created lessons (class Lessons tab and Lesson Plans "Assign to Class") are approved automatically', async () => {
  const classId = await createClass({ day: 'wednesday', hourPosition: 2, className: 'Approval Admin Class' });
  const family = await makeFamily(classId);
  const admin = await loginAsAdmin();

  const planId = await createLessonPlan({ title: 'Template Lesson', description: 'From the library', createdByAccountId: null });
  const assignRes = await request(app).post(`/admin/lesson-plans/${planId}/assign`).set('Cookie', admin.cookie).type('form').send({ classId: String(classId), _csrf: admin.csrfToken });
  assert.equal(assignRes.status, 302);
  const assigned = await db.prepare('SELECT * FROM class_assignments WHERE class_id = ? AND title = ?').get(classId, 'Template Lesson');
  assert.equal(assigned.approval_status, 'approved');

  await request(app).post(`/admin/class-schedule/classes/${classId}/assignments`).set('Cookie', admin.cookie).type('form').send({ title: 'Admin Tab Lesson', _csrf: admin.csrfToken });
  const adminTab = await db.prepare('SELECT * FROM class_assignments WHERE class_id = ? AND title = ?').get(classId, 'Admin Tab Lesson');
  assert.equal(adminTab.approval_status, 'approved');

  const studentLessons = await request(app).get(`/student/classes/${classId}?tab=lessons`).set('Cookie', family.student.cookie);
  assert.match(studentLessons.text, /Template Lesson/);
  assert.match(studentLessons.text, /Admin Tab Lesson/);

  // createAssignment's own default (used by every admin path) is approved.
  const directId = await createAssignment({ classId, className: 'Approval Admin Class', title: 'Direct Lesson', createdByAccountId: null });
  assert.equal(await statusOf(directId), 'approved');
});

test('migration: lessons that exist before it are backfilled as approved; new rows default to draft; re-running is safe', async () => {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const target = '20261231010000_lesson_plan_approval.sql';
  const before = files.filter((f) => f < target);
  const pg = new PGlite();
  await pg.exec(before.map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n'));
  await pg.exec("INSERT INTO class_assignments (class_name, title) VALUES ('Old Class', 'Old Lesson')");
  const migrationSql = fs.readFileSync(path.join(migrationsDir, target), 'utf8');
  await pg.exec(migrationSql);
  await pg.exec(migrationSql);
  const old = await pg.query("SELECT approval_status FROM class_assignments WHERE title = 'Old Lesson'");
  assert.equal(old.rows[0].approval_status, 'approved');
  await pg.exec("INSERT INTO class_assignments (class_name, title) VALUES ('New Class', 'New Lesson')");
  const fresh = await pg.query("SELECT approval_status FROM class_assignments WHERE title = 'New Lesson'");
  assert.equal(fresh.rows[0].approval_status, 'draft');
  await assert.rejects(pg.exec("INSERT INTO class_assignments (class_name, title, approval_status) VALUES ('X', 'Y', 'bogus')"));

  // Follow-up migration: 'declined' -> 'rejected', with its note carried
  // into lesson_approval_events; re-running is safe.
  await pg.exec("INSERT INTO class_assignments (class_name, title, approval_status, review_note, reviewed_at) VALUES ('D', 'Declined Before', 'declined', 'Needs work', '2026-12-30 10:00:00')");
  const followUp = fs.readFileSync(path.join(migrationsDir, '20261231030000_lesson_plan_rejections.sql'), 'utf8');
  await pg.exec(followUp);
  await pg.exec(followUp);
  const migrated = await pg.query("SELECT id, approval_status FROM class_assignments WHERE title = 'Declined Before'");
  assert.equal(migrated.rows[0].approval_status, 'rejected');
  const history = await pg.query('SELECT action, message FROM lesson_approval_events WHERE assignment_id = $1', [migrated.rows[0].id]);
  assert.deepEqual(history.rows, [{ action: 'rejected', message: 'Needs work' }]);
  await assert.rejects(pg.exec("INSERT INTO class_assignments (class_name, title, approval_status) VALUES ('X', 'Y', 'bogus')"));
  await pg.close();
});
