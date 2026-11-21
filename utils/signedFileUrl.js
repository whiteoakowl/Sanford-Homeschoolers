// Private files that pages show directly in <img>/<a> tags - member and
// child photos (member-photos bucket) and class handouts plus older
// homework (lesson-attachments bucket). Both buckets are private, so
// there's no public Supabase link to hand out. Instead every page that
// shows one gets an app link signed by the server:
//
//   /files/<bucket>/<key>?exp=<unix seconds>&sig=<HMAC>
//
// GET /files/... (routes/signed-files.js) checks the signature and the
// expiry, then sends the browser to a short-lived Supabase signed link.
// That works everywhere a page is shown - signed-in pages, the kiosk,
// and server-rendered PDFs (name tags, rosters), which fetch images with
// no session - while a link copied out of a page stops working within
// about two days. Links are stable for a whole day (expiry is rounded to
// the end of the next UTC day), so browsers can still cache the images.
const crypto = require('crypto');

const SIGNED_BUCKETS = new Set(['member-photos', 'lesson-attachments']);

function secret() {
  return process.env.FILE_LINK_SECRET || process.env.SESSION_SECRET || '';
}

function signature(bucket, key, exp) {
  return crypto.createHmac('sha256', secret()).update(`${bucket}\n${key}\n${exp}`).digest('base64url');
}

// End of tomorrow (UTC), in unix seconds.
function expiryFor(nowMs = Date.now()) {
  const day = 24 * 60 * 60;
  return (Math.floor(nowMs / 1000 / day) + 2) * day;
}

function signedFileUrl(bucket, key, nowMs = Date.now()) {
  if (!key) return null;
  const exp = expiryFor(nowMs);
  return `/files/${bucket}/${encodeURIComponent(key)}?exp=${exp}&sig=${signature(bucket, key, exp)}`;
}

function verifySignedFile(bucket, key, exp, sig, nowMs = Date.now()) {
  if (!SIGNED_BUCKETS.has(bucket) || !key || !secret()) return false;
  const expNum = Number(exp);
  if (!Number.isInteger(expNum) || expNum * 1000 < nowMs) return false;
  const expected = Buffer.from(signature(bucket, key, expNum));
  const given = Buffer.from(String(sig || ''));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

module.exports = { SIGNED_BUCKETS, signedFileUrl, verifySignedFile, expiryFor };
