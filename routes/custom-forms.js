// Member-facing Custom Forms (Community & Commerce track, item 7),
// mounted at /forms (server.js). Members-only for every route - a form
// is either open to any signed-in account (no assignments at all) or
// targeted at specific people/roles, never public. A submission is
// filled out on behalf of one member of the acting account's own family
// (self included) - one submission per (form, member), matching the
// unique constraint the migration itself puts on that pair.
const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../db');
const { requirePortalAuth } = require('../middleware/portalAuth');
const { familyForAccount } = require('../utils/portalAuth');
const { lessonAttachmentFileFilter } = require('../utils/uploads');
const customForms = require('../utils/customForms');
// Answer parsing + the private custom-form-files storage live in utils/
// customFormAnswers.js, shared with routes/parent-support.js.
const { collectAnswers, sendFormFile } = require('../utils/customFormAnswers');

router.use(requirePortalAuth);

const MAX_FILE_BYTES = 5 * 1024 * 1024;
// Was missing a fileFilter entirely - every other upload route in this
// app pairs its size limit with one (utils/uploads.js), checking the
// declared mimetype against the real extension so a submitted file
// can't be served back as a type it wasn't validated as. A form file
// field is a document (e.g. a signed waiver), same set lesson/
// assignment attachments already accept.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES }, fileFilter: lessonAttachmentFileFilter });

async function roleIdsForAccount(req) {
  return req.portalRoles.map((r) => r.id);
}

router.get('/', async (req, res) => {
  const family = await familyForAccount(req.portalAccount.id);
  const roleIds = await roleIdsForAccount(req);
  const forms = await customForms.formsVisibleTo(family, roleIds);
  res.render('custom-forms-list', { title: 'Forms', forms });
});

// Must come BEFORE the generic '/:id' route below - otherwise Express
// would match "files" itself as an :id here first (route matching is by
// definition order within a router, not by specificity).
router.get('/files/:answerId', async (req, res) => {
  const answer = await db
    .prepare(
      `SELECT a.*, s.member_id, s.form_id FROM custom_form_answers a
       JOIN custom_form_submissions s ON s.id = a.submission_id
       WHERE a.id = ?`
    )
    .get(req.params.answerId);
  if (!answer || !answer.value_text) return res.status(404).render('404', { title: 'Not Found' });

  const isModerator = req.portalPermissions.has('manage_forms');
  if (!isModerator) {
    const family = await familyForAccount(req.portalAccount.id);
    if (!family.some((m) => m.id === answer.member_id)) {
      return res.status(403).render('403', { title: 'Not Authorized', message: "You don't have access to this file.", backHref: '/forms', backLabel: 'Back to Forms' });
    }
  }

  if (!(await sendFormFile(res, answer.value_text))) return res.status(404).render('404', { title: 'Not Found' });
});

router.get('/:id', async (req, res) => {
  const form = await customForms.getForm(req.params.id);
  if (!form || form.status !== 'published' || form.system_key) return res.status(404).render('404', { title: 'Not Found' });
  const family = await familyForAccount(req.portalAccount.id);
  const roleIds = await roleIdsForAccount(req);
  if (!(await customForms.canAccessForm(form.id, family, roleIds))) {
    return res.status(403).render('403', { title: 'Not Authorized', message: "You don't have access to this form.", backHref: '/forms', backLabel: 'Back to Forms' });
  }
  // Multi-page/section forms: pages (ordered) each carrying their own
  // ordered fields - a one-page form (the common case) just renders as
  // one page with no progress bar (views/custom-forms-fill.ejs only
  // shows one once pages.length > 1).
  const pages = await customForms.pagesWithFields(form.id);
  for (const page of pages) {
    page.conditionalLogicParsed = customForms.parseConditionalLogic(page.conditional_logic);
    for (const field of page.fields) {
      field.conditionalLogicParsed = customForms.parseConditionalLogic(field.conditional_logic);
      field.matrixColumnsParsed = customForms.parseMatrixColumns(field.matrix_columns);
    }
  }
  res.render('custom-forms-fill', {
    title: form.title,
    form,
    pages,
    ratingMax: customForms.RATING_MAX,
    spinnerRange: customForms.SPINNER_RANGE,
    displayOnlyTypes: [...customForms.DISPLAY_ONLY_TYPES],
    themePreset: customForms.themePresetByKey(form.theme_preset),
    customFormImageUrl: customForms.customFormImageUrl,
    family,
    error: req.query.error || null,
  });
});

router.get('/:id/mine/:memberId', async (req, res) => {
  const form = await customForms.getForm(req.params.id);
  if (!form) return res.status(404).render('404', { title: 'Not Found' });
  const family = await familyForAccount(req.portalAccount.id);
  if (!family.some((m) => m.id === parseInt(req.params.memberId, 10))) {
    return res.status(403).render('403', { title: 'Not Authorized', message: "That's not your submission.", backHref: '/forms', backLabel: 'Back to Forms' });
  }
  const submission = await customForms.submissionFor(form.id, req.params.memberId);
  if (!submission) return res.status(404).render('404', { title: 'Not Found' });
  const answers = await customForms.answersForSubmission(submission.id);
  res.render('custom-forms-submitted', { title: form.title, form, submission, answers, customForms });
});

router.post('/:id/submit', upload.any(), async (req, res) => {
  const form = await customForms.getForm(req.params.id);
  if (!form || form.status !== 'published' || form.system_key) return res.status(404).render('404', { title: 'Not Found' });
  const family = await familyForAccount(req.portalAccount.id);
  const roleIds = await roleIdsForAccount(req);
  if (!(await customForms.canAccessForm(form.id, family, roleIds))) {
    return res.status(403).render('403', { title: 'Not Authorized', message: "You don't have access to this form.", backHref: '/forms', backLabel: 'Back to Forms' });
  }
  const memberId = parseInt(req.body.memberId, 10);
  if (!family.some((m) => m.id === memberId)) {
    return res.redirect(`/forms/${form.id}?error=` + encodeURIComponent('You can only submit for yourself or your own family.'));
  }
  if (await customForms.submissionFor(form.id, memberId)) {
    return res.redirect(`/forms/${form.id}/mine/${memberId}`);
  }

  const pages = await customForms.pagesWithFields(form.id);
  const result = await collectAnswers(pages, req.body, req.files);
  if (result.error) return res.redirect(`/forms/${form.id}?error=` + encodeURIComponent(result.error));
  const answers = result.answers;

  await customForms.submitForm(form.id, memberId, req.portalAccount.id, answers);
  res.redirect(`/forms/${form.id}/mine/${memberId}`);
});

module.exports = router;
