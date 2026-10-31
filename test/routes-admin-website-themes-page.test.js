// Coverage for a real request, with a screenshot of Shopify's own
// Settings > Online Store > Themes page: "This design page should look
// and function exactly like Shopify when you edit the online store
// website." A new GET /main-admin/website/themes (views/main-admin-
// website-themes.ejs) sits in front of the existing full editor
// (routes/admin-website.js's own GET /, views/main-admin-website.ejs,
// unchanged) - the Settings hub's Public Homepage card now links here,
// its "Customize" button opens the real editor, and the editor's own
// Exit link returns here instead of all the way out to Settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `admin-website-themes-page-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `admin-website-themes-page-test-uploads-${process.pid}`);
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

async function loginAsMainAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: process.env.MAIN_ADMIN_EMAIL, password: process.env.MAIN_ADMIN_PASSWORD, next: '/main-admin' });
  return loginRes.headers['set-cookie'];
}

test('Settings hub Public Homepage card now links to the Themes page, not straight into the editor', async () => {
  const cookie = await loginAsMainAdmin();
  const hub = await request(app).get('/main-admin/settings').set('Cookie', cookie);
  assert.equal(hub.status, 200);
  assert.match(hub.text, /<a class="team-info-card" href="\/main-admin\/website\/themes">/);
});

test('Themes page shows one theme card: live preview, name, fonts, color swatches, Customize, and View your store', async () => {
  const cookie = await loginAsMainAdmin();
  const res = await request(app).get('/main-admin/website/themes').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /<h1>Themes<\/h1>/);
  assert.match(res.text, /View your store/);
  assert.match(res.text, /href="\/" target="_blank"/);
  assert.match(res.text, /Default Theme/);
  assert.match(res.text, /Current theme/);
  // Shipped defaults: Montserrat heading / Open Sans body.
  assert.match(res.text, /Fonts: Montserrat \/ Open Sans/);
  assert.match(res.text, /class="homepage-theme-swatch"/);
  const swatchCount = (res.text.match(/class="homepage-theme-swatch"/g) || []).length;
  assert.equal(swatchCount, 4);
  assert.match(res.text, /href="\/main-admin\/website">Customize<\/a>/);
  assert.match(res.text, /src="\/main-admin\/website\/preview"/);
});

test('customizing a theme setting is reflected back on the Themes page', async () => {
  const cookie = await loginAsMainAdmin();
  const editorPage = await request(app).get('/main-admin/website').set('Cookie', cookie);
  const csrfToken = /name="csrf-token" content="([^"]*)"/.exec(editorPage.text)[1];

  await request(app)
    .post('/main-admin/website/theme-settings')
    .set('Cookie', cookie)
    .type('form')
    .send({
      colorPrimary: '#123456',
      colorAccent: '#79BAEC',
      colorBackground: '#FFFFFF',
      colorCards: '#FFFFFF',
      colorText: '#1C2530',
      fontHeading: 'georgia',
      fontBody: 'arial',
      fontSizeBase: 'medium',
      _csrf: csrfToken,
    });

  const themesPage = await request(app).get('/main-admin/website/themes').set('Cookie', cookie);
  assert.match(themesPage.text, /#123456/);
  assert.match(themesPage.text, /Fonts: Georgia \(Serif\) \/ Arial/);
});

test('the full editor\'s Exit link returns to the Themes page, not straight to Settings', async () => {
  const cookie = await loginAsMainAdmin();
  const res = await request(app).get('/main-admin/website').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /class="homepage-theme-exit" href="\/main-admin\/website\/themes"/);
});
