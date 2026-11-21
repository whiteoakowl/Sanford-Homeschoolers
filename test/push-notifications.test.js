// Push notifications: a member turns push on per device (stored in
// push_subscriptions), notify() sends to every one of their devices,
// expired devices are forgotten, and only https push-service endpoints
// are ever accepted.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const webpush = require('web-push');

process.env.DB_PATH = path.join(os.tmpdir(), `push-notifications-${process.pid}.db`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.VAPID_SUBJECT = 'mailto:test@example.com';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const push = require('../utils/pushProvider');

test.before(() => app.ready);

// A real browser-shaped subscription (keys from a real P-256 key pair so
// web-push's payload encryption accepts them).
function fakeSubscription(n) {
  const crypto = require('crypto');
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/test-device-${n}-${process.pid}`,
    keys: { p256dh: ecdh.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
  };
}

async function signIn() {
  const login = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const cookie = login.headers['set-cookie'];
  const page = await request(app).get('/notifications/preferences').set('Cookie', cookie);
  const csrf = /name="csrf-token" content="([^"]*)"/.exec(page.text)[1];
  const accountId = (await db.prepare("SELECT id FROM member_accounts WHERE email = 'mainadmin@coop.local'").get()).id;
  return { cookie, csrf, accountId, page };
}

test('only https push-service endpoints are accepted', () => {
  const good = fakeSubscription(0);
  assert.equal(push.isValidSubscription(good), true);
  assert.equal(push.isValidSubscription({ ...good, endpoint: 'http://fcm.googleapis.com/x' }), false);
  assert.equal(push.isValidSubscription({ ...good, endpoint: 'https://127.0.0.1/x' }), false);
  assert.equal(push.isValidSubscription({ ...good, endpoint: 'https://localhost/x' }), false);
  assert.equal(push.isValidSubscription({ ...good, endpoint: 'https://metadata.internal/x' }), false);
  assert.equal(push.isValidSubscription({ endpoint: good.endpoint }), false);
  assert.equal(push.isValidSubscription(null), false);
});

test('preferences page shows the device card with the public key', async () => {
  const { page } = await signIn();
  assert.equal(page.status, 200);
  assert.match(page.text, /Push notifications on this device/);
  assert.match(page.text, new RegExp(`data-public-key="${keys.publicKey}"`));
  assert.match(page.text, /\/js\/push-notifications\.js/);
});

test('subscribe needs a signed-in member and the CSRF token', async () => {
  const sub = fakeSubscription(1);
  const anon = await request(app).post('/notifications/push/subscribe').set('Accept', 'application/json').send({ subscription: sub });
  assert.equal(anon.status, 302);
  const { cookie } = await signIn();
  const noCsrf = await request(app).post('/notifications/push/subscribe').set('Cookie', cookie).set('Accept', 'application/json').send({ subscription: sub });
  assert.equal(noCsrf.status, 403);
});

test('a member turns push on for two devices, gets pushes on both, and an expired device is forgotten', async () => {
  const { cookie, csrf, accountId } = await signIn();
  const devices = [fakeSubscription(2), fakeSubscription(3)];
  for (const sub of devices) {
    const res = await request(app).post('/notifications/push/subscribe').set('Cookie', cookie).set('X-CSRF-Token', csrf).send({ subscription: sub });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  }
  assert.equal(await push.deviceCount(accountId), 2);

  const bad = await request(app).post('/notifications/push/subscribe').set('Cookie', cookie).set('X-CSRF-Token', csrf).send({ subscription: { endpoint: 'http://evil.example/x', keys: { p256dh: 'a', auth: 'b' } } });
  assert.equal(bad.status, 400);

  const sent = [];
  const result = await push.sendToAccount(
    accountId,
    { title: 'Class cancelled', body: 'Art is cancelled today.', linkUrl: 'https://evil.example/' },
    {
      send: async (subscription, payload) => {
        sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
        if (subscription.endpoint === devices[1].endpoint) {
          const err = new Error('Gone');
          err.statusCode = 410;
          throw err;
        }
      },
    }
  );
  assert.equal(result.status, 'sent');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].payload.title, 'Class cancelled');
  // Off-site links are never put in a push.
  assert.equal(sent[0].payload.url, '/notifications');
  assert.equal(await push.deviceCount(accountId), 1, 'the 410 device is removed');

  const off = await request(app).post('/notifications/push/unsubscribe').set('Cookie', cookie).set('X-CSRF-Token', csrf).send({ endpoint: devices[0].endpoint });
  assert.equal(off.body.deviceCount, 0);
  const none = await push.sendToAccount(accountId, { title: 'x', body: 'y' });
  assert.equal(none.status, 'skipped');
});

test('notify() records a push delivery and respects the member turning push off for a type', async () => {
  const { accountId } = await signIn();
  const notifications = require('../utils/notifications');
  const type = (await notifications.listTypes())[0];

  const id1 = await notifications.notify(accountId, type.key, { title: 'Hello', body: 'World' });
  const row1 = await db.prepare("SELECT status, detail FROM notification_deliveries WHERE notification_id = ? AND channel = 'push'").get(id1);
  assert.equal(row1.status, 'skipped');
  assert.match(row1.detail, /not turned on push/);

  await notifications.setPreference(accountId, type.key, 'push', false);
  const id2 = await notifications.notify(accountId, type.key, { title: 'Hello', body: 'World' });
  const row2 = await db.prepare("SELECT detail FROM notification_deliveries WHERE notification_id = ? AND channel = 'push'").get(id2);
  assert.match(row2.detail, /opted out/);

  await notifications.setPreference(accountId, type.key, 'push', true);
  await notifications.setAutoSend(type.key, { email: true, sms: true, push: false });
  const id3 = await notifications.notify(accountId, type.key, { title: 'Hello', body: 'World' });
  const row3 = await db.prepare("SELECT detail FROM notification_deliveries WHERE notification_id = ? AND channel = 'push'").get(id3);
  assert.match(row3.detail, /turned off for this notification type/);
});

test('without VAPID keys nothing is sent and the page says push is not set up', async () => {
  const saved = process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  try {
    const result = await push.sendToAccount(1, { title: 'x', body: 'y' });
    assert.equal(result.status, 'skipped');
    const { page } = await signIn();
    assert.match(page.text, /data-public-key=""/);
  } finally {
    process.env.VAPID_PRIVATE_KEY = saved;
  }
});
