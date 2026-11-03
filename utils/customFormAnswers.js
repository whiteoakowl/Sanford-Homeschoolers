// Turns a submitted Custom Forms POST body (+ multer files) into the
// [{ fieldId, valueText, optionIds }] answer array utils/customForms.js
// stores - moved here out of routes/custom-forms.js's own submit handler
// so a second form-filling surface (routes/parent-support.js's Website
// Feedback & Support contact form, whose extra fields are built in this
// same Custom Forms builder) validates and parses answers the exact same
// way instead of re-deriving every field type's own posting shape.
const path = require('path');
const fs = require('fs');
const { createStorageClient, uploadFile, downloadFile, generateKey } = require('./storage');
const customForms = require('./customForms');

// A private bucket (like admin-documents.js's own `documents` bucket) -
// a form submission can carry a real uploaded document (e.g. a signed
// waiver), so this is proxied through an authenticated download route
// rather than a public URL, unlike Events/Directory's own image uploads.
const FORM_FILES_BUCKET = 'custom-form-files';
// Deliberately OUTSIDE public/ (unlike admin-documents.js's own local-
// disk fallback, which lives under public/uploads/documents and is
// therefore reachable by anyone who knows/guesses the key, since
// express.static serves the whole public/ tree unconditionally) - a
// submitted form file is only ever proxied through an authenticated
// route (sendFormFile below), so there's no reason to also make it
// directly fetchable by URL.
const FORM_FILES_DIR = path.join(__dirname, '..', 'private-uploads', 'custom-form-files');
const storageClient = createStorageClient();
if (!storageClient && !fs.existsSync(FORM_FILES_DIR)) {
  try {
    fs.mkdirSync(FORM_FILES_DIR, { recursive: true });
  } catch (err) {
    console.error(`Could not create local upload directory ${FORM_FILES_DIR}:`, err.message);
  }
}

async function saveFormFile(file) {
  if (storageClient) return uploadFile(storageClient, FORM_FILES_BUCKET, file.buffer, file.originalname, file.mimetype);
  const key = generateKey(file.originalname);
  fs.writeFileSync(path.join(FORM_FILES_DIR, key), file.buffer);
  return key;
}

// Returns false (caller renders its own 404) when a local-disk file is
// missing - the caller has already done its own access check.
async function sendFormFile(res, key) {
  if (storageClient) {
    const buffer = await downloadFile(storageClient, FORM_FILES_BUCKET, key);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buffer);
    return true;
  }
  const filePath = path.join(FORM_FILES_DIR, path.basename(key));
  if (!fs.existsSync(filePath)) return false;
  res.sendFile(filePath);
  return true;
}

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

// Field types whose own submitted body value isn't a plain string
// (full_name/address/appointment post an object of sub-keys, fill_blank
// posts an array of blanks, input_table posts an object of row->column)
// get their own required check below instead of the generic "is this
// field's raw body value falsy" one, which would otherwise treat a
// submitted-but-still-empty object/array as answered.
const COMPOSITE_REQUIRED_TYPES = new Set(['full_name', 'address', 'appointment', 'fill_blank', 'input_table']);

// `pages` is customForms.pagesWithFields(formId)'s own shape. Returns
// { error } (a plain "<label> is required." message) or { answers }.
// Conditional logic ("only show this field/section when...") is
// enforced server-side too, not just hidden client-side (public/js/
// custom-form-runtime.js) - a required field a respondent never
// actually saw, because its own rule failed or its whole page/section
// was skipped, must never block submission.
async function collectAnswers(pages, body, files) {
  // heading/paragraph etc. are layout-only (DISPLAY_ONLY_TYPES) - never
  // an answer, never required, never stored.
  const fields = pages.flatMap((p) => p.fields).filter((f) => !customForms.DISPLAY_ONLY_TYPES.has(f.field_type));
  const filesByField = new Map((files || []).map((f) => [f.fieldname, f]));

  const valuesByFieldId = {};
  for (const field of fields) valuesByFieldId[field.id] = rawValueForField(field, body, filesByField);
  const requiredError = (field) => ({ error: `"${field.label}" is required.` });

  const answers = [];
  for (const field of fields) {
    const visible = customForms.isFieldVisible(field, valuesByFieldId, pages);
    if (
      field.is_required &&
      visible &&
      field.field_type !== 'file' &&
      field.field_type !== 'multiple_choice' &&
      !COMPOSITE_REQUIRED_TYPES.has(field.field_type) &&
      !body[`field_${field.id}`]
    ) {
      return requiredError(field);
    }
    if (field.field_type === 'full_name' || field.field_type === 'address' || field.field_type === 'appointment') {
      const combined = combinedSubfieldValue(field.field_type, body[`field_${field.id}`]);
      if (field.is_required && visible && !combined) return requiredError(field);
      answers.push({ fieldId: field.id, valueText: combined });
      continue;
    }
    if (field.field_type === 'fill_blank') {
      const blanks = fillBlankValues(body, field.id);
      if (field.is_required && visible && (blanks.length === 0 || blanks.some((b) => !b))) return requiredError(field);
      answers.push({ fieldId: field.id, valueText: JSON.stringify(blanks) });
      continue;
    }
    if (field.field_type === 'input_table') {
      const matrix = combinedMatrixValue(field, body[`field_${field.id}`]);
      if (field.is_required && visible && Object.keys(matrix).length < field.options.length) return requiredError(field);
      answers.push({ fieldId: field.id, valueText: JSON.stringify(matrix) });
      continue;
    }
    if (field.field_type === 'multiple_choice') {
      const raw = body[`field_${field.id}`];
      const optionIds = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((v) => parseInt(v, 10));
      if (field.is_required && visible && optionIds.length === 0) return requiredError(field);
      answers.push({ fieldId: field.id, valueText: null, optionIds });
    } else if (field.field_type === 'file') {
      const file = filesByField.get(`field_${field.id}`);
      if (field.is_required && visible && !file) return requiredError(field);
      answers.push({ fieldId: field.id, valueText: file ? await saveFormFile(file) : null });
    } else if (field.field_type === 'checkbox') {
      answers.push({ fieldId: field.id, valueText: body[`field_${field.id}`] ? '1' : '0' });
    } else {
      answers.push({ fieldId: field.id, valueText: (body[`field_${field.id}`] || '').trim() });
    }
  }
  return { answers };
}

module.exports = { FORM_FILES_BUCKET, collectAnswers, saveFormFile, sendFormFile };
