// Database-backed failure counter for sign-ins and PIN entry (security
// audit). utils/loginRateLimit.js's in-memory version only counts
// failures seen by ONE server process; on Netlify each request can hit a
// different or freshly started function instance, so its counts kept
// resetting. This keeps the same isRateLimited/recordFailure/
// recordSuccess shape, but every method is async and the counts live in
// the login_failures table (supabase/migrations/20261231180000_login_failures.sql),
// so they hold across every instance.
const db = require('../db');

const PRUNE_EVERY_MS = 10 * 60 * 1000;
let lastPrunedAt = 0;

function createPersistentLimiter({ name, windowMs, maxAttempts }) {
  const bucket = (key) => `${name}:${String(key || 'unknown').toLowerCase()}`;

  async function failureCount(key) {
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM login_failures WHERE bucket = ? AND failed_at > ?')
      .get(bucket(key), Date.now() - windowMs);
    return Number(row ? row.n : 0);
  }

  async function isRateLimited(key) {
    return (await failureCount(key)) >= maxAttempts;
  }

  async function recordFailure(key) {
    const now = Date.now();
    await db.prepare('INSERT INTO login_failures (bucket, failed_at) VALUES (?, ?)').run(bucket(key), now);
    if (now - lastPrunedAt > PRUNE_EVERY_MS) {
      lastPrunedAt = now;
      // Nothing older than a day matters to any limiter here.
      await db.prepare('DELETE FROM login_failures WHERE failed_at < ?').run(now - 24 * 60 * 60 * 1000);
    }
  }

  async function recordSuccess(key) {
    await db.prepare('DELETE FROM login_failures WHERE bucket = ?').run(bucket(key));
  }

  return { isRateLimited, recordFailure, recordSuccess };
}

module.exports = { createPersistentLimiter };
