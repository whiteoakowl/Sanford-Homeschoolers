// Lesson Plans - reusable, standalone templates of the same shape a real
// class's own Lessons already are (class_assignments/lesson_content_items/
// quiz_questions/quiz_choices, see utils/academics.js). A real request:
// "Co-op admin portal add a tab called lesson plans... Admins can create
// lessons plans and assign them to a class to be used as an option.
// Teachers can also still create their own lesson plans like they do
// now. Once the admin created lesson plan is added to a class it can
// then be edited by the teacher without changing the main copy admins
// have on their end." assignLessonPlanToClass below is the one function
// that ever bridges a template over to a real class - a one-time deep
// copy into real class_assignments/lesson_content_items/quiz_questions/
// quiz_choices rows, after which the copy is a completely ordinary
// lesson (editable/deletable exactly like a teacher's own) with no
// ongoing link back to the template at all.
const db = require('../db');
const { createAssignment, createContentItem, createQuizQuestion, lessonAttachmentUrl } = require('./academics');
const { getClass } = require('./classSchedule');

// The shared library only - a family's own private copy (family_id set,
// see copyLessonPlanForFamily) never shows to admins' list or teachers.
async function listLessonPlans() {
  return db.prepare('SELECT * FROM lesson_plans WHERE family_id IS NULL ORDER BY title').all();
}

// A real request: "Allow members to use this lesson plan for Homeschool
// family management... lesson should appear on available lesson plans
// page... should show up under add preplanned class button... weekly
// planner add lessons." The one filtered lookup every Family School
// Management surface that lists lesson plans calls, instead of each
// route re-querying lesson_plans.allow_family_school_use on its own.
// familyId adds that family's own private copies; other families'
// copies never show.
async function listFamilySchoolLessonPlans(familyId) {
  return db
    .prepare('SELECT * FROM lesson_plans WHERE allow_family_school_use = true AND (family_id IS NULL OR family_id = ?) ORDER BY title, family_id NULLS FIRST')
    .all(familyId || null);
}

// Whether a family may see/use this plan at all: a shared library plan
// offered to Family School Management, or that family's own copy.
function familyCanUseLessonPlan(plan, familyId) {
  if (!plan || !plan.allow_family_school_use) return false;
  return plan.family_id == null || (familyId != null && plan.family_id === familyId);
}

// A real request: parents edit a library plan for "their personal family
// use" only. Makes (or reuses) this family's private copy of a shared
// plan - its content and quiz questions too - and points this family's
// own Family Classes lessons that used the original at the copy, so
// their edits show up in their own classes. The original, and every
// other family, are untouched.
async function copyLessonPlanForFamily(lessonPlanId, familyId, createdByAccountId) {
  const plan = await getLessonPlan(lessonPlanId);
  if (!plan || plan.family_id != null || !familyId) return null;
  const existing = await db.prepare('SELECT id FROM lesson_plans WHERE family_id = ? AND copied_from_lesson_plan_id = ?').get(familyId, plan.id);
  if (existing) return existing.id;

  return db.withTransaction(async (tx) => {
    const copyId = (
      await tx
        .prepare(
          `INSERT INTO lesson_plans (title, description, created_by_account_id, allow_family_school_use, allow_teacher_edit, allow_member_edit, family_id, copied_from_lesson_plan_id)
           VALUES (?, ?, ?, true, false, false, ?, ?) RETURNING id`
        )
        .get(plan.title, plan.description, createdByAccountId || null, familyId, plan.id)
    ).id;
    const lessonIdMap = new Map();
    const lessons = await tx.prepare('SELECT * FROM lesson_plan_lessons WHERE lesson_plan_id = ? ORDER BY position, id').all(plan.id);
    for (const lesson of lessons) {
      const newLessonId = (
        await tx
          .prepare('INSERT INTO lesson_plan_lessons (lesson_plan_id, title, description, position) VALUES (?, ?, ?, ?) RETURNING id')
          .get(copyId, lesson.title, lesson.description, lesson.position)
      ).id;
      lessonIdMap.set(lesson.id, newLessonId);
    }
    const items = await tx.prepare('SELECT * FROM lesson_plan_content_items WHERE lesson_plan_id = ? ORDER BY position, id').all(plan.id);
    for (const item of items) {
      const newItemId = (
        await tx
          .prepare(
            `INSERT INTO lesson_plan_content_items (lesson_plan_id, lesson_id, type, position, title, video_url, body, file_url, description, attachment_url, attachment_name, points_possible)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
          )
          .get(copyId, lessonIdMap.get(item.lesson_id) || null, item.type, item.position, item.title, item.video_url, item.body, item.file_url, item.description, item.attachment_url, item.attachment_name, item.points_possible)
      ).id;
      const questions = await tx.prepare('SELECT * FROM lesson_plan_quiz_questions WHERE content_item_id = ? ORDER BY position, id').all(item.id);
      for (const q of questions) {
        const newQuestionId = (
          await tx
            .prepare('INSERT INTO lesson_plan_quiz_questions (content_item_id, type, prompt, points_possible, position) VALUES (?, ?, ?, ?, ?) RETURNING id')
            .get(newItemId, q.type, q.prompt, q.points_possible, q.position)
        ).id;
        const choices = await tx.prepare('SELECT * FROM lesson_plan_quiz_choices WHERE question_id = ? ORDER BY position, id').all(q.id);
        for (const c of choices) {
          await tx.prepare('INSERT INTO lesson_plan_quiz_choices (question_id, label, is_correct, position) VALUES (?, ?, ?, ?)').run(newQuestionId, c.label, c.is_correct, c.position);
        }
      }
    }
    await tx
      .prepare(
        `UPDATE family_school_lessons SET source_lesson_plan_id = ?, updated_at = now_text()
         WHERE source_lesson_plan_id = ? AND class_id IN (SELECT id FROM family_school_classes WHERE family_id = ?)`
      )
      .run(copyId, plan.id, familyId);
    for (const [oldLessonId, newLessonId] of lessonIdMap) {
      await tx
        .prepare(
          `UPDATE family_school_lessons SET source_lesson_plan_lesson_id = ?
           WHERE source_lesson_plan_lesson_id = ? AND class_id IN (SELECT id FROM family_school_classes WHERE family_id = ?)`
        )
        .run(newLessonId, oldLessonId, familyId);
    }
    return copyId;
  });
}

async function getLessonPlan(id) {
  return db.prepare('SELECT * FROM lesson_plans WHERE id = ?').get(id);
}

async function createLessonPlan({ title, description, createdByAccountId }) {
  const info = await db
    .prepare('INSERT INTO lesson_plans (title, description, created_by_account_id) VALUES (?, ?, ?)')
    .run(title, description || null, createdByAccountId || null);
  return info.lastInsertRowid;
}

// A real request: "Co-op admin portal. Lesson plans tab... allow
// teachers to edit/add to the lesson plan, all members to edit/add to
// the lesson plan." Two more independent permission checkboxes
// alongside the existing Homeschool family management one, saved on the
// same Lesson Plan Details form/route rather than a separate page -
// both default false (today's admin-only editing is unchanged until an
// admin opts a specific lesson plan in).
async function updateLessonPlan(id, { title, description, allowFamilySchoolUse, allowTeacherEdit, allowMemberEdit }) {
  await db
    .prepare(
      'UPDATE lesson_plans SET title = ?, description = ?, allow_family_school_use = ?, allow_teacher_edit = ?, allow_member_edit = ?, updated_at = now_text() WHERE id = ?'
    )
    .run(title, description || null, !!allowFamilySchoolUse, !!allowTeacherEdit, !!allowMemberEdit, id);
}

// A real request: "Lesson plan so that if a teacher uses it for co-op
// classes or a parent uses it for a family school management lesson
// plan for their students they won't be able to change it. It can be
// locked or unlocked by admin." The one shared lookup every non-admin
// enforcement point calls, instead of each route file re-querying
// lesson_plans.locked on its own.
//
// A later request: the "Allow teachers to edit/add" and "Allow parents
// to edit or add ... from the Family School Management portal"
// checkboxes now let those portals edit the plan itself (routes/
// lessonPlanContentRoutes.js) - and a locked plan blocks both
// (memberCanEditPlan there); only admins can edit a locked plan.
//
// Where this is also checked:
//   - Family School Management (routes/parent-family-school.js, via
//     utils/familySchool.js's own contentItemsForLesson/getLesson call
//     sites) - a parent's lesson that references a plan always renders
//     that plan's content read-only, independent of this flag (there is
//     no route that would ever let a parent write to lesson_plan_
//     content_items at all - it's a live read-through reference, never
//     a copy, see the family_school_lesson_plan_reference migration's
//     own comment). The lock state still shows there, so a parent can
//     see whether the admin considers it final.
//   - Co-op Teacher Portal (routes/teacher-portal.js) - deliberately NOT
//     checked here. "Assign to Class" (this file's own
//     assignLessonPlanToClass) is a one-time DEEP COPY into ordinary
//     class_assignments/lesson_content_items rows with no lesson_plan_id
//     of their own at all - by the time a teacher could edit anything,
//     it's already a fully independent row, not "this lesson plan's
//     content" anymore. There is currently no path where a teacher ever
//     edits a lesson_plans/lesson_plan_content_items row directly (only
//     routes/admin-lesson-plans.js touches those, and that whole router
//     is already admin-gated), so there is nothing for `locked` to block
//     on the teacher side today.
async function isLessonPlanLocked(id) {
  if (!id) return false;
  const plan = await db.prepare('SELECT locked FROM lesson_plans WHERE id = ?').get(id);
  return !!(plan && plan.locked);
}

// Admin-only (routes/admin-lesson-plans.js is already fully admin-gated)
// - a plain toggle, same "flip the boolean, hand back the new value for
// the redirect notice" shape familySchool.js's own toggleWeekAssignmentComplete
// already uses.
async function toggleLessonPlanLocked(id) {
  const row = await db.prepare('UPDATE lesson_plans SET locked = NOT locked, updated_at = now_text() WHERE id = ? RETURNING locked').get(id);
  return row ? row.locked : null;
}

// lesson_plan_content_items/lesson_plan_quiz_questions/lesson_plan_quiz_choices
// all cascade off lesson_plans, so one delete here is enough - same
// pattern utils/academics.js's own deleteAssignment comment explains.
async function deleteLessonPlan(id) {
  await db.prepare('DELETE FROM lesson_plans WHERE id = ?').run(id);
}

async function getLessonPlanContentItem(id) {
  return db.prepare('SELECT * FROM lesson_plan_content_items WHERE id = ?').get(id);
}

// includeAnswerKey - same reasoning as contentItemsForAssignment's own
// comment (utils/academics.js): true only for the admin's own editing
// view, never anywhere a non-admin could read the response.
async function contentItemsForLessonPlan(lessonPlanId, { includeAnswerKey = false } = {}) {
  const items = await db
    .prepare(
      `SELECT ci.* FROM lesson_plan_content_items ci LEFT JOIN lesson_plan_lessons l ON l.id = ci.lesson_id
       WHERE ci.lesson_plan_id = ? ORDER BY l.position NULLS FIRST, l.id NULLS FIRST, ci.position, ci.id`
    )
    .all(lessonPlanId);
  return decorateLessonPlanItems(items, includeAnswerKey);
}

// A real request: a library plan holds lessons, each with its own
// assignments - the same lesson/assignment design as the Teacher Portal.
async function contentItemsForLessonPlanLesson(lessonId, { includeAnswerKey = false } = {}) {
  const items = await db.prepare('SELECT * FROM lesson_plan_content_items WHERE lesson_id = ? ORDER BY position, id').all(lessonId);
  return decorateLessonPlanItems(items, includeAnswerKey);
}

async function decorateLessonPlanItems(items, includeAnswerKey) {
  return Promise.all(
    items.map(async (item) => {
      const withAttachment = { ...item, attachmentUrl: lessonAttachmentUrl(item.attachment_url) };
      if (withAttachment.type !== 'quiz') return withAttachment;
      return { ...withAttachment, questions: await questionsForLessonPlanContentItem(item.id, { includeAnswerKey }) };
    })
  );
}

// No dueDate here (unlike createContentItem) - see the migration's own
// comment on why a due date only ever makes sense once a copy is
// attached to a real class.
// lessonId - which of the plan's lessons this assignment belongs to; when
// left out it goes on the plan's first lesson (one is made if the plan
// has none yet).
async function createLessonPlanContentItem({ lessonPlanId, lessonId, type, title, videoUrl, body, fileUrl, description, attachmentUrl, attachmentName, pointsPossible }) {
  let targetLessonId = lessonId || null;
  if (targetLessonId) {
    const lesson = await getLessonPlanLesson(targetLessonId);
    if (!lesson || lesson.lesson_plan_id !== lessonPlanId) targetLessonId = null;
  }
  if (!targetLessonId) targetLessonId = await firstLessonPlanLessonId(lessonPlanId);
  const { next_position: nextPosition } = await db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM lesson_plan_content_items WHERE lesson_id = ?')
    .get(targetLessonId);
  const info = await db
    .prepare(
      'INSERT INTO lesson_plan_content_items (lesson_plan_id, lesson_id, type, position, title, video_url, body, file_url, description, attachment_url, attachment_name, points_possible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id'
    )
    .get(lessonPlanId, targetLessonId, type, nextPosition, title || null, videoUrl || null, body || null, fileUrl || null, description || null, attachmentUrl || null, attachmentName || null, pointsPossible != null ? pointsPossible : null);
  return info.id;
}

// --- A plan's lessons (lesson_plan_lessons) ---

async function getLessonPlanLesson(id) {
  return id ? db.prepare('SELECT * FROM lesson_plan_lessons WHERE id = ?').get(id) : null;
}

async function lessonsForLessonPlan(lessonPlanId, { includeAnswerKey = false } = {}) {
  const lessons = await db.prepare('SELECT * FROM lesson_plan_lessons WHERE lesson_plan_id = ? ORDER BY position, id').all(lessonPlanId);
  const out = [];
  for (const lesson of lessons) {
    out.push({ ...lesson, contentItems: await contentItemsForLessonPlanLesson(lesson.id, { includeAnswerKey }) });
  }
  return out;
}

async function createLessonPlanLesson({ lessonPlanId, title, description }) {
  const { next_position: nextPosition } = await db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM lesson_plan_lessons WHERE lesson_plan_id = ?')
    .get(lessonPlanId);
  const row = await db
    .prepare('INSERT INTO lesson_plan_lessons (lesson_plan_id, title, description, position) VALUES (?, ?, ?, ?) RETURNING id')
    .get(lessonPlanId, title, description || null, nextPosition);
  return row.id;
}

async function updateLessonPlanLesson(id, { title, description }) {
  await db.prepare('UPDATE lesson_plan_lessons SET title = ?, description = ? WHERE id = ?').run(title, description || null, id);
}

async function deleteLessonPlanLesson(id) {
  await db.prepare('DELETE FROM lesson_plan_lessons WHERE id = ?').run(id);
}

async function firstLessonPlanLessonId(lessonPlanId) {
  const first = await db.prepare('SELECT id FROM lesson_plan_lessons WHERE lesson_plan_id = ? ORDER BY position, id LIMIT 1').get(lessonPlanId);
  if (first) return first.id;
  const plan = await getLessonPlan(lessonPlanId);
  return createLessonPlanLesson({ lessonPlanId, title: plan ? plan.title : 'Lesson 1', description: plan ? plan.description : null });
}

async function updateLessonPlanContentItem(id, { title, videoUrl, body, fileUrl, description, attachmentUrl, attachmentName, pointsPossible }) {
  await db
    .prepare(
      'UPDATE lesson_plan_content_items SET title = ?, video_url = ?, body = ?, file_url = ?, description = ?, attachment_url = ?, attachment_name = ?, points_possible = ? WHERE id = ?'
    )
    .run(
      title || null,
      videoUrl || null,
      body || null,
      fileUrl || null,
      description || null,
      attachmentUrl || null,
      attachmentName || null,
      pointsPossible != null ? pointsPossible : null,
      id
    );
}

async function deleteLessonPlanContentItem(id) {
  await db.prepare('DELETE FROM lesson_plan_content_items WHERE id = ?').run(id);
}

async function reorderLessonPlanContentItems(lessonPlanId, orderedIds) {
  for (let i = 0; i < orderedIds.length; i++) {
    await db.prepare('UPDATE lesson_plan_content_items SET position = ? WHERE id = ? AND lesson_plan_id = ?').run(i, orderedIds[i], lessonPlanId);
  }
}

async function questionsForLessonPlanContentItem(contentItemId, { includeAnswerKey = false } = {}) {
  const questions = await db.prepare('SELECT * FROM lesson_plan_quiz_questions WHERE content_item_id = ? ORDER BY position, id').all(contentItemId);
  return Promise.all(
    questions.map(async (q) => {
      if (q.type !== 'multiple_choice') return { ...q, choices: [] };
      const choices = await db.prepare('SELECT * FROM lesson_plan_quiz_choices WHERE question_id = ? ORDER BY position, id').all(q.id);
      return { ...q, choices: includeAnswerKey ? choices : choices.map(({ is_correct: _is_correct, ...c }) => c) };
    })
  );
}

async function createLessonPlanQuizQuestion({ contentItemId, type, prompt, pointsPossible, choices }) {
  const { next_position: nextPosition } = await db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM lesson_plan_quiz_questions WHERE content_item_id = ?')
    .get(contentItemId);
  const info = await db
    .prepare('INSERT INTO lesson_plan_quiz_questions (content_item_id, type, prompt, points_possible, position) VALUES (?, ?, ?, ?, ?)')
    .run(contentItemId, type, prompt, pointsPossible || 1, nextPosition);
  const questionId = info.lastInsertRowid;
  if (type === 'multiple_choice') {
    let position = 0;
    for (const choice of choices || []) {
      if (!choice.label || !choice.label.trim()) continue;
      await db
        .prepare('INSERT INTO lesson_plan_quiz_choices (question_id, label, is_correct, position) VALUES (?, ?, ?, ?)')
        .run(questionId, choice.label.trim(), choice.isCorrect ? 1 : 0, position++);
    }
  }
  return questionId;
}

async function deleteLessonPlanQuizQuestion(id) {
  await db.prepare('DELETE FROM lesson_plan_quiz_questions WHERE id = ?').run(id);
}

// The one bridge from a template to a real class - "essentially its like
// adding a ready made lesson plan template to a class, the teacher can
// tweak it without changing the original." Builds a brand new
// class_assignments row (same createAssignment every other "add a lesson
// to a class" path uses) titled after the lesson plan, then deep-copies
// every content item (and, for a quiz, every question/choice) onto it -
// an ordinary, fully independent lesson from this point on. Returns the
// new assignment's id so the caller can redirect straight to it.
async function assignLessonPlanToClass(lessonPlanId, classId, createdByAccountId) {
  const plan = await getLessonPlan(lessonPlanId);
  if (!plan) throw new Error('Lesson plan not found.');
  const cls = await getClass(classId);
  if (!cls) throw new Error('Class not found.');

  // A real request: a plan holds lessons - each becomes its own lesson on
  // the class (in order), with that lesson's assignments copied into it.
  // A plan with no lessons yet still adds one (empty) lesson.
  let lessons = await lessonsForLessonPlan(lessonPlanId, { includeAnswerKey: true });
  if (!lessons.length) lessons = [{ title: plan.title, description: plan.description, contentItems: [] }];

  let firstAssignmentId = null;
  for (const lesson of lessons) {
    const assignmentId = await createAssignment({
      classId,
      className: cls.class_name,
      title: lesson.title,
      description: lesson.description,
      createdByAccountId,
    });
    if (!firstAssignmentId) firstAssignmentId = assignmentId;
    // Remembered so the plan's "Allow teachers to edit/add" checkbox and
    // Lock still decide whether this class's teacher may edit the copy
    // (see teacherLessonPlanBlock below).
    await db.prepare('UPDATE class_assignments SET source_lesson_plan_id = ? WHERE id = ?').run(plan.id, assignmentId);

    for (const item of lesson.contentItems) {
      const newItemId = await createContentItem({
        assignmentId,
        type: item.type,
        title: item.title,
        videoUrl: item.video_url,
        body: item.body,
        fileUrl: item.file_url,
        description: item.description,
        attachmentUrl: item.attachment_url,
        attachmentName: item.attachment_name,
        pointsPossible: item.points_possible,
      });
      if (item.type === 'quiz') {
        for (const q of item.questions) {
          await createQuizQuestion({
            contentItemId: newItemId,
            type: q.type,
            prompt: q.prompt,
            pointsPossible: q.points_possible,
            choices: q.choices.map((c) => ({ label: c.label, isCorrect: !!c.is_correct })),
          });
        }
      }
    }
  }

  return firstAssignmentId;
}

// A real request: a teacher edits a lesson plan only on the co-op class
// it was assigned to - "these shared changes only show up on the co-op
// class it is attached to" - never the shared plan or Family School
// Management. Returns why this teacher can't edit a class lesson that
// came from a plan (null when they can): the plan doesn't allow teacher
// edits, or an admin locked it. Lessons a teacher wrote themselves, or
// whose plan was deleted, are always editable.
async function teacherLessonPlanBlock(assignment) {
  if (!assignment || !assignment.source_lesson_plan_id) return null;
  const plan = await getLessonPlan(assignment.source_lesson_plan_id);
  if (!plan) return null;
  if (plan.locked) return `This lesson comes from the "${plan.title}" lesson plan, which an admin has locked, so it can't be edited right now.`;
  if (!plan.allow_teacher_edit) return `This lesson comes from the "${plan.title}" lesson plan, which teachers aren't allowed to edit.`;
  return null;
}

module.exports = {
  teacherLessonPlanBlock,
  getLessonPlanLesson,
  lessonsForLessonPlan,
  createLessonPlanLesson,
  updateLessonPlanLesson,
  deleteLessonPlanLesson,
  contentItemsForLessonPlanLesson,
  listLessonPlans,
  listFamilySchoolLessonPlans,
  familyCanUseLessonPlan,
  copyLessonPlanForFamily,
  getLessonPlan,
  createLessonPlan,
  updateLessonPlan,
  deleteLessonPlan,
  isLessonPlanLocked,
  toggleLessonPlanLocked,
  getLessonPlanContentItem,
  contentItemsForLessonPlan,
  createLessonPlanContentItem,
  updateLessonPlanContentItem,
  deleteLessonPlanContentItem,
  reorderLessonPlanContentItems,
  questionsForLessonPlanContentItem,
  createLessonPlanQuizQuestion,
  deleteLessonPlanQuizQuestion,
  assignLessonPlanToClass,
};
