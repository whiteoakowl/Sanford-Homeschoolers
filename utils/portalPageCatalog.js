// Single source of truth for the portal platform's "which page/subpage
// can this portal view" catalog - a real request: "permission to view
// each of these pages and subpages... this list [on Admins] should
// include all pages and subpages across the website, sectioned by
// portal for easy finding." Drives:
//  - views/main-admin-roles.ejs (the Portal Permissions screen) - each
//    role's own dialog is scoped to ONLY that role's own page catalog
//    (sectionsForRole below).
//  - views/main-admin-admins.ejs (each admin position's own edit
//    dialog) - the FULL combined catalog (adminCatalogSections below),
//    Co-op Admin excluded (see this repo's own scoping notes - it runs
//    on a completely separate legacy login, not this permission model).
//  - views/partials/portal-nav.ejs's own nav filtering, which imports
//    the flat per-portal key sets below rather than re-deriving them.
//
// Every key here must also exist as a row in the `permissions` table -
// see db/bootstrapPg.js's own PORTAL_PERMISSIONS (fresh installs) and
// supabase/migrations/20261226010000_portal_page_permissions.sql (an
// already-deployed database) - both lists are hand-kept in sync with
// this one; nothing here inserts/reads the database itself.
//
// A page entry with `key: null` is a pure grouping label (e.g. Parent
// Portal's "Co-op Classes," whose own bare URL is identical to its
// first subpage's own URL, so there's nothing distinct for a top-level
// checkbox to mean) - rendered as a plain nested heading, never its own
// checkbox. Every other entry's `key` is a real, enforced permission -
// see middleware/portalAuth.js's requirePortalPermission/
// requireAnyPortalPermission and each route file's own guard.
//
// Main Admin's own page list deliberately reuses its EXISTING manage_*
// permission keys (byte-for-byte unchanged - every main-admin-*.js/
// admin-*.js route file already calls requirePortalPermission with
// these exact names) as each page's own top-level key; only the
// subpages (tabs that previously had no permission of their own at all)
// are new keys.
const MAIN_ADMIN_PAGES = [
  { key: 'manage_members', label: 'Members', subpages: [
    { key: 'view_members_approvals', label: 'Approvals' },
    { key: 'view_members_archive', label: 'Archive' },
    { key: 'view_members_locked', label: 'Locked' },
    { key: 'view_members_settings', label: 'Settings' },
  ] },
  { key: 'manage_finances', label: 'Accounting', subpages: [
    { key: 'view_accounting_categories', label: 'Category/Fiscal Year' },
    { key: 'view_accounting_invoices', label: 'Invoices' },
    { key: 'view_accounting_payments', label: 'Payments' },
    { key: 'view_accounting_adjustments', label: 'Adjustments' },
    { key: 'view_accounting_reports', label: 'Reports' },
    { key: 'view_accounting_transactions', label: 'Transactions' },
    { key: 'view_accounting_receipts', label: 'Receipts' },
    { key: 'view_accounting_logs', label: 'Logs' },
    { key: 'view_accounting_settings', label: 'Settings' },
  ] },
  { key: 'send_announcements', label: 'Communication (Announcements)', subpages: [
    { key: 'view_announcements_email', label: 'Email' },
    { key: 'view_announcements_text', label: 'Text' },
  ] },
  { key: 'manage_communications', label: 'Newsletter' },
  { key: 'manage_events', label: 'Events', subpages: [
    { key: 'view_events_drafts', label: 'Drafts' },
    { key: 'view_events_requests', label: 'Requests' },
    { key: 'view_events_attendance', label: 'Event Attendance' },
    { key: 'view_events_registrationlog', label: 'Event Registration Log' },
    { key: 'view_events_settings', label: 'Settings' },
    { key: 'register_guests', label: 'Register Guests' },
  ] },
  { key: 'manage_forum', label: 'Chat', subpages: [
    { key: 'view_forums_rooms', label: 'Chat Rooms' },
    { key: 'view_forums_archive', label: 'Archive' },
  ] },
  { key: 'manage_volunteers', label: 'Volunteers', subpages: [
    { key: 'view_volunteers_signup_lists', label: 'Sign-Up Lists' },
    { key: 'view_volunteers_lists', label: 'Volunteer Lists' },
  ] },
  { key: 'manage_name_tags', label: 'Name Tags', subpages: [
    { key: 'view_name_tags_print', label: 'Print' },
    { key: 'view_name_tags_requests', label: 'Requests' },
  ] },
  // Photos, Publications, and Fun's own "Nature News" subpage already
  // share this one key today (admin-photos.js/admin-publications.js/
  // admin-nature-news.js all gate with manage_publications) - a
  // pre-existing coupling this pass doesn't change, just labels clearly
  // rather than listing the same checkbox three separate times.
  { key: 'manage_publications', label: 'Publications & Photos', subpages: [
    { key: 'view_admin_photos_archive', label: 'Photos Archive' },
  ] },
  { key: 'manage_resources', label: 'Resource Links', subpages: [
    { key: 'view_resource_links_approvals', label: 'Approvals' },
  ] },
  // Business Directory and Member Directory already share this one key
  // today (admin-directory.js/admin-member-directory.js both gate with
  // manage_directory) - same pre-existing-coupling reasoning as Photos/
  // Publications above.
  { key: 'manage_directory', label: 'Business & Member Directory', subpages: [
    { key: 'view_directory_requests', label: 'Requests' },
    { key: 'view_directory_archive', label: 'Archive' },
  ] },
  { key: 'manage_classifieds', label: 'Classifieds', subpages: [
    { key: 'view_classifieds_requests', label: 'Requests' },
    { key: 'view_classifieds_archive', label: 'Archive' },
  ] },
  { key: 'manage_store', label: 'Shop', subpages: [
    { key: 'view_store_orders', label: 'Orders' },
    { key: 'view_store_archived', label: 'Archived' },
    { key: 'view_store_analytics', label: 'Analytics' },
    { key: 'view_store_settings', label: 'Settings' },
  ] },
  { key: 'manage_forms', label: 'Custom Forms' },
  { key: 'manage_babysitters', label: 'Babysitters', subpages: [
    { key: 'view_babysitters_approvals', label: 'Approvals' },
    { key: 'view_babysitters_settings', label: 'Settings' },
  ] },
  { key: 'manage_annual_calendar', label: 'Annual Calendar' },
  // Had no permission key at all before this pass (routes/main-admin-
  // family-school.js only ever checked requirePortal('main_admin')) -
  // both of these are genuinely new.
  { key: 'view_family_school_main_admin', label: 'Family School Management (Transcripts)', subpages: [
    { key: 'view_family_school_diplomas_main_admin', label: 'Diplomas' },
  ] },
  { key: 'manage_training', label: 'Training' },
  { key: 'manage_website', label: 'Website & FAQ' },
  { key: 'manage_documents', label: 'Documents' },
  { key: 'manage_sections', label: 'Sections' },
  { key: 'view_audit_log', label: 'Audit Log' },
  { key: 'manage_users', label: 'Admins & Users' },
  { key: 'manage_roles', label: 'Portal Permissions (Roles)' },
  { key: 'manage_classes', label: 'Classes' },
  { key: 'manage_registrations', label: 'Registrations' },
  // Nature News's own bare page reuses manage_publications (see
  // Publications & Photos above) - only its 5 sibling subpages
  // (routes/main-admin-fun.js) ever lacked a permission of their own.
  { key: null, label: 'Fun', subpages: [
    { key: 'manage_publications', label: 'Nature News' },
    { key: 'view_fun_student_reading_challenge', label: 'Student Reading Challenge' },
    { key: 'view_fun_parent_reading_challenge', label: 'Parent Reading Challenge' },
    { key: 'view_fun_games', label: 'Games' },
    { key: 'view_fun_vocabulary_game', label: 'Vocabulary Game' },
    { key: 'view_fun_pets', label: 'Pets' },
  ] },
];

// Parent Portal's own page catalog - see views/partials/portal-nav.ejs's
// PARENT_NAV_LINKS, the exact source this list mirrors (Home excluded -
// a portal's own Home/dashboard is always reachable, never gated, so a
// locked-out admin can still navigate; same for every other portal
// below).
const PARENT_PAGES = [
  { key: 'view_parent_events', label: 'Events' },
  { key: null, label: 'Co-op Classes', subpages: [
    { key: 'view_parent_classes', label: 'Class Registration' },
    { key: 'view_parent_classroom_dashboard', label: 'Classroom Dashboard' },
    { key: 'view_parent_name_tag_form', label: 'Name Tag Form' },
    { key: 'view_parent_absence_form', label: 'Absence/Late Form' },
    { key: 'view_parent_handbook', label: 'Policy Handbook' },
  ] },
  { key: 'view_parent_chat', label: 'Chat' },
  { key: 'view_parent_training', label: 'Training' },
  { key: 'view_parent_directory', label: 'Business Directory' },
  { key: 'view_parent_classifieds', label: 'Classifieds' },
  { key: 'view_parent_resources', label: 'Resources' },
  { key: 'view_parent_documents', label: 'Documents' },
  { key: 'view_parent_store', label: 'Store' },
  { key: 'view_parent_photos', label: 'Photos' },
  { key: 'view_parent_name_tags', label: 'Name Tags' },
  { key: 'view_parent_babysitters', label: 'Babysitters' },
  { key: 'view_parent_library', label: 'Library' },
  { key: 'view_parent_reading', label: 'Reading Challenge' },
  { key: 'view_parent_accounting', label: 'Accounting' },
];

// Family School Management - its own portal card for the same 'parent'
// role (routes/portal-auth.js's expandPortalRoles) - see
// FAMILY_SCHOOL_NAV_LINKS.
const FAMILY_SCHOOL_PAGES = [
  { key: 'view_fsm_classes', label: 'Family Classes' },
  { key: 'view_fsm_grades', label: 'Family Grades' },
  { key: 'view_fsm_attendance', label: 'Family Attendance' },
  { key: 'view_fsm_journal', label: 'Daily Learning Log' },
  { key: 'view_fsm_volunteer_hours', label: 'Volunteer Hours' },
  { key: 'view_fsm_annual_planner', label: 'Annual Planner' },
  { key: 'view_fsm_weekly_planner', label: 'Weekly Planner' },
  { key: 'view_fsm_transcripts', label: 'Transcripts' },
  { key: 'view_fsm_diplomas', label: 'Diplomas' },
  { key: 'view_fsm_portfolio', label: 'Portfolio' },
];

// Co-op Teacher Portal - see TEACHER_NAV_LINKS.
const TEACHER_PAGES = [
  { key: 'view_teacher_attendance', label: 'Attendance' },
  { key: 'view_teacher_classes', label: 'Class Schedule' },
  { key: 'view_teacher_training', label: 'Training' },
  { key: 'view_teacher_assignments', label: 'Assignments' },
  { key: 'view_teacher_chat', label: 'Chat' },
  { key: 'view_teacher_photos', label: 'Photos' },
  { key: 'view_teacher_instructor_profile', label: 'Instructor Profile' },
];

// Student Portal - see STUDENT_NAV_LINKS. Chat is listed once, nested
// under Classroom Dashboard (same URL/key the standalone Chat tab also
// points at - listing the same permission's checkbox twice in one
// dialog would let the two get out of sync until the next page load, so
// this catalog lists every key exactly once).
const STUDENT_PAGES = [
  { key: null, label: 'Events', subpages: [
    { key: 'view_student_events', label: 'Calendar' },
    { key: 'view_student_event_registrations', label: 'My Event Registrations' },
  ] },
  { key: 'view_student_classes', label: 'Co-op Schedule' },
  { key: null, label: 'Classroom Dashboard', subpages: [
    { key: 'view_student_classes_dashboard', label: 'Classes' },
    { key: 'view_student_grades', label: 'Grades' },
    { key: 'view_student_attendance', label: 'Attendance' },
    { key: 'view_student_weekly_planner', label: 'Weekly Planner' },
    { key: 'view_student_chat', label: 'Chat' },
    { key: 'view_student_portfolio', label: 'Portfolio' },
    { key: 'view_student_transcript', label: 'Transcripts' },
  ] },
  { key: 'view_student_resources', label: 'Resources' },
  { key: 'view_student_photos', label: 'Photos' },
  { key: 'view_student_babysitter_profile', label: 'Babysitter Profile' },
];

// Student Portal's own 2nd section, "Activities" - see
// STUDENT_ACTIVITY_LINKS.
const STUDENT_ACTIVITY_PAGES = [
  { key: 'view_student_games', label: 'Games' },
  { key: 'view_student_pets', label: 'Pet' },
  { key: 'view_student_reading', label: 'Reading Challenge' },
  { key: 'view_student_achievements', label: 'Achievements' },
  { key: 'view_student_leaderboard', label: 'Leaderboard' },
  { key: 'view_student_nature_news', label: 'Nature News' },
  { key: 'view_student_vocabulary', label: 'Vocabulary' },
];

// views/main-admin-roles.ejs - each role's dialog scoped to only its own
// portal(s). main_admin and coop_admin are never looked up here (both
// keep their own no-dialog treatment in the view itself).
function sectionsForRole(roleKey) {
  if (roleKey === 'parent') {
    return [
      { title: 'Parent Portal', pages: PARENT_PAGES },
      { title: 'Family School Management', pages: FAMILY_SCHOOL_PAGES },
    ];
  }
  if (roleKey === 'student') {
    return [
      { title: 'Student Portal', pages: STUDENT_PAGES },
      { title: 'Activities', pages: STUDENT_ACTIVITY_PAGES },
    ];
  }
  if (roleKey === 'teacher') {
    return [{ title: 'Co-op Teacher Portal', pages: TEACHER_PAGES }];
  }
  return [];
}

// views/main-admin-admins.ejs - the full combined catalog, every portal
// except Co-op Admin (separate legacy login, out of scope - see this
// repo's own scoping notes).
function adminCatalogSections() {
  return [
    { title: 'Main Admin', pages: MAIN_ADMIN_PAGES },
    { title: 'Parent Portal', pages: PARENT_PAGES },
    { title: 'Family School Management', pages: FAMILY_SCHOOL_PAGES },
    { title: 'Student Portal', pages: STUDENT_PAGES },
    { title: 'Activities', pages: STUDENT_ACTIVITY_PAGES },
    { title: 'Co-op Teacher Portal', pages: TEACHER_PAGES },
  ];
}

// Shared by both main-admin-roles.ejs's and main-admin-admins.ejs's own
// route handlers (routes/main-admin.js) - joins this catalog's plain
// {key,label} data against the real `permissions` table rows (for each
// one's own id/description) and whichever grant set the caller is
// rendering (a role's role_permissions, or one admin position's own
// admin_position_permissions), so the view itself only ever renders
// {label, permId, description, checked} - never touches the catalog or
// the database directly. A page/subpage whose key doesn't exist in
// permissionByKey yet (the seeding migration hasn't run) is skipped
// rather than rendered with a broken checkbox.
function buildSections(sections, permissionByKey, isChecked) {
  function buildItem(entry) {
    const perm = entry.key ? permissionByKey.get(entry.key) : null;
    if (entry.key && !perm) return null;
    const subpages = (entry.subpages || []).map(buildItem).filter(Boolean);
    return {
      label: entry.label,
      permId: perm ? perm.id : null,
      description: perm ? perm.description : '',
      checked: perm ? isChecked(perm.id) : false,
      subpages,
    };
  }
  return sections
    .map((section) => ({ title: section.title, items: section.pages.map(buildItem).filter(Boolean) }))
    .filter((section) => section.items.length > 0);
}

module.exports = {
  MAIN_ADMIN_PAGES,
  PARENT_PAGES,
  FAMILY_SCHOOL_PAGES,
  TEACHER_PAGES,
  STUDENT_PAGES,
  STUDENT_ACTIVITY_PAGES,
  sectionsForRole,
  adminCatalogSections,
  buildSections,
};
