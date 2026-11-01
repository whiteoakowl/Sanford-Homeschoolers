// Member-facing Custom Forms (Community & Commerce track, item 7),
// mounted at /forms (server.js). Members-only for every route - a form
// is either open to any signed-in account (no assignments at all) or
// targeted at specific people/roles, never public. A submission is
// filled out on behalf of one member of the acting account's own family
// (self included) - one submission per (form, member), matching the
// unique constraint the migration itself puts on that pair.
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { requirePortalAuth } = require('../middleware/portalAuth');
const { familyForAccount } = require('../utils/portalAuth');
const { createStorageClient, uploadFile, downloadFile, generateKey } = require('../utils/storage');
const { lessonAttachmentFileFilter } = require('../utils/uploads');
const customForms = require('../utils/customForms');

router.use(requirePortalAuth);

// A private bucket (like admin-documents.js's own `documents` bucket) -
// a form submission can carry a real uploaded document (e.g. a signed
// waiver), so this is proxied through an authenticated download route
// below rather than a public URL, unlike Events/Directory's own image
// uploads.
const FORM_FILES_BUCKET = 'custom-form-files';
// Deliberately OUTSIDE public/ (unlike admin-documents.js's own local-
// disk fallback, which lives under public/uploads/documents and is
// therefore reachable by anyone who knows/guesses the key, since
// express.static serves the whole public/ tree unconditionally) - a
// submitted form file is proxied exclusively through the authenticated
// /forms/files/:answerId route below, so there's no reason to also make
// it directly fetchable by URL.
const FORM_FILES_DIR = path.join(__dirname, '..', 'private-uploads', 'custom-form-files');
const storageClient = createStorageClient();
if (!storageClient && !fs.existsSync(FORM_FILES_DIR)) {
  try {
    fs.mkdirSync(FORM_FILES_DIR, { recursive: true });
  } catch (err) {
    console.error(`Could not create local upload directory ${FORM_FILES_DIR}:`, err.message);
  }
}

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

  if (storageClient) {
    const buffer = await downloadFile(storageClient, FORM_FILES_BUCKET, answer.value_text);
    res.setHeader('Content-Type', 'application/octet-stream');
    return res.send(buffer);
  }
  const filePath = path.join(FORM_FILES_DIR, path.basename(answer.value_text));
  if (!fs.existsSync(filePath)) return res.status(404).render('404', { title: 'Not Found' });
  res.sendFile(filePath);
});

router.get('/:id', async (req, res) => {
  const form = await customForms.getForm(req.params.id);
  if (!form || form.status !== 'published') return res.status(404).render('404', { title: 'Not Found' });
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

// A real request, with a Jotform screenshot naming "Full Name", "Address"
// and "Appointment" as elements this app didn't have yet (see utils/
// customForms.js's own COMPOSITE_TYPES comment): each is several inputs
// on the public form (views/partials/custom-form-field.ejs,
// field_<id>[subkey]) combined here into the ONE plain-text answer this
// app stores for every field type - full_name as "First Last" (same
// single-string convention a member's own name already uses), address
// as a single comma-joined line, appointment as "YYYY-MM-DD HH:MM".
// Blank sub-parts are simply left out rather than leaving stray
// separators in the combined string.
function combinedSubfieldValue(fieldType, raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  if (fieldType === 'full_name') return [v.first, v.last].map((s) => (s || '').trim()).filter(Boolean).join(' ');
  if (fieldType === 'address') {
    const cityStateZip = [[v.city, v.state].map((s) => (s || '').trim()).filter(Boolean).join(', '), (v.zip || '').trim()].filter(Boolean).join(' ');
    return [(v.street || '').trim(), (v.street2 || '').trim(), cityStateZip].filter(Boolean).join(', ');
  }
  if (fieldType === 'appointment') return [v.date, v.time].map((s) => (s || '').trim()).filter(Boolean).join(' ');
  return '';
}

// Input Table/Matrix's answer is {rowLabel: selectedColumnLabel} - each
// row posts as its own field_<id>[<row label>] (views/partials/custom-
// form-field.ejs), so a row nobody picked a column for simply never
// shows up as a key here, same as any other unanswered radio group.
function combinedMatrixValue(field, raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const row of field.options) {
    if (v[row.label]) out[row.label] = v[row.label].toString();
  }
  return out;
}

// Fill in the Blank's answer is one value per blank in its template
// (views/partials/custom-form-field.ejs splits field_<id>[] into that
// many <input>s) - collected as a plain array here, same shape
// multiple_choice's own array-of-labels already gives evaluateCondition
// (it maps over whatever array it's handed), and JSON-stringified only
// where it's actually stored (the per-type branch below), not here.
function fillBlankValues(body, fieldId) {
  const raw = body[`field_${fieldId}`];
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((v) => (v || '').toString().trim());
}

// The field's submitted value, in whatever shape evaluateCondition
// expects (a plain string for most types, an array of selected option
// LABELS - not ids - for multiple_choice, since a conditional rule's
// own `value` is always a label, same as single_choice/dropdown already
// submit). Used to build valuesByFieldId below, which both the
// required-field check and isFieldVisible read from - the one place
// "what did they actually answer" is computed, so the two can never see
// a different answer for the same field.
function rawValueForField(field, body, filesByField) {
  if (field.field_type === 'multiple_choice') {
    const raw = body[`field_${field.id}`];
    const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((v) => parseInt(v, 10));
    return field.options.filter((o) => ids.includes(o.id)).map((o) => o.label);
  }
  if (field.field_type === 'checkbox') return body[`field_${field.id}`] ? '1' : '0';
  if (field.field_type === 'file') return filesByField.has(`field_${field.id}`) ? 'has-file' : '';
  if (field.field_type === 'full_name' || field.field_type === 'address' || field.field_type === 'appointment') {
    return combinedSubfieldValue(field.field_type, body[`field_${field.id}`]);
  }
  if (field.field_type === 'fill_blank') return fillBlankValues(body, field.id);
  if (field.field_type === 'input_table') return Object.values(combinedMatrixValue(field, body[`field_${field.id}`]));
  return (body[`field_${field.id}`] || '').toString();
}

router.post('/:id/submit', upload.any(), async (req, res) => {
  const form = await customForms.getForm(req.params.id);
  if (!form || form.status !== 'published') return res.status(404).render('404', { title: 'Not Found' });
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
  // heading/paragraph are layout-only (DISPLAY_ONLY_TYPES) - never an
  // answer, never required, never stored.
  const fields = pages.flatMap((p) => p.fields).filter((f) => !customForms.DISPLAY_ONLY_TYPES.has(f.field_type));
  const filesByField = new Map((req.files || []).map((f) => [f.fieldname, f]));

  // Conditional logic ("only show this field/section when...") is
  // enforced server-side too, not just hidden client-side with plain JS
  // (public/js/custom-form-runtime.js) - a required field a respondent
  // never actually saw, because its own rule failed or its whole
  // page/section was skipped, must never block submission. Every
  // field's raw submitted value is collected up front (independent of
  // field order, since a rule can point at a field anywhere in the
  // form) before any required check runs.
  const valuesByFieldId = {};
  for (const field of fields) valuesByFieldId[field.id] = rawValueForField(field, req.body, filesByField);

  // Field types whose own submitted req.body value isn't a plain string
  // (full_name/address/appointment post an object of sub-keys, fill_blank
  // posts an array of blanks, input_table posts an object of row->column)
  // get their own required check below instead of the generic "is this
  // field's raw body value falsy" one just under it, which would
  // otherwise treat a submitted-but-still-empty object/array as answered.
  const COMPOSITE_REQUIRED_TYPES = new Set(['full_name', 'address', 'appointment', 'fill_blank', 'input_table']);

  const answers = [];
  for (const field of fields) {
    const visible = customForms.isFieldVisible(field, valuesByFieldId, pages);
    if (
      field.is_required &&
      visible &&
      field.field_type !== 'file' &&
      field.field_type !== 'multiple_choice' &&
      !COMPOSITE_REQUIRED_TYPES.has(field.field_type) &&
      !req.body[`field_${field.id}`]
    ) {
      return res.redirect(`/forms/${form.id}?error=` + encodeURIComponent(`"${field.label}" is required.`));
    }
    if (field.field_type === 'full_name' || field.field_type === 'address' || field.field_type === 'appointment') {
      const combined = combinedSubfieldValue(field.field_type, req.body[`field_${field.id}`]);
      if (field.is_required && visible && !combined) {
        return res.redirect(`/forms/${form.id}?error=` + encodeURIComponent(`"${field.label}" is required.`));
      }
      answers.push({ fieldId: field.id, valueText: combined });
      continue;
    }
    if (field.field_type === 'fill_blank') {
      const blanks = fillBlankValues(req.body, field.id);
      if (field.is_required && visible && (blanks.length === 0 || blanks.some((b) => !b))) {
        return res.redirect(`/forms/${form.id}?error=` + encodeURIComponent(`"${field.label}" is required.`));
      }
      answers.push({ fieldId: field.id, valueText: JSON.stringify(blanks) });
      continue;
    }
    if (field.field_type === 'input_table') {
      const matrix = combinedMatrixValue(field, req.body[`field_${field.id}`]);
      if (field.is_required && visible && Object.keys(matrix).length < field.options.length) {
        return res.redirect(`/forms/${form.id}?error=` + encodeURIComponent(`"${field.label}" is required.`));
      }
      answers.push({ fieldId: field.id, valueText: JSON.stringify(matrix) });
      continue;
    }
    if (field.field_type === 'multiple_choice') {
      const raw = req.body[`field_${field.id}`];
      const optionIds = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((v) => parseInt(v, 10));
      if (field.is_required && visible && optionIds.length === 0) {
        return res.redirect(`/forms/${form.id}?error=` + encodeURIComponent(`"${field.label}" is required.`));
      }
      answers.push({ fieldId: field.id, valueText: null, optionIds });
    } else if (field.field_type === 'file') {
      const file = filesByField.get(`field_${field.id}`);
      if (field.is_required && visible && !file) {
        return res.redirect(`/forms/${form.id}?error=` + encodeURIComponent(`"${field.label}" is required.`));
      }
      let key = null;
      if (file) {
        key = storageClient
          ? await uploadFile(storageClient, FORM_FILES_BUCKET, file.buffer, file.originalname, file.mimetype)
          : (() => {
              const k = generateKey(file.originalname);
              fs.writeFileSync(path.join(FORM_FILES_DIR, k), file.buffer);
              return k;
            })();
      }
      answers.push({ fieldId: field.id, valueText: key });
    } else if (field.field_type === 'checkbox') {
      answers.push({ fieldId: field.id, valueText: req.body[`field_${field.id}`] ? '1' : '0' });
    } else {
      answers.push({ fieldId: field.id, valueText: (req.body[`field_${field.id}`] || '').trim() });
    }
  }

  await customForms.submitForm(form.id, memberId, req.portalAccount.id, answers);
  res.redirect(`/forms/${form.id}/mine/${memberId}`);
});

module.exports = router;
