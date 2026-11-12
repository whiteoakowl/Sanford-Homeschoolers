// A real request: the Co-op Admin Lesson Plans library, Family School
// Management and the Co-op Admin class Lessons tab use the Teacher
// Portal's lesson/assignment design - "+ Add Lesson" makes a bar, and
// each lesson holds its own assignments. A library plan now holds
// lessons; assigning it to a class makes one class lesson per plan
// lesson, and a family using it gets one Family Classes lesson per plan
// lesson.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `lesson-plan-lessons-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `lesson-plan-lessons-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');
const { createClass } = require('../utils/classSchedule');
const { contentItemsForAssignment } = require('../utils/academics');
const { lessonsForLessonPlan, updateLessonPlan, copyLessonPlanForFamily } = require('../utils/lessonPlans');
const { contentItemsForLesson } = require('../utils/familySchool');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

async function adminAgent() {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/admin' });
  const page = await agent.get('/admin/lesson-plans');
  return { agent, csrf: /name="csrf-token" content="([^"]*)"/.exec(page.text)[1] };
}

test('Library plan: Add Lesson makes bars, assignments go on their own lesson, Assign to Class makes one class lesson each', async () => {
  const { agent, csrf } = await adminAgent();
  const created = await agent.post('/admin/lesson-plans').type('form').send({ _csrf: csrf, title: 'Birds Unit', description: 'A unit on birds.' });
  const planId = Number(/lesson-plans\/(\d+)/.exec(created.headers.location)[1]);

  const l1 = await agent.post(`/admin/lesson-plans/${planId}/lessons`).type('form').send({ _csrf: csrf, title: 'Week 1: Songbirds', description: 'Listen.' });
  const lesson1 = Number(/open=(\d+)/.exec(l1.headers.location)[1]);
  const l2 = await agent.post(`/admin/lesson-plans/${planId}/lessons`).type('form').send({ _csrf: csrf, title: 'Week 2: Raptors' });
  const lesson2 = Number(/open=(\d+)/.exec(l2.headers.location)[1]);

  const add = await agent.post(`/admin/lesson-plans/${planId}/content`).type('form').send({ _csrf: csrf, lessonId: lesson2, type: 'text', title: 'Owl Facts', body: 'Owls hunt at night.' });
  assert.match(add.headers.location, new RegExp(`open=${lesson2}`));
  await agent.post(`/admin/lesson-plans/${planId}/content`).type('form').send({ _csrf: csrf, lessonId: lesson1, type: 'text', title: 'Robin Song', body: 'Listen for robins.' });

  const lessons = await lessonsForLessonPlan(planId);
  assert.deepEqual(lessons.map((l) => [l.title, l.contentItems.map((i) => i.title)]), [['Week 1: Songbirds', ['Robin Song']], ['Week 2: Raptors', ['Owl Facts']]]);

  const page = await agent.get(`/admin/lesson-plans/${planId}?open=${lesson2}`);
  assert.match(page.text, /\+ Add Lesson/);
  assert.match(page.text, new RegExp(`<details class="lesson-plan-bar" id="plan-lesson-${lesson2}" open>`));
  assert.match(page.text, new RegExp(`id="add-content-dialog-${lesson1}"`));
  assert.match(page.text, new RegExp(`name="lessonId" value="${lesson2}"`));

  const edit = await agent.post(`/admin/lesson-plans/lessons/${lesson1}/edit`).type('form').send({ _csrf: csrf, title: 'Week 1: Backyard Birds', description: '' });
  assert.equal(edit.status, 302);

  const classId = await createClass({ day: 'monday', hourPosition: 1, className: 'Birding Class' });
  const assign = await agent.post(`/admin/lesson-plans/${planId}/assign`).type('form').send({ _csrf: csrf, classId: String(classId) });
  assert.equal(assign.status, 302);
  const classLessons = await db.prepare('SELECT * FROM class_assignments WHERE class_id = ? ORDER BY position, id').all(classId);
  assert.deepEqual(classLessons.map((l) => l.title), ['Week 1: Backyard Birds', 'Week 2: Raptors']);
  assert.deepEqual((await contentItemsForAssignment(classLessons[0].id)).map((i) => i.title), ['Robin Song']);
  assert.deepEqual((await contentItemsForAssignment(classLessons[1].id)).map((i) => i.title), ['Owl Facts']);
  assert.ok(classLessons.every((l) => l.source_lesson_plan_id === planId));

  // Deleting a lesson removes its assignments too.
  await agent.post(`/admin/lesson-plans/lessons/${lesson2}/delete`).type('form').send({ _csrf: csrf });
  assert.deepEqual((await lessonsForLessonPlan(planId)).map((l) => l.title), ['Week 1: Backyard Birds']);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS c FROM lesson_plan_content_items WHERE lesson_plan_id = ?').get(planId)).c), 1);
});

test('Family School: a plan with lessons adds one family lesson per plan lesson; a family copy copies the lessons', async () => {
  const { agent, csrf } = await adminAgent();
  const created = await agent.post('/admin/lesson-plans').type('form').send({ _csrf: csrf, title: 'Trees Unit', description: '' });
  const planId = Number(/lesson-plans\/(\d+)/.exec(created.headers.location)[1]);
  await updateLessonPlan(planId, { title: 'Trees Unit', description: '', allowFamilySchoolUse: true, allowTeacherEdit: false, allowMemberEdit: true });
  const a = Number(/open=(\d+)/.exec((await agent.post(`/admin/lesson-plans/${planId}/lessons`).type('form').send({ _csrf: csrf, title: 'Leaves' })).headers.location)[1]);
  const b = Number(/open=(\d+)/.exec((await agent.post(`/admin/lesson-plans/${planId}/lessons`).type('form').send({ _csrf: csrf, title: 'Bark' })).headers.location)[1]);
  await agent.post(`/admin/lesson-plans/${planId}/content`).type('form').send({ _csrf: csrf, lessonId: a, type: 'text', title: 'Leaf Rubbing', body: 'x' });
  await agent.post(`/admin/lesson-plans/${planId}/content`).type('form').send({ _csrf: csrf, lessonId: b, type: 'text', title: 'Bark Texture', body: 'y' });

  const familyId = (await db.prepare("INSERT INTO families (name) VALUES ('Treehouse') RETURNING id").get()).id;
  const memberId = (await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, is_primary_parent, active) VALUES ('Tree Parent', 'tp1', 'tp1', 'parent', ?, 1, 1) RETURNING id").get(familyId)).id;
  const accountId = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, 'tree@example.com', ?, 'active', now_text()) RETURNING id").get(memberId, hashPassword('pw123456'))).id;
  await db.prepare("INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = 'parent'))").run(accountId);
  const parent = request.agent(app);
  await parent.post('/login').type('form').send({ email: 'tree@example.com', password: 'pw123456', next: '/parent' });
  const pcsrf = /name="csrf-token" content="([^"]*)"/.exec((await parent.get('/parent/family-school/classes')).text)[1];

  const made = await parent.post('/parent/family-school/classes/from-lesson-plan').type('form').send({ _csrf: pcsrf, lessonPlanId: planId });
  const classId = Number(/classes\/(\d+)/.exec(made.headers.location)[1]);
  const familyLessons = await db.prepare('SELECT * FROM family_school_lessons WHERE class_id = ? ORDER BY position, id').all(classId);
  assert.deepEqual(familyLessons.map((l) => l.title), ['Leaves', 'Bark']);
  assert.deepEqual((await contentItemsForLesson(familyLessons[0].id)).map((i) => i.title), ['Leaf Rubbing']);
  assert.deepEqual((await contentItemsForLesson(familyLessons[1].id)).map((i) => i.title), ['Bark Texture']);

  const classPage = await parent.get(`/parent/family-school/classes/${classId}?open=${familyLessons[1].id}`);
  assert.match(classPage.text, new RegExp(`<details class="lesson-plan-bar" id="lesson-${familyLessons[1].id}" open>`));
  assert.match(classPage.text, /Bark Texture/);

  const copyId = await copyLessonPlanForFamily(planId, familyId, accountId);
  const copyLessons = await lessonsForLessonPlan(copyId);
  assert.deepEqual(copyLessons.map((l) => [l.title, l.contentItems.map((i) => i.title)]), [['Leaves', ['Leaf Rubbing']], ['Bark', ['Bark Texture']]]);
  const repointed = await db.prepare('SELECT source_lesson_plan_id, source_lesson_plan_lesson_id FROM family_school_lessons WHERE class_id = ? ORDER BY position, id').all(classId);
  assert.deepEqual(repointed.map((r) => r.source_lesson_plan_id), [copyId, copyId]);
  assert.deepEqual(repointed.map((r) => r.source_lesson_plan_lesson_id), copyLessons.map((l) => l.id));

  // A family-written lesson in a class: + New Lesson makes a bar; assignments added from it come back to it.
  const own = await parent.post(`/parent/family-school/classes/${classId}/lessons`).type('form').send({ _csrf: pcsrf, source: 'own', title: 'Our Own Lesson' });
  const ownId = Number(/open=(\d+)/.exec(own.headers.location)[1]);
  const returnTo = `/parent/family-school/classes/${classId}?open=${ownId}`;
  const content = await parent.post(`/parent/family-school/lessons/${ownId}/content`).type('form').send({ _csrf: pcsrf, type: 'text', title: 'Our Reading', body: 'z', returnTo });
  assert.match(content.headers.location, new RegExp(`^/parent/family-school/classes/${classId}\\?open=${ownId}&notice=`));
  assert.deepEqual((await contentItemsForLesson(ownId)).map((i) => i.title), ['Our Reading']);
});
