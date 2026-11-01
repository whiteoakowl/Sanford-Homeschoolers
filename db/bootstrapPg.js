// First-boot seeding for a fresh Postgres database - the Postgres
// equivalent of the "Seed a ..." blocks in db/index.js (the SQLite
// version), NOT its "One-time backfill/upgrade" blocks. Those upgrade
// blocks exist only to bring an already-deployed SQLite database that
// predates some feature up to date; a brand new Postgres database created
// from supabase/migrations/*.sql has no pre-existing rows to upgrade in
// the first place, so none of them apply here - see MIGRATION.md.
//
// Schema itself is NOT applied here for a real Supabase/Postgres
// connection - that's the Supabase CLI's job (`supabase db push` /
// migrations), run once per environment, not on every app boot the way
// SQLite's schema.sql is. For the pglite test database, which has no
// separate migration step, the caller (test/pgTestDb.js) applies the
// schema file directly before calling this.
const bcrypt = require('bcryptjs');
const { DEFAULT_LAYOUTS } = require('../utils/nameTagBadge');
const { DEFAULT_LAYOUT: SCHEDULE_CARD_DEFAULT_LAYOUT } = require('../utils/scheduleCardBadge');

async function seedIfMissing(db) {
  const adminCount = (await db.prepare('SELECT COUNT(*) AS c FROM admins').get()).c;
  if (Number(adminCount) === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'changeme123';
    const hash = bcrypt.hashSync(password, 10);
    await db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, hash);
    console.log(`Seeded default admin account "${username}". Change the password after first login.`);
  }

  if (!(await db.prepare("SELECT 1 FROM app_settings WHERE key = 'class_checkin_pin_hash'").get())) {
    const pin = process.env.CLASS_CHECKIN_PIN || '0000';
    const pinHash = bcrypt.hashSync(pin, 10);
    await db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run('class_checkin_pin_hash', pinHash);
    console.log(`Seeded default Class Check-In PIN "${pin}". Change it under Settings after first login.`);
  }

  // volunteer_lists is no longer seeded eagerly here - a real request
  // ("the kiosk can be changed each semester seamlessly") made it
  // semester-scoped (one Monday/Wednesday Floater List per semester, not
  // one forever), so utils/volunteers.js's own getListByDay now creates a
  // day's list (plus its 4 default Hour sections) lazily, the first time
  // it's actually needed for whatever semester is active.

  for (const day of ['monday', 'wednesday']) {
    const existing = await db.prepare('SELECT id FROM class_schedule_hours WHERE day = ?').get(day);
    if (existing) continue;
    for (let i = 1; i <= 4; i++) {
      await db.prepare('INSERT INTO class_schedule_hours (day, position, label) VALUES (?, ?, ?)').run(day, i, `Hour ${i}`);
    }
  }

  for (const memberType of ['student', 'parent', 'admin']) {
    const existing = await db.prepare('SELECT member_type FROM name_tag_templates WHERE member_type = ?').get(memberType);
    if (existing) continue;
    await db
      .prepare('INSERT INTO name_tag_templates (member_type, layout_json) VALUES (?, ?)')
      .run(memberType, JSON.stringify(DEFAULT_LAYOUTS[memberType]));
  }

  for (const badgeType of ['setupCleanup', 'custom']) {
    const existing = await db.prepare('SELECT badge_type FROM misc_badge_templates WHERE badge_type = ?').get(badgeType);
    if (existing) continue;
    await db
      .prepare('INSERT INTO misc_badge_templates (badge_type, layout_json) VALUES (?, ?)')
      .run(badgeType, JSON.stringify(DEFAULT_LAYOUTS[badgeType]));
  }

  const existingScheduleCardTemplate = await db.prepare('SELECT layout_json FROM schedule_card_templates WHERE id = 1').get();
  if (!existingScheduleCardTemplate) {
    await db
      .prepare('INSERT INTO schedule_card_templates (id, layout_json) VALUES (1, ?)')
      .run(JSON.stringify(SCHEDULE_CARD_DEFAULT_LAYOUT));
  }

  // A real request: "make an admin setup/cleanup card with a barcode. if
  // someone doesn't have a setup cleanup card to scan the admin setup/
  // cleanup card can be scanned to bypass the checkout demand for a
  // setup/cleanup card... this card isn't linked to any specific member.
  // its just a general bypass card." A real 'setupCleanup' misc_badges
  // row (see routes/checkout.js's findSetupCleanupBypassBadge use of it)
  // but with task_item_id left NULL - every other row of that badge_type
  // is auto-created 1:1 from a real task_list_items row (utils/
  // taskList.js's upsertTaskBadge), so a NULL task_item_id row is never
  // produced any other way and safely doubles as this row's own marker.
  // Seeded once, like the default admin account/PIN above - not part of
  // the admin-imported/task-derived deck lifecycle (replaceMiscBadges is
  // blocked for 'setupCleanup' server-side - see routes/admin-misc-
  // badges.js), so nothing else ever recreates or touches it once it
  // exists. Shows up in Design > Print > Setup/Cleanup Badges for free,
  // right alongside every real task's own badge.
  const bypassBadgeExists = await db.prepare("SELECT 1 FROM misc_badges WHERE badge_type = 'setupCleanup' AND task_item_id IS NULL").get();
  if (!bypassBadgeExists) {
    const existsCode = db.prepare('SELECT 1 FROM task_list_items WHERE barcode = ?');
    let code;
    do {
      code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    } while (await existsCode.get(code));
    await db
      .prepare('INSERT INTO misc_badges (badge_type, title, description, barcode) VALUES (?, ?, ?, ?)')
      .run(
        'setupCleanup',
        'Setup/Cleanup Bypass Card',
        "Scan this instead of a member's own Setup/Cleanup badge at checkout when they don't have theirs to scan. Not tied to any specific member or task.",
        code
      );
    console.log('Seeded a general Setup/Cleanup bypass badge for checkout (Design > Print > Setup/Cleanup Badges).');
  }

  const leadershipCount = (await db.prepare('SELECT COUNT(*) AS c FROM leadership_contacts').get()).c;
  if (Number(leadershipCount) === 0) {
    const roles = ['Director', 'Assistant Director', 'Co-op Classes', 'Finance Team', 'Events Coordinator', 'Yearbook Team'];
    for (let i = 0; i < roles.length; i++) {
      await db.prepare('INSERT INTO leadership_contacts (role, position) VALUES (?, ?)').run(roles[i], i);
    }
  }

  await seedPortalPlatform(db);
}

// The five starter portal roles, the permission catalog Main Admin can
// grant to any role, and one bootstrapped Main Admin account - without
// this, nobody could ever reach the Main Admin Portal to grant that role
// to anyone else in the first place. Same "seed once on a fresh database"
// pattern as the rest of seedIfMissing above, not a repeatable backfill.
// Each description below is the user's own exact wording from a real
// request ("Add description under each portal title. On choose portal
// page...") - see views/portal-switcher.ejs's own comment on why this
// field (already selected by utils/portalAuth.js's rolesForAccount) went
// unrendered there for a while.
const PORTAL_ROLES = [
  { key: 'parent', label: 'Parent', description: 'Class registration, event registration, family homeschool management, etc.', isSystem: true },
  { key: 'student', label: 'Student', description: 'View and complete lessons, chat with friends. Challenges, play games etc.', isSystem: true },
  // A real request: "Teacher portal should be called co-op teacher
  // portal." label renamed to match (parallel to 'Co-op Admin' just
  // below) - the in-portal nav shell itself (middleware/portalAuth.js's
  // own sharedPortalTitle, every teacher-*.ejs view's own portalTitle)
  // says the fuller "Co-op Teacher Portal".
  { key: 'teacher', label: 'Co-op Teacher', description: 'Attendance, manage classes. Lesson plans. Etc.', isSystem: true },
  { key: 'coop_admin', label: 'Co-op Admin', description: 'Co-op classes, schedules, floaters, name tags, attendance etc.', isSystem: true },
  { key: 'main_admin', label: 'Main Admin', description: 'Group management, events, chat groups, approvals, website settings etc.', isSystem: true },
];

// A real request: "these permissions should not be about being able to
// manage these different pages and elements. It should be permission to
// view each of these pages and subpages." Every one of Main Admin's own
// existing keys below keeps its exact name (every main-admin-*.js/
// admin-*.js route file already calls requirePortalPermission with it by
// name - renaming any of them would break that gate) - only their own
// label/description text was reworded toward "view this page," and each
// now carries a `portal` tag (used by utils/portalPageCatalog.js to
// group views/main-admin-admins.ejs's combined catalog by portal).
// Everything from view_parent_events onward is new - one key per page/
// subpage a Parent/Family School/Co-op Teacher/Student portal account
// can view, added alongside the existing Main-Admin-only keys rather
// than replacing them. See utils/portalPageCatalog.js's own header
// comment for the full page catalog these keys back, and
// supabase/migrations/20261226010000_portal_page_permissions.sql for how
// an already-deployed database gets these same rows (this array only
// ever runs against a brand-new one - see seedPortalPlatform below).
const PORTAL_PERMISSIONS = [
  { key: 'manage_users', label: 'View Users', description: 'View the Users & Approvals page: member accounts, role assignments, and the approval queue.', portal: 'main_admin' },
  { key: 'manage_roles', label: 'View Roles & Permissions', description: 'View the Portal Permissions page and control which permissions each role grants.', portal: 'main_admin' },
  { key: 'manage_website', label: 'View Website Settings', description: 'View and edit the public homepage, announcements, and FAQs pages.', portal: 'main_admin' },
  { key: 'manage_classes', label: 'View Classes', description: 'View the Classes page: capacity, registration windows, and class details.', portal: 'main_admin' },
  { key: 'manage_registrations', label: 'View Registrations', description: "View and adjust members' class registrations.", portal: 'main_admin' },
  { key: 'manage_events', label: 'View Events', description: 'View the Events page: event details, volunteer signups, and donation requests.', portal: 'main_admin' },
  { key: 'manage_volunteers', label: 'View Volunteers', description: 'View the Volunteers page: committees, sign-up lists, and volunteer lists.', portal: 'main_admin' },
  { key: 'manage_classifieds', label: 'View Classifieds', description: 'View the Classifieds page: listing approvals, archive, and moderation.', portal: 'main_admin' },
  { key: 'manage_finances', label: 'View Accounting', description: 'View the Accounting page: charges, payments, and refunds.', portal: 'main_admin' },
  { key: 'manage_store', label: 'View Shop', description: 'View the Shop page: products, inventory, and orders.', portal: 'main_admin' },
  { key: 'manage_forum', label: 'View Chat', description: 'View the Chat page: categories, threads, and posts.', portal: 'main_admin' },
  { key: 'manage_forms', label: 'View Custom Forms', description: 'View the Custom Forms page: form builder and submissions.', portal: 'main_admin' },
  { key: 'manage_training', label: 'View Training', description: 'View the Training page: courses, lessons, and assignments.', portal: 'main_admin' },
  { key: 'manage_documents', label: 'View Documents', description: 'View the Documents page: uploaded and organized shared documents.', portal: 'main_admin' },
  { key: 'manage_publications', label: 'View Publications & Photos', description: 'View the Publications and Photos pages: articles, publications, and photo albums.', portal: 'main_admin' },
  { key: 'manage_directory', label: 'View Business & Member Directory', description: 'View the Business Directory and Member Directory pages.', portal: 'main_admin' },
  { key: 'manage_communications', label: 'View Communications', description: 'View the Communications page: the newsletter and notification settings.', portal: 'main_admin' },
  { key: 'view_audit_log', label: 'View Audit Log', description: 'View the record of financial changes, moderation, and deletions across the app.', portal: 'main_admin' },
  { key: 'manage_members', label: 'View Members', description: 'View the Members page: the member/family roster.', portal: 'main_admin' },
  { key: 'send_announcements', label: 'View Announcements', description: 'View the Announcements page and compose/send announcements to members.', portal: 'main_admin' },
  { key: 'manage_resources', label: 'View Resource Links', description: 'View the Resource Links page shown on member portals.', portal: 'main_admin' },
  { key: 'manage_babysitters', label: 'View Babysitters', description: 'View the Babysitters page: profile submissions and edits.', portal: 'main_admin' },
  { key: 'manage_sections', label: 'View Sections', description: 'View the Sections page used to restrict events/classes to specific groups.', portal: 'main_admin' },
  { key: 'manage_name_tags', label: 'View Name Tags', description: 'View the Name Tags page: design, print, and requests.', portal: 'main_admin' },
  { key: 'register_guests', label: 'Register Guests', description: 'Register a non-member guest for an event.', portal: 'main_admin' },
  { key: 'manage_annual_calendar', label: 'View Annual Calendar', description: 'View the Annual Calendar page: fiscal-year calendars and color-coded dates.', portal: 'main_admin' },

  // Main Admin subpages/tabs that had no permission of their own before
  // this pass (only the one blanket page-level key above gated the
  // whole feature) - see utils/portalPageCatalog.js's MAIN_ADMIN_PAGES.
  { key: 'view_members_approvals', label: 'View Members: Approvals', description: 'View the Members page’s Approvals tab.', portal: 'main_admin' },
  { key: 'view_members_archive', label: 'View Members: Archive', description: 'View the Members page’s Archive tab.', portal: 'main_admin' },
  { key: 'view_members_locked', label: 'View Members: Locked', description: 'View the Members page’s Locked tab.', portal: 'main_admin' },
  { key: 'view_members_settings', label: 'View Members: Settings', description: 'View the Members page’s Settings tab.', portal: 'main_admin' },
  { key: 'view_accounting_categories', label: 'View Accounting: Category/Fiscal Year', description: 'View the Accounting page’s Category/Fiscal Year tab.', portal: 'main_admin' },
  { key: 'view_accounting_invoices', label: 'View Accounting: Invoices', description: 'View the Accounting page’s Invoices tab.', portal: 'main_admin' },
  { key: 'view_accounting_payments', label: 'View Accounting: Payments', description: 'View the Accounting page’s Payments tab.', portal: 'main_admin' },
  { key: 'view_accounting_adjustments', label: 'View Accounting: Adjustments', description: 'View the Accounting page’s Adjustments tab.', portal: 'main_admin' },
  { key: 'view_accounting_reports', label: 'View Accounting: Reports', description: 'View the Accounting page’s Reports tab.', portal: 'main_admin' },
  { key: 'view_accounting_transactions', label: 'View Accounting: Transactions', description: 'View the Accounting page’s Transactions tab.', portal: 'main_admin' },
  { key: 'view_accounting_receipts', label: 'View Accounting: Receipts', description: 'View the Accounting page’s Receipts tab.', portal: 'main_admin' },
  { key: 'view_accounting_logs', label: 'View Accounting: Logs', description: 'View the Accounting page’s Logs tab.', portal: 'main_admin' },
  { key: 'view_accounting_settings', label: 'View Accounting: Settings', description: 'View the Accounting page’s Settings tab.', portal: 'main_admin' },
  { key: 'view_announcements_email', label: 'View Communication: Email', description: 'View the Communication page’s Email tab.', portal: 'main_admin' },
  { key: 'view_announcements_text', label: 'View Communication: Text', description: 'View the Communication page’s Text tab.', portal: 'main_admin' },
  { key: 'view_events_drafts', label: 'View Events: Drafts', description: 'View the Events page’s Drafts tab.', portal: 'main_admin' },
  { key: 'view_events_requests', label: 'View Events: Requests', description: 'View the Events page’s Requests tab.', portal: 'main_admin' },
  { key: 'view_events_attendance', label: 'View Events: Event Attendance', description: 'View the Events page’s Event Attendance tab.', portal: 'main_admin' },
  { key: 'view_events_registrationlog', label: 'View Events: Event Registration Log', description: 'View the Events page’s Event Registration Log tab.', portal: 'main_admin' },
  { key: 'view_events_settings', label: 'View Events: Settings', description: 'View the Events page’s Settings tab.', portal: 'main_admin' },
  { key: 'view_forums_rooms', label: 'View Chat: Chat Rooms', description: 'View the Chat page’s Chat Rooms tab.', portal: 'main_admin' },
  { key: 'view_forums_archive', label: 'View Chat: Archive', description: 'View the Chat page’s Archive tab.', portal: 'main_admin' },
  { key: 'view_volunteers_signup_lists', label: 'View Volunteers: Sign-Up Lists', description: 'View the Volunteers page’s Sign-Up Lists tab.', portal: 'main_admin' },
  { key: 'view_volunteers_lists', label: 'View Volunteers: Volunteer Lists', description: 'View the Volunteers page’s Volunteer Lists tab.', portal: 'main_admin' },
  { key: 'view_name_tags_print', label: 'View Name Tags: Print', description: 'View the Name Tags page’s Print tab.', portal: 'main_admin' },
  { key: 'view_name_tags_requests', label: 'View Name Tags: Requests', description: 'View the Name Tags page’s Requests tab.', portal: 'main_admin' },
  { key: 'view_admin_photos_archive', label: 'View Photos: Archive', description: 'View the Photos page’s Archive tab.', portal: 'main_admin' },
  { key: 'view_resource_links_approvals', label: 'View Resource Links: Approvals', description: 'View the Resource Links page’s Approvals tab.', portal: 'main_admin' },
  { key: 'view_directory_requests', label: 'View Business Directory: Requests', description: 'View the Business Directory page’s Requests tab.', portal: 'main_admin' },
  { key: 'view_directory_archive', label: 'View Business Directory: Archive', description: 'View the Business Directory page’s Archive tab.', portal: 'main_admin' },
  { key: 'view_classifieds_requests', label: 'View Classifieds: Requests', description: 'View the Classifieds page’s Requests tab.', portal: 'main_admin' },
  { key: 'view_classifieds_archive', label: 'View Classifieds: Archive', description: 'View the Classifieds page’s Archive tab.', portal: 'main_admin' },
  { key: 'view_store_orders', label: 'View Shop: Orders', description: 'View the Shop page’s Orders tab.', portal: 'main_admin' },
  { key: 'view_store_archived', label: 'View Shop: Archived', description: 'View the Shop page’s Archived tab.', portal: 'main_admin' },
  { key: 'view_store_analytics', label: 'View Shop: Analytics', description: 'View the Shop page’s Analytics tab.', portal: 'main_admin' },
  { key: 'view_store_settings', label: 'View Shop: Settings', description: 'View the Shop page’s Settings tab.', portal: 'main_admin' },
  { key: 'view_babysitters_approvals', label: 'View Babysitters: Approvals', description: 'View the Babysitters page’s Approvals tab.', portal: 'main_admin' },
  { key: 'view_babysitters_settings', label: 'View Babysitters: Settings', description: 'View the Babysitters page’s Settings tab.', portal: 'main_admin' },
  // Had no permission at all before this pass - routes/main-admin-
  // family-school.js only ever checked requirePortal('main_admin').
  { key: 'view_family_school_main_admin', label: 'View Family School Management (Transcripts)', description: 'View Main Admin’s own Family School Management page (transcript creation).', portal: 'main_admin' },
  { key: 'view_family_school_diplomas_main_admin', label: 'View Family School Management: Diplomas', description: 'View Main Admin’s own Family School Management Diplomas subpage.', portal: 'main_admin' },
  // routes/main-admin-fun.js's own 5 subpages - same "had no permission
  // at all" situation as Family School Management above.
  { key: 'view_fun_student_reading_challenge', label: 'View Fun: Student Reading Challenge', description: 'View the Fun page’s Student Reading Challenge subpage.', portal: 'main_admin' },
  { key: 'view_fun_parent_reading_challenge', label: 'View Fun: Parent Reading Challenge', description: 'View the Fun page’s Parent Reading Challenge subpage.', portal: 'main_admin' },
  { key: 'view_fun_games', label: 'View Fun: Games', description: 'View the Fun page’s Games subpage.', portal: 'main_admin' },
  { key: 'view_fun_vocabulary_game', label: 'View Fun: Vocabulary Game', description: 'View the Fun page’s Vocabulary Game subpage.', portal: 'main_admin' },
  { key: 'view_fun_pets', label: 'View Fun: Pets', description: 'View the Fun page’s Pets subpage.', portal: 'main_admin' },

  // Parent Portal - see utils/portalPageCatalog.js's PARENT_PAGES.
  { key: 'view_parent_events', label: 'View Events', description: 'View the Events page from Parent Portal.', portal: 'parent' },
  { key: 'view_parent_classes', label: 'View Class Registration', description: 'View the Co-op Classes page’s Class Registration subpage.', portal: 'parent' },
  { key: 'view_parent_classroom_dashboard', label: 'View Classroom Dashboard', description: 'View the Co-op Classes page’s Classroom Dashboard subpage.', portal: 'parent' },
  { key: 'view_parent_name_tag_form', label: 'View Name Tag Form', description: 'View the Co-op Classes page’s Name Tag Form subpage.', portal: 'parent' },
  { key: 'view_parent_absence_form', label: 'View Absence/Late Form', description: 'View the Co-op Classes page’s Absence/Late Form subpage.', portal: 'parent' },
  { key: 'view_parent_handbook', label: 'View Policy Handbook', description: 'View the Co-op Classes page’s Policy Handbook subpage.', portal: 'parent' },
  { key: 'view_parent_chat', label: 'View Chat', description: 'View the Chat page from Parent Portal.', portal: 'parent' },
  { key: 'view_parent_training', label: 'View Training', description: 'View the Training page from Parent Portal.', portal: 'parent' },
  { key: 'view_parent_directory', label: 'View Business Directory', description: 'View the Business Directory page from Parent Portal.', portal: 'parent' },
  { key: 'view_parent_classifieds', label: 'View Classifieds', description: 'View the Classifieds page from Parent Portal.', portal: 'parent' },
  { key: 'view_parent_resources', label: 'View Resources', description: 'View the Resources page from Parent Portal.', portal: 'parent' },
  { key: 'view_parent_documents', label: 'View Documents', description: 'View the Documents page from Parent Portal.', portal: 'parent' },
  { key: 'view_parent_store', label: 'View Store', description: 'View the Store page from Parent Portal.', portal: 'parent' },
  { key: 'view_parent_photos', label: 'View Photos', description: 'View the Photos page from Parent Portal.', portal: 'parent' },
  { key: 'view_parent_name_tags', label: 'View Name Tags', description: 'View the Name Tags page from Parent Portal.', portal: 'parent' },
  { key: 'view_parent_babysitters', label: 'View Babysitters', description: 'View the Babysitters page from Parent Portal.', portal: 'parent' },
  { key: 'view_parent_library', label: 'View Library', description: 'View the Library page from Parent Portal.', portal: 'parent' },
  { key: 'view_parent_reading', label: 'View Reading Challenge', description: 'View the Reading Challenge page from Parent Portal.', portal: 'parent' },
  { key: 'view_parent_accounting', label: 'View Accounting', description: 'View the Accounting page from Parent Portal.', portal: 'parent' },

  // Family School Management - see utils/portalPageCatalog.js's
  // FAMILY_SCHOOL_PAGES. Its own portal card is reached via the SAME
  // 'parent' role as Parent Portal above (routes/portal-auth.js's
  // expandPortalRoles), not a separate DB role.
  { key: 'view_fsm_classes', label: 'View Family Classes', description: 'View the Family Classes page.', portal: 'family_school' },
  { key: 'view_fsm_grades', label: 'View Family Grades', description: 'View the Family Grades page.', portal: 'family_school' },
  { key: 'view_fsm_attendance', label: 'View Family Attendance', description: 'View the Family Attendance page.', portal: 'family_school' },
  { key: 'view_fsm_journal', label: 'View Daily Learning Log', description: 'View the Daily Learning Log page.', portal: 'family_school' },
  { key: 'view_fsm_volunteer_hours', label: 'View Volunteer Hours', description: 'View the Volunteer Hours page.', portal: 'family_school' },
  { key: 'view_fsm_annual_planner', label: 'View Annual Planner', description: 'View the Annual Planner page.', portal: 'family_school' },
  { key: 'view_fsm_weekly_planner', label: 'View Weekly Planner', description: 'View the Weekly Planner page.', portal: 'family_school' },
  { key: 'view_fsm_transcripts', label: 'View Transcripts', description: 'View the Transcripts page.', portal: 'family_school' },
  { key: 'view_fsm_diplomas', label: 'View Diplomas', description: 'View the Diplomas page.', portal: 'family_school' },
  { key: 'view_fsm_portfolio', label: 'View Portfolio', description: 'View the Portfolio page.', portal: 'family_school' },

  // Co-op Teacher Portal - see utils/portalPageCatalog.js's
  // TEACHER_PAGES.
  { key: 'view_teacher_attendance', label: 'View Attendance', description: 'View the Attendance page from Co-op Teacher Portal.', portal: 'teacher' },
  { key: 'view_teacher_classes', label: 'View Class Schedule', description: 'View the Class Schedule page from Co-op Teacher Portal.', portal: 'teacher' },
  { key: 'view_teacher_training', label: 'View Training', description: 'View the Training page from Co-op Teacher Portal.', portal: 'teacher' },
  { key: 'view_teacher_assignments', label: 'View Assignments', description: 'View the Assignments page from Co-op Teacher Portal.', portal: 'teacher' },
  { key: 'view_teacher_chat', label: 'View Chat', description: 'View the Chat page from Co-op Teacher Portal.', portal: 'teacher' },
  { key: 'view_teacher_photos', label: 'View Photos', description: 'View the Photos page from Co-op Teacher Portal.', portal: 'teacher' },
  { key: 'view_teacher_instructor_profile', label: 'View Instructor Profile', description: 'View the Instructor Profile page.', portal: 'teacher' },

  // Student Portal - see utils/portalPageCatalog.js's STUDENT_PAGES.
  { key: 'view_student_events', label: 'View Calendar', description: 'View the Events page’s Calendar subpage from Student Portal.', portal: 'student' },
  { key: 'view_student_event_registrations', label: 'View My Event Registrations', description: 'View the Events page’s My Event Registrations subpage.', portal: 'student' },
  { key: 'view_student_classes', label: 'View Co-op Schedule', description: 'View the Co-op Schedule page.', portal: 'student' },
  { key: 'view_student_classes_dashboard', label: 'View Classroom Dashboard: Classes', description: 'View the Classroom Dashboard page’s Classes subpage.', portal: 'student' },
  { key: 'view_student_grades', label: 'View Classroom Dashboard: Grades', description: 'View the Classroom Dashboard page’s Grades subpage.', portal: 'student' },
  { key: 'view_student_attendance', label: 'View Classroom Dashboard: Attendance', description: 'View the Classroom Dashboard page’s Attendance subpage.', portal: 'student' },
  { key: 'view_student_weekly_planner', label: 'View Classroom Dashboard: Weekly Planner', description: 'View the Classroom Dashboard page’s Weekly Planner subpage.', portal: 'student' },
  { key: 'view_student_chat', label: 'View Chat', description: 'View the Chat page from Student Portal.', portal: 'student' },
  { key: 'view_student_portfolio', label: 'View Portfolio', description: 'View the Classroom Dashboard page’s Portfolio subpage.', portal: 'student' },
  { key: 'view_student_transcript', label: 'View Transcripts', description: 'View the Classroom Dashboard page’s Transcripts subpage.', portal: 'student' },
  { key: 'view_student_resources', label: 'View Resources', description: 'View the Resources page from Student Portal.', portal: 'student' },
  { key: 'view_student_photos', label: 'View Photos', description: 'View the Photos page from Student Portal.', portal: 'student' },
  { key: 'view_student_babysitter_profile', label: 'View Babysitter Profile', description: 'View the Babysitter Profile page.', portal: 'student' },

  // Student Portal's own "Activities" section - see
  // utils/portalPageCatalog.js's STUDENT_ACTIVITY_PAGES.
  { key: 'view_student_games', label: 'View Games', description: 'View the Games page.', portal: 'student' },
  { key: 'view_student_pets', label: 'View Pet', description: 'View the Pet page.', portal: 'student' },
  { key: 'view_student_reading', label: 'View Reading Challenge', description: 'View the Reading Challenge page from Student Portal.', portal: 'student' },
  { key: 'view_student_achievements', label: 'View Achievements', description: 'View the Achievements page.', portal: 'student' },
  { key: 'view_student_leaderboard', label: 'View Leaderboard', description: 'View the Leaderboard page.', portal: 'student' },
  { key: 'view_student_nature_news', label: 'View Nature News', description: 'View the Nature News page from Student Portal.', portal: 'student' },
  { key: 'view_student_vocabulary', label: 'View Vocabulary', description: 'View the Vocabulary page.', portal: 'student' },
];

// Beyond Main Admin (which gets every permission below, unchanged - see
// the mainAdminRoleId loop below), each portal-scoped permission above
// is granted by default to whichever role already has unrestricted
// access to that page today, so this ships as a purely additive, zero-
// behavior-change upgrade - nothing newly disappears or 403s for any
// existing account until a Main Admin deliberately unchecks something.
const DEFAULT_GRANT_PORTALS_BY_ROLE = {
  parent: ['parent', 'family_school'],
  teacher: ['teacher'],
  student: ['student'],
};

async function seedPortalPlatform(db) {
  const roleIdByKey = {};
  for (const role of PORTAL_ROLES) {
    const existing = await db.prepare('SELECT id FROM roles WHERE key = ?').get(role.key);
    if (existing) {
      roleIdByKey[role.key] = existing.id;
      continue;
    }
    const info = await db
      .prepare('INSERT INTO roles (key, label, description, is_system) VALUES (?, ?, ?, ?)')
      .run(role.key, role.label, role.description, role.isSystem ? 1 : 0);
    roleIdByKey[role.key] = info.lastInsertRowid;
  }

  const permissionIdByKey = {};
  for (const perm of PORTAL_PERMISSIONS) {
    const existing = await db.prepare('SELECT id FROM permissions WHERE key = ?').get(perm.key);
    if (existing) {
      permissionIdByKey[perm.key] = existing.id;
      continue;
    }
    const info = await db.prepare('INSERT INTO permissions (key, label, description, portal) VALUES (?, ?, ?, ?)').run(perm.key, perm.label, perm.description, perm.portal || null);
    permissionIdByKey[perm.key] = info.lastInsertRowid;
  }

  // Main Admin gets every permission by default (including every
  // portal-scoped one below - harmless, Main Admin doesn't route through
  // those checks, see middleware/portalAuth.js) - every other role starts
  // with only its own portal(s)' default grants (DEFAULT_GRANT_PORTALS_BY_
  // ROLE above), left for a Main Admin to narrow deliberately from the
  // Portal Permissions screen.
  const mainAdminRoleId = roleIdByKey.main_admin;
  for (const key of Object.keys(permissionIdByKey)) {
    await db
      .prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?) ON CONFLICT (role_id, permission_id) DO NOTHING')
      .run(mainAdminRoleId, permissionIdByKey[key]);
  }
  for (const [roleKey, portals] of Object.entries(DEFAULT_GRANT_PORTALS_BY_ROLE)) {
    const roleId = roleIdByKey[roleKey];
    if (!roleId) continue;
    for (const perm of PORTAL_PERMISSIONS) {
      if (!portals.includes(perm.portal)) continue;
      await db
        .prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?) ON CONFLICT (role_id, permission_id) DO NOTHING')
        .run(roleId, permissionIdByKey[perm.key]);
    }
  }

  const anyMainAdmin = await db
    .prepare('SELECT 1 FROM member_account_roles WHERE role_id = ? LIMIT 1')
    .get(mainAdminRoleId);
  if (anyMainAdmin) return;

  const email = process.env.MAIN_ADMIN_EMAIL || 'mainadmin@coop.local';
  const password = process.env.MAIN_ADMIN_PASSWORD || 'changeme123';

  const existsCode = db.prepare('SELECT 1 FROM members WHERE member_code = ?');
  let code;
  do {
    code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  } while (await existsCode.get(code));

  // active = 0 - this isn't a real co-op attendee, just the platform's
  // own bootstrap login, so it must stay out of the existing Co-op Admin
  // Portal's own member-facing lists/counts/exports (Members page,
  // rosters, print sheets) by default, the same way every other
  // already-archived member already does.
  const memberInfo = await db
    .prepare("INSERT INTO members (name, barcode, member_code, member_type, active) VALUES ('Main Admin', ?, ?, 'admin', 0)")
    .run(code, code);
  const passwordHash = bcrypt.hashSync(password, 10);
  const accountInfo = await db
    .prepare(
      "INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text())"
    )
    .run(memberInfo.lastInsertRowid, email, passwordHash);
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountInfo.lastInsertRowid, mainAdminRoleId);

  console.log(`Seeded a Main Admin portal account "${email}" / "${password}". Log in at /login and change the password after first login.`);
}

// Genuine one-time backfill for an ALREADY-DEPLOYED Postgres database -
// unlike seedIfMissing above (fresh-install-only, see this file's own
// header comment), this has to run against a name_tag_templates row that
// already exists, because seedIfMissing only ever inserts that row once,
// the first time the app boots against a brand new database. An install
// that had already seeded its student/parent template before the "logo"
// element was added to DEFAULT_LAYOUTS (utils/nameTagBadge.js) would
// otherwise never pick the logo up on its own - the saved row simply
// isn't touched again after that first insert.
// Only replaces a saved layout wholesale when it still has exactly the
// pre-logo default's own element ids (nobody has customized it in the
// editor yet) - safe to swap in the fully-repositioned new default there.
// Otherwise, so a real admin-customized layout is never silently
// overwritten, this only adds a small logo image element in a free
// corner, leaving every existing element exactly where it is.
const PRE_LOGO_ELEMENT_IDS = {
  student: ['memberCode', 'name', 'grade', 'barcode'],
  parent: ['memberCode', 'name', 'team', 'barcode'],
};

function sameIds(a, b) {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, i) => id === sortedB[i]);
}

// A saved badge/schedule-card layout can predate the { background,
// elements } wrapper - old rows stored a bare elements array instead (see
// utils/nameTagData.js's getTemplate, which already has to unwrap this
// same legacy shape on every read). Every backfill below needs this too:
// checking `layout.elements` against a still-bare array would find
// `undefined` (arrays have no .elements property) and silently skip the
// row forever, exactly the "never went into effect" failure mode this
// whole file exists to avoid.
function normalizeLayout(parsed) {
  return Array.isArray(parsed) ? { background: '#ffffff', backgroundOpacity: 1, elements: parsed } : parsed;
}

async function backfillNameTagLogo(db) {
  for (const memberType of Object.keys(PRE_LOGO_ELEMENT_IDS)) {
    const row = await db.prepare('SELECT layout_json FROM name_tag_templates WHERE member_type = ?').get(memberType);
    if (!row) continue;
    let parsed;
    try {
      parsed = JSON.parse(row.layout_json);
    } catch (err) {
      continue;
    }
    const layout = normalizeLayout(parsed);
    if (!layout.elements || layout.elements.some((el) => el.type === 'image')) continue;

    const newLayout = sameIds(layout.elements.map((el) => el.id), PRE_LOGO_ELEMENT_IDS[memberType])
      ? DEFAULT_LAYOUTS[memberType]
      : {
          ...layout,
          elements: [{ id: 'logo', type: 'image', src: '/img/logo-owl.png', x: 288, y: 4, width: 32, height: 32 }, ...layout.elements],
        };

    await db.prepare('UPDATE name_tag_templates SET layout_json = ? WHERE member_type = ?').run(JSON.stringify(newLayout), memberType);
  }
}

// Genuine one-time backfill for an already-deployed database's EXISTING
// name_tag_templates rows, saved before autoFitText existed on the name
// field (see public/js/name-tag-render-core.js's fitFontSize) - a real
// bug report: a customized template (one that took backfillNameTagLogo's
// "leave everything else as-is" branch above, so it never picked up the
// flag from a fresh DEFAULT_LAYOUTS swap either) kept clipping a longer
// name ("Carson Bell") instead of shrinking it to fit, on both the design
// editor and the actual printed tag, since both render through the same
// shared core. Also covers gradeLevel for the same reason - a real
// follow-up request, since a long grade_level value (utils/nameTagData.js's
// gradeLevelLabel appends "Grade" to every ordinal grade, e.g.
// "Kindergarten" or "12th Grade") can clip exactly the same way an
// unshrunk long name used to. Every OTHER text field (allergies, cleanup
// team, custom text, ...) is left exactly as saved - shrink-to-fit only
// ever made sense as the default for fields whose length genuinely varies
// member to member.
const AUTOFIT_BACKFILL_FIELDS = ['name', 'gradeLevel'];

async function backfillNameTagAutoFit(db) {
  const rows = await db.prepare('SELECT member_type, layout_json FROM name_tag_templates').all();
  for (const row of rows) {
    let layout;
    try {
      layout = normalizeLayout(JSON.parse(row.layout_json));
    } catch (err) {
      continue;
    }
    if (!layout || !Array.isArray(layout.elements)) continue;

    let changed = false;
    const elements = layout.elements.map((el) => {
      if (el.type === 'text' && AUTOFIT_BACKFILL_FIELDS.includes(el.field) && !el.autoFitText) {
        changed = true;
        return { ...el, autoFitText: true };
      }
      return el;
    });
    if (!changed) continue;

    await db.prepare('UPDATE name_tag_templates SET layout_json = ? WHERE member_type = ?').run(JSON.stringify({ ...layout, elements }), row.member_type);
  }
}

// Genuine one-time backfill for an already-deployed database's EXISTING
// 'parent' name_tag_templates row, converting the OLD two-separate-
// element Monday/Wednesday setup-cleanup layout (monday-job +
// wednesday-job, added by backfillParentSetupCleanupDays below) into ONE
// shared element bound to setupCleanupDays - a real follow-up request:
// the two lines should "share a text space" rather than sit as two
// disconnected boxes. Only fires when the old fields are present and the
// new merged field isn't yet (so an install already migrated, or one
// where an admin deliberately customized the layout away from either
// shape, is left alone) - replaces just those two elements, in place at
// the position of whichever is found first, leaving every other
// customization (logo position, memberCode styling, ...) untouched. Runs
// after backfillParentSetupCleanupDays in db/index.js's db.ready chain,
// so by the time this fires every parent template already has at least
// the old two-element shape to migrate from (either it always did, or
// that backfill just added it).
async function backfillParentSetupCleanupMerge(db) {
  const row = await db.prepare("SELECT layout_json FROM name_tag_templates WHERE member_type = 'parent'").get();
  if (!row) return;
  let layout;
  try {
    layout = normalizeLayout(JSON.parse(row.layout_json));
  } catch (err) {
    return;
  }
  if (!layout || !Array.isArray(layout.elements)) return;
  if (layout.elements.some((el) => el.field === 'setupCleanupDays')) return;

  const oldIndex = layout.elements.findIndex((el) => el.field === 'mondaySetupCleanup' || el.field === 'wednesdaySetupCleanup');
  if (oldIndex === -1) return;

  const merged = DEFAULT_LAYOUTS.parent.elements.find((el) => el.field === 'setupCleanupDays');
  if (!merged) return;

  const elements = layout.elements.filter((el) => el.field !== 'mondaySetupCleanup' && el.field !== 'wednesdaySetupCleanup');
  elements.splice(oldIndex, 0, { ...merged });

  await db.prepare("UPDATE name_tag_templates SET layout_json = ? WHERE member_type = 'parent'").run(JSON.stringify({ ...layout, elements }));
}

// Genuine one-time (well, repeat-safe - see below) backfill for an
// already-deployed database's EXISTING 'parent' name_tag_templates row -
// a real bug report: a parent's printed badge showed stray, overlapping
// fragments of team/assignment text bleeding onto the name area, even
// though nothing looked wrong in the design editor's own preview. Root
// cause: this originally only matched the OLD default's exact
// { id: 'team', field: 'cleanupTeam' } shape, deliberately leaving alone
// any cleanupTeam element with a different id on the theory that a
// different id could only mean an admin had deliberately re-added it via
// the "Add Element" picker (utils/nameTagBadge.js's FIELDS_BY_TYPE) and
// wanted it there. That theory is what actually broke here: an admin HAD
// re-added it that way at some point (get a normal auto-generated id, not
// "team"), at a position that predates later layout changes (setupCleanup-
// Days moving to the front of the badge, etc.) and now overlaps whatever
// element currently occupies that spot - invisible in the single-badge
// editor preview when a later element in paint order fully covers it
// there, but peeking out from underneath on a real printed badge once
// that covering element's own autofit shrinks smaller for a particular
// member's actual (shorter) text. cleanupTeam's whole ROLE - showing a
// parent's team info on their badge - is now what setupCleanupDays does
// instead, day-by-day and deduplicated ("Monday - Team 1" / "Wednesday -
// Team 2"), so there's no longer a legitimate reason for a cleanupTeam
// element to exist on a parent name tag at all: this now removes EVERY
// element bound to that field, any id, unconditionally, and cleanupTeam
// is dropped from FIELDS_BY_TYPE.parent (below) so "Add Element" can't
// reintroduce it. Runs on every boot (like every backfill here), so it
// also cleans up any future save that somehow reintroduces one.
async function backfillParentRemoveLegacyCleanupTeamElement(db) {
  const row = await db.prepare("SELECT layout_json FROM name_tag_templates WHERE member_type = 'parent'").get();
  if (!row) return;
  let layout;
  try {
    layout = normalizeLayout(JSON.parse(row.layout_json));
  } catch (err) {
    return;
  }
  if (!layout || !Array.isArray(layout.elements)) return;
  if (!layout.elements.some((el) => el.field === 'cleanupTeam')) return;

  const elements = layout.elements.filter((el) => el.field !== 'cleanupTeam');

  await db.prepare("UPDATE name_tag_templates SET layout_json = ? WHERE member_type = 'parent'").run(JSON.stringify({ ...layout, elements }));
}

// Genuine one-time backfill for an already-deployed database's EXISTING
// misc_badge_templates 'setupCleanup' row - seedIfMissing (above) only
// ever inserts that row once, the first time the app boots against a
// brand new database, so an install whose row was already seeded before
// the barcode element was added to DEFAULT_LAYOUTS.setupCleanup (utils/
// nameTagBadge.js - lets a parent scan the physical badge at checkout,
// see routes/checkout.js's task-scan step) never picks it up on its own.
// A real bug report: the barcode simply never appeared on a Setup/
// Cleanup badge's design preview OR its printed card, because both
// render the same saved template (routes/admin-misc-badges.js's print
// route, and the Design tab's own preview). Only adds a barcode element
// when the saved layout has none at all, leaving every other
// customization untouched - 'custom' is deliberately excluded, since its
// own default has no barcode element and isn't meant to be scanned (see
// utils/miscBadgeData.js's own miscBadgeRowData comment).
async function backfillMiscBadgeBarcode(db) {
  const row = await db.prepare("SELECT layout_json FROM misc_badge_templates WHERE badge_type = 'setupCleanup'").get();
  if (!row) return;
  let layout;
  try {
    layout = normalizeLayout(JSON.parse(row.layout_json));
  } catch (err) {
    return;
  }
  if (!layout || !Array.isArray(layout.elements)) return;
  if (layout.elements.some((el) => el.type === 'barcode')) return;

  const barcodeDefault = DEFAULT_LAYOUTS.setupCleanup.elements.find((el) => el.type === 'barcode');
  if (!barcodeDefault) return;
  const elements = [...layout.elements, { ...barcodeDefault }];

  await db.prepare("UPDATE misc_badge_templates SET layout_json = ? WHERE badge_type = 'setupCleanup'").run(JSON.stringify({ ...layout, elements }));
}

// Genuine one-time backfill for an already-deployed database's EXISTING
// 'setupCleanup' misc_badge_templates row - a real follow-up request: "the
// description of the tasks, do not reduce the font size to keep it all on
// one line. keep the same font size and simply continue the tasks
// description on the next line below it." DEFAULT_LAYOUTS.setupCleanup's
// own 'task'/description element no longer sets autoFitText (see its own
// comment) so a FRESH install already wraps instead of shrinking, but an
// already-saved template (including a customized one) keeps whatever
// autoFitText value it was saved with - this flips it off wherever found,
// leaving every other customization (position, size, color, font, the
// day/team/leader elements' own autoFitText) untouched.
async function backfillSetupCleanupTaskWraps(db) {
  const row = await db.prepare("SELECT layout_json FROM misc_badge_templates WHERE badge_type = 'setupCleanup'").get();
  if (!row) return;
  let layout;
  try {
    layout = normalizeLayout(JSON.parse(row.layout_json));
  } catch (err) {
    return;
  }
  if (!layout || !Array.isArray(layout.elements)) return;
  if (!layout.elements.some((el) => el.field === 'description' && el.autoFitText)) return;

  const elements = layout.elements.map((el) => {
    if (el.field !== 'description' || !el.autoFitText) return el;
    const updated = { ...el };
    delete updated.autoFitText;
    return updated;
  });

  await db.prepare("UPDATE misc_badge_templates SET layout_json = ? WHERE badge_type = 'setupCleanup'").run(JSON.stringify({ ...layout, elements }));
}

// Genuine one-time backfill for an already-deployed database's EXISTING
// misc_badge_templates 'setupCleanup' row - a second, later redesign of
// the same badge. A real bug report, with a screenshot: task text
// overlapping the team name and badge number on the printed card. Fixed
// by dropping the standalone scannable badge_number and the static
// "Setup / Cleanup" org line in favor of day/team name/leader/task, each
// with autoFitText (see DEFAULT_LAYOUTS.setupCleanup's own comment) -
// but that only changes what a BRAND NEW install's row gets seeded with.
// Unlike backfillMiscBadgeBarcode just above (which only ADDS one
// missing element to an otherwise-untouched layout), this replaces the
// WHOLE saved layout - the field set itself changed (day/leaderLabel are
// new; badgeNumber/the static org text are gone), so there's no old
// element positioning left worth preserving once the fields it was
// built around no longer exist on this badge. Detects "still on the old
// shape" by the new day-field element's absence, same as any other
// already-migrated check in this file. 'custom' badges were never part
// of this redesign and are untouched.
async function backfillSetupCleanupBadgeLayout(db) {
  const row = await db.prepare("SELECT layout_json FROM misc_badge_templates WHERE badge_type = 'setupCleanup'").get();
  if (!row) return;
  let layout;
  try {
    layout = normalizeLayout(JSON.parse(row.layout_json));
  } catch (err) {
    return;
  }
  if (!layout || !Array.isArray(layout.elements)) return;
  if (layout.elements.some((el) => el.field === 'day')) return;

  await db
    .prepare("UPDATE misc_badge_templates SET layout_json = ? WHERE badge_type = 'setupCleanup'")
    .run(JSON.stringify(DEFAULT_LAYOUTS.setupCleanup));
}

// Genuine one-time backfill for an already-deployed database's EXISTING
// misc_badge_templates 'setupCleanup' row - a real request: "the task #
// should be in the top right corner of the badge." Same shape as
// backfillMiscBadgeBarcode above (only ADDS one missing element to an
// otherwise-untouched, possibly hand-customized layout) rather than
// backfillSetupCleanupBadgeLayout's whole-layout replace - the task-number
// element is purely additive, nothing else about the existing layout's
// fields changed. Detects "already migrated" by field, not type, since
// 'text' is far too generic a type to check alone.
async function backfillSetupCleanupTaskNumber(db) {
  const row = await db.prepare("SELECT layout_json FROM misc_badge_templates WHERE badge_type = 'setupCleanup'").get();
  if (!row) return;
  let layout;
  try {
    layout = normalizeLayout(JSON.parse(row.layout_json));
  } catch (err) {
    return;
  }
  if (!layout || !Array.isArray(layout.elements)) return;
  if (layout.elements.some((el) => el.field === 'taskNumber')) return;

  const taskNumberDefault = DEFAULT_LAYOUTS.setupCleanup.elements.find((el) => el.field === 'taskNumber');
  if (!taskNumberDefault) return;
  const elements = [...layout.elements, { ...taskNumberDefault }];

  await db.prepare("UPDATE misc_badge_templates SET layout_json = ? WHERE badge_type = 'setupCleanup'").run(JSON.stringify({ ...layout, elements }));
}

// Genuine one-time backfill for an already-deployed database's EXISTING
// misc_badge_templates 'setupCleanup' row - a real request: "Setup/
// cleanup cards should also have their barcode ID number on the card."
// Same additive shape as backfillSetupCleanupTaskNumber above (detects
// by field, not type), plus one extra step: the barcode element's old
// 55px-tall default left no room below it for a new text line within
// the card's fixed 216px height, so this also shrinks it to the new
// 44px default - but only when it still exactly matches the OLD
// default position/size (meaning it was never hand-repositioned); a
// barcode an admin has customized is left exactly where they put it, so
// the new ID line may need a manual nudge there via the Design editor.
async function backfillSetupCleanupBarcodeIdNumber(db) {
  const row = await db.prepare("SELECT layout_json FROM misc_badge_templates WHERE badge_type = 'setupCleanup'").get();
  if (!row) return;
  let layout;
  try {
    layout = normalizeLayout(JSON.parse(row.layout_json));
  } catch (err) {
    return;
  }
  if (!layout || !Array.isArray(layout.elements)) return;
  if (layout.elements.some((el) => el.field === 'barcodeValue')) return;

  const idDefault = DEFAULT_LAYOUTS.setupCleanup.elements.find((el) => el.field === 'barcodeValue');
  if (!idDefault) return;

  const OLD_BARCODE_SHAPE = { x: 68, y: 156, width: 200, height: 55 };
  const elements = layout.elements.map((el) => {
    if (el.type !== 'barcode') return el;
    const matchesOldDefault = ['x', 'y', 'width', 'height'].every((k) => el[k] === OLD_BARCODE_SHAPE[k]);
    return matchesOldDefault ? { ...el, height: 44 } : el;
  });
  elements.push({ ...idDefault });

  await db.prepare("UPDATE misc_badge_templates SET layout_json = ? WHERE badge_type = 'setupCleanup'").run(JSON.stringify({ ...layout, elements }));
}

// Genuine one-time backfill for an already-deployed database's EXISTING
// misc_badges rows for setupCleanup tasks - the redesign above didn't
// just change the template's layout, it SWAPPED what the underlying
// title/description columns mean for these rows (title: task text ->
// team name, description: section title -> task text - see
// upsertTaskBadge's own comment) and added two genuinely new columns,
// day/leader_name, both NULL on any row inserted before this shipped.
// Anything saved before this redesign is stuck showing the OLD meaning
// in the NEW columns - a "Team Name" field showing task text, a "Task"
// field showing a section title - with day/leader always blank.
// Re-stamps every task item's badge from its section's CURRENT team
// link/title, the same derivation utils/taskList.js's own
// badgeContextForSection makes on every real edit - safe to run every
// boot even once already up to date, since it always re-derives from
// the section/team, never from admin-entered badge data (there isn't
// any for these rows - they're wholly computed, unlike a
// misc_badge_templates layout, which a real admin might hand-customize
// and backfillSetupCleanupBadgeLayout above deliberately only touches
// once). Deliberately reimplements that derivation with raw SQL against
// the `db` PARAMETER, rather than requiring utils/taskList.js and calling
// its exported helpers - those are bound to the app's own global db
// singleton (utils/taskList.js's own `require('../db')`), which is
// exactly what every other test in this suite passes in here as `db`
// EXCEPT the ones creating their own isolated test database
// (test/pgTestDb.js's createTestDb) - calling through to the global
// singleton from inside a function that's supposed to operate on a
// caller-supplied db would silently read/write the wrong database
// there, not this backfill's own target.
async function backfillSetupCleanupBadgeFields(db) {
  const items = await db.prepare('SELECT id, description, section_id, barcode FROM task_list_items').all();
  if (items.length === 0) return;
  const sectionContext = new Map();
  for (const item of items) {
    if (!sectionContext.has(item.section_id)) {
      const section = await db.prepare('SELECT * FROM task_list_sections WHERE id = ?').get(item.section_id);
      let ctx = { day: null, teamName: null, leaderName: null };
      if (section && !section.team_id) {
        ctx = { day: section.day, teamName: section.title, leaderName: null };
      } else if (section) {
        const team = await db
          .prepare(
            `SELECT st.title, st.day, m.name AS "leaderName" FROM setup_teams st
             LEFT JOIN members m ON m.id = st.leader_id AND m.active = 1
             WHERE st.id = ?`
          )
          .get(section.team_id);
        ctx = team ? { day: team.day, teamName: team.title, leaderName: team.leaderName || null } : { day: section.day, teamName: section.title, leaderName: null };
      }
      sectionContext.set(item.section_id, ctx);
    }
    const ctx = sectionContext.get(item.section_id);
    const existing = await db.prepare('SELECT id FROM misc_badges WHERE task_item_id = ?').get(item.id);
    if (existing) {
      await db
        .prepare('UPDATE misc_badges SET title = ?, description = ?, day = ?, leader_name = ? WHERE id = ?')
        .run(ctx.teamName, item.description, ctx.day, ctx.leaderName, existing.id);
      continue;
    }
    await db
      .prepare(
        `INSERT INTO misc_badges (badge_type, badge_number, title, description, day, leader_name, barcode, task_item_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run('setupCleanup', item.barcode, ctx.teamName, item.description, ctx.day, ctx.leaderName, item.barcode, item.id);
  }
}

// Genuine one-time backfill for an already-deployed database's EXISTING
// schedule_card_templates row (id=1) - seedIfMissing only ever inserts
// this row once, the first time the app boots against a brand new
// database, so an install whose row was already seeded before "remove
// name and add allergies" landed (utils/scheduleCardBadge.js's own
// DEFAULT_LAYOUT comment) never picked that redesign up - the saved row
// simply isn't touched again after that first insert. A real bug report:
// a production Schedule Card kept showing the member's name with no
// allergy anywhere on it. Removes any leftover "name"-field element (the
// current default no longer has one) and inserts the current default's
// own allergy element, only when the saved layout doesn't already have
// one - safe to run even against a layout with other real customizations
// (tables moved, phone line restyled, ...), since only the name/allergy
// elements themselves are touched.
async function backfillScheduleCardAllergy(db) {
  const row = await db.prepare('SELECT layout_json FROM schedule_card_templates WHERE id = 1').get();
  if (!row) return;
  let layout;
  try {
    layout = normalizeLayout(JSON.parse(row.layout_json));
  } catch (err) {
    return;
  }
  if (!layout || !Array.isArray(layout.elements)) return;
  if (layout.elements.some((el) => el.field === 'allergy')) return;

  const allergyDefault = SCHEDULE_CARD_DEFAULT_LAYOUT.elements.find((el) => el.field === 'allergy');
  if (!allergyDefault) return;
  const elements = [{ ...allergyDefault }, ...layout.elements.filter((el) => el.field !== 'name')];

  await db.prepare('UPDATE schedule_card_templates SET layout_json = ? WHERE id = 1').run(JSON.stringify({ ...layout, elements }));
}

// Genuine one-time backfill for an already-deployed database's EXISTING
// schedule_card_templates row, saved before autoFitText existed on its
// allergy/phone fields (utils/scheduleCardBadge.js's own DEFAULT_LAYOUT) -
// same class of bug as backfillNameTagAutoFit above: a row created by
// backfillScheduleCardAllergy itself (or seeded fresh) before that flag
// was added to the default never picks it up again on its own, so a
// longer allergy note ("Peanut, tree nut, and dairy allergy") could clip
// on the printed Schedule Card instead of shrinking to fit. Every OTHER
// element (the day tables, their labels, ...) is left exactly as saved.
const SCHEDULE_CARD_AUTOFIT_FIELDS = ['allergy', 'primaryParentPhone'];

async function backfillScheduleCardAutoFit(db) {
  const row = await db.prepare('SELECT layout_json FROM schedule_card_templates WHERE id = 1').get();
  if (!row) return;
  let layout;
  try {
    layout = normalizeLayout(JSON.parse(row.layout_json));
  } catch (err) {
    return;
  }
  if (!layout || !Array.isArray(layout.elements)) return;

  let changed = false;
  const elements = layout.elements.map((el) => {
    if (el.type === 'text' && SCHEDULE_CARD_AUTOFIT_FIELDS.includes(el.field) && !el.autoFitText) {
      changed = true;
      return { ...el, autoFitText: true };
    }
    return el;
  });
  if (!changed) return;

  await db.prepare('UPDATE schedule_card_templates SET layout_json = ? WHERE id = 1').run(JSON.stringify({ ...layout, elements }));
}

// Genuine one-time backfill for an already-deployed database's EXISTING
// schedule_card_templates row, saved before this real request: "make the
// lines on the table of the schedule cards black so it stands out more.
// make the font black. make the blue Monday/Wednesday titles stand out
// more." (the font-color part needed no backfill - name-tag-render-
// core.js's renderTableEl now sets it unconditionally, not from a saved
// field). Only touches a table/label element whose color still exactly
// matches the OLD default (the barely-visible #dbe8f5 grid line, the
// muted #2e6da4 day-label) - an admin who already picked their own grid
// line or label color is left alone, same "only touch what still matches
// the retired default" rule every backfill in this file follows.
const SCHEDULE_CARD_OLD_TABLE_BORDER_COLOR = '#dbe8f5';
const SCHEDULE_CARD_OLD_LABEL_COLOR = '#2e6da4';

async function backfillScheduleCardColors(db) {
  const row = await db.prepare('SELECT layout_json FROM schedule_card_templates WHERE id = 1').get();
  if (!row) return;
  let layout;
  try {
    layout = normalizeLayout(JSON.parse(row.layout_json));
  } catch (err) {
    return;
  }
  if (!layout || !Array.isArray(layout.elements)) return;

  let changed = false;
  const elements = layout.elements.map((el) => {
    if (el.type === 'table' && el.borderColor === SCHEDULE_CARD_OLD_TABLE_BORDER_COLOR) {
      changed = true;
      return { ...el, borderColor: '#000000' };
    }
    if (el.type === 'text' && el.field === 'custom' && (el.text === 'Monday' || el.text === 'Wednesday') && el.color === SCHEDULE_CARD_OLD_LABEL_COLOR) {
      changed = true;
      return { ...el, color: '#0b3d91' };
    }
    return el;
  });
  if (!changed) return;

  await db.prepare('UPDATE schedule_card_templates SET layout_json = ? WHERE id = 1').run(JSON.stringify({ ...layout, elements }));
}

// Genuine one-time backfill for an already-deployed database's EXISTING
// schedule_card_templates row, saved under the OLD, cramped spacing (a
// real bug report: "make sure there is some space division between
// Monday and Wednesday schedule. Expand the schedule grids just a bit
// still leaving a strong boarder of space") - the two tables used to sit
// only 2px apart, reading as one continuous grid rather than two
// separate days. Only snaps an element's x/y/width/height back to the
// current default's own values when they still EXACTLY match that old
// layout's known position for that same element id - same "only touch
// what still matches the retired default" rule backfillScheduleCardColors
// above follows, so an admin who already dragged a table/label to their
// own spot (or resized one in the editor) is left untouched.
const SCHEDULE_CARD_OLD_SPACING = {
  allergy: { x: 8, y: 5, width: 210, height: 14 },
  'parent-phone': { x: 222, y: 5, width: 106, height: 14 },
  'mon-label': { x: 8, y: 21, width: 320, height: 11 },
  'mon-table': { x: 8, y: 33, width: 320, height: 82 },
  'wed-label': { x: 8, y: 117, width: 320, height: 11 },
  'wed-table': { x: 8, y: 129, width: 320, height: 79 },
};

async function backfillScheduleCardSpacing(db) {
  const row = await db.prepare('SELECT layout_json FROM schedule_card_templates WHERE id = 1').get();
  if (!row) return;
  let layout;
  try {
    layout = normalizeLayout(JSON.parse(row.layout_json));
  } catch (err) {
    return;
  }
  if (!layout || !Array.isArray(layout.elements)) return;

  let changed = false;
  const elements = layout.elements.map((el) => {
    const old = SCHEDULE_CARD_OLD_SPACING[el.id];
    const current = SCHEDULE_CARD_DEFAULT_LAYOUT.elements.find((d) => d.id === el.id);
    if (!old || !current) return el;
    if (el.x !== old.x || el.y !== old.y || el.width !== old.width || el.height !== old.height) return el;
    changed = true;
    return { ...el, x: current.x, y: current.y, width: current.width, height: current.height };
  });
  if (!changed) return;

  await db.prepare('UPDATE schedule_card_templates SET layout_json = ? WHERE id = 1').run(JSON.stringify({ ...layout, elements }));
}

// The split shape this backfill installs - NOT sourced from
// DEFAULT_LAYOUTS.parent, which now holds the later merged setupCleanupDays
// shape instead (see backfillParentSetupCleanupMerge below). Kept as its
// own historical constant so this backfill still does exactly what it did
// when it first shipped, regardless of how the current default has since
// evolved - the merge backfill is what carries a template the rest of the
// way from here to the current shape.
const LEGACY_PARENT_SETUP_CLEANUP_DAY_ELEMENTS = [
  { id: 'monday-job', type: 'text', field: 'mondaySetupCleanup', x: 8, y: 4, width: 320, height: 15, fontSize: 10, color: '#1c2530', bold: true, align: 'left', valign: 'middle', autoFitText: true },
  { id: 'wednesday-job', type: 'text', field: 'wednesdaySetupCleanup', x: 8, y: 20, width: 320, height: 15, fontSize: 10, color: '#1c2530', bold: true, align: 'left', valign: 'middle', autoFitText: true },
];

// Genuine one-time backfill for an already-deployed database's EXISTING
// 'parent' name_tag_templates row, saved before the Monday/Wednesday
// setup/cleanup job fields existed (utils/nameTagData.js's
// setupCleanupJobLabels) - seedIfMissing only ever inserts a member type's
// row once, so an install whose parent template was already saved (even
// the untouched fresh default, before this feature shipped) never picks
// the new elements up on its own. A real request: those two lines need to
// be the first thing on a parent's badge - prepended to whatever the
// saved layout already has (front of the array is front of the badge,
// since element order is stacking/paint order - see name-tag-render-
// core.js's own comment) rather than appended at the end, so this lands
// them there even for a heavily customized layout, not just a still-
// default one. Only adds them when the saved layout has neither field at
// all (nor the later merged setupCleanupDays field either - see
// backfillParentSetupCleanupMerge below; a fresh install seeded straight
// from the current DEFAULT_LAYOUTS.parent has ONLY that merged field, and
// without this check would otherwise look like it "predates the
// feature" and get the old split fields wrongly re-added on top of it),
// leaving every other customization (including someone who deliberately
// removed the old cleanupTeam field) untouched.
async function backfillParentSetupCleanupDays(db) {
  const row = await db.prepare("SELECT layout_json FROM name_tag_templates WHERE member_type = 'parent'").get();
  if (!row) return;
  let layout;
  try {
    layout = normalizeLayout(JSON.parse(row.layout_json));
  } catch (err) {
    return;
  }
  if (!layout || !Array.isArray(layout.elements)) return;
  if (layout.elements.some((el) => el.field === 'mondaySetupCleanup' || el.field === 'wednesdaySetupCleanup' || el.field === 'setupCleanupDays')) return;

  const elements = [...LEGACY_PARENT_SETUP_CLEANUP_DAY_ELEMENTS.map((el) => ({ ...el })), ...layout.elements];

  await db.prepare("UPDATE name_tag_templates SET layout_json = ? WHERE member_type = 'parent'").run(JSON.stringify({ ...layout, elements }));
}

// Genuine one-time backfill for an already-deployed database's EXISTING
// student/parent name_tag_templates rows - a real request: the name field
// (and, for student, the grade field) should have real room to run a
// bigger font once each was split into 2 stacked lines (utils/
// nameTagData.js's splitNameLines/gradeLevelLabel), not stay pinned at
// the smaller single-line box/font size an older saved template still
// has. Only ever grows height/fontSize UP to at least the current
// DEFAULT_LAYOUTS value for that exact id+field pair, never down - a
// template with a genuinely larger custom size already keeps it, and
// growing a box that was already big enough is a safe no-op (the shared
// height-aware correction in public/js/badge-autofit.js's
// shrinkLinesToFitHeight is the real guarantee against clipping either
// way, this backfill is purely about giving an old install the same
// starting room a fresh install already gets).
const STACKED_SIZING_TARGETS = {
  student: [
    { id: 'name', field: 'name', height: 40, fontSize: 22 },
    { id: 'grade', field: 'gradeLevel', height: 36, fontSize: 16 },
  ],
  parent: [{ id: 'name', field: 'name', height: 40, fontSize: 20 }],
};

async function backfillNameTagStackedSizing(db) {
  for (const memberType of Object.keys(STACKED_SIZING_TARGETS)) {
    const row = await db.prepare('SELECT layout_json FROM name_tag_templates WHERE member_type = ?').get(memberType);
    if (!row) continue;
    let layout;
    try {
      layout = normalizeLayout(JSON.parse(row.layout_json));
    } catch (err) {
      continue;
    }
    if (!layout || !Array.isArray(layout.elements)) continue;

    const targets = STACKED_SIZING_TARGETS[memberType];
    let changed = false;
    const elements = layout.elements.map((el) => {
      const target = targets.find((t) => t.id === el.id && t.field === el.field);
      if (!target || el.type !== 'text') return el;
      const height = Math.max(el.height, target.height);
      const fontSize = Math.max(el.fontSize, target.fontSize);
      if (height === el.height && fontSize === el.fontSize) return el;
      changed = true;
      return { ...el, height, fontSize };
    });
    if (!changed) continue;

    await db.prepare('UPDATE name_tag_templates SET layout_json = ? WHERE member_type = ?').run(JSON.stringify({ ...layout, elements }), memberType);
  }
}

// A real request: "can we not update the template so these features of
// wrap text and shrink to fit will always work no matter what we create?"
// - name-tag-render-core.js's renderTextEl now derives autoFitText/
// autoFitWrap for every BOUND field (anything but 'custom'/'description')
// from the field itself, not from a flag stored in the saved layout - so
// a backfill like backfillNameTagAutoFit/backfillAdminPositionAutoFitWrap
// (which briefly existed here, forcing exactly those two flags onto an
// already-saved admin template's position element) is structurally
// unnecessary for this class of bug going forward: there's no longer a
// flag for a saved template to be missing. A genuinely too-small saved
// box can still leave text tiny at the font-shrink floor, which is what
// backfillNameTagStackedSizing above still exists to grow - but the
// "silently clips instead of shrinking" failure mode itself can no longer
// happen no matter what a template does or doesn't have saved.

// Genuine one-time backfill for an already-deployed database's EXISTING
// task_list_items rows, created before the barcode column existed -
// nothing else ever revisits an old row once it's inserted (utils/
// taskList.js's addItem only assigns a barcode to a NEW row), so without
// this an already-live co-op's existing task list would keep every one
// of its tasks permanently un-scannable. Also creates each backfilled
// task's own Setup/Cleanup badge (see misc_badges.task_item_id's own
// schema comment) - a task created before this feature shipped has no
// badge row at all yet, same as a fresh one only gets one via
// upsertTaskBadge at creation time.
async function backfillTaskItemBarcodes(db) {
  const rows = await db.prepare('SELECT id, description, section_id FROM task_list_items WHERE barcode IS NULL').all();
  if (rows.length === 0) return;
  const existsCode = db.prepare('SELECT 1 FROM task_list_items WHERE barcode = ?');
  for (const row of rows) {
    let code;
    do {
      code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    } while (await existsCode.get(code));
    await db.prepare('UPDATE task_list_items SET barcode = ? WHERE id = ?').run(code, row.id);

    const section = await db.prepare('SELECT title FROM task_list_sections WHERE id = ?').get(row.section_id);
    const existingBadge = await db.prepare('SELECT id FROM misc_badges WHERE task_item_id = ?').get(row.id);
    if (existingBadge) continue;
    await db
      .prepare('INSERT INTO misc_badges (badge_type, badge_number, title, description, barcode, task_item_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run('setupCleanup', code, row.description, section ? section.title : null, code, row.id);
  }
}

// Genuine one-time cleanup for an already-deployed database - a real
// request: "don't suggest floaters. just offer the drop down menu of
// choices that aren't already assigned." substitute_assignments rows left
// in 'pending' status were the now-removed auto-suggest system's own
// non-committal guesses (utils/substitutes.js's substituteBoard no longer
// auto-picks/persists one at all), so any 'pending' row still in the
// table from before this change is stale - never an admin's own decision,
// yet still capable of showing as "Awaiting Approval" (views/admin-
// logs.ejs) or pinning a name into a slot's dropdown that nobody ever
// actually approved. Never touches 'approved' rows - only ever a genuine
// admin decision, made through setAssignment.
async function backfillRemovePendingSubstituteAssignments(db) {
  await db.prepare("DELETE FROM substitute_assignments WHERE status = 'pending'").run();
}

// Main Admin Forms tab upgrade ("full editing features and view just
// like jotform, exactly") - every custom_form_fields row now needs a
// page_id (multi-page/section support, supabase/migrations/20261225010000_
// custom_forms_builder_upgrade.sql), but every form that existed before
// this migration has fields with page_id still NULL and no
// custom_form_pages row to point them at. Gives each such form exactly
// one default page ("Page 1") and reassigns its existing fields to it,
// so an already-published form keeps rendering as a single page, same
// as before this upgrade - new forms never hit this (utils/customForms.js's
// createForm already makes a first page itself).
async function backfillCustomFormDefaultPages(db) {
  const orphanedFormIds = await db.prepare('SELECT DISTINCT form_id AS id FROM custom_form_fields WHERE page_id IS NULL').all();
  for (const { id: formId } of orphanedFormIds) {
    let page = await db.prepare('SELECT id FROM custom_form_pages WHERE form_id = ? ORDER BY position, id LIMIT 1').get(formId);
    if (!page) {
      const info = await db.prepare('INSERT INTO custom_form_pages (form_id, title, position) VALUES (?, ?, 0)').run(formId, 'Page 1');
      page = { id: info.lastInsertRowid };
    }
    await db.prepare('UPDATE custom_form_fields SET page_id = ? WHERE form_id = ? AND page_id IS NULL').run(page.id, formId);
  }
}

module.exports = {
  seedIfMissing,
  backfillNameTagLogo,
  backfillNameTagAutoFit,
  backfillMiscBadgeBarcode,
  backfillSetupCleanupTaskWraps,
  backfillSetupCleanupBadgeLayout,
  backfillSetupCleanupTaskNumber,
  backfillSetupCleanupBarcodeIdNumber,
  backfillSetupCleanupBadgeFields,
  backfillScheduleCardAllergy,
  backfillScheduleCardAutoFit,
  backfillScheduleCardColors,
  backfillScheduleCardSpacing,
  backfillParentSetupCleanupDays,
  backfillParentSetupCleanupMerge,
  backfillParentRemoveLegacyCleanupTeamElement,
  backfillNameTagStackedSizing,
  backfillTaskItemBarcodes,
  backfillRemovePendingSubstituteAssignments,
  backfillCustomFormDefaultPages,
};
