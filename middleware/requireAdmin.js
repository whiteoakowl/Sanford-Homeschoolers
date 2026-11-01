// Gates every /admin/* route behind the single master Admin session. See
// README.md's "Admin access model" section for why this is functionally
// identical to requireFullAdmin.js/res.locals.isFullAdmin today, and why
// all three still exist as separate touchpoints anyway.
const db = require('../db');

// A real request: "After a member signs in on the homepage, they should
// not be asked again to sign into any portal pages... co-op admin."
// routes/portal-auth.js's own POST /login already bridges a fresh
// member login carrying the coop_admin role straight into this same
// session.adminId - this is the matching fallback for a session that
// was already active before that bridge ran (signed in before this
// change shipped, or granted the coop_admin role mid-session), so
// nobody has to sign out and back in to pick it up.
async function bridgeCoopAdminRole(req) {
  if (!req.portalRoles || !req.portalRoles.some((r) => r.key === 'coop_admin')) return false;
  const admin = await db.prepare('SELECT * FROM admins ORDER BY id LIMIT 1').get();
  if (!admin) return false;
  req.session.adminId = admin.id;
  req.session.username = admin.username;
  return true;
}

async function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  // res.locals.isFullAdmin is already computed (server.js's own
  // app.use, mounted ahead of every /admin router) by the time this
  // runs, from session.adminId as it stood before the bridge below can
  // set it - without this, the very first page a just-bridged account
  // lands on would still hide admin-only nav for that one render.
  if (await bridgeCoopAdminRole(req)) { res.locals.isFullAdmin = true; return next(); }
  const wantsJson = req.headers.accept && req.headers.accept.includes('application/json');
  if (wantsJson) return res.status(401).json({ error: 'Not authenticated' });
  // A real bug report: "after adding 4 categories it asks me to log in
  // and then goes to a 404 page." A session that expires mid-use lands
  // its NEXT request here - for a POST (the add-category form's own
  // action, e.g. /admin/accounting/accounting-categories), that's a
  // write-only URL with no GET handler of its own. Re-logging in follows
  // `next` with a plain GET (routes/admin.js's own res.redirect(next)),
  // so replaying a POST-only URL that way 404s outright - only a GET
  // request's own URL is safe to send a signed-in admin straight back to.
  const next_ = req.method === 'GET' ? encodeURIComponent(req.originalUrl) : '';
  res.redirect(next_ ? `/admin/login?next=${next_}` : '/admin/login');
}

module.exports = requireAdmin;
module.exports.bridgeCoopAdminRole = bridgeCoopAdminRole;
