// A real request: "When scanning qr codes to do class attendance, check in
// and out, it should not ask for a pin #. Scanning the class qr code goes
// directly to the class attendance page." Each printed class QR code
// carries a per-class key (an HMAC of the class id with a secret stored
// once in app_settings), so scanning it opens that one class without the
// shared PIN, while guessing /kiosk/class-checkin/classes/<n>/attendance
// with no key still lands on the PIN screen. The secret never changes on
// its own, so printed sheets keep working.
const crypto = require('crypto');
const db = require('../db');
const { appSetting } = require('./appSettings');

const SECRET_KEY = 'class_qr_secret';

async function classQrSecret() {
  const existing = await appSetting(SECRET_KEY, null);
  if (existing) return existing;
  // Insert-if-absent, then re-read, so two first uses at once still agree.
  await db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING').run(SECRET_KEY, crypto.randomBytes(32).toString('hex'));
  return appSetting(SECRET_KEY, null);
}

async function keyFor(scope) {
  const secret = await classQrSecret();
  return crypto.createHmac('sha256', secret).update(scope).digest('hex').slice(0, 20);
}

async function keyMatches(scope, key) {
  if (typeof key !== 'string' || key.length !== 20) return false;
  return crypto.timingSafeEqual(Buffer.from(await keyFor(scope)), Buffer.from(key));
}

const classQrKey = (classId) => keyFor(`class:${classId}`);
const isValidClassQrKey = (classId, key) => keyMatches(`class:${classId}`, key);
// A later real request: "Same for playground qr code scanning. It should
// not require a pin number" - one key per printed (day, hour) code.
const playgroundQrKey = (day, hour) => keyFor(`playground:${day}:${hour}`);
const isValidPlaygroundQrKey = (day, hour, key) => keyMatches(`playground:${day}:${hour}`, key);

module.exports = { classQrKey, isValidClassQrKey, playgroundQrKey, isValidPlaygroundQrKey };
