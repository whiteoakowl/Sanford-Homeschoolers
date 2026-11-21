// Admin Help Center (/admin-help) - how to use the Co-op Admin and Main
// Admin portals. Only opens for admins (see routes/admin-help.js).
//
// AUDIENCES:
//   coop_admin  Co-op Admin role (or the master account)
//   main_admin  Main Admin role (or the master account)
// Main Admin articles also name the page permission they document
// (manage_members, manage_finances, ...), so an admin only sees help for
// the Main Admin pages their admin position can open. The master account
// sees everything.
const { hasCoopAdminAccess } = require('../../middleware/requireAdmin');
const { createHelpCenter } = require('./engine');

function isMainAdmin(req) {
  return !!(req.isMasterAccount || (req.portalRoles || []).some((r) => r.key === 'main_admin'));
}

function isAdmin(req) {
  return isMainAdmin(req) || hasCoopAdminAccess(req);
}

function viewerFromRequest(req) {
  const audiences = new Set();
  if (hasCoopAdminAccess(req)) audiences.add('coop_admin');
  if (isMainAdmin(req)) audiences.add('main_admin');
  return { audiences, permissions: req.portalPermissions || new Set(), allPermissions: !!req.isMasterAccount };
}

module.exports = createHelpCenter({
  name: 'Admin Help Center',
  categories: [
    require('./admin-content/coop-getting-started'),
    require('./admin-content/coop-operations'),
    require('./admin-content/coop-classes'),
    require('./admin-content/coop-people'),
    require('./admin-content/all-admins'),
    require('./admin-content/main-getting-started'),
    require('./admin-content/main-members'),
    require('./admin-content/main-accounting'),
    require('./admin-content/main-communication-events'),
    require('./admin-content/main-content'),
    require('./admin-content/main-site'),
  ],
  faqs: require('./admin-content/faq'),
  audiences: ['coop_admin', 'main_admin'],
  viewerFromRequest,
});
module.exports.isAdmin = isAdmin;
module.exports.isMainAdmin = isMainAdmin;
