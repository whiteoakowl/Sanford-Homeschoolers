// Shared limiter for every place the Class Check-In PIN is typed (kiosk
// unlock, kiosk full-screen exit, admin full-screen exit) - a burst of
// wrong guesses at one counts against all of them. Database-backed (see
// utils/persistentRateLimit.js) so it holds across Netlify instances;
// the PIN is only 4 digits, so a limiter that resets is no limiter.
const { createPersistentLimiter } = require('./persistentRateLimit');

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

const limiter = createPersistentLimiter({ name: 'class-checkin-pin', windowMs: WINDOW_MS, maxAttempts: MAX_ATTEMPTS });

module.exports = { ...limiter, WINDOW_MS, MAX_ATTEMPTS };
