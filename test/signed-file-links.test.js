// Member/child photos and class files live in private buckets and are
// shown through server-signed app links that expire (utils/signedFileUrl.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(os.tmpdir(), `signed-file-links-${process.pid}.db`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const { signedFileUrl, verifySignedFile, expiryFor } = require('../utils/signedFileUrl');
const { urlForUpload } = require('../utils/uploadBackend');

test.before(() => app.ready);

function parts(url) {
  const u = new URL(url, 'http://x');
  const [, , bucket, key] = u.pathname.split('/');
  return { bucket, key: decodeURIComponent(key), exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig') };
}

test('a signed link verifies, and any change to it does not', () => {
  const url = signedFileUrl('member-photos', '123-456.jpg');
  const p = parts(url);
  assert.equal(verifySignedFile(p.bucket, p.key, p.exp, p.sig), true);
  assert.equal(verifySignedFile(p.bucket, 'other.jpg', p.exp, p.sig), false, 'other key');
  assert.equal(verifySignedFile('lesson-attachments', p.key, p.exp, p.sig), false, 'other bucket');
  assert.equal(verifySignedFile(p.bucket, p.key, String(Number(p.exp) + 86400), p.sig), false, 'extended expiry');
  assert.equal(verifySignedFile(p.bucket, p.key, p.exp, 'x' + p.sig.slice(1)), false, 'tampered signature');
  assert.equal(verifySignedFile('documents', p.key, p.exp, p.sig), false, 'non-signed bucket');
});

test('links expire within about two days and stay the same all day (cacheable)', () => {
  const now = Date.UTC(2026, 10, 21, 9, 0, 0);
  const later = Date.UTC(2026, 10, 21, 23, 0, 0);
  assert.equal(signedFileUrl('member-photos', 'a.jpg', now), signedFileUrl('member-photos', 'a.jpg', later));
  const exp = expiryFor(now);
  assert.ok(exp * 1000 - now <= 2 * 24 * 60 * 60 * 1000);
  const p = parts(signedFileUrl('member-photos', 'a.jpg', now));
  assert.equal(verifySignedFile(p.bucket, p.key, p.exp, p.sig, now + 3 * 24 * 60 * 60 * 1000), false, 'expired');
});

test('member photos use signed app links when Supabase is configured, never a public Supabase link', () => {
  const fakeClient = {};
  const url = urlForUpload({ client: fakeClient, bucket: 'member-photos', webDir: '/uploads/members', key: 'kid.jpg' });
  assert.match(url, /^\/files\/member-photos\/kid\.jpg\?exp=\d+&sig=/);
  assert.doesNotMatch(url, /object\/public/);
});

test('the file route refuses bad or missing signatures', async () => {
  assert.equal((await request(app).get('/files/member-photos/kid.jpg')).status, 404);
  assert.equal((await request(app).get('/files/member-photos/kid.jpg?exp=9999999999&sig=abc')).status, 404);
  assert.equal((await request(app).get('/files/documents/x.pdf?exp=9999999999&sig=abc')).status, 404);
});
