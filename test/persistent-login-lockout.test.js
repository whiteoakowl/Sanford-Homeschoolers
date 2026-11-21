// Security audit: wrong-password lockouts are counted in the database
// (utils/persistentRateLimit.js), so they hold across every Netlify
// instance instead of resetting with each new one. And signing in issues
// a brand-new session id (no session fixation).
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(os.tmpdir(), `persistent-login-lockout-${process.pid}.db`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { createPersistentLimiter } = require('../utils/persistentRateLimit');

const EMAIL = 'mainadmin@coop.local';
const PASSWORD = 'changeme123';

test.before(() => app.ready);

function login(email, password) {
  return request(app).post('/login').type('form').send({ email, password });
}

test('8 wrong passwords lock that email for 15 minutes, even with the right password', async () => {
  for (let i = 0; i < 8; i++) {
    const res = await login(EMAIL, 'wrong-password');
    assert.match(res.text, /Incorrect email or password/);
  }
  const locked = await login(EMAIL, PASSWORD);
  assert.equal(locked.status, 200);
  assert.match(locked.text, /Too many login attempts/);

  // The count lives in the database, so a separate limiter (as a fresh
  // Netlify instance would build) sees the same lock.
  const otherInstance = createPersistentLimiter({ name: 'login-email', windowMs: 15 * 60 * 1000, maxAttempts: 8 });
  assert.equal(await otherInstance.isRateLimited(EMAIL), true);

  // Once the window has passed, the right password works again.
  await db.prepare("UPDATE login_failures SET failed_at = failed_at - ? WHERE bucket LIKE 'login-%'").run(16 * 60 * 1000);
  const ok = await login(EMAIL, PASSWORD);
  assert.equal(ok.status, 302);
});

test('signing in replaces the session id', async () => {
  // Get a real pre-login session (unlocking Class Check-In with the
  // seeded default PIN stores a flag in it).
  const unlock = await request(app).post('/kiosk/class-checkin/unlock').type('form').send({ pin: '0000' });
  const preCookie = (unlock.headers['set-cookie'] || []).find((c) => c.startsWith('connect.sid='));
  assert.ok(preCookie, 'unlocking should create a session');
  const res = await request(app).post('/login').set('Cookie', preCookie.split(';')[0]).type('form').send({ email: EMAIL, password: PASSWORD });
  assert.equal(res.status, 302);
  const postCookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('connect.sid='));
  assert.ok(postCookie, 'login should issue a session cookie');
  assert.notEqual(postCookie.split(';')[0], preCookie.split(';')[0]);
});
