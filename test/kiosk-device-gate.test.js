// Security audit: walk-up kiosk screens list members' names and take
// 6-digit member codes, so on an internet-facing install they open only
// on a kiosk device unlocked once with the Class Check-In PIN, or for a
// signed-in member (middleware/requireKioskDevice.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(os.tmpdir(), `kiosk-device-gate-${process.pid}.db`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
delete process.env.KIOSK_OPEN_ACCESS;

const request = require('supertest');
const app = require('../server');
const db = require('../db');

test.before(() => app.ready);

function sessionCookie(res) {
  const c = (res.headers['set-cookie'] || []).find((v) => v.startsWith('connect.sid='));
  return c ? c.split(';')[0] : null;
}

test('a signed-out visitor from the internet gets the unlock screen, not member names', async () => {
  for (const url of ['/kiosk', '/kiosk/checkin', '/kiosk/find-parent', '/absence', '/name-tag', '/volunteers', '/setup', '/training']) {
    const res = await request(app).get(url);
    assert.equal(res.status, 302, url);
    assert.match(res.headers.location, /^\/kiosk\/unlock\?next=/, url);
  }
  const page = await request(app).get('/kiosk/unlock?next=%2Fabsence');
  assert.equal(page.status, 200);
  assert.match(page.text, /Unlock This Kiosk/);
});

test('scan endpoints refuse remote barcode guessing', async () => {
  const code = '123456';
  await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, active) VALUES ('Gate Student', ?, ?, 'student', 1)").run(code, code);
  for (const url of ['/kiosk/checkin/scan', '/kiosk/checkout/scan', '/kiosk/find-parent/scan']) {
    const res = await request(app).post(url).type('form').send({ barcode: code });
    assert.equal(res.status, 401, url);
    assert.doesNotMatch(JSON.stringify(res.body), /Gate Student/, url);
  }
});

test('a wrong PIN does not unlock; the right PIN unlocks the device for today', async () => {
  const wrong = await request(app).post('/kiosk/unlock').type('form').send({ pin: '9999', next: '/absence' });
  assert.equal(wrong.status, 401);
  assert.match(wrong.text, /Incorrect PIN/);

  const right = await request(app).post('/kiosk/unlock').type('form').send({ pin: '0000', next: '/absence' });
  assert.equal(right.status, 302);
  assert.equal(right.headers.location, '/absence');
  const cookie = sessionCookie(right);
  assert.ok(cookie);
  assert.equal((await request(app).get('/absence').set('Cookie', cookie)).status, 200);
  assert.equal((await request(app).get('/kiosk/checkin').set('Cookie', cookie)).status, 200);

  // The next day the same device is locked again until an admin enters
  // the PIN (simulated by backdating the stored unlock date).
  const sid = decodeURIComponent(cookie.split('=')[1]).replace(/^s:/, '').split('.')[0];
  const row = await db.prepare('SELECT data_json FROM sessions WHERE sid = ?').get(sid);
  const data = JSON.parse(row.data_json);
  assert.ok(data.kioskDeviceUnlockedOn, 'the unlock date is stored');
  data.kioskDeviceUnlockedOn = '2000-01-01';
  await db.prepare('UPDATE sessions SET data_json = ? WHERE sid = ?').run(JSON.stringify(data), sid);
  const nextDay = await request(app).get('/kiosk/checkin').set('Cookie', cookie);
  assert.equal(nextDay.status, 302);
  assert.match(nextDay.headers.location, /^\/kiosk\/unlock/);
});

test('the unlock screen is an admin setup screen, with no member sign-in prompt', async () => {
  const page = await request(app).get('/kiosk/unlock');
  assert.match(page.text, /set up this kiosk for today/);
  assert.doesNotMatch(page.text, /Member\?/);
});

test('the unlock page never redirects off-site', async () => {
  const res = await request(app).post('/kiosk/unlock').type('form').send({ pin: '0000', next: '//evil.example.com/' });
  assert.equal(res.headers.location, '/kiosk');
});

test('unlocking Class Check-In also unlocks the device', async () => {
  const res = await request(app).post('/kiosk/class-checkin/unlock').type('form').send({ pin: '0000' });
  const cookie = sessionCookie(res);
  assert.equal((await request(app).get('/kiosk/find-parent').set('Cookie', cookie)).status, 200);
});

test('a signed-in member can open them from home (e.g. report an absence)', async () => {
  const login = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const cookie = sessionCookie(login);
  assert.equal((await request(app).get('/absence').set('Cookie', cookie)).status, 200);
});
