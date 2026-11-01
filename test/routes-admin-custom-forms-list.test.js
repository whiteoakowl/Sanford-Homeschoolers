// Route-level coverage for the Main Admin Custom Forms LIST page's
// redesign (a real request: "Custom forms page should be a list of rows
// showing forms, not cards. Each row says the form name, published/draft,
// # of submissions, edit icon, trash icon, share icon (public link),
// analytics icons. All fit to mobile view, not side to side scrolling.")
// - replacing the old .team-card-grid/.team-info-card one-card-per-form
// grid with a single seamless .cf-list of .cf-list-row rows. See
// test/routes-custom-forms-builder.test.js for the builder/submissions
// pages' own coverage; this file only covers the list page itself
// (GET /main-admin/forms).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `custom-forms-list-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.ADMIN_USERNAME = 'testadmin';
process.env.ADMIN_PASSWORD = 'testpassword123';
process.env.MAIN_ADMIN_EMAIL = 'mainadmin@coop.local';
process.env.MAIN_ADMIN_PASSWORD = 'changeme123';

const request = require('supertest');
const app = require('../server');
const db = require('../db');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
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

async function createForm(admin, title) {
  const createRes = await request(app).post('/main-admin/forms').set('Cookie', admin.cookie).type('form').send({ title, _csrf: admin.csrfToken });
  return /\/main-admin\/forms\/(\d+)\/builder/.exec(createRes.headers.location)[1];
}

async function publish(admin, formId) {
  await request(app).post(`/main-admin/forms/${formId}/status`).set('Cookie', admin.cookie).type('form').send({ status: 'published', _csrf: admin.csrfToken });
}

test('Custom Forms list renders a seamless list of rows, not a card grid', async () => {
  const admin = await loginAsMainAdmin();
  await createForm(admin, 'Draft Row Form');
  const publishedFormId = await createForm(admin, 'Published Row Form');
  await publish(admin, publishedFormId);

  const res = await request(app).get('/main-admin/forms').set('Cookie', admin.cookie);
  assert.equal(res.status, 200);

  // The old card-grid markup must be gone from this page entirely.
  assert.doesNotMatch(res.text, /team-card-grid/, 'the old card grid class should no longer appear');
  assert.doesNotMatch(res.text, /team-info-card/, 'the old per-form card class should no longer appear');
  assert.doesNotMatch(res.text, /team-col/, 'the old card-grid column class should no longer appear');

  // The new list/row markup should be present instead.
  assert.match(res.text, /class="cf-list"/, 'the new list container should be present');
  assert.match(res.text, /cf-list-row/, 'each form should render as a cf-list-row');

  // Both forms show up, each with its own status badge.
  assert.match(res.text, /Draft Row Form/);
  assert.match(res.text, /Published Row Form/);
  assert.match(res.text, /badge-pill-orange">Draft/);
  assert.match(res.text, /badge-pill-green">Published/);
});

test('Custom Forms list row shows submission count and all four row actions (edit/share/analytics/delete)', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Row Actions Form');

  const res = await request(app).get('/main-admin/forms').set('Cookie', admin.cookie);
  assert.equal(res.status, 200);

  // Submission count - a freshly created form has none yet.
  assert.match(res.text, /0 submissions/);

  // Edit icon -> the builder, same destination as before.
  assert.match(res.text, new RegExp(`href="/main-admin/forms/${formId}/builder"[^>]*>[\\s\\S]*?#icon-edit`));

  // Share icon -> copies the form's own direct (portal-gated) /forms/:id
  // link, via the app's existing data-copy-link convention - not a
  // public/unauthenticated URL.
  assert.match(res.text, new RegExp(`data-copy-link="https?://[^"]*/forms/${formId}"`));
  assert.match(res.text, /#icon-link/, 'the share button should use the link icon');

  // Analytics icon -> the existing Submissions page (sort/filter/CSV
  // export), not a new dashboard.
  assert.match(res.text, new RegExp(`href="/main-admin/forms/${formId}/submissions"[^>]*>[\\s\\S]*?#icon-chart-bar`));

  // Trash icon -> POSTs to the existing delete route, with this app's
  // data-confirm convention (matching the builder page's own delete
  // button wording exactly).
  assert.match(res.text, new RegExp(`<form method="POST" action="/main-admin/forms/${formId}/delete" data-confirm="Delete`));
  assert.match(res.text, /icon-btn icon-btn-danger"[^>]*>[\s\S]*?#icon-trash/);
});

test('the trash icon\'s delete form actually deletes the form (not just reachable from inside the builder)', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Deletable From List');

  const beforeList = await request(app).get('/main-admin/forms').set('Cookie', admin.cookie);
  assert.match(beforeList.text, /Deletable From List/);

  const deleteRes = await request(app)
    .post(`/main-admin/forms/${formId}/delete`)
    .set('Cookie', admin.cookie)
    .type('form')
    .send({ _csrf: admin.csrfToken });
  assert.equal(deleteRes.status, 302);
  assert.match(deleteRes.headers.location, /\/main-admin\/forms\?notice=/);

  const row = await db.prepare('SELECT * FROM custom_forms WHERE id = ?').get(formId);
  assert.equal(row, undefined, 'the form should be gone from the database');

  const afterList = await request(app).get('/main-admin/forms').set('Cookie', admin.cookie);
  assert.doesNotMatch(afterList.text, /Deletable From List/);
});

test('a closed form shows the gray Closed badge', async () => {
  const admin = await loginAsMainAdmin();
  const formId = await createForm(admin, 'Closed Row Form');
  await request(app).post(`/main-admin/forms/${formId}/status`).set('Cookie', admin.cookie).type('form').send({ status: 'closed', _csrf: admin.csrfToken });

  const res = await request(app).get('/main-admin/forms').set('Cookie', admin.cookie);
  assert.match(res.text, /badge-pill-gray">Closed/);
});
