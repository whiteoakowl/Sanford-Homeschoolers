// Admin Help Center - /admin-help. How to use the Co-op Admin and Main
// Admin portals, every page and setting. Admins only: members are sent
// to the member Help Center instead. Co-op Admins see Co-op Admin help;
// Main Admins see Main Admin help for the pages their position can open.
const { createHelpRouter } = require('../utils/helpCenter/router');
const adminHelp = require('../utils/helpCenter/admin');

// Main Admins coming from Main Admin keep its menu; Co-op Admins (and
// anyone arriving from Co-op Admin) keep the Co-op Admin menu.
function navFor(req) {
  if (req.session.helpPortal === 'coop_admin' && adminHelp.viewerFromRequest(req).audiences.has('coop_admin')) return { adminNav: true };
  if (adminHelp.isMainAdmin(req)) return { portalTitle: 'Main Admin' };
  return { adminNav: true };
}

module.exports = createHelpRouter({
  help: adminHelp,
  basePath: '/admin-help',
  name: 'Admin Help Center',
  intro: 'Step-by-step guides for running the co-op: every admin page, setting and feature you have access to.',
  portalTitle: 'Admin Help',
  allow: adminHelp.isAdmin,
  navFor,
  suggestions: ['kiosk', 'pin', 'registration window', 'approve', 'invoice', 'payment', 'event', 'print name tags', 'permissions'],
});
