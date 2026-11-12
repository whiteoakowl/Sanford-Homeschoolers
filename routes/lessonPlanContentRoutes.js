// Lesson Plan content editing (content items + quiz questions), shared by:
//   - Co-op Admin (routes/admin-lesson-plans.js) - the shared library
//     plans, always allowed.
//   - Family School Management (routes/parent-family-school.js) - only a
//     family's own private copy (lesson_plans.family_id), made when a
//     parent clicks Edit on a plan with "Allow parents to edit or add..."
//     checked and not locked.
// Teachers never edit a shared plan - only the copy assigned to their own
// class (utils/lessonPlans.js's teacherLessonPlanBlock).
const multer = require('multer');
const db = require('../db');
const { sanitizePostBody } = require('../utils/sanitizeHtml');
const { lessonAttachmentFileFilter } = require('../utils/uploads');
const { saveLessonAttachment } = require('../utils/academics');
const {
  getLessonPlan,
  getLessonPlanContentItem,
  contentItemsForLessonPlan,
  createLessonPlanContentItem,
  updateLessonPlanContentItem,
  deleteLessonPlanContentItem,
  reorderLessonPlanContentItems,
  createLessonPlanQuizQuestion,
  deleteLessonPlanQuizQuestion,
} = require('../utils/lessonPlans');

const MAX_LESSON_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const LESSON_CONTENT_TYPES = ['video', 'text', 'file', 'quiz', 'assignment_upload', 'assignment_submission'];
const lessonAttachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_LESSON_ATTACHMENT_BYTES }, fileFilter: lessonAttachmentFileFilter });

const NOT_ALLOWED = 'This lesson plan is locked, or you do not have permission to edit it.';

// options:
//   pathPrefix  - route path inside `router` ('/lesson-plans', '/family-school/lesson-plans')
//   urlPrefix   - the same path as the browser sees it ('/admin/lesson-plans', ...) -
//                 the base the content/questions forms post to
//   managePath  - id => URL of the plan's editor page (redirect target)
//   middleware  - extra middleware for every route (e.g. a portal permission check)
//   canEdit     - async (req, plan) => boolean
//   renderQuestions - (req, res, locals) => renders the Manage Questions page
function mountLessonPlanContentRoutes(router, { pathPrefix, urlPrefix, managePath, middleware = [], canEdit, renderQuestions }) {
  function uploadLessonAttachment(req, res, next) {
    lessonAttachmentUpload.single('attachment')(req, res, (err) => {
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.redirect(
          managePath(req.params.id) +
            '?error=' +
            encodeURIComponent(`That file is too large - lesson plan attachments are limited to ${MAX_LESSON_ATTACHMENT_BYTES / (1024 * 1024)}MB.`)
        );
      }
      next(err);
    });
  }

  // Loads the plan (by id, or via a content item / question), 404s if it
  // doesn't exist and 403s if this portal may not edit it.
  async function editablePlan(req, res, planId) {
    const plan = planId ? await getLessonPlan(planId) : null;
    if (!plan) {
      res.status(404).send('Not found');
      return null;
    }
    if (!(await canEdit(req, plan))) {
      res.status(403).send(NOT_ALLOWED);
      return null;
    }
    return plan;
  }

  router.post(`${pathPrefix}/:id/content`, ...middleware, uploadLessonAttachment, async (req, res) => {
    const lessonPlanId = parseInt(req.params.id, 10);
    if (!(await editablePlan(req, res, lessonPlanId))) return;
    const back = managePath(lessonPlanId);
    const type = req.body.type;
    if (!LESSON_CONTENT_TYPES.includes(type)) return res.redirect(back + '?error=' + encodeURIComponent('Choose a content type.'));

    let attachmentUrl = null;
    let attachmentName = null;
    if (type === 'assignment_upload' && req.file) {
      attachmentUrl = await saveLessonAttachment(req.file);
      attachmentName = req.file.originalname;
    }

    await createLessonPlanContentItem({
      lessonPlanId,
      type,
      title: (req.body.title || '').trim(),
      videoUrl: type === 'video' ? (req.body.videoUrl || '').trim() : null,
      body:
        type === 'text'
          ? (req.body.body || '').trim()
          : type === 'assignment_upload'
          ? sanitizePostBody(req.body.assignmentBody || '')
          : type === 'assignment_submission'
          ? sanitizePostBody(req.body.submissionBody || '')
          : null,
      fileUrl: type === 'file' ? (req.body.fileUrl || '').trim() : null,
      description: type === 'video' ? (req.body.description || '').trim() : type === 'file' ? (req.body.fileDescription || '').trim() : null,
      attachmentUrl,
      attachmentName,
      pointsPossible: type === 'assignment_submission' && req.body.submissionPointsPossible ? parseInt(req.body.submissionPointsPossible, 10) : null,
    });
    res.redirect(back + '?notice=' + encodeURIComponent('Added to the lesson plan.'));
  });

  router.post(`${pathPrefix}/content/:id/edit`, ...middleware, uploadLessonAttachment, async (req, res) => {
    const contentItem = await getLessonPlanContentItem(parseInt(req.params.id, 10));
    if (!contentItem) return res.status(404).send('Not found');
    if (!(await editablePlan(req, res, contentItem.lesson_plan_id))) return;
    const back = managePath(contentItem.lesson_plan_id);
    const type = contentItem.type;

    let attachmentUrl = contentItem.attachment_url;
    let attachmentName = contentItem.attachment_name;
    if (type === 'assignment_upload' && req.file) {
      attachmentUrl = await saveLessonAttachment(req.file);
      attachmentName = req.file.originalname;
    }

    await updateLessonPlanContentItem(contentItem.id, {
      title: (req.body.title || '').trim(),
      videoUrl: type === 'video' ? (req.body.videoUrl || '').trim() : contentItem.video_url,
      body:
        type === 'text'
          ? (req.body.body || '').trim()
          : type === 'assignment_upload'
          ? sanitizePostBody(req.body.assignmentBody || '')
          : type === 'assignment_submission'
          ? sanitizePostBody(req.body.submissionBody || '')
          : contentItem.body,
      fileUrl: type === 'file' ? (req.body.fileUrl || '').trim() : contentItem.file_url,
      description: type === 'video' ? (req.body.description || '').trim() : type === 'file' ? (req.body.fileDescription || '').trim() : contentItem.description,
      attachmentUrl,
      attachmentName,
      pointsPossible: type === 'assignment_submission' && req.body.submissionPointsPossible ? parseInt(req.body.submissionPointsPossible, 10) : null,
    });
    res.redirect(back + '?notice=' + encodeURIComponent('Updated.'));
  });

  router.post(`${pathPrefix}/content/:id/delete`, ...middleware, async (req, res) => {
    const contentItem = await getLessonPlanContentItem(parseInt(req.params.id, 10));
    if (!contentItem) return res.status(404).send('Not found');
    if (!(await editablePlan(req, res, contentItem.lesson_plan_id))) return;
    await deleteLessonPlanContentItem(contentItem.id);
    res.redirect(managePath(contentItem.lesson_plan_id) + '?notice=' + encodeURIComponent('Removed.'));
  });

  router.post(`${pathPrefix}/:id/content/reorder`, ...middleware, async (req, res) => {
    const lessonPlanId = parseInt(req.params.id, 10);
    if (!(await editablePlan(req, res, lessonPlanId))) return;
    const contentItemIds = [].concat(req.body.contentItemIds || []).map((v) => parseInt(v, 10));
    await reorderLessonPlanContentItems(lessonPlanId, contentItemIds);
    res.json({ ok: true });
  });

  router.get(`${pathPrefix}/content/:id/questions`, ...middleware, async (req, res) => {
    const contentItem = await getLessonPlanContentItem(parseInt(req.params.id, 10));
    if (!contentItem || contentItem.type !== 'quiz') return res.status(404).send('Not found');
    const plan = await editablePlan(req, res, contentItem.lesson_plan_id);
    if (!plan) return;
    const items = await contentItemsForLessonPlan(plan.id, { includeAnswerKey: true });
    const questions = items.find((i) => i.id === contentItem.id).questions;
    renderQuestions(req, res, {
      title: `Questions - ${contentItem.title || 'Quiz'}`,
      basePath: urlPrefix,
      backHref: managePath(plan.id),
      plan,
      contentItem,
      questions,
      error: req.query.error || null,
      notice: req.query.notice || null,
    });
  });

  router.post(`${pathPrefix}/content/:id/questions`, ...middleware, async (req, res) => {
    const contentItem = await getLessonPlanContentItem(parseInt(req.params.id, 10));
    if (!contentItem) return res.status(404).send('Not found');
    if (!(await editablePlan(req, res, contentItem.lesson_plan_id))) return;
    const back = managePath(contentItem.lesson_plan_id);
    const type = req.body.type === 'short_answer' ? 'short_answer' : 'multiple_choice';
    const prompt = (req.body.prompt || '').trim();
    if (!prompt) return res.redirect(back + '?error=' + encodeURIComponent('A question prompt is required.'));
    const correctIndex = req.body.correctChoice;
    const choices = [1, 2, 3, 4].map((n) => ({
      label: (req.body[`choice${n}`] || '').trim(),
      isCorrect: String(correctIndex) === String(n),
    }));
    await createLessonPlanQuizQuestion({
      contentItemId: contentItem.id,
      type,
      prompt,
      pointsPossible: req.body.pointsPossible ? Number(req.body.pointsPossible) : 1,
      choices: type === 'multiple_choice' ? choices : [],
    });
    res.redirect(back + '?notice=' + encodeURIComponent('Question added.'));
  });

  router.post(`${pathPrefix}/questions/:id/delete`, ...middleware, async (req, res) => {
    const questionId = parseInt(req.params.id, 10);
    const question = await db
      .prepare('SELECT q.*, lpci.lesson_plan_id FROM lesson_plan_quiz_questions q JOIN lesson_plan_content_items lpci ON lpci.id = q.content_item_id WHERE q.id = ?')
      .get(questionId);
    if (!question) return res.status(404).send('Not found');
    if (!(await editablePlan(req, res, question.lesson_plan_id))) return;
    await deleteLessonPlanQuizQuestion(questionId);
    res.redirect(managePath(question.lesson_plan_id) + '?notice=' + encodeURIComponent('Question removed.'));
  });
}

module.exports = { mountLessonPlanContentRoutes };
