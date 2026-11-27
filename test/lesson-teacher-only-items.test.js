// A real request: "When adding assignments to lessons plans be able to
// mark them teacher only. Then that particular resource or assignment
// will only be available to teachers, subs and admins. It won't be
// available for students or parents."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `teacher-only-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `teacher-only-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');
const { generateMemberCode } = require('../utils/members');
const { contentItemsForAssignment } = require('../utils/academics');
const lessonPlans = require('../utils/lessonPlans');
const { lessonPlanSummary } = require('../utils/lessonPlanSummary');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));
const csrfOf = (html) => /name="csrf-token" content="([^"]*)"/.exec(html)[1];

async function account(memberId, email, roleKey) {
  const acct = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text()) RETURNING id").get(memberId, email, hashPassword('testpassword123'))).id;
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = ?))').run(acct, roleKey);
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email, password: 'testpassword123' });
  return agent;
}

test('a teacher-only item shows for admins, teachers and the kiosk, and never for students or parents', async () => {
  const classId = (await db.prepare("INSERT INTO classes (class_name, day, hour_position) VALUES ('Teacher Only Class', 'wednesday', 1) RETURNING id").get()).id;
  const fam = (await db.prepare("INSERT INTO families (name) VALUES ('TO Family') RETURNING id").get()).id;
  const code = await generateMemberCode();
  const studentId = (await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, active) VALUES ('Tia Student', ?, ?, 'student', ?, 1) RETURNING id").get(code, code, fam)).id;
  const parentId = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, is_primary_parent, active) VALUES ('Pam Parent', 'PP9', 'parent', ?, 1, 1) RETURNING id").get(fam)).id;
  await db.prepare('INSERT INTO class_enrollments (class_id, student_id) VALUES (?, ?)').run(classId, studentId);

  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const page = await admin.get('/admin/schedule?tab=wednesday');
  const csrf = csrfOf(page.text);
  await admin.post(`/admin/class-schedule/classes/${classId}/assignments`).type('form').send({ _csrf: csrf, title: 'Week 1' });
  const lessonId = (await db.prepare('SELECT id FROM class_assignments WHERE class_id = ?').get(classId)).id;
  const lessonPage = await admin.get(`/admin/class-schedule/assignments/${lessonId}`);
  assert.match(lessonPage.text, /name="teacherOnly"/, 'the Add Assignments form has the Teacher only box');
  await admin.post(`/admin/class-schedule/assignments/${lessonId}/content`).type('form').send({ _csrf: csrf, type: 'text', title: 'Read Chapter 1', body: 'For everyone' });
  await admin.post(`/admin/class-schedule/assignments/${lessonId}/content`).type('form').send({ _csrf: csrf, type: 'text', title: 'Answer Key', body: 'Secret answers', teacherOnly: '1' });
  const secret = await db.prepare("SELECT * FROM lesson_content_items WHERE title = 'Answer Key'").get();
  assert.equal(secret.teacher_only, true);

  // Staff see it, labelled.
  const staffPage = await admin.get(`/admin/class-schedule/assignments/${lessonId}`);
  assert.match(staffPage.text, /Answer Key<\/button> <span class="badge-pill badge-pill-gray teacher-only-badge"/);
  assert.equal((await contentItemsForAssignment(lessonId, { includeAnswerKey: true })).length, 2);
  const summary = await lessonPlanSummary(classId, { approvedOnly: false });
  assert.ok(summary[0].contentItems.some((i) => i.title === 'Answer Key' && i.teacherOnly), 'kiosk/sub and roster summaries include it');

  // Students and parents never get it - not in lists, not by direct link.
  assert.equal((await contentItemsForAssignment(lessonId)).length, 1);
  const student = await account(studentId, 'tia@example.com', 'student');
  const sLessons = await student.get(`/student/classes/dashboard/${classId}?tab=lessons`);
  assert.match(sLessons.text, /Read Chapter 1/);
  assert.doesNotMatch(sLessons.text, /Answer Key/);
  assert.equal((await student.get(`/student/content/${secret.id}`)).status, 404);
  const sCsrf = csrfOf(sLessons.text);
  const completeRes = await student.post(`/student/content/${secret.id}/complete`).type('form').send({ _csrf: sCsrf });
  assert.equal(completeRes.status, 404);
  const parent = await account(parentId, 'pam@example.com', 'parent');
  const pLessons = await parent.get(`/parent/classes/dashboard/${classId}?tab=lessons&studentId=${studentId}`);
  assert.doesNotMatch(pLessons.text, /Answer Key/);
  assert.equal((await parent.get(`/parent/content/${secret.id}?studentId=${studentId}`)).status, 404);

  // Unticking it in the edit form makes it visible again.
  await admin.post(`/admin/class-schedule/content/${secret.id}/edit`).type('form').send({ _csrf: csrf, title: 'Answer Key', body: 'Now shared' });
  assert.equal((await db.prepare('SELECT teacher_only FROM lesson_content_items WHERE id = ?').get(secret.id)).teacher_only, false);
  assert.match((await student.get(`/student/classes/dashboard/${classId}?tab=lessons`)).text, /Answer Key/);
});

test('library lesson plans: a teacher-only item is copied to a class as teacher-only, and never into a family copy', async () => {
  const plan = await lessonPlans.createLessonPlan({ title: 'Plant Unit', description: '' });
  const planId = typeof plan === 'object' ? plan.id : plan;
  await lessonPlans.createLessonPlanContentItem({ lessonPlanId: planId, type: 'text', title: 'Seed reading', body: 'all' });
  await lessonPlans.createLessonPlanContentItem({ lessonPlanId: planId, type: 'text', title: 'Teacher notes', body: 'staff', teacherOnly: true });

  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const planPage = await admin.get(`/admin/lesson-plans/${planId}`);
  assert.match(planPage.text, /name="teacherOnly"/);
  assert.match(planPage.text, /Teacher notes<\/button> <span class="badge-pill badge-pill-gray teacher-only-badge"/);

  const classId = (await db.prepare("INSERT INTO classes (class_name, day, hour_position) VALUES ('Plant Class', 'wednesday', 2) RETURNING id").get()).id;
  const firstLesson = await lessonPlans.assignLessonPlanToClass(planId, classId, null);
  const copied = await db.prepare("SELECT title, teacher_only FROM lesson_content_items WHERE assignment_id = ? ORDER BY position").all(firstLesson);
  assert.deepEqual(copied.map((r) => [r.title, r.teacher_only]), [['Seed reading', false], ['Teacher notes', true]]);

  const fam = (await db.prepare("INSERT INTO families (name) VALUES ('Plant Family') RETURNING id").get()).id;
  const copyId = await lessonPlans.copyLessonPlanForFamily(planId, fam, null);
  const famItems = await db.prepare('SELECT title FROM lesson_plan_content_items WHERE lesson_plan_id = ?').all(copyId);
  assert.deepEqual(famItems.map((r) => r.title), ['Seed reading']);
  assert.deepEqual((await lessonPlans.contentItemsForLessonPlan(planId)).map((i) => i.title), ['Seed reading'], 'family-facing reads leave it out');
});
