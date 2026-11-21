// Admin Help Center - /admin-help. How to use the Co-op Admin and Main
// Admin portals, every page and setting. Admins only: members are sent
// to the member Help Center instead. Co-op Admins see Co-op Admin help;
// Main Admins see Main Admin help for the pages their position can open.
const { createHelpRouter } = require('../utils/helpCenter/router');
const adminHelp = require('../utils/helpCenter/admin');

module.exports = createHelpRouter({
  help: adminHelp,
  basePath: '/admin-help',
  name: 'Admin Help Center',
  intro: 'Step-by-step guides for running the co-op: every admin page, setting and feature you have access to.',
  portalTitle: 'Admin Help',
  allow: adminHelp.isAdmin,
  suggestions: ['kiosk', 'pin', 'registration window', 'approve', 'invoice', 'payment', 'event', 'print name tags', 'permissions'],
});
