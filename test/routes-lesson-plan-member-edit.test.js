// A real request: make "Allow teachers to edit/add to the lesson plan"
// and "Allow parents to edit or add to the lesson plan from the Family
// School Management portal" actually work, and have Lock block both -
// only admins can edit a locked plan.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `lesson-plan-member-edit-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `lesson-plan-member-edit-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');
const { createLessonPlan, updateLessonPlan, toggleLessonPlanLocked, contentItemsForLessonPlan } = require('../utils/lessonPlans');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

let counter = 0;
async function portalAgent(roleKey) {
  counter += 1;
  const code = `lpedit${counter}`;
  const familyId = (await db.prepare('INSERT INTO families (name) VALUES (?) RETURNING id').get(`LP Family ${counter}`)).id;
  const memberId = (
    await db
      .prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, is_primary_parent, active) VALUES (?, ?, ?, 'parent', ?, 1, 1) RETURNING id")
      .get(`LP ${roleKey} ${counter}`, code, code, familyId)
  ).id;
  const accountId = (
    await db
      .prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text()) RETURNING id")
      .get(memberId, `${code}@example.com`, hashPassword('testpassword123'))
  ).id;
  const role = await db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey);
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountId, role.id);
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: `${code}@example.com`, password: 'testpassword123', next: `/${roleKey}` });
  return agent;
}

async function csrf(agent, url) {
  const page = await agent.get(url);
  return /name="csrf-token" content="([^"]*)"/.exec(page.text)[1];
}

async function makePlan(title, flags) {
  const id = await createLessonPlan({ title, description: '', createdByAccountId: null });
  await updateLessonPlan(id, { title, description: '', allowFamilySchoolUse: true, allowTeacherEdit: false, allowMemberEdit: false, ...flags });
  return id;
}

// A follow-up: "If a teacher in teacher portal edits a lesson plan that
// was assigned to their class, these shared changes only show up on the
// co-op class it is attached to... the changes wouldn't cross over" to
// Family School Management. Teachers edit only their class's copy, and
// only when the plan allows teacher edits and isn't locked.
test('Teacher Portal: edits a plan only on the class it was assigned to, per the plan\'s checkbox and Lock', async () => {
  const { createLessonPlanContentItem, assignLessonPlanToClass } = require('../utils/lessonPlans');
  const { createClass } = require('../utils/classSchedule');
  const { contentItemsForAssignment } = require('../utils/academics');
  const open = await makePlan('Teacher Open Plan', { allowTeacherEdit: true });
  const closed = await makePlan('Teacher Closed Plan', {});
  await createLessonPlanContentItem({ lessonPlanId: open, type: 'text', title: 'Plan Text', body: 'x' });
  const classId = await createClass({ day: 'monday', hourPosition: 1, className: 'LP Teacher Class' });
  const openLesson = await assignLessonPlanToClass(open, classId, null);
  const closedLesson = await assignLessonPlanToClass(closed, classId, null);
  const teacher = await portalAgent('teacher');
  const member = await db.prepare("SELECT ma.member_id FROM member_accounts ma WHERE ma.email = ?").get(`lpedit${counter}@example.com`);
  await db.prepare("INSERT INTO class_staff (class_id, member_id, role) VALUES (?, ?, 'teacher')").run(classId, member.member_id);

  assert.equal((await teacher.get('/teacher/lesson-plans')).status, 404, 'no page for editing the shared plans');

  const token = await csrf(teacher, `/teacher/assignments/${openLesson}`);
  const add = await teacher.post(`/teacher/assignments/${openLesson}/content`).type('form').send({ _csrf: token, type: 'text', title: 'Class Only Note', body: 'hi' });
  assert.equal(add.status, 302);
  assert.doesNotMatch(decodeURIComponent(add.headers.location), /error=/);
  assert.deepEqual((await contentItemsForAssignment(openLesson)).map((i) => i.title), ['Plan Text', 'Class Only Note']);
  assert.deepEqual((await contentItemsForLessonPlan(open)).map((i) => i.title), ['Plan Text'], 'the shared plan (and Family School Management) never changes');

  const closedPage = await teacher.get(`/teacher/assignments/${closedLesson}`);
  assert.match(closedPage.text, /teachers aren(&#39;|')t allowed to edit/);
  const blocked = await teacher.post(`/teacher/assignments/${closedLesson}/content`).type('form').send({ _csrf: token, type: 'text', title: 'Nope', body: 'x' });
  assert.match(decodeURIComponent(blocked.headers.location), /teachers aren't allowed to edit/);
  assert.equal((await contentItemsForAssignment(closedLesson)).length, 0);

  await toggleLessonPlanLocked(open);
  const item = (await contentItemsForAssignment(openLesson))[0];
  const lockedDelete = await teacher.post(`/teacher/content/${item.id}/delete`).type('form').send({ _csrf: token });
  assert.match(decodeURIComponent(lockedDelete.headers.location), /locked/);
  assert.equal((await contentItemsForAssignment(openLesson)).length, 2);
  assert.match((await teacher.get(`/teacher/assignments/${openLesson}`)).text, /an admin has locked/);
});

// A follow-up: "The only classes that parents can edit are the ones in
// family school management portal for their personal family use." A
// parent's Edit makes their family its own private copy; the shared
// plan, other families and co-op classes never change.
test('Family School Management: Edit makes a private family copy; the shared plan and other families are untouched', async () => {
  const { createLessonPlanContentItem, createLessonPlanQuizQuestion } = require('../utils/lessonPlans');
  const open = await makePlan('Parent Open Plan', { allowMemberEdit: true });
  const closed = await makePlan('Parent Closed Plan', {});
  const quizId = await createLessonPlanContentItem({ lessonPlanId: open, type: 'quiz', title: 'Library Quiz' });
  await createLessonPlanQuizQuestion({ contentItemId: quizId, type: 'multiple_choice', prompt: 'Two plus two?', pointsPossible: 1, choices: [{ label: '4', isCorrect: true }, { label: '5', isCorrect: false }] });
  const parent = await portalAgent('parent');
  const otherParent = await portalAgent('parent');
  let token = await csrf(parent, '/parent/family-school/classes?tab=availableLessonPlans');

  // A Family Class already using the shared plan.
  await parent.post('/parent/family-school/classes/from-lesson-plan').type('form').send({ _csrf: token, lessonPlanId: open });

  const library = await parent.get('/parent/family-school/classes?tab=availableLessonPlans');
  assert.match(library.text, new RegExp(`action="/parent/family-school/lesson-plans/${open}/copy"`));
  assert.doesNotMatch(library.text, new RegExp(`/lesson-plans/${closed}/copy`));
  assert.match((await parent.get(`/parent/family-school/lesson-plans/${open}`)).text, /Edit for My Family/);

  // Parents can never edit the shared plan itself.
  const direct = await parent.post(`/parent/family-school/lesson-plans/${open}/content`).type('form').send({ _csrf: token, type: 'text', title: 'Sneaky', body: 'x' });
  assert.equal(direct.status, 403);
  assert.equal((await parent.get(`/parent/family-school/lesson-plans/${open}/edit`)).status, 404);

  const copyRes = await parent.post(`/parent/family-school/lesson-plans/${open}/copy`).type('form').send({ _csrf: token });
  assert.equal(copyRes.status, 302);
  const copyId = Number(/lesson-plans\/(\d+)\/edit/.exec(copyRes.headers.location)[1]);
  assert.notEqual(copyId, open);
  const copied = await contentItemsForLessonPlan(copyId, { includeAnswerKey: true });
  assert.equal(copied[0].title, 'Library Quiz');
  assert.equal(copied[0].questions[0].prompt, 'Two plus two?');
  assert.equal(copied[0].questions[0].choices.length, 2);

  // Copying again reuses the same copy; their Family Class now uses it.
  const again = await parent.post(`/parent/family-school/lesson-plans/${open}/copy`).type('form').send({ _csrf: token });
  assert.match(again.headers.location, new RegExp(`/lesson-plans/${copyId}/edit`));
  const familyLesson = await db.prepare('SELECT source_lesson_plan_id FROM family_school_lessons WHERE title = ?').get('Parent Open Plan');
  assert.equal(familyLesson.source_lesson_plan_id, copyId);

  const editPage = await parent.get(`/parent/family-school/lesson-plans/${copyId}/edit`);
  assert.equal(editPage.status, 200);
  assert.match(editPage.text, /only affect your family/);
  token = await csrf(parent, `/parent/family-school/lesson-plans/${copyId}/edit`);
  const add = await parent.post(`/parent/family-school/lesson-plans/${copyId}/content`).type('form').send({ _csrf: token, type: 'text', title: 'Family Note', body: 'ours' });
  assert.equal(add.status, 302);
  assert.deepEqual((await contentItemsForLessonPlan(copyId)).map((i) => i.title), ['Library Quiz', 'Family Note']);
  assert.deepEqual((await contentItemsForLessonPlan(open)).map((i) => i.title), ['Library Quiz'], 'the shared plan is unchanged');

  // Another family can't see or edit it, and admins/teachers don't list it.
  assert.doesNotMatch((await otherParent.get('/parent/family-school/classes?tab=availableLessonPlans')).text, new RegExp(`lesson-plans/${copyId}`));
  assert.equal((await otherParent.get(`/parent/family-school/lesson-plans/${copyId}`)).status, 404);
  const otherToken = await csrf(otherParent, '/parent/family-school/classes');
  assert.equal((await otherParent.post(`/parent/family-school/lesson-plans/${copyId}/content`).type('form').send({ _csrf: otherToken, type: 'text', title: 'x', body: 'x' })).status, 403);
  const { listLessonPlans } = require('../utils/lessonPlans');
  assert.ok(!(await listLessonPlans()).some((p) => p.id === copyId));

  // A locked plan can't be copied for editing.
  const lockedPlan = await makePlan('Parent Locked Plan', { allowMemberEdit: true });
  await toggleLessonPlanLocked(lockedPlan);
  assert.match((await parent.get(`/parent/family-school/lesson-plans/${lockedPlan}`)).text, /locked by an admin/);
  const lockedCopy = await parent.post(`/parent/family-school/lesson-plans/${lockedPlan}/copy`).type('form').send({ _csrf: token });
  assert.match(decodeURIComponent(lockedCopy.headers.location), /locked by an admin/);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM lesson_plans WHERE copied_from_lesson_plan_id = ?').get(lockedPlan)).n, 0);
});

test('Admins can always edit a locked plan', async () => {
  const plan = await makePlan('Admin Locked Plan', { allowTeacherEdit: true });
  await toggleLessonPlanLocked(plan);
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/admin' });
  const token = await csrf(admin, `/admin/lesson-plans/${plan}`);
  const res = await admin.post(`/admin/lesson-plans/${plan}/content`).type('form').send({ _csrf: token, type: 'text', title: 'Admin Add', body: 'x' });
  assert.equal(res.status, 302);
  assert.deepEqual((await contentItemsForLessonPlan(plan)).map((i) => i.title), ['Admin Add']);
});
