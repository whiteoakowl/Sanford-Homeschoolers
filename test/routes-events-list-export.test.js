// A real request: "all pages/subpages across the entire app where there
// are print, export, import, or download buttons should be changed to
// icons, and those pages/subpages should have all four." The public
// Events calendar (views/events-list.ejs) only had Print - this covers
// its new Export (icon button + routes/events.js's own GET
// /events/export.csv, reusing the same visibility-filtered list the page
// itself shows and the same buildEventsExportCsvLines builder Main
// Admin's own Events list already exports with).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `events-list-export-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `events-list-export-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.MAIN_ADMIN_EMAIL = 'mainadmin@coop.local';
process.env.MAIN_ADMIN_PASSWORD = 'changeme123';

const request = require('supertest');
const app = require('../server');

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

test('public Events calendar: Export and Print are icon buttons, Export downloads a CSV of the visible events', async () => {
  const admin = await loginAsMainAdmin();
  const createRes = await request(app)
    .post('/main-admin/events')
    .set('Cookie', admin.cookie)
    .type('form')
    .send({ title: 'Export Test Carnival', startsAt: '2099-01-01T10:00', visibility: 'public', _csrf: admin.csrfToken });
  const eventId = Number(/\/main-admin\/events\/(\d+)\/builder/.exec(createRes.headers.location)[1]);
  await request(app).post(`/main-admin/events/${eventId}/status`).set('Cookie', admin.cookie).type('form').send({ status: 'published', _csrf: admin.csrfToken });

  const page = await request(app).get('/events');
  assert.equal(page.status, 200);
  assert.match(page.text, /<a class="icon-btn" href="\/events\/export\.csv" aria-label="Export CSV"/);
  assert.match(page.text, /<a class="icon-btn" href="\/events\/print" target="_blank" aria-label="Print"/);
  assert.match(page.text, /<a class="icon-btn" href="\/events\/download\.pdf" aria-label="Download PDF"/);

  const csv = await request(app).get('/events/export.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /Title.*Starts At.*Ends At.*Location.*Category.*Visibility.*Capacity.*Description/);
  assert.match(csv.text, /Export Test Carnival/);
});

test('public Events calendar: Download PDF is a real PDF of the same print preview', async () => {
  const admin = await loginAsMainAdmin();
  const createRes = await request(app)
    .post('/main-admin/events')
    .set('Cookie', admin.cookie)
    .type('form')
    .send({ title: 'Download PDF Carnival', startsAt: '2099-01-01T10:00', visibility: 'public', _csrf: admin.csrfToken });
  const eventId = Number(/\/main-admin\/events\/(\d+)\/builder/.exec(createRes.headers.location)[1]);
  await request(app).post(`/main-admin/events/${eventId}/status`).set('Cookie', admin.cookie).type('form').send({ status: 'published', _csrf: admin.csrfToken });

  const printRes = await request(app).get('/events/print');
  assert.equal(printRes.status, 200);
  assert.match(printRes.text, /Download PDF Carnival/);

  const pdfRes = await request(app)
    .get('/events/download.pdf')
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers['content-type'], 'application/pdf');
  assert.match(pdfRes.headers['content-disposition'], /attachment; filename="events\.pdf"/);
  assert.equal(pdfRes.body.slice(0, 5).toString(), '%PDF-');
});

// A real request: "Parent portal event calendar. The export, pdf and print
// icons should be in a row side by side, not a column" - the icon row uses
// .class-schedule-icon-row, which keeps icons on one line on phones
// instead of the mobile toolbar grid (one column for icon-only rows).
test('Events calendar: Export/Print/PDF icons sit in a one-line icon row (calendar and list view)', async () => {
  for (const view of ['calendar', 'list']) {
    const res = await request(app).get(`/events?view=${view}&portal=parent`);
    assert.equal(res.status, 200);
    const row = /<div class="roster-btn-row([^"]*)">(?:(?!<div class="roster-btn-row)[\s\S])*?aria-label="Export CSV"/.exec(res.text);
    assert.ok(row, `${view}: the Export icon is inside a toolbar row`);
    assert.match(row[1], /class-schedule-icon-row/, `${view}: that row is the one-line icon row`);
  }
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'styles.css'), 'utf8');
  assert.match(css, /\.roster-btn-row\.class-schedule-icon-row \{\s*display: flex;\s*flex-wrap: nowrap;/);
});
