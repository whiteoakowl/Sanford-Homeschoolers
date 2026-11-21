// Member Help Center - /help. Signed-in members only. Content in
// utils/helpCenter/content/, filtered by each person's roles and page
// permissions (utils/helpCenter/index.js). Nothing about Main Admin
// tools or the site's internals is documented here - that's the admin
// help center (routes/admin-help.js).
const { createHelpRouter } = require('../utils/helpCenter/router');

const PORTAL_TITLES = { parent: 'Parent Portal', family_school: 'Family School Management', student: 'Student Portal', teacher: 'Co-op Teacher Portal' };

// The member portal menu to show: the one the person came from if they
// have it, otherwise their first member portal.
function navFor(req, res) {
  const keys = new Set((req.portalRoles || []).map((r) => r.key));
  const wanted = req.session.helpPortal;
  if (wanted === 'family_school' && keys.has('parent')) return { portalTitle: PORTAL_TITLES.family_school };
  if (PORTAL_TITLES[wanted] && keys.has(wanted)) return { portalTitle: PORTAL_TITLES[wanted] };
  if (wanted === 'coop_admin' && res.locals.isFullAdmin) return { adminNav: true };
  for (const key of ['parent', 'student', 'teacher']) if (keys.has(key)) return { portalTitle: PORTAL_TITLES[key] };
  if (res.locals.isFullAdmin) return { adminNav: true };
  return { portalTitle: 'Help & Support' };
}

module.exports = createHelpRouter({
  help: require('../utils/helpCenter'),
  basePath: '/help',
  name: 'Help Center',
  intro: 'Answers to common questions about using the co-op website. Search above, or browse a topic below.',
  portalTitle: 'Help & Support',
  navFor,
  suggestions: ['register', 'schedule', 'absence', 'check in', 'password', 'event', 'name tag', 'notifications'],
});
