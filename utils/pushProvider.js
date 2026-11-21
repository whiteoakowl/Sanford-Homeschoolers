// Web push delivery (phones, tablets, computers) - the third channel
// notify() (utils/notifications.js) sends on, after email and text.
//
// Uses the standard Web Push protocol through the `web-push` package:
// each payload is encrypted for the one device it's going to, so the
// browser's push service (Google, Apple, Mozilla) only ever relays
// ciphertext. Needs a VAPID key pair - generate once with
//   node scripts/generate-vapid-keys.js
// and set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (a
// mailto: address or the site's https URL) in the environment. Without
// them nothing is sent and each attempt is recorded as "skipped", the
// same way email/text behave when they aren't configured.
const webpush = require('web-push');
const db = require('../db');

function isConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function publicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

let configuredWith = null;
function ensureVapid() {
  const signature = `${process.env.VAPID_PUBLIC_KEY}|${process.env.VAPID_PRIVATE_KEY}|${process.env.VAPID_SUBJECT}`;
  if (configuredWith === signature) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  configuredWith = signature;
}

// Only https push-service endpoints are ever accepted from a browser -
// the server POSTs to whatever URL is stored here, so anything else
// (http://, internal addresses) is refused up front.
function isValidSubscription(sub) {
  if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' || !sub.keys) return false;
  if (sub.endpoint.length > 1000 || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') return false;
  if (sub.keys.p256dh.length > 200 || sub.keys.auth.length > 100) return false;
  let url;
  try {
    url = new URL(sub.endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  return true;
}

async function saveSubscription(accountId, sub, userAgent) {
  // One endpoint belongs to one device; if a different member signs in
  // on that device and turns push on, it moves to them.
  await db
    .prepare(
      `INSERT INTO push_subscriptions (member_account_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET member_account_id = excluded.member_account_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent`
    )
    .run(accountId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, (userAgent || '').slice(0, 300) || null);
}

async function removeSubscription(accountId, endpoint) {
  await db.prepare('DELETE FROM push_subscriptions WHERE member_account_id = ? AND endpoint = ?').run(accountId, endpoint);
}

async function subscriptionsForAccount(accountId) {
  return db.prepare('SELECT * FROM push_subscriptions WHERE member_account_id = ? ORDER BY id').all(accountId);
}

async function deviceCount(accountId) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE member_account_id = ?').get(accountId);
  return Number(row ? row.n : 0);
}

// Only same-site paths are ever put in a push, so tapping one can never
// send someone to another website.
function safeLink(linkUrl) {
  return typeof linkUrl === 'string' && linkUrl.startsWith('/') && !linkUrl.startsWith('//') ? linkUrl : '/notifications';
}

// `send` is injectable so tests can stand in for the real push services.
async function sendToAccount(accountId, { title, body, linkUrl }, { send = (s, p, o) => webpush.sendNotification(s, p, o) } = {}) {
  if (!isConfigured()) return { status: 'skipped', detail: 'Push notifications are not set up on this site yet (no VAPID keys).' };
  const subs = await subscriptionsForAccount(accountId);
  if (subs.length === 0) return { status: 'skipped', detail: 'Recipient has not turned on push notifications on any device.' };
  ensureVapid();
  const payload = JSON.stringify({
    title: String(title || 'Sanford Homeschoolers').slice(0, 120),
    body: String(body || '').slice(0, 300),
    url: safeLink(linkUrl),
  });
  let sent = 0;
  let removed = 0;
  const errors = [];
  for (const sub of subs) {
    try {
      await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 24 * 60 * 60, urgency: 'normal' });
      sent += 1;
      await db.prepare('UPDATE push_subscriptions SET last_success_at = now_text() WHERE id = ?').run(sub.id);
    } catch (err) {
      // 404/410: the device unsubscribed or the browser was reset -
      // that subscription will never work again, so forget it.
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        removed += 1;
      } else {
        errors.push(err && err.statusCode ? `HTTP ${err.statusCode}` : (err && err.message) || 'error');
      }
    }
  }
  if (sent > 0) return { status: 'sent', detail: `Sent to ${sent} device${sent === 1 ? '' : 's'}.${removed ? ` Removed ${removed} expired.` : ''}` };
  if (errors.length === 0) return { status: 'skipped', detail: `All ${removed} device subscription(s) had expired and were removed.` };
  return { status: 'failed', detail: `Push failed: ${errors.join(', ')}`.slice(0, 500) };
}

module.exports = {
  isConfigured,
  publicKey,
  isValidSubscription,
  saveSubscription,
  removeSubscription,
  subscriptionsForAccount,
  deviceCount,
  sendToAccount,
};
