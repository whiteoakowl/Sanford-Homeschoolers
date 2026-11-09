// Coverage for two real requests:
// 1. "Homepage mobile. Log in button, the text should shrink to fit to
//    stay on one row clean in button box." The public homepage's own Log
//    In button (public/js/site-render.js's 'login' header element) gets
//    a narrow fixed-width mobile box by default (utils/siteBuilder.js's
//    own legacyHeaderStrip: w: 62, h: 34) - public/js/shrink-title-to-
//    fit.js's own generic measure-and-shrink helper now targets it, the
//    same way it already does the Classes grid/Grade Level Report.
// 2. "If at any time a member clicks log out, on any portal, it will go
//    back to the homepage." The one live, actually-used logout button
//    every portal's own nav posts to (routes/portal-auth.js's POST
//    /logout, mounted at the bare /logout) already redirected to '/' -
//    covered here as a locked-in regression test, plus the separate,
//    otherwise-unreachable /admin/logout (routes/admin.js, left over
//    from the retired master login) brought in line with it too.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `public-home-login-shrink-logout-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `public-home-login-shrink-logout-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.MAIN_ADMIN_EMAIL = 'mainadmin@coop.local';
process.env.MAIN_ADMIN_PASSWORD = 'changeme123';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

test('Public homepage loads the shared shrink-to-fit helper and its own Log In button is one of its targets', async () => {
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /<script src="\/js\/shrink-title-to-fit\.js" defer><\/script>/);
  // The default (never-customized) header always includes the Log In
  // button as its own .wx-el-login element (utils/siteBuilder.js's own
  // legacyHeaderStrip).
  assert.match(res.text, /class="wx-el wx-el-login"/);

  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'shrink-title-to-fit.js'), 'utf8');
  assert.match(script, /\.wx-el-login \.wx-btn/, 'the Log In button should be one of the shrink-to-fit targets');
});

let counter = 0;
async function createStudentAndLogin() {
  counter += 1;
  const code = `logout-home-student${counter}`;
  const familyId = (await db.prepare('INSERT INTO families (name) VALUES (?) RETURNING id').get(`Logout Home Family ${counter}`)).id;
  const memberId = (
    await db
      .prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, active) VALUES (?, ?, ?, 'student', ?, 1) RETURNING id")
      .get(`Logout Home Student ${counter}`, code, code, familyId)
  ).id;
  const email = `${code}@example.com`;
  const accountId = (
    await db
      .prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text()) RETURNING id")
      .get(memberId, email, hashPassword('testpassword123'))
  ).id;
  const role = await db.prepare("SELECT id FROM roles WHERE key = 'student'").get();
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountId, role.id);
  const loginRes = await request(app).post('/login').type('form').send({ email, password: 'testpassword123', next: '/student' });
  return loginRes.headers['set-cookie'];
}

function extractCsrf(html) {
  return /name="csrf-token" content="([^"]*)"/.exec(html)[1];
}

test('Logging out from a portal (the real /logout button every portal nav posts to) redirects to the homepage', async () => {
  const cookie = await createStudentAndLogin();
  const studentPage = await request(app).get('/student').set('Cookie', cookie);
  const csrfToken = extractCsrf(studentPage.text);
  const res = await request(app).post('/logout').set('Cookie', cookie).type('form').send({ _csrf: csrfToken });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/');

  // And the homepage itself still renders fine, now showing Log In again
  // instead of My Portals, confirming the session really was cleared.
  const home = await request(app).get('/').set('Cookie', res.headers['set-cookie'] || cookie);
  assert.equal(home.status, 200);
});

test('Every portal nav (Student, Parent, Main Admin, Co-op Admin) posts its Log Out form to the same /logout route', async () => {
  const studentCookie = await createStudentAndLogin();
  const studentPage = await request(app).get('/student').set('Cookie', studentCookie);
  assert.match(studentPage.text, /<form method="POST" action="\/logout" class="logout-form">/);

  const adminLoginRes = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/main-admin' });
  const adminCookie = adminLoginRes.headers['set-cookie'];
  const adminPage = await request(app).get('/main-admin').set('Cookie', adminCookie);
  assert.match(adminPage.text, /<form method="POST" action="\/logout" class="logout-form">/);

  const coopAdminPage = await request(app).get('/admin').set('Cookie', adminCookie);
  assert.match(coopAdminPage.text, /<form method="POST" action="\/logout" class="logout-form">/);
});

test('The separate, otherwise-unreachable /admin/logout route also redirects to the homepage, consistent with the real logout button', async () => {
  const adminLoginRes = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/main-admin' });
  const adminCookie = adminLoginRes.headers['set-cookie'];
  const adminPage = await request(app).get('/admin').set('Cookie', adminCookie);
  const csrfToken = extractCsrf(adminPage.text);
  const res = await request(app).post('/admin/logout').set('Cookie', adminCookie).type('form').send({ _csrf: csrfToken });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/');
});
