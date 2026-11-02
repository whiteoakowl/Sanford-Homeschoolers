// Parent Portal's Website Feedback & Support contact form (routes/
// parent-support.js) and Main Admin's Support tab that logs it (routes/
// main-admin-support.js) - see supabase/migrations/20261228010000_
// website_feedback_support.sql. Subject + Message are always on the
// form; each type's own extra fields come from one dedicated Custom
// Forms builder form per type (custom_forms.system_key), so admins get
// the full Jotform-style builder instead of a second, smaller one.
const db = require('../db');
const customForms = require('./customForms');

const REQUEST_TYPES = [
  { key: 'feedback', label: 'Website Feedback', systemKey: 'support_feedback', formTitle: 'Website Feedback Form', adminHref: '/main-admin/support' },
  { key: 'support', label: 'Support', systemKey: 'support_support', formTitle: 'Support Form', adminHref: '/main-admin/support/requests' },
];

function typeByKey(key) {
  return REQUEST_TYPES.find((t) => t.key === key) || null;
}

function typeBySystemKey(systemKey) {
  return REQUEST_TYPES.find((t) => t.systemKey === systemKey) || null;
}

async function formForType(typeKey) {
  const type = typeByKey(typeKey);
  if (!type) return null;
  return db.prepare('SELECT * FROM custom_forms WHERE system_key = ?').get(type.systemKey);
}

// The "Create Form" button - creates the type's backing form on first
// click (published, so it never needs its own Publish step) and hands
// back its id either way, so a double-click never makes a second one.
async function ensureFormForType(typeKey, accountId) {
  const existing = await formForType(typeKey);
  if (existing) return existing.id;
  const type = typeByKey(typeKey);
  const formId = await customForms.createForm(type.formTitle, accountId);
  await db.prepare("UPDATE custom_forms SET system_key = ?, status = 'published' WHERE id = ?").run(type.systemKey, formId);
  return formId;
}

// Pages-with-fields for a type's extra fields (empty when no form has
// been created yet), conditional logic pre-parsed the same way routes/
// custom-forms.js's own fill-out page does.
async function extraPagesForType(typeKey) {
  const form = await formForType(typeKey);
  if (!form) return [];
  const pages = await customForms.pagesWithFields(form.id);
  for (const page of pages) {
    page.conditionalLogicParsed = customForms.parseConditionalLogic(page.conditional_logic);
    for (const field of page.fields) {
      field.conditionalLogicParsed = customForms.parseConditionalLogic(field.conditional_logic);
      field.matrixColumnsParsed = customForms.parseMatrixColumns(field.matrix_columns);
    }
  }
  return pages;
}

// answers is utils/customFormAnswers.js's collectAnswers() output -
// snapshotted with each field's own label/type (see the migration's
// extra_answers_json comment), multiple_choice's option ids resolved to
// their labels.
function snapshotAnswers(pages, answers) {
  const fieldsById = new Map(pages.flatMap((p) => p.fields).map((f) => [f.id, f]));
  return answers.map((a) => {
    const field = fieldsById.get(a.fieldId);
    const entry = { fieldId: a.fieldId, label: field ? field.label : '', fieldType: field ? field.field_type : 'short_text', valueText: a.valueText ?? null };
    if (a.optionIds && field) entry.choiceLabels = field.options.filter((o) => a.optionIds.includes(o.id)).map((o) => o.label);
    return entry;
  });
}

async function createRequest({ typeKey, subject, message, memberId, accountId, extraAnswers }) {
  const info = await db
    .prepare('INSERT INTO support_requests (request_type, subject, message, member_id, submitted_by_account_id, extra_answers_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run(typeKey, subject, message, memberId || null, accountId || null, extraAnswers && extraAnswers.length ? JSON.stringify(extraAnswers) : null);
  return info.lastInsertRowid;
}

function parseExtraAnswers(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

// status: 'open' | 'completed' | 'all'. Open entries always sort first
// (a real request: "a complete button to mark them done" - done ones
// sink below whatever still needs attention), newest first within each.
async function listRequests(typeKey, status = 'all') {
  let sql = `SELECT r.*, m.name AS "memberName", cb.name AS "completedByName"
     FROM support_requests r
     LEFT JOIN members m ON m.id = r.member_id
     LEFT JOIN member_accounts ca ON ca.id = r.completed_by_account_id
     LEFT JOIN members cb ON cb.id = ca.member_id
     WHERE r.request_type = ?`;
  if (status === 'open') sql += ' AND r.completed_at IS NULL';
  else if (status === 'completed') sql += ' AND r.completed_at IS NOT NULL';
  sql += ' ORDER BY (r.completed_at IS NOT NULL), r.submitted_at DESC, r.id DESC';
  const rows = await db.prepare(sql).all(typeKey);
  for (const row of rows) row.extraAnswers = parseExtraAnswers(row.extra_answers_json);
  return rows;
}

async function getRequest(id) {
  const row = await db.prepare('SELECT * FROM support_requests WHERE id = ?').get(id);
  if (row) row.extraAnswers = parseExtraAnswers(row.extra_answers_json);
  return row;
}

async function setCompleted(id, typeKey, accountId, completed) {
  if (completed) {
    await db
      .prepare('UPDATE support_requests SET completed_at = now_text(), completed_by_account_id = ? WHERE id = ? AND request_type = ? AND completed_at IS NULL')
      .run(accountId, id, typeKey);
  } else {
    await db.prepare('UPDATE support_requests SET completed_at = NULL, completed_by_account_id = NULL WHERE id = ? AND request_type = ?').run(id, typeKey);
  }
}

module.exports = {
  REQUEST_TYPES,
  typeByKey,
  typeBySystemKey,
  formForType,
  ensureFormForType,
  extraPagesForType,
  snapshotAnswers,
  createRequest,
  listRequests,
  getRequest,
  setCompleted,
};
