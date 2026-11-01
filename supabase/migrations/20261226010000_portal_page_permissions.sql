-- A real request: "Portal permissions... permission to view each of
-- these pages and subpages... This list [on Admins] should include all
-- pages and subpages across the website, sectioned by portal for easy
-- finding." See utils/portalPageCatalog.js for the full page catalog
-- this backs, and middleware/portalAuth.js for how each new key is
-- actually enforced (requirePortalPermission/requireAnyPortalPermission).
-- db/bootstrapPg.js's own PORTAL_PERMISSIONS is kept in sync with this
-- file by hand - a fresh database runs that instead of this file, and
-- must end up with the exact same catalog.

-- Lets each permission be grouped by portal in the UI (views/main-admin-
-- admins.ejs's combined catalog) without guessing from its key/label.
alter table permissions add column if not exists portal text;

-- Existing Main Admin keys keep their exact name (every main-admin-*.js/
-- admin-*.js route file already calls requirePortalPermission with it by
-- name) - only their label/description text and a new portal tag change.
update permissions set label = 'View Users', description = 'View the Users & Approvals page: member accounts, role assignments, and the approval queue.', portal = 'main_admin' where key = 'manage_users';
update permissions set label = 'View Roles & Permissions', description = 'View the Portal Permissions page and control which permissions each role grants.', portal = 'main_admin' where key = 'manage_roles';
update permissions set label = 'View Website Settings', description = 'View and edit the public homepage, announcements, and FAQs pages.', portal = 'main_admin' where key = 'manage_website';
update permissions set label = 'View Classes', description = 'View the Classes page: capacity, registration windows, and class details.', portal = 'main_admin' where key = 'manage_classes';
update permissions set label = 'View Registrations', description = 'View and adjust members'' class registrations.', portal = 'main_admin' where key = 'manage_registrations';
update permissions set label = 'View Events', description = 'View the Events page: event details, volunteer signups, and donation requests.', portal = 'main_admin' where key = 'manage_events';
update permissions set label = 'View Volunteers', description = 'View the Volunteers page: committees, sign-up lists, and volunteer lists.', portal = 'main_admin' where key = 'manage_volunteers';
update permissions set label = 'View Classifieds', description = 'View the Classifieds page: listing approvals, archive, and moderation.', portal = 'main_admin' where key = 'manage_classifieds';
update permissions set label = 'View Accounting', description = 'View the Accounting page: charges, payments, and refunds.', portal = 'main_admin' where key = 'manage_finances';
update permissions set label = 'View Shop', description = 'View the Shop page: products, inventory, and orders.', portal = 'main_admin' where key = 'manage_store';
update permissions set label = 'View Chat', description = 'View the Chat page: categories, threads, and posts.', portal = 'main_admin' where key = 'manage_forum';
update permissions set label = 'View Custom Forms', description = 'View the Custom Forms page: form builder and submissions.', portal = 'main_admin' where key = 'manage_forms';
update permissions set label = 'View Training', description = 'View the Training page: courses, lessons, and assignments.', portal = 'main_admin' where key = 'manage_training';
update permissions set label = 'View Documents', description = 'View the Documents page: uploaded and organized shared documents.', portal = 'main_admin' where key = 'manage_documents';
update permissions set label = 'View Publications & Photos', description = 'View the Publications and Photos pages: articles, publications, and photo albums.', portal = 'main_admin' where key = 'manage_publications';
update permissions set label = 'View Business & Member Directory', description = 'View the Business Directory and Member Directory pages.', portal = 'main_admin' where key = 'manage_directory';
update permissions set label = 'View Communications', description = 'View the Communications page: the newsletter and notification settings.', portal = 'main_admin' where key = 'manage_communications';
update permissions set label = 'View Audit Log', description = 'View the record of financial changes, moderation, and deletions across the app.', portal = 'main_admin' where key = 'view_audit_log';
update permissions set label = 'View Members', description = 'View the Members page: the member/family roster.', portal = 'main_admin' where key = 'manage_members';
update permissions set label = 'View Announcements', description = 'View the Announcements page and compose/send announcements to members.', portal = 'main_admin' where key = 'send_announcements';
update permissions set label = 'View Resource Links', description = 'View the Resource Links page shown on member portals.', portal = 'main_admin' where key = 'manage_resources';
update permissions set label = 'View Babysitters', description = 'View the Babysitters page: profile submissions and edits.', portal = 'main_admin' where key = 'manage_babysitters';
update permissions set label = 'View Sections', description = 'View the Sections page used to restrict events/classes to specific groups.', portal = 'main_admin' where key = 'manage_sections';
update permissions set label = 'View Name Tags', description = 'View the Name Tags page: design, print, and requests.', portal = 'main_admin' where key = 'manage_name_tags';
update permissions set label = 'Register Guests', description = 'Register a non-member guest for an event.', portal = 'main_admin' where key = 'register_guests';
update permissions set label = 'View Annual Calendar', description = 'View the Annual Calendar page: fiscal-year calendars and color-coded dates.', portal = 'main_admin' where key = 'manage_annual_calendar';

-- New permission keys - one row per page/subpage this pass adds a real
-- permission for (Main Admin subpages that previously had none at all,
-- plus every Parent/Family School/Co-op Teacher/Student portal page).
insert into permissions (key, label, description, portal) values
  ('view_members_approvals', 'View Members: Approvals', 'View the Members page’s Approvals tab.', 'main_admin'),
  ('view_members_archive', 'View Members: Archive', 'View the Members page’s Archive tab.', 'main_admin'),
  ('view_members_locked', 'View Members: Locked', 'View the Members page’s Locked tab.', 'main_admin'),
  ('view_members_settings', 'View Members: Settings', 'View the Members page’s Settings tab.', 'main_admin'),
  ('view_accounting_categories', 'View Accounting: Category/Fiscal Year', 'View the Accounting page’s Category/Fiscal Year tab.', 'main_admin'),
  ('view_accounting_invoices', 'View Accounting: Invoices', 'View the Accounting page’s Invoices tab.', 'main_admin'),
  ('view_accounting_payments', 'View Accounting: Payments', 'View the Accounting page’s Payments tab.', 'main_admin'),
  ('view_accounting_adjustments', 'View Accounting: Adjustments', 'View the Accounting page’s Adjustments tab.', 'main_admin'),
  ('view_accounting_reports', 'View Accounting: Reports', 'View the Accounting page’s Reports tab.', 'main_admin'),
  ('view_accounting_transactions', 'View Accounting: Transactions', 'View the Accounting page’s Transactions tab.', 'main_admin'),
  ('view_accounting_receipts', 'View Accounting: Receipts', 'View the Accounting page’s Receipts tab.', 'main_admin'),
  ('view_accounting_logs', 'View Accounting: Logs', 'View the Accounting page’s Logs tab.', 'main_admin'),
  ('view_accounting_settings', 'View Accounting: Settings', 'View the Accounting page’s Settings tab.', 'main_admin'),
  ('view_announcements_email', 'View Communication: Email', 'View the Communication page’s Email tab.', 'main_admin'),
  ('view_announcements_text', 'View Communication: Text', 'View the Communication page’s Text tab.', 'main_admin'),
  ('view_events_drafts', 'View Events: Drafts', 'View the Events page’s Drafts tab.', 'main_admin'),
  ('view_events_requests', 'View Events: Requests', 'View the Events page’s Requests tab.', 'main_admin'),
  ('view_events_attendance', 'View Events: Event Attendance', 'View the Events page’s Event Attendance tab.', 'main_admin'),
  ('view_events_registrationlog', 'View Events: Event Registration Log', 'View the Events page’s Event Registration Log tab.', 'main_admin'),
  ('view_events_settings', 'View Events: Settings', 'View the Events page’s Settings tab.', 'main_admin'),
  ('view_forums_rooms', 'View Chat: Chat Rooms', 'View the Chat page’s Chat Rooms tab.', 'main_admin'),
  ('view_forums_archive', 'View Chat: Archive', 'View the Chat page’s Archive tab.', 'main_admin'),
  ('view_volunteers_signup_lists', 'View Volunteers: Sign-Up Lists', 'View the Volunteers page’s Sign-Up Lists tab.', 'main_admin'),
  ('view_volunteers_lists', 'View Volunteers: Volunteer Lists', 'View the Volunteers page’s Volunteer Lists tab.', 'main_admin'),
  ('view_name_tags_print', 'View Name Tags: Print', 'View the Name Tags page’s Print tab.', 'main_admin'),
  ('view_name_tags_requests', 'View Name Tags: Requests', 'View the Name Tags page’s Requests tab.', 'main_admin'),
  ('view_admin_photos_archive', 'View Photos: Archive', 'View the Photos page’s Archive tab.', 'main_admin'),
  ('view_resource_links_approvals', 'View Resource Links: Approvals', 'View the Resource Links page’s Approvals tab.', 'main_admin'),
  ('view_directory_requests', 'View Business Directory: Requests', 'View the Business Directory page’s Requests tab.', 'main_admin'),
  ('view_directory_archive', 'View Business Directory: Archive', 'View the Business Directory page’s Archive tab.', 'main_admin'),
  ('view_classifieds_requests', 'View Classifieds: Requests', 'View the Classifieds page’s Requests tab.', 'main_admin'),
  ('view_classifieds_archive', 'View Classifieds: Archive', 'View the Classifieds page’s Archive tab.', 'main_admin'),
  ('view_store_orders', 'View Shop: Orders', 'View the Shop page’s Orders tab.', 'main_admin'),
  ('view_store_archived', 'View Shop: Archived', 'View the Shop page’s Archived tab.', 'main_admin'),
  ('view_store_analytics', 'View Shop: Analytics', 'View the Shop page’s Analytics tab.', 'main_admin'),
  ('view_store_settings', 'View Shop: Settings', 'View the Shop page’s Settings tab.', 'main_admin'),
  ('view_babysitters_approvals', 'View Babysitters: Approvals', 'View the Babysitters page’s Approvals tab.', 'main_admin'),
  ('view_babysitters_settings', 'View Babysitters: Settings', 'View the Babysitters page’s Settings tab.', 'main_admin'),
  ('view_family_school_main_admin', 'View Family School Management (Transcripts)', 'View Main Admin’s own Family School Management page (transcript creation).', 'main_admin'),
  ('view_family_school_diplomas_main_admin', 'View Family School Management: Diplomas', 'View Main Admin’s own Family School Management Diplomas subpage.', 'main_admin'),
  ('view_fun_student_reading_challenge', 'View Fun: Student Reading Challenge', 'View the Fun page’s Student Reading Challenge subpage.', 'main_admin'),
  ('view_fun_parent_reading_challenge', 'View Fun: Parent Reading Challenge', 'View the Fun page’s Parent Reading Challenge subpage.', 'main_admin'),
  ('view_fun_games', 'View Fun: Games', 'View the Fun page’s Games subpage.', 'main_admin'),
  ('view_fun_vocabulary_game', 'View Fun: Vocabulary Game', 'View the Fun page’s Vocabulary Game subpage.', 'main_admin'),
  ('view_fun_pets', 'View Fun: Pets', 'View the Fun page’s Pets subpage.', 'main_admin'),
  ('view_parent_events', 'View Events', 'View the Events page from Parent Portal.', 'parent'),
  ('view_parent_classes', 'View Class Registration', 'View the Co-op Classes page’s Class Registration subpage.', 'parent'),
  ('view_parent_classroom_dashboard', 'View Classroom Dashboard', 'View the Co-op Classes page’s Classroom Dashboard subpage.', 'parent'),
  ('view_parent_name_tag_form', 'View Name Tag Form', 'View the Co-op Classes page’s Name Tag Form subpage.', 'parent'),
  ('view_parent_absence_form', 'View Absence/Late Form', 'View the Co-op Classes page’s Absence/Late Form subpage.', 'parent'),
  ('view_parent_handbook', 'View Policy Handbook', 'View the Co-op Classes page’s Policy Handbook subpage.', 'parent'),
  ('view_parent_chat', 'View Chat', 'View the Chat page from Parent Portal.', 'parent'),
  ('view_parent_training', 'View Training', 'View the Training page from Parent Portal.', 'parent'),
  ('view_parent_directory', 'View Business Directory', 'View the Business Directory page from Parent Portal.', 'parent'),
  ('view_parent_classifieds', 'View Classifieds', 'View the Classifieds page from Parent Portal.', 'parent'),
  ('view_parent_resources', 'View Resources', 'View the Resources page from Parent Portal.', 'parent'),
  ('view_parent_documents', 'View Documents', 'View the Documents page from Parent Portal.', 'parent'),
  ('view_parent_store', 'View Store', 'View the Store page from Parent Portal.', 'parent'),
  ('view_parent_photos', 'View Photos', 'View the Photos page from Parent Portal.', 'parent'),
  ('view_parent_name_tags', 'View Name Tags', 'View the Name Tags page from Parent Portal.', 'parent'),
  ('view_parent_babysitters', 'View Babysitters', 'View the Babysitters page from Parent Portal.', 'parent'),
  ('view_parent_library', 'View Library', 'View the Library page from Parent Portal.', 'parent'),
  ('view_parent_reading', 'View Reading Challenge', 'View the Reading Challenge page from Parent Portal.', 'parent'),
  ('view_parent_accounting', 'View Accounting', 'View the Accounting page from Parent Portal.', 'parent'),
  ('view_fsm_classes', 'View Family Classes', 'View the Family Classes page.', 'family_school'),
  ('view_fsm_grades', 'View Family Grades', 'View the Family Grades page.', 'family_school'),
  ('view_fsm_attendance', 'View Family Attendance', 'View the Family Attendance page.', 'family_school'),
  ('view_fsm_journal', 'View Daily Learning Log', 'View the Daily Learning Log page.', 'family_school'),
  ('view_fsm_volunteer_hours', 'View Volunteer Hours', 'View the Volunteer Hours page.', 'family_school'),
  ('view_fsm_annual_planner', 'View Annual Planner', 'View the Annual Planner page.', 'family_school'),
  ('view_fsm_weekly_planner', 'View Weekly Planner', 'View the Weekly Planner page.', 'family_school'),
  ('view_fsm_transcripts', 'View Transcripts', 'View the Transcripts page.', 'family_school'),
  ('view_fsm_diplomas', 'View Diplomas', 'View the Diplomas page.', 'family_school'),
  ('view_fsm_portfolio', 'View Portfolio', 'View the Portfolio page.', 'family_school'),
  ('view_teacher_attendance', 'View Attendance', 'View the Attendance page from Co-op Teacher Portal.', 'teacher'),
  ('view_teacher_classes', 'View Class Schedule', 'View the Class Schedule page from Co-op Teacher Portal.', 'teacher'),
  ('view_teacher_training', 'View Training', 'View the Training page from Co-op Teacher Portal.', 'teacher'),
  ('view_teacher_assignments', 'View Assignments', 'View the Assignments page from Co-op Teacher Portal.', 'teacher'),
  ('view_teacher_chat', 'View Chat', 'View the Chat page from Co-op Teacher Portal.', 'teacher'),
  ('view_teacher_photos', 'View Photos', 'View the Photos page from Co-op Teacher Portal.', 'teacher'),
  ('view_teacher_instructor_profile', 'View Instructor Profile', 'View the Instructor Profile page.', 'teacher'),
  ('view_student_events', 'View Calendar', 'View the Events page’s Calendar subpage from Student Portal.', 'student'),
  ('view_student_event_registrations', 'View My Event Registrations', 'View the Events page’s My Event Registrations subpage.', 'student'),
  ('view_student_classes', 'View Co-op Schedule', 'View the Co-op Schedule page.', 'student'),
  ('view_student_classes_dashboard', 'View Classroom Dashboard: Classes', 'View the Classroom Dashboard page’s Classes subpage.', 'student'),
  ('view_student_grades', 'View Classroom Dashboard: Grades', 'View the Classroom Dashboard page’s Grades subpage.', 'student'),
  ('view_student_attendance', 'View Classroom Dashboard: Attendance', 'View the Classroom Dashboard page’s Attendance subpage.', 'student'),
  ('view_student_weekly_planner', 'View Classroom Dashboard: Weekly Planner', 'View the Classroom Dashboard page’s Weekly Planner subpage.', 'student'),
  ('view_student_chat', 'View Chat', 'View the Chat page from Student Portal.', 'student'),
  ('view_student_portfolio', 'View Portfolio', 'View the Classroom Dashboard page’s Portfolio subpage.', 'student'),
  ('view_student_transcript', 'View Transcripts', 'View the Classroom Dashboard page’s Transcripts subpage.', 'student'),
  ('view_student_resources', 'View Resources', 'View the Resources page from Student Portal.', 'student'),
  ('view_student_photos', 'View Photos', 'View the Photos page from Student Portal.', 'student'),
  ('view_student_babysitter_profile', 'View Babysitter Profile', 'View the Babysitter Profile page.', 'student'),
  ('view_student_games', 'View Games', 'View the Games page.', 'student'),
  ('view_student_pets', 'View Pet', 'View the Pet page.', 'student'),
  ('view_student_reading', 'View Reading Challenge', 'View the Reading Challenge page from Student Portal.', 'student'),
  ('view_student_achievements', 'View Achievements', 'View the Achievements page.', 'student'),
  ('view_student_leaderboard', 'View Leaderboard', 'View the Leaderboard page.', 'student'),
  ('view_student_nature_news', 'View Nature News', 'View the Nature News page from Student Portal.', 'student'),
  ('view_student_vocabulary', 'View Vocabulary', 'View the Vocabulary page.', 'student')
on conflict (key) do nothing;

-- Main Admin already has every permission (role_permissions already
-- grants it every key - see the foundation migration); these new ones
-- get the same treatment for parity with a fresh install
-- (db/bootstrapPg.js's seedPortalPlatform grants every key to main_admin
-- unconditionally) even though Main Admin never routes through any of
-- these new portal-scoped checks itself.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.key in (
  'view_members_approvals',
  'view_members_archive',
  'view_members_locked',
  'view_members_settings',
  'view_accounting_categories',
  'view_accounting_invoices',
  'view_accounting_payments',
  'view_accounting_adjustments',
  'view_accounting_reports',
  'view_accounting_transactions',
  'view_accounting_receipts',
  'view_accounting_logs',
  'view_accounting_settings',
  'view_announcements_email',
  'view_announcements_text',
  'view_events_drafts',
  'view_events_requests',
  'view_events_attendance',
  'view_events_registrationlog',
  'view_events_settings',
  'view_forums_rooms',
  'view_forums_archive',
  'view_volunteers_signup_lists',
  'view_volunteers_lists',
  'view_name_tags_print',
  'view_name_tags_requests',
  'view_admin_photos_archive',
  'view_resource_links_approvals',
  'view_directory_requests',
  'view_directory_archive',
  'view_classifieds_requests',
  'view_classifieds_archive',
  'view_store_orders',
  'view_store_archived',
  'view_store_analytics',
  'view_store_settings',
  'view_babysitters_approvals',
  'view_babysitters_settings',
  'view_family_school_main_admin',
  'view_family_school_diplomas_main_admin',
  'view_fun_student_reading_challenge',
  'view_fun_parent_reading_challenge',
  'view_fun_games',
  'view_fun_vocabulary_game',
  'view_fun_pets',
  'view_parent_events',
  'view_parent_classes',
  'view_parent_classroom_dashboard',
  'view_parent_name_tag_form',
  'view_parent_absence_form',
  'view_parent_handbook',
  'view_parent_chat',
  'view_parent_training',
  'view_parent_directory',
  'view_parent_classifieds',
  'view_parent_resources',
  'view_parent_documents',
  'view_parent_store',
  'view_parent_photos',
  'view_parent_name_tags',
  'view_parent_babysitters',
  'view_parent_library',
  'view_parent_reading',
  'view_parent_accounting',
  'view_fsm_classes',
  'view_fsm_grades',
  'view_fsm_attendance',
  'view_fsm_journal',
  'view_fsm_volunteer_hours',
  'view_fsm_annual_planner',
  'view_fsm_weekly_planner',
  'view_fsm_transcripts',
  'view_fsm_diplomas',
  'view_fsm_portfolio',
  'view_teacher_attendance',
  'view_teacher_classes',
  'view_teacher_training',
  'view_teacher_assignments',
  'view_teacher_chat',
  'view_teacher_photos',
  'view_teacher_instructor_profile',
  'view_student_events',
  'view_student_event_registrations',
  'view_student_classes',
  'view_student_classes_dashboard',
  'view_student_grades',
  'view_student_attendance',
  'view_student_weekly_planner',
  'view_student_chat',
  'view_student_portfolio',
  'view_student_transcript',
  'view_student_resources',
  'view_student_photos',
  'view_student_babysitter_profile',
  'view_student_games',
  'view_student_pets',
  'view_student_reading',
  'view_student_achievements',
  'view_student_leaderboard',
  'view_student_nature_news',
  'view_student_vocabulary'
) where r.key = 'main_admin'
on conflict (role_id, permission_id) do nothing;

-- Parent Portal + Family School Management (same 'parent' role, a 2nd
-- portal card - routes/portal-auth.js's expandPortalRoles) - every page
-- a parent account can already reach today, granted by default so this
-- ships with zero behavior change until a Main Admin deliberately
-- unchecks one from the Portal Permissions screen.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.key in (
  'view_parent_events',
  'view_parent_classes',
  'view_parent_classroom_dashboard',
  'view_parent_name_tag_form',
  'view_parent_absence_form',
  'view_parent_handbook',
  'view_parent_chat',
  'view_parent_training',
  'view_parent_directory',
  'view_parent_classifieds',
  'view_parent_resources',
  'view_parent_documents',
  'view_parent_store',
  'view_parent_photos',
  'view_parent_name_tags',
  'view_parent_babysitters',
  'view_parent_library',
  'view_parent_reading',
  'view_parent_accounting',
  'view_fsm_classes',
  'view_fsm_grades',
  'view_fsm_attendance',
  'view_fsm_journal',
  'view_fsm_volunteer_hours',
  'view_fsm_annual_planner',
  'view_fsm_weekly_planner',
  'view_fsm_transcripts',
  'view_fsm_diplomas',
  'view_fsm_portfolio'
) where r.key = 'parent'
on conflict (role_id, permission_id) do nothing;

-- Co-op Teacher Portal.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.key in (
  'view_teacher_attendance',
  'view_teacher_classes',
  'view_teacher_training',
  'view_teacher_assignments',
  'view_teacher_chat',
  'view_teacher_photos',
  'view_teacher_instructor_profile'
) where r.key = 'teacher'
on conflict (role_id, permission_id) do nothing;

-- Student Portal + its own 'Activities' section.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.key in (
  'view_student_events',
  'view_student_event_registrations',
  'view_student_classes',
  'view_student_classes_dashboard',
  'view_student_grades',
  'view_student_attendance',
  'view_student_weekly_planner',
  'view_student_chat',
  'view_student_portfolio',
  'view_student_transcript',
  'view_student_resources',
  'view_student_photos',
  'view_student_babysitter_profile',
  'view_student_games',
  'view_student_pets',
  'view_student_reading',
  'view_student_achievements',
  'view_student_leaderboard',
  'view_student_nature_news',
  'view_student_vocabulary'
) where r.key = 'student'
on conflict (role_id, permission_id) do nothing;

