// Member Help Center - /help. Signed-in members only. Content in
// utils/helpCenter/content/, filtered by each person's roles and page
// permissions (utils/helpCenter/index.js). Nothing about Main Admin
// tools or the site's internals is documented here - that's the admin
// help center (routes/admin-help.js).
const { createHelpRouter } = require('../utils/helpCenter/router');

module.exports = createHelpRouter({
  help: require('../utils/helpCenter'),
  basePath: '/help',
  name: 'Help Center',
  intro: 'Answers to common questions about using the co-op website. Search above, or browse a topic below.',
  portalTitle: 'Help & Support',
  suggestions: ['register', 'schedule', 'absence', 'check in', 'password', 'event', 'name tag', 'notifications'],
});
