// Gates every /admin/* route - either the single master Admin session
// (req.session.adminId, routes/admin.js's own /admin/login) or a signed-
// in member portal account holding the coop_admin role. See README.md's
// "Admin access model" section for why requireAdmin/requireFullAdmin/
// res.locals.isFullAdmin are functionally identical today, and why all
// three still exist as separate touchpoints anyway.
//
// A real request: "After a member signs in on the homepage, they
// should not be asked again to sign into any portal pages. Not even
// main admin or co-op admin... Nobody should get access to the single
// master admin session. Co-op admin portal shouldn't be locked behind
// that log in either." hasCoopAdminAccess never touches
// req.session.adminId at all - a coop_admin-role member gets into
// /admin entirely on their own portal session, the master Admin
// session stays exclusive to whoever actually signs in as it. The only
// spots in /admin that still need to tell the two apart (changing the
// master Admin's own username/password, the Kiosk/Class-Check-In
// settings, the class chat author name) check req.session.adminId
// directly themselves - see routes/admin.js's own requireMasterAdmin
// and routes/admin-class-schedule.js's own chat handler.
function hasCoopAdminAccess(req) {
  return !!(req.portalRoles && req.portalRoles.some((r) => r.key === 'coop_admin'));
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  if (hasCoopAdminAccess(req)) return next();
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
module.exports.hasCoopAdminAccess = hasCoopAdminAccess;
