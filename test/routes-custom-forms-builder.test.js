// Route-level coverage for the Main Admin Custom Forms builder's
// Jotform-style upgrade (a real request: "Main admin portal, forms tab.
// Should have full editing features and view just like jotform.
// Exactly.") - pages/sections with drag-reorder, per-field conditional
// "only show when" logic (enforced both in the builder/fill-out
// rendering and, more importantly, server-side during submission), a
// fuller field-type palette, per-form theme, and a sortable/filterable
// submissions list with a working CSV export. See test/routes-custom-
// forms.test.js for the original schema's own coverage (field types,
// assignments, one-submission-per-member, the file-upload filter) -
// this file only covers what the upgrade in supabase/migrations/
// 20261225010000_custom_forms_builder_upgrade.sql and utils/
// customForms.js added on top of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `custom-forms-builder-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `custom-forms-builder-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.ADMIN_USERNAME = 'testadmin';
process.env.ADMIN_PASSWORD = 'testpassword123';
process.env.MAIN_ADMIN_EMAIL = 'mainadmin@coop.local';
process.env.MAIN_ADMIN_PASSWORD = 'changeme123';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const customForms = require('../utils/customForms');
const { hashPassword } = require('../utils/portalAuth');
const { generateMemberCode } = require('../utils/members');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

function extractCsrf(html) {
  return /name="csrf-token" content="([^"]*)"/.exec(html)[1];
}

async function loginAsMainAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: process.env.MAIN_ADMIN_EMAIL, password: process.env.MAIN_ADMIN_PASSWORD, next: '/main-admin' });
  const cookie = loginRes.headers['set-cookie'];
  const page = await request(app).get('/main-admin').set('Cookie', cookie);
  return { cookie, csrfToken: extractCsrf(page.text) };
}

let familyCounter = 0;
async function createParentAccount() {
  familyCounter += 1;
  const familyName = `Builder Test Family ${familyCounter}`;
  const familyId = (await db.prepare('INSERT INTO families (name) VALUES (?)').run(familyName)).lastInsertRowid;
  const code = await generateMemberCode();
  const parentInfo = await db
    .prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, is_primary_parent, active) VALUES (?, ?, ?, 'parent', ?, 1, 1)")
    .run(`Builder Parent ${familyCounter}`, code, code, familyId);
  const email = `builderparent${familyCounter}@example.com`;
  const password = 'testpassword123';
  const accountInfo = await db
    .prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text())")
    .run(parentInfo.lastInsertRowid, email, hashPassword(password));
  const parentRole = await db.prepare("SELECT id FROM roles WHERE key = 'parent'").get();
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountInfo.lastInsertRowid, parentRole.id);

  const loginRes = await request(app).post('/login').type('form').send({ email, password, next: '/forms' });
  const cookie = loginRes.headers['set-cookie'];
  const page = await request(app).get('/forms').set('Cookie', cookie);
  return { cookie, csrfToken: extractCsrf(page.text), memberId: parentInfo.lastInsertRowid };
}

async function createForm(admin, title) {
  const createRes = await request(app).post('/main-admin/forms').set('Cookie', admin.cookie).type('form').send({ title, _csrf: admin.csrfToken });
  return /\/main-admin\/forms\/(\d+)\/builder/.exec(createRes.headers.location)[1];
}

async function publish(admin, formId) {
  await request(app).post(`/main-admin/forms/${formId}/status`).set('Cookie', admin.cookie).type('form').send({ status: 'published', _csrf: admin.csrfToken });
}

async function addField(admin, formId, body) {
  await request(app).post(`/main-admin/forms/${formId}/fields`).set('Cookie', admin.cookie).type('form').send({ ...body, _csrf: admin.csrfToken });
  return db.prepare('SELECT * FROM custom_form_fields WHERE form_id = ? ORDER BY id DESC LIMIT 1').get(formId);
}

// --- Pure logic (utils/customForms.js) ---

test('evaluateCondition/isFieldVisible - the same rule server-rendering and submission-time validation both read', () => {
  const equalsRule = { fieldId: 1, operator: 'equals', value: 'Yes' };
  assert.equal(customForms.evaluateCondition(equalsRule, { 1: 'Yes' }), true);
  assert.equal(customForms.evaluateCondition(equalsRule, { 1: 'No' }), false);
  assert.equal(customForms.evaluateCondition(null, { 1: 'anything' }), true, 'no rule at all means always visible');

  const containsRule = { fieldId: 2, operator: 'contains', value: 'setup' };
  assert.equal(customForms.evaluateCondition(containsRule, { 2: ['Setup', 'Cleanup'] }), true, 'an array value (multiple_choice labels) is checked element-wise');
  assert.equal(customForms.evaluateCondition(containsRule, { 2: ['Cleanup'] }), false);

  assert.equal(customForms.evaluateCondition({ fieldId: 3, operator: 'is_answered' }, { 3: '  ' }), false, 'whitespace-only does not count as answered');
  assert.equal(customForms.evaluateCondition({ fieldId: 3, operator: 'is_blank' }, { 3: '' }), true);

  const field = { id: 10, conditional_logic: JSON.stringify({ fieldId: 1, operator: 'equals', value: 'Yes' }), page_id: 100 };
  const pages = [{ id: 100, conditional_logic: null }];
  assert.equal(customForms.isFieldVisible(field, { 1: 'Yes' }, pages), true);
  assert.equal(customForms.isFieldVisible(field, { 1: 'No' }, pages), false, 'the field\'s own rule failing hides it even though its page has none');

  const hiddenPage = [{ id: 100, conditional_logic: JSON.stringify({ fieldId: 1, operator: 'equals', value: 'Yes' }) }];
  const unconditionalField = { id: 11, conditional_logic: null, page_id: 100 };
  assert.equal(customForms.isFieldVisible(unconditionalField, { 1: 'No' }, hiddenPage), false, 'a field with no rule of its own is still hidden when its whole PAGE is hidden');
});

test('parseConditionalLogic rejects malformed or unrecognized-operator JSON rather than throwing', () => {
  assert.equal(customForms.parseConditionalLogic(null), null);
  assert.equal(customForms.parseConditionalLogic('not json'), null);
  assert.equal(customForms.parseConditionalLogic(JSON.stringify({ fieldId: 1, operator: 'bogus_op', value: 'x' })), null);
  assert.deepEqual(customForms.parseConditionalLogic(JSON.stringify({ fieldId: 5, operator: 'equals', value: 'Yes' })), { fieldId: 5, operator: 'equals', value: 'Yes' });
});

// --- Pages / sections ---

test('a new form starts with exactly one page, and pages can be added, edited, reordered, and deleted', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Pages Test Form');

  const initialPages = await db.prepare('SELECT * FROM custom_form_pages WHERE form_id = ?').all(formId);
  assert.equal(initialPages.length, 1, 'createForm should seed exactly one default page');

  await request(app).post(`/main-admin/forms/${formId}/pages`).set('Cookie', admin.cookie).type('form').send({ title: 'Page Two', description: 'Second section', _csrf: admin.csrfToken });
  const twoPages = await db.prepare('SELECT * FROM custom_form_pages WHERE form_id = ? ORDER BY position').all(formId);
  assert.equal(twoPages.length, 2);

  const builderHtml = await request(app).get(`/main-admin/forms/${formId}/builder`).set('Cookie', admin.cookie);
  assert.equal(builderHtml.status, 200);
  assert.match(builderHtml.text, /Page Two/);

  // Reorder: swap the two pages
  const reversed = [...twoPages].reverse().map((p) => p.id);
  const reorderRes = await request(app).post(`/main-admin/forms/${formId}/pages/reorder`).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrfToken).send({ blockIds: reversed });
  assert.equal(reorderRes.status, 200);
  const afterReorder = await db.prepare('SELECT id FROM custom_form_pages WHERE form_id = ? ORDER BY position').all(formId);
  assert.deepEqual(afterReorder.map((p) => p.id), reversed);

  // Deleting the only-remaining... no, there are 2, so deleting one should succeed and move its fields
  await addField(admin, formId, { fieldType: 'short_text', label: 'On page two', pageId: String(twoPages[1].id) });
  const deleteRes = await request(app).post(`/main-admin/forms/${formId}/pages/${twoPages[1].id}/delete`).set('Cookie', admin.cookie).type('form').send({ _csrf: admin.csrfToken });
  assert.match(decodeURIComponent(deleteRes.headers.location), /moved to the remaining page/);
  const remainingPages = await db.prepare('SELECT id FROM custom_form_pages WHERE form_id = ?').all(formId);
  assert.equal(remainingPages.length, 1);
  const movedField = await db.prepare("SELECT page_id FROM custom_form_fields WHERE form_id = ? AND label = 'On page two'").get(formId);
  assert.equal(movedField.page_id, remainingPages[0].id, 'the deleted page\'s field should have moved to the surviving page, not vanished');

  // A form must always have at least one page
  const refusedDelete = await request(app).post(`/main-admin/forms/${formId}/pages/${remainingPages[0].id}/delete`).set('Cookie', admin.cookie).type('form').send({ _csrf: admin.csrfToken });
  assert.match(decodeURIComponent(refusedDelete.headers.location), /must have at least one page/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS c FROM custom_form_pages WHERE form_id = ?').get(formId)).c, 1);
});

test('fields can be dragged into a new order within their page, scoped to that page and form', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Field Reorder Form');
  const page = await db.prepare('SELECT id FROM custom_form_pages WHERE form_id = ?').get(formId);

  const a = await addField(admin, formId, { fieldType: 'short_text', label: 'A', pageId: String(page.id) });
  const b = await addField(admin, formId, { fieldType: 'short_text', label: 'B', pageId: String(page.id) });
  const c = await addField(admin, formId, { fieldType: 'short_text', label: 'C', pageId: String(page.id) });

  const reorderRes = await request(app)
    .post(`/main-admin/forms/${formId}/fields/reorder`)
    .set('Cookie', admin.cookie)
    .set('X-CSRF-Token', admin.csrfToken)
    .send({ blockIds: [c.id, a.id, b.id], pageId: page.id });
  assert.equal(reorderRes.status, 200);

  const afterReorder = await db.prepare('SELECT id FROM custom_form_fields WHERE form_id = ? AND page_id = ? ORDER BY position').all(formId, page.id);
  assert.deepEqual(afterReorder.map((f) => f.id), [c.id, a.id, b.id]);
});

// --- Conditional logic, end to end ---

test('a field hidden by conditional logic is never required at submission time, even though it is marked required', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Conditional Logic Form');

  const nameField = await addField(admin, formId, { fieldType: 'short_text', label: 'Name', isRequired: 'on' });
  const wantsExtraField = await addField(admin, formId, { fieldType: 'single_choice', label: 'Need extra help?', options: 'Yes\nNo', isRequired: 'on' });
  const detailsField = await addField(admin, formId, {
    fieldType: 'long_text',
    label: 'Describe what you need',
    isRequired: 'on',
    conditionFieldId: String(wantsExtraField.id),
    conditionOperator: 'equals',
    conditionValue: 'Yes',
  });
  assert.deepEqual(JSON.parse(detailsField.conditional_logic), { fieldId: wantsExtraField.id, operator: 'equals', value: 'Yes' });

  await publish(admin, formId);
  const parent = await createParentAccount();

  // Answers "No" - the required "Describe what you need" field is hidden
  // by its own conditional rule and must never block submission even
  // though it's required and left blank.
  const submitRes = await request(app)
    .post(`/forms/${formId}/submit`)
    .set('Cookie', parent.cookie)
    .type('form')
    .send({
      memberId: String(parent.memberId),
      [`field_${nameField.id}`]: 'Jamie',
      [`field_${wantsExtraField.id}`]: 'No',
      _csrf: parent.csrfToken,
    });
  assert.match(submitRes.headers.location, new RegExp(`/forms/${formId}/mine/${parent.memberId}`), 'a required field hidden by conditional logic must not block submission: ' + decodeURIComponent(submitRes.headers.location));

  const submission = await db.prepare('SELECT id FROM custom_form_submissions WHERE form_id = ? AND member_id = ?').get(formId, parent.memberId);
  const detailsAnswer = await db.prepare('SELECT value_text FROM custom_form_answers WHERE submission_id = ? AND field_id = ?').get(submission.id, detailsField.id);
  assert.ok(!detailsAnswer || !detailsAnswer.value_text, 'the hidden field should be stored blank, not forced to have a value');
});

test('the same required field DOES block submission once its condition is actually met', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Conditional Logic Enforced Form');
  const wantsExtraField = await addField(admin, formId, { fieldType: 'single_choice', label: 'Need extra help?', options: 'Yes\nNo', isRequired: 'on' });
  const detailsField = await addField(admin, formId, {
    fieldType: 'long_text',
    label: 'Describe what you need',
    isRequired: 'on',
    conditionFieldId: String(wantsExtraField.id),
    conditionOperator: 'equals',
    conditionValue: 'Yes',
  });

  await publish(admin, formId);
  const parent = await createParentAccount();

  const submitRes = await request(app)
    .post(`/forms/${formId}/submit`)
    .set('Cookie', parent.cookie)
    .type('form')
    .send({ memberId: String(parent.memberId), [`field_${wantsExtraField.id}`]: 'Yes', _csrf: parent.csrfToken });
  assert.match(decodeURIComponent(submitRes.headers.location), new RegExp(`"${detailsField.label}" is required`));
});

test('a page hidden by its own conditional logic hides every field on it from the required check', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Conditional Page Form');
  const gateField = await addField(admin, formId, { fieldType: 'checkbox', label: 'Are you a returning family?' });

  await request(app).post(`/main-admin/forms/${formId}/pages`).set('Cookie', admin.cookie).type('form').send({
    title: 'Returning Family Details',
    conditionFieldId: String(gateField.id),
    conditionOperator: 'equals',
    conditionValue: '1',
    _csrf: admin.csrfToken,
  });
  const page2 = await db.prepare('SELECT * FROM custom_form_pages WHERE form_id = ? ORDER BY position DESC LIMIT 1').get(formId);
  assert.ok(customForms.parseConditionalLogic(page2.conditional_logic), 'the new page should have stored a conditional_logic rule');

  const requiredOnHiddenPage = await addField(admin, formId, { fieldType: 'short_text', label: 'Last year\'s co-op', isRequired: 'on', pageId: String(page2.id) });

  await publish(admin, formId);
  const parent = await createParentAccount();

  // Leaves the checkbox unchecked ('0') - page 2 (and everything on it,
  // including the required field) should be invisible, so leaving it
  // blank must not block submission.
  const submitRes = await request(app)
    .post(`/forms/${formId}/submit`)
    .set('Cookie', parent.cookie)
    .type('form')
    .send({ memberId: String(parent.memberId), [`field_${gateField.id}`]: '', _csrf: parent.csrfToken });
  assert.match(submitRes.headers.location, new RegExp(`/forms/${formId}/mine/${parent.memberId}`), 'a required field on a conditionally-hidden PAGE must not block submission: ' + decodeURIComponent(submitRes.headers.location));
});

// --- Multi-page rendering ---

test('a multi-page form renders a progress indicator on the fill-out page; a single-page form does not', async () => {
  const admin = await loginAsMainAdmin();
  const singleFormId = await createForm(admin, 'Single Page Form');
  await addField(admin, singleFormId, { fieldType: 'short_text', label: 'Only field' });
  await publish(admin, singleFormId);

  const multiFormId = await createForm(admin, 'Multi Page Form');
  await addField(admin, multiFormId, { fieldType: 'short_text', label: 'Page one field' });
  await request(app).post(`/main-admin/forms/${multiFormId}/pages`).set('Cookie', admin.cookie).type('form').send({ title: 'Page Two', _csrf: admin.csrfToken });
  await publish(admin, multiFormId);

  const parent = await createParentAccount();
  const singlePage = await request(app).get(`/forms/${singleFormId}`).set('Cookie', parent.cookie);
  assert.doesNotMatch(singlePage.text, /data-cf-progress/, 'a one-page form must not show a progress indicator');

  const multiPage = await request(app).get(`/forms/${multiFormId}`).set('Cookie', parent.cookie);
  assert.match(multiPage.text, /data-cf-progress/);
  assert.match(multiPage.text, /Page Two/);
  assert.match(multiPage.text, /data-cf-next/, 'a multi-page form should offer a Next control');
});

// --- Theme ---

test('a form\'s theme (primary color + button style) is saved and rendered on the fill-out page', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Themed Form');
  await publish(admin, formId);

  await request(app)
    .post(`/main-admin/forms/${formId}`)
    .set('Cookie', admin.cookie)
    .type('form')
    .send({ title: 'Themed Form', themePrimaryColor: '#ab12cd', themeButtonStyle: 'pill', _csrf: admin.csrfToken });

  const stored = await db.prepare('SELECT theme_primary_color, theme_button_style FROM custom_forms WHERE id = ?').get(formId);
  assert.equal(stored.theme_primary_color, '#ab12cd');
  assert.equal(stored.theme_button_style, 'pill');

  const parent = await createParentAccount();
  const fillPage = await request(app).get(`/forms/${formId}`).set('Cookie', parent.cookie);
  assert.match(fillPage.text, /--cf-primary: #ab12cd/i);
  assert.match(fillPage.text, /--cf-radius: 999px/);

  // An invalid color/button style never gets persisted - falls back to
  // the existing-brand defaults rather than storing garbage.
  await request(app)
    .post(`/main-admin/forms/${formId}`)
    .set('Cookie', admin.cookie)
    .type('form')
    .send({ title: 'Themed Form', themePrimaryColor: 'javascript:alert(1)', themeButtonStyle: 'triangle', _csrf: admin.csrfToken });
  const sanitized = await db.prepare('SELECT theme_primary_color, theme_button_style FROM custom_forms WHERE id = ?').get(formId);
  assert.equal(sanitized.theme_primary_color, '#2e6da4');
  assert.equal(sanitized.theme_button_style, 'rounded');
});

// --- Fuller field-type palette ---

test('every new field type (email/phone/url/rating/scale) stores a plain text answer, and heading/paragraph never do', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'New Field Types Form');
  const email = await addField(admin, formId, { fieldType: 'email', label: 'Email' });
  const phone = await addField(admin, formId, { fieldType: 'phone', label: 'Phone' });
  const url = await addField(admin, formId, { fieldType: 'url', label: 'Website' });
  const rating = await addField(admin, formId, { fieldType: 'rating', label: 'Rate us' });
  const scale = await addField(admin, formId, { fieldType: 'scale', label: 'Likelihood' });
  await addField(admin, formId, { fieldType: 'heading', label: 'Section heading' });
  await addField(admin, formId, { fieldType: 'paragraph', label: 'internal note', helpText: 'Please fill out honestly.' });

  await publish(admin, formId);
  const parent = await createParentAccount();

  const fillPage = await request(app).get(`/forms/${formId}`).set('Cookie', parent.cookie);
  assert.equal(fillPage.status, 200);
  assert.match(fillPage.text, /Section heading/);
  assert.match(fillPage.text, /Please fill out honestly\./);
  assert.match(fillPage.text, /cf-rating/);
  assert.match(fillPage.text, /cf-scale/);

  await request(app)
    .post(`/forms/${formId}/submit`)
    .set('Cookie', parent.cookie)
    .type('form')
    .send({
      memberId: String(parent.memberId),
      [`field_${email.id}`]: 'parent@example.com',
      [`field_${phone.id}`]: '555-123-4567',
      [`field_${url.id}`]: 'https://example.com',
      [`field_${rating.id}`]: '4',
      [`field_${scale.id}`]: '9',
      _csrf: parent.csrfToken,
    });

  const submission = await db.prepare('SELECT id FROM custom_form_submissions WHERE form_id = ? AND member_id = ?').get(formId, parent.memberId);
  const answers = await db.prepare('SELECT field_id, value_text FROM custom_form_answers WHERE submission_id = ?').all(submission.id);
  const byField = new Map(answers.map((a) => [a.field_id, a.value_text]));
  assert.equal(byField.get(email.id), 'parent@example.com');
  assert.equal(byField.get(rating.id), '4');
  assert.equal(byField.get(scale.id), '9');
  assert.equal(answers.length, 5, 'heading/paragraph must never get an answer row at all');
});

// --- Five more field types: a real request, with a Jotform screenshot
// naming "Full Name", "Address", "Appointment", "Signature", and "Fill
// in the Blank" as elements this app didn't have yet. Each combines
// several sub-inputs into one stored plain-text answer except
// signature (a drawn image, stored as its own data URL) and fill_blank
// (stored as a JSON array of its blanks) - see routes/custom-forms.js's
// own combinedSubfieldValue/fillBlankValues and utils/customForms.js's
// COMPOSITE_TYPES.

test('the Add Field dropdown lists every field type flat, in one list - no Basic/Widgets grouping, and the five new types are in it', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Dropdown Form');
  const builderHtml = await request(app).get(`/main-admin/forms/${formId}/builder`).set('Cookie', admin.cookie);
  assert.equal(builderHtml.status, 200);
  assert.match(builderHtml.text, /<select name="fieldType" data-cf-field-type-select required>/);
  assert.doesNotMatch(builderHtml.text, /cf-type-palette|cf-type-btn|cf-type-palette-group-label/, 'the old grouped icon-button palette should be gone');
  for (const label of ['Full Name', 'Address', 'Appointment', 'Signature', 'Fill in the Blank']) {
    assert.match(builderHtml.text, new RegExp(`<option value="[a-z_]+" ?[^>]*>${label}</option>`));
  }
});

test('full_name/address/appointment combine their sub-inputs into one stored answer, and required blocks submission when any required sub-part is blank', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Composite Fields Form');
  const name = await addField(admin, formId, { fieldType: 'full_name', label: 'Your Name', isRequired: '1' });
  const address = await addField(admin, formId, { fieldType: 'address', label: 'Your Address' });
  const appt = await addField(admin, formId, { fieldType: 'appointment', label: 'Pick a time' });
  await publish(admin, formId);
  const parent = await createParentAccount();

  // Required full_name, left blank entirely, blocks submission.
  const blocked = await request(app)
    .post(`/forms/${formId}/submit`)
    .set('Cookie', parent.cookie)
    .type('form')
    .send({ memberId: String(parent.memberId), _csrf: parent.csrfToken });
  assert.match(decodeURIComponent(blocked.headers.location), /"Your Name" is required/);

  await request(app)
    .post(`/forms/${formId}/submit`)
    .set('Cookie', parent.cookie)
    .type('form')
    .send({
      memberId: String(parent.memberId),
      [`field_${name.id}[first]`]: 'Jane',
      [`field_${name.id}[last]`]: 'Doe',
      [`field_${address.id}[street]`]: '123 Main St',
      [`field_${address.id}[city]`]: 'Anytown',
      [`field_${address.id}[state]`]: 'NC',
      [`field_${address.id}[zip]`]: '27330',
      [`field_${appt.id}[date]`]: '2026-11-15',
      [`field_${appt.id}[time]`]: '14:30',
      _csrf: parent.csrfToken,
    });

  const submission = await db.prepare('SELECT id FROM custom_form_submissions WHERE form_id = ? AND member_id = ?').get(formId, parent.memberId);
  const answers = await db.prepare('SELECT field_id, value_text FROM custom_form_answers WHERE submission_id = ?').all(submission.id);
  const byField = new Map(answers.map((a) => [a.field_id, a.value_text]));
  assert.equal(byField.get(name.id), 'Jane Doe');
  assert.equal(byField.get(address.id), '123 Main St, Anytown, NC 27330');
  assert.equal(byField.get(appt.id), '2026-11-15 14:30');
});

test('Fill in the Blank stores one value per blank as a JSON array, and required blocks submission when any blank is empty', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Fill Blank Form');
  const blank = await addField(admin, formId, {
    fieldType: 'fill_blank',
    label: 'Pop quiz',
    helpText: 'The capital of France is ___ and 2 + 2 = ___.',
    isRequired: '1',
  });
  await publish(admin, formId);
  const parent = await createParentAccount();

  const fillPage = await request(app).get(`/forms/${formId}`).set('Cookie', parent.cookie);
  assert.match(fillPage.text, /The capital of France is <input[^]*?and 2 \+ 2 = <input/);

  const blocked = await request(app)
    .post(`/forms/${formId}/submit`)
    .set('Cookie', parent.cookie)
    .type('form')
    .send({ memberId: String(parent.memberId), [`field_${blank.id}[]`]: ['Paris', ''], _csrf: parent.csrfToken });
  assert.match(decodeURIComponent(blocked.headers.location), /"Pop quiz" is required/);

  await request(app)
    .post(`/forms/${formId}/submit`)
    .set('Cookie', parent.cookie)
    .type('form')
    .send({ memberId: String(parent.memberId), [`field_${blank.id}[]`]: ['Paris', '4'], _csrf: parent.csrfToken });

  const submission = await db.prepare('SELECT id FROM custom_form_submissions WHERE form_id = ? AND member_id = ?').get(formId, parent.memberId);
  const answer = await db.prepare('SELECT value_text FROM custom_form_answers WHERE submission_id = ? AND field_id = ?').get(submission.id, blank.id);
  assert.deepEqual(JSON.parse(answer.value_text), ['Paris', '4']);

  const confirmPage = await request(app).get(`/forms/${formId}/mine/${parent.memberId}`).set('Cookie', parent.cookie);
  assert.match(confirmPage.text, /Paris, 4/);
});

test('Signature stores its drawn image, required blocks an empty signature, and it renders as an image (not raw text) on the submission pages', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Signature Form');
  const sig = await addField(admin, formId, { fieldType: 'signature', label: 'Sign here', isRequired: '1' });
  await publish(admin, formId);
  const parent = await createParentAccount();

  const fillPage = await request(app).get(`/forms/${formId}`).set('Cookie', parent.cookie);
  assert.match(fillPage.text, /cf-signature-pad-wrap/);
  assert.match(fillPage.text, /class="cf-signature-value-input"/);

  const blocked = await request(app)
    .post(`/forms/${formId}/submit`)
    .set('Cookie', parent.cookie)
    .type('form')
    .send({ memberId: String(parent.memberId), [`field_${sig.id}`]: '', _csrf: parent.csrfToken });
  assert.match(decodeURIComponent(blocked.headers.location), /"Sign here" is required/);

  const fakeDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await request(app)
    .post(`/forms/${formId}/submit`)
    .set('Cookie', parent.cookie)
    .type('form')
    .send({ memberId: String(parent.memberId), [`field_${sig.id}`]: fakeDataUrl, _csrf: parent.csrfToken });

  const submission = await db.prepare('SELECT id FROM custom_form_submissions WHERE form_id = ? AND member_id = ?').get(formId, parent.memberId);
  const answer = await db.prepare('SELECT value_text FROM custom_form_answers WHERE submission_id = ? AND field_id = ?').get(submission.id, sig.id);
  assert.equal(answer.value_text, fakeDataUrl);

  const confirmPage = await request(app).get(`/forms/${formId}/mine/${parent.memberId}`).set('Cookie', parent.cookie);
  assert.match(confirmPage.text, new RegExp(`<img src="${fakeDataUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" alt="Signature"`));
});

// --- The rest of Jotform's own "Basic Elements" (a real request, after
// a web search confirmed Jotform's "Widgets" are an open-ended 300+
// item marketplace with no fixed list: "Basics + a few generic layout
// widgets" - Image, Input Table/Matrix, Divider, Video, Spinner). ---

test('the Add Field dropdown includes the five newest field types too', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'More Types Dropdown Form');
  const builderHtml = await request(app).get(`/main-admin/forms/${formId}/builder`).set('Cookie', admin.cookie);
  for (const label of ['Image', 'Input Table / Matrix', 'Divider', 'Video', 'Spinner']) {
    assert.match(builderHtml.text, new RegExp(`<option value="[a-z_]+" ?[^>]*>${label}</option>`));
  }
});

test('Divider/Video are display-only (never an answer, never required, never in the CSV export)', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Divider Video Form');
  await addField(admin, formId, { fieldType: 'divider', label: 'A divider' });
  await addField(admin, formId, { fieldType: 'video', label: 'Welcome video', placeholder: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  const name = await addField(admin, formId, { fieldType: 'short_text', label: 'Your Name', isRequired: '1' });
  await publish(admin, formId);
  const parent = await createParentAccount();

  const fillPage = await request(app).get(`/forms/${formId}`).set('Cookie', parent.cookie);
  assert.match(fillPage.text, /cf-divider/);
  assert.match(fillPage.text, /youtube\.com\/embed\/dQw4w9WgXcQ/);

  await request(app)
    .post(`/forms/${formId}/submit`)
    .set('Cookie', parent.cookie)
    .type('form')
    .send({ memberId: String(parent.memberId), [`field_${name.id}`]: 'Jo', _csrf: parent.csrfToken });

  const submission = await db.prepare('SELECT id FROM custom_form_submissions WHERE form_id = ? AND member_id = ?').get(formId, parent.memberId);
  const answers = await db.prepare('SELECT field_id FROM custom_form_answers WHERE submission_id = ?').all(submission.id);
  assert.equal(answers.length, 1, 'only the real Short Text answer should be stored - divider/video never get an answer row');
  assert.equal(answers[0].field_id, name.id);
});

test('Image uploads and stores a picture, shown on the fill-out page and never submitted as an answer', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Image Field Form');
  const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

  // Multipart requests carry _csrf in the query string, not the body -
  // middleware/csrfProtection.js's own comment explains why (it's
  // mounted ahead of the per-route multer middleware that actually
  // parses a multipart body, so req.body._csrf isn't populated yet by
  // the time the CSRF check runs for these).
  const addRes = await request(app)
    .post(`/main-admin/forms/${formId}/fields?_csrf=${encodeURIComponent(admin.csrfToken)}`)
    .set('Cookie', admin.cookie)
    .field('fieldType', 'image')
    .field('label', 'Co-op logo')
    .field('pageId', String((await db.prepare('SELECT id FROM custom_form_pages WHERE form_id = ?').get(formId)).id))
    .attach('image', PNG_1X1, { filename: 'logo.png', contentType: 'image/png' });
  assert.equal(addRes.status, 302);

  const field = await db.prepare("SELECT * FROM custom_form_fields WHERE form_id = ? AND field_type = 'image'").get(formId);
  assert.ok(field.image_path, 'the uploaded image should be saved and its key stored on the field');

  await publish(admin, formId);
  const parent = await createParentAccount();
  const fillPage = await request(app).get(`/forms/${formId}`).set('Cookie', parent.cookie);
  assert.match(fillPage.text, /<img src="[^"]*\/uploads\/custom-forms\/[^"]*\.png" alt="Co-op logo" class="cf-image-block"/);
});

test('Input Table/Matrix stores {row: column}, required blocks submission until every row has an answer, and CSV/detail pages render it readably', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Matrix Form');
  const page = await db.prepare('SELECT id FROM custom_form_pages WHERE form_id = ?').get(formId);
  await request(app)
    .post(`/main-admin/forms/${formId}/fields`)
    .set('Cookie', admin.cookie)
    .type('form')
    .send({
      fieldType: 'input_table',
      label: 'Weekly availability',
      pageId: String(page.id),
      options: 'Monday\nWednesday',
      matrixColumns: 'Can attend\nCannot attend',
      isRequired: '1',
      _csrf: admin.csrfToken,
    });
  const table = await db.prepare("SELECT * FROM custom_form_fields WHERE form_id = ? AND field_type = 'input_table'").get(formId);
  await publish(admin, formId);
  const parent = await createParentAccount();

  const fillPage = await request(app).get(`/forms/${formId}`).set('Cookie', parent.cookie);
  assert.match(fillPage.text, /cf-matrix-table/);
  assert.match(fillPage.text, /Monday/);
  assert.match(fillPage.text, /Can attend/);

  const blocked = await request(app)
    .post(`/forms/${formId}/submit`)
    .set('Cookie', parent.cookie)
    .type('form')
    .send({ memberId: String(parent.memberId), [`field_${table.id}[Monday]`]: 'Can attend', _csrf: parent.csrfToken });
  assert.match(decodeURIComponent(blocked.headers.location), /"Weekly availability" is required/);

  await request(app)
    .post(`/forms/${formId}/submit`)
    .set('Cookie', parent.cookie)
    .type('form')
    .send({
      memberId: String(parent.memberId),
      [`field_${table.id}[Monday]`]: 'Can attend',
      [`field_${table.id}[Wednesday]`]: 'Cannot attend',
      _csrf: parent.csrfToken,
    });

  const submission = await db.prepare('SELECT id FROM custom_form_submissions WHERE form_id = ? AND member_id = ?').get(formId, parent.memberId);
  const answer = await db.prepare('SELECT value_text FROM custom_form_answers WHERE submission_id = ? AND field_id = ?').get(submission.id, table.id);
  assert.deepEqual(JSON.parse(answer.value_text), { Monday: 'Can attend', Wednesday: 'Cannot attend' });

  const csvRes = await request(app).get(`/main-admin/forms/${formId}/submissions/export`).set('Cookie', admin.cookie);
  assert.match(csvRes.text, /Monday: Can attend; Wednesday: Cannot attend/);

  const detailRes = await request(app).get(`/main-admin/forms/${formId}/submissions/${submission.id}`).set('Cookie', admin.cookie);
  assert.match(detailRes.text, /<li>Monday: Can attend<\/li>/);
});

test('Spinner stores a plain number answer, same as a regular number field', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Spinner Form');
  const spinner = await addField(admin, formId, { fieldType: 'spinner', label: 'How many kids?', defaultValue: '2' });
  await publish(admin, formId);
  const parent = await createParentAccount();

  const fillPage = await request(app).get(`/forms/${formId}`).set('Cookie', parent.cookie);
  assert.match(fillPage.text, /cf-spinner-input/);
  assert.match(fillPage.text, /value="2"/);

  await request(app)
    .post(`/forms/${formId}/submit`)
    .set('Cookie', parent.cookie)
    .type('form')
    .send({ memberId: String(parent.memberId), [`field_${spinner.id}`]: '4', _csrf: parent.csrfToken });

  const submission = await db.prepare('SELECT id FROM custom_form_submissions WHERE form_id = ? AND member_id = ?').get(formId, parent.memberId);
  const answer = await db.prepare('SELECT value_text FROM custom_form_answers WHERE submission_id = ? AND field_id = ?').get(submission.id, spinner.id);
  assert.equal(answer.value_text, '4');
});

// --- "Fun" visual themes - a real request: "Be able to add fun visual
// themes to custom forms, holidays, activities, sports etc." ---

test('picking a theme preset saves it and shows its emoji on the fill-out page, and "None" shows no emoji', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Themed Form');

  await request(app)
    .post(`/main-admin/forms/${formId}`)
    .set('Cookie', admin.cookie)
    .type('form')
    .send({ title: 'Themed Form', themePreset: 'halloween', themePrimaryColor: '#d2691e', themeButtonStyle: 'rounded', _csrf: admin.csrfToken });

  const form = await db.prepare('SELECT theme_preset, theme_primary_color FROM custom_forms WHERE id = ?').get(formId);
  assert.equal(form.theme_preset, 'halloween');
  assert.equal(form.theme_primary_color, '#d2691e');

  await publish(admin, formId);
  const parent = await createParentAccount();
  const fillPage = await request(app).get(`/forms/${formId}`).set('Cookie', parent.cookie);
  assert.match(fillPage.text, /<h1><span aria-hidden="true">\u{1F383}<\/span> Themed Form<\/h1>/u);

  // An unthemed form (the default "none" preset) shows no emoji at all.
  const plainFormId = await createForm(admin, 'Plain Form');
  await publish(admin, plainFormId);
  const plainFillPage = await request(app).get(`/forms/${plainFormId}`).set('Cookie', parent.cookie);
  assert.match(plainFillPage.text, /<h1>Plain Form<\/h1>/);
});

// --- Submissions list: sort, filter, CSV export ---

test('the submissions list can be sorted and filtered by member name, and CSV export lists every real field', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Submissions List Form');
  const colorField = await addField(admin, formId, { fieldType: 'short_text', label: 'Favorite Color' });
  await addField(admin, formId, { fieldType: 'heading', label: 'A heading, not a question' });
  await publish(admin, formId);

  const alpha = await createParentAccount(); // "Builder Parent N"
  const beta = await createParentAccount();
  await request(app).post(`/forms/${formId}/submit`).set('Cookie', alpha.cookie).type('form').send({ memberId: String(alpha.memberId), [`field_${colorField.id}`]: 'Blue', _csrf: alpha.csrfToken });
  await request(app).post(`/forms/${formId}/submit`).set('Cookie', beta.cookie).type('form').send({ memberId: String(beta.memberId), [`field_${colorField.id}`]: 'Green', _csrf: beta.csrfToken });

  const sortedAsc = await request(app).get(`/main-admin/forms/${formId}/submissions?sort=member&dir=asc`).set('Cookie', admin.cookie);
  assert.equal(sortedAsc.status, 200);

  const filtered = await request(app).get(`/main-admin/forms/${formId}/submissions?q=${encodeURIComponent('Builder Parent')}`).set('Cookie', admin.cookie);
  assert.match(filtered.text, /Builder Parent/);

  const filteredOut = await request(app).get(`/main-admin/forms/${formId}/submissions?q=nobody-matches-this`).set('Cookie', admin.cookie);
  assert.doesNotMatch(filteredOut.text, /Builder Parent/);

  // A real latent bug this upgrade fixes: /submissions/export used to
  // be shadowed by the generic /submissions/:submissionId route
  // defined before it, so the literal segment "export" was parsed as a
  // submission id and 500'd - see routes/admin-custom-forms.js's own
  // comment on the reorder. This is the regression test for that.
  const csv = await request(app).get(`/main-admin/forms/${formId}/submissions/export`).set('Cookie', admin.cookie);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /Favorite Color/);
  assert.match(csv.text, /Blue/);
  assert.match(csv.text, /Green/);
  assert.doesNotMatch(csv.text, /A heading, not a question/, 'a display-only heading field must never appear as a CSV column');

  // A real submission's own detail page still works (unchanged route,
  // just now reachable because /export no longer shadows it the other
  // way around).
  const submission = await db.prepare('SELECT id FROM custom_form_submissions WHERE form_id = ? LIMIT 1').get(formId);
  const detail = await request(app).get(`/main-admin/forms/${formId}/submissions/${submission.id}`).set('Cookie', admin.cookie);
  assert.equal(detail.status, 200);
});
