// Customer Help Center engine (routes/help.js). The articles themselves
// live in utils/helpCenter/content/*.js - one file per category - so
// updating help after a UI change means editing plain text there, not
// templates.
//
// AUDIENCES - who an article is for. An article (or FAQ) is shown only
// if the signed-in account has at least one of its audiences:
//   member      every signed-in account
//   parent      Parent Portal role
//   student     Student Portal role
//   teacher     Co-op Teacher Portal role
//   coop_admin  Co-op Admin role (or the master account)
// There is deliberately NO Main Admin audience: this Help Center is for
// families, students, teachers and Co-op Admins only. Main Admin tools,
// and anything about the site's servers, database or setup, are never
// documented here.
//
// An article can also name a `permission` (the same page permission the
// portal menu uses); it then only shows to accounts that can open that
// page.
//
// Article shape:
//   {
//     slug: 'register-for-a-class',          unique, used in the URL
//     title, summary,
//     audiences: ['parent'],
//     permission: 'view_parent_classes',     optional
//     keywords: ['register', 'sign up'],     extra search words
//     body: [ block, ... ]                   see below
//     related: ['other-slug', ...]           optional
//   }
// Body blocks (rendered by views/partials/help-blocks.ejs):
//   { p: 'Paragraph text' }
//   { h: 'Sub-heading' }
//   { steps: ['Step one', 'Step two'] }      numbered
//   { list: ['Item', 'Item'] }               bulleted
//   { tip: 'Helpful note' }
//   { note: 'Important note' }
//   { table: { head: ['A', 'B'], rows: [['1', '2']] } }
// Text may use **bold** for exact on-screen labels; nothing else is
// interpreted (all text is HTML-escaped when shown).
const { hasCoopAdminAccess } = require('../../middleware/requireAdmin');
const { createHelpCenter } = require('./engine');

// The audiences the signed-in account belongs to.
function viewerFromRequest(req) {
  const audiences = new Set(['member']);
  for (const role of req.portalRoles || []) {
    if (['parent', 'student', 'teacher', 'coop_admin'].includes(role.key)) audiences.add(role.key);
  }
  if (hasCoopAdminAccess(req)) audiences.add('coop_admin');
  const isCoopAdmin = audiences.has('coop_admin');
  return { audiences, permissions: req.portalPermissions || new Set(), allPermissions: isCoopAdmin, isCoopAdmin };
}

module.exports = createHelpCenter({
  name: 'Help Center',
  categories: [
    require('./content/getting-started'),
    require('./content/account-profile'),
    require('./content/family'),
    require('./content/membership'),
    require('./content/classes'),
    require('./content/schedules'),
    require('./content/attendance'),
    require('./content/events'),
    require('./content/communication'),
    require('./content/resources'),
    require('./content/volunteers'),
    require('./content/payments'),
    require('./content/name-tags'),
    require('./content/printing'),
    require('./content/family-school'),
    require('./content/students'),
    require('./content/teachers'),
    require('./content/notifications-settings'),
    require('./content/privacy'),
    require('./content/security'),
  ],
  faqs: require('./content/faq'),
  audiences: ['member', 'parent', 'student', 'teacher', 'coop_admin'],
  viewerFromRequest,
});
