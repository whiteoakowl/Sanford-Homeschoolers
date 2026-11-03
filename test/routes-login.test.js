// A real request: "The main admin portal is now where the master lives.
// Master log in as full control of everything." The old separate
// username/password master login (/admin/login) is retired - the master is
// the Main Admin portal account, signed in on the one shared /login, and
// it gets all of Co-op Admin. Covers that the old login is gone, old links
// land on /login with their destination preserved, and the master's
// session really opens Co-op Admin.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `routes-login-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `routes-login-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.MAIN_ADMIN_EMAIL = 'mainadmin@coop.local';
process.env.MAIN_ADMIN_PASSWORD = 'changeme123';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { generateMemberCode } = require('../utils/members');
const { hashPassword } = require('../utils/portalAuth');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

test('master login', async (t) => {
  await t.test('the Main Admin master signs in on /login and that session opens Co-op Admin', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/admin' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/admin');
    const cookie = res.headers['set-cookie'];
    assert.ok(cookie && cookie.length > 0, 'expected a session cookie to be set');

    const dashboard = await request(app).get('/admin').set('Cookie', cookie);
    assert.equal(dashboard.status, 200);
    const settings = await request(app).get('/admin/settings').set('Cookie', cookie);
    assert.equal(settings.status, 200);
    for (const card of ['Quick Links', 'Install App', 'Kiosk', 'Class Check-In PIN', 'Semesters']) {
      assert.match(settings.text, new RegExp(card));
    }
    assert.doesNotMatch(settings.text, /tab=account/);
  });

  await t.test('GET /admin/login redirects to the shared /login, keeping a safe destination', async () => {
    const res = await request(app).get('/admin/login?next=%2Fadmin%2Fmembers');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/login?next=%2Fadmin%2Fmembers');

    const offsite = await request(app).get('/admin/login?next=https%3A%2F%2Fevil.example');
    assert.equal(offsite.headers.location, '/login?next=%2Fadmin');
  });

  await t.test('the old username/password POST no longer signs anyone in', async () => {
    const res = await request(app).post('/admin/login').type('form').send({ username: 'admin', password: 'changeme123' });
    assert.notEqual(res.headers.location, '/admin');
    const after = await request(app).get('/admin').set('Cookie', res.headers['set-cookie'] || []);
    assert.equal(after.status, 302);
    assert.match(after.headers.location, /^\/login/);
  });

  await t.test('an unauthenticated request to an admin route redirects to /login with the original URL preserved', async () => {
    const res = await request(app).get('/admin/members?tab=classes');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/login?next=%2Fadmin%2Fmembers%3Ftab%3Dclasses');
  });

  await t.test('Main Admin > Admin Login changes the signed-in master account\'s own login email', async () => {
    const login = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/main-admin' });
    const cookie = login.headers['set-cookie'];
    const page = await request(app).get('/main-admin/admin-login').set('Cookie', cookie);
    assert.equal(page.status, 200);
    assert.match(page.text, /value="mainadmin@coop\.local"/);
    const csrfToken = /name="csrf-token" content="([^"]*)"/.exec(page.text)[1];

    const wrongPw = await request(app)
      .post('/main-admin/admin-login/password')
      .set('Cookie', cookie)
      .type('form')
      .send({ currentPassword: 'nope', newPassword: 'whatever123', _csrf: csrfToken });
    assert.match(wrongPw.text, /Current password is incorrect/);

    const changed = await request(app)
      .post('/main-admin/admin-login/email')
      .set('Cookie', cookie)
      .type('form')
      .send({ newEmail: 'master@coop.local', _csrf: csrfToken });
    assert.match(changed.text, /Login email updated/);

    const relogin = await request(app).post('/login').type('form').send({ email: 'master@coop.local', password: 'changeme123', next: '/main-admin' });
    assert.equal(relogin.status, 302);
    assert.equal(relogin.headers.location, '/main-admin');
  });

  async function memberWithRoles(email, roleKeys) {
    const code = await generateMemberCode();
    const memberId = (await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, active) VALUES (?, ?, ?, 'parent', 1)").run(email, code, code)).lastInsertRowid;
    await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text())").run(memberId, email, hashPassword('memberpass123'));
    const acct = await db.prepare('SELECT id FROM member_accounts WHERE email = ?').get(email);
    for (const key of roleKeys) {
      const role = await db.prepare('SELECT id FROM roles WHERE key = ?').get(key);
      await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(acct.id, role.id);
    }
    const login = await request(app).post('/login').type('form').send({ email, password: 'memberpass123', next: '/portal' });
    return login.headers['set-cookie'];
  }

  // "This should not affect member admin access to portals" - only the one
  // master account gets everything; members keep their own roles' access.
  await t.test('a Main Admin member (not the master) does not gain Co-op Admin; a coop_admin member keeps it', async () => {
    const mainAdminMember = await memberWithRoles('second-main-admin@example.com', ['main_admin']);
    const blocked = await request(app).get('/admin').set('Cookie', mainAdminMember);
    assert.equal(blocked.status, 302);
    assert.match(blocked.headers.location, /^\/login/);
    const mainAdminHome = await request(app).get('/main-admin').set('Cookie', mainAdminMember);
    assert.equal(mainAdminHome.status, 200);

    const coopAdminMember = await memberWithRoles('coop-admin-member@example.com', ['coop_admin']);
    const allowed = await request(app).get('/admin').set('Cookie', coopAdminMember);
    assert.equal(allowed.status, 200);
  });

  await t.test('the master sees a Co-op Admin card on My Portals', async () => {
    const login = await request(app).post('/login').type('form').send({ email: 'master@coop.local', password: 'changeme123', next: '/portal' });
    const portals = await request(app).get('/portal').set('Cookie', login.headers['set-cookie']);
    assert.equal(portals.status, 200);
    assert.match(portals.text, /Co-op Admin/);
  });
});
