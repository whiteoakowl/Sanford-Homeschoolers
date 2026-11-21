// Security audit: the walk-up kiosk screens (/kiosk check-in/out and Find
// a Parent, /absence, /name-tag, /volunteers, /setup, /training) were
// built for tablets inside the building, with no sign-in. Once the app
// moved to the public internet (Netlify) that meant anyone, anywhere,
// could open /absence and read every parent's and child's name, or
// type 6-digit member codes into the check-in/out and Find a Parent
// endpoints to check children in/out remotely or learn where a parent
// will be and when.
//
// These pages now open only for:
//   - anyone signed in with a member account (parents can still report
//     an absence from home, teachers can still use their QR links), or
//   - a device that has been unlocked once with the Class Check-In PIN
//     (GET/POST /kiosk/unlock, or the existing Class Check-In unlock).
//     The unlock is stored in that device's session, which lasts until
//     it's cleared, so a kiosk tablet only needs it once.
//
// KIOSK_OPEN_ACCESS=1 turns this off - ONLY for a building-network-only
// install (README's LAN kiosk setup) that the internet can't reach.
function kioskOpenAccess() {
  return process.env.KIOSK_OPEN_ACCESS === '1';
}

function isKioskDevice(req) {
  return kioskOpenAccess() || !!req.portalAccount || !!(req.session && req.session.kioskDeviceUnlocked);
}

// Paths under the gated prefixes that must stay reachable: the unlock
// screen itself, the PIN check used to leave full-screen mode, and Class
// Check-In (which already has its own PIN gate and, once unlocked there,
// also unlocks the device).
const EXEMPT_PREFIXES = ['/kiosk/unlock', '/kiosk/fullscreen/verify-pin', '/kiosk/class-checkin'];

function requireKioskDevice(req, res, next) {
  const pathOnly = req.originalUrl.split('?')[0];
  if (EXEMPT_PREFIXES.some((p) => pathOnly === p || pathOnly.startsWith(p + '/'))) return next();
  if (isKioskDevice(req)) return next();
  const wantsJson = req.method !== 'GET' || (req.headers.accept && req.headers.accept.includes('application/json'));
  if (wantsJson) {
    return res.status(401).json({ ok: false, message: 'This kiosk needs to be unlocked. Reload the page and enter the Class Check-In PIN.' });
  }
  res.redirect('/kiosk/unlock?next=' + encodeURIComponent(req.originalUrl));
}

module.exports = { requireKioskDevice, isKioskDevice, kioskOpenAccess };
