-- A real bug report, in the user's own words: "Main admin portal, portal
-- permissions is for locking/unlocking member views of pages and
-- subpages. Main admin portal, admins, roles and permissions is for
-- giving permission to manage the different pages and subpages."
--
-- supabase/migrations/20261226010000_portal_page_permissions.sql
-- relabeled EVERY permission row from "Manage X" to "View X" wording,
-- including the ~26 original Main-Admin rows (manage_members,
-- manage_finances, etc.) and the ~45 brand-new Main-Admin SUBPAGE rows
-- it added in the same pass (view_members_approvals, etc.). That "View"
-- wording is correct for every permission tagged portal IN ('parent',
-- 'family_school', 'student', 'teacher') - those are the genuine
-- member-facing "can this portal SEE this page" permissions shown on
-- views/main-admin-roles.ejs (Portal Permissions) - but it was wrong
-- for every permission tagged portal = 'main_admin'. A main_admin
-- permission only ever appears on views/main-admin-admins.ejs (Admin
-- Positions' own edit dialog, via utils/portalPageCatalog.js's
-- adminCatalogSections) - Main Admin's own card on Portal Permissions
-- has no dialog at all ("Main Admin always has every permission",
-- unchanged by this migration). Admin Positions is about granting STAFF
-- the ability to MANAGE/edit a page, not about hiding it from ordinary
-- members, so its wording needs to say "Manage", not "View".
--
-- The 26 original rows below are reverted BYTE-FOR-BYTE back to the
-- exact label/description text they had before 20261226010000 ever
-- touched them (see the pre-migration db/bootstrapPg.js for that exact
-- original wording - this file matches it verbatim). Two of those 26
-- were never actually changed to "View" wording in the first place
-- (view_audit_log - an audit log can only ever be viewed, never
-- "managed" - and register_guests, already an action verb) - both are
-- included below anyway, set back to their own unchanged original text,
-- so this migration is a complete, explicit undo of every row
-- 20261226010000 touched rather than a partial one a future reader has
-- to cross-reference to trust.
--
-- The 45 new Main-Admin subpage rows below never had pre-"View" wording
-- to revert to (they were born with it in the same migration) - each
-- gets fresh "Manage ..." wording in the same style as the 26 originals
-- instead, reflecting the exact same corrected framing.
--
-- `key` is left completely untouched everywhere - every main-admin-*.js/
-- admin-*.js route file already calls requirePortalPermission with these
-- exact names, and renaming any of them here would be a real access
-- regression, not a wording fix.
--
-- db/bootstrapPg.js's own PORTAL_PERMISSIONS array is updated to match
-- this exact wording, so a fresh install and an already-upgraded
-- database end up with the identical catalog.

-- The original 26 (verbatim pre-20261226010000 label/description).
update permissions set label = 'Manage Users', description = 'Approve accounts, assign roles and portal access.' where key = 'manage_users';
update permissions set label = 'Manage Roles & Permissions', description = 'Create/edit roles and control which permissions they grant.' where key = 'manage_roles';
update permissions set label = 'Manage Website', description = 'Edit the public homepage, announcements, and FAQs.' where key = 'manage_website';
update permissions set label = 'Manage Classes', description = 'Create/edit classes, capacity, and registration windows.' where key = 'manage_classes';
update permissions set label = 'Manage Registrations', description = 'Review and adjust members'' class registrations.' where key = 'manage_registrations';
update permissions set label = 'Manage Events', description = 'Create/edit events, volunteer signups, and donation requests.' where key = 'manage_events';
update permissions set label = 'Manage Volunteers', description = 'Manage committees, sign-up lists, and volunteer lists (Main Admin > Volunteers).' where key = 'manage_volunteers';
update permissions set label = 'Manage Classifieds', description = 'Approve, archive, and moderate classifieds listings.' where key = 'manage_classifieds';
update permissions set label = 'Manage Finances', description = 'View and record accounting charges, payments, and refunds.' where key = 'manage_finances';
update permissions set label = 'Manage Store', description = 'Manage products, inventory, and orders.' where key = 'manage_store';
update permissions set label = 'Manage Chat', description = 'Moderate chat categories, threads, and posts.' where key = 'manage_forum';
update permissions set label = 'Manage Forms', description = 'Build and publish custom forms, and view submissions.' where key = 'manage_forms';
update permissions set label = 'Manage Training', description = 'Create courses/lessons and assign training.' where key = 'manage_training';
update permissions set label = 'Manage Documents', description = 'Upload and organize shared documents.' where key = 'manage_documents';
update permissions set label = 'Manage Publications', description = 'Write and publish articles, publications, and photo albums.' where key = 'manage_publications';
update permissions set label = 'Manage Directory', description = 'Manage the member and business directories.' where key = 'manage_directory';
update permissions set label = 'Manage Communications', description = 'Assemble/send the weekly newsletter and control SMS/notification settings.' where key = 'manage_communications';
update permissions set label = 'View Audit Log', description = 'View the record of financial changes, moderation, and deletions across the app.' where key = 'view_audit_log';
update permissions set label = 'Manage Members', description = 'Add, edit, archive, and organize the member/family roster.' where key = 'manage_members';
update permissions set label = 'Send Announcements', description = 'Compose and send announcements to members, shown on their portal home page.' where key = 'send_announcements';
update permissions set label = 'Manage Resource Links', description = 'Add and remove the curated resource links shown on member portals.' where key = 'manage_resources';
update permissions set label = 'Manage Babysitter Directory', description = 'Approve or reject babysitter profile submissions and edits.' where key = 'manage_babysitters';
update permissions set label = 'Manage Sections', description = 'Create sections and assign members to them, for restricting events/classes to specific groups.' where key = 'manage_sections';
update permissions set label = 'Manage Name Tags', description = 'Design and print name tags, schedule cards, badges, and barcode sheets for any member.' where key = 'manage_name_tags';
update permissions set label = 'Register Guests', description = 'Register a non-member guest for an event.' where key = 'register_guests';
update permissions set label = 'Manage Annual Calendar', description = 'Create fiscal-year calendars, keys, and color-code calendar dates.' where key = 'manage_annual_calendar';

-- The 45 new Main-Admin subpage rows 20261226010000 added - fresh
-- "Manage ..." wording in the same style as the 26 originals above (no
-- prior non-"View" text exists to revert to for these).
update permissions set label = 'Manage Members: Approvals', description = 'Manage the Members page''s Approvals tab.' where key = 'view_members_approvals';
update permissions set label = 'Manage Members: Archive', description = 'Manage the Members page''s Archive tab.' where key = 'view_members_archive';
update permissions set label = 'Manage Members: Locked', description = 'Manage the Members page''s Locked tab.' where key = 'view_members_locked';
update permissions set label = 'Manage Members: Settings', description = 'Manage the Members page''s Settings tab.' where key = 'view_members_settings';
update permissions set label = 'Manage Accounting: Category/Fiscal Year', description = 'Manage the Accounting page''s Category/Fiscal Year tab.' where key = 'view_accounting_categories';
update permissions set label = 'Manage Accounting: Invoices', description = 'Manage the Accounting page''s Invoices tab.' where key = 'view_accounting_invoices';
update permissions set label = 'Manage Accounting: Payments', description = 'Manage the Accounting page''s Payments tab.' where key = 'view_accounting_payments';
update permissions set label = 'Manage Accounting: Adjustments', description = 'Manage the Accounting page''s Adjustments tab.' where key = 'view_accounting_adjustments';
update permissions set label = 'Manage Accounting: Reports', description = 'Manage the Accounting page''s Reports tab.' where key = 'view_accounting_reports';
update permissions set label = 'Manage Accounting: Transactions', description = 'Manage the Accounting page''s Transactions tab.' where key = 'view_accounting_transactions';
update permissions set label = 'Manage Accounting: Receipts', description = 'Manage the Accounting page''s Receipts tab.' where key = 'view_accounting_receipts';
update permissions set label = 'Manage Accounting: Logs', description = 'Manage the Accounting page''s Logs tab.' where key = 'view_accounting_logs';
update permissions set label = 'Manage Accounting: Settings', description = 'Manage the Accounting page''s Settings tab.' where key = 'view_accounting_settings';
update permissions set label = 'Manage Communication: Email', description = 'Manage the Communication page''s Email tab.' where key = 'view_announcements_email';
update permissions set label = 'Manage Communication: Text', description = 'Manage the Communication page''s Text tab.' where key = 'view_announcements_text';
update permissions set label = 'Manage Events: Drafts', description = 'Manage the Events page''s Drafts tab.' where key = 'view_events_drafts';
update permissions set label = 'Manage Events: Requests', description = 'Manage the Events page''s Requests tab.' where key = 'view_events_requests';
update permissions set label = 'Manage Events: Event Attendance', description = 'Manage the Events page''s Event Attendance tab.' where key = 'view_events_attendance';
update permissions set label = 'Manage Events: Event Registration Log', description = 'Manage the Events page''s Event Registration Log tab.' where key = 'view_events_registrationlog';
update permissions set label = 'Manage Events: Settings', description = 'Manage the Events page''s Settings tab.' where key = 'view_events_settings';
update permissions set label = 'Manage Chat: Chat Rooms', description = 'Manage the Chat page''s Chat Rooms tab.' where key = 'view_forums_rooms';
update permissions set label = 'Manage Chat: Archive', description = 'Manage the Chat page''s Archive tab.' where key = 'view_forums_archive';
update permissions set label = 'Manage Volunteers: Sign-Up Lists', description = 'Manage the Volunteers page''s Sign-Up Lists tab.' where key = 'view_volunteers_signup_lists';
update permissions set label = 'Manage Volunteers: Volunteer Lists', description = 'Manage the Volunteers page''s Volunteer Lists tab.' where key = 'view_volunteers_lists';
update permissions set label = 'Manage Name Tags: Print', description = 'Manage the Name Tags page''s Print tab.' where key = 'view_name_tags_print';
update permissions set label = 'Manage Name Tags: Requests', description = 'Manage the Name Tags page''s Requests tab.' where key = 'view_name_tags_requests';
update permissions set label = 'Manage Photos: Archive', description = 'Manage the Photos page''s Archive tab.' where key = 'view_admin_photos_archive';
update permissions set label = 'Manage Resource Links: Approvals', description = 'Manage the Resource Links page''s Approvals tab.' where key = 'view_resource_links_approvals';
update permissions set label = 'Manage Business Directory: Requests', description = 'Manage the Business Directory page''s Requests tab.' where key = 'view_directory_requests';
update permissions set label = 'Manage Business Directory: Archive', description = 'Manage the Business Directory page''s Archive tab.' where key = 'view_directory_archive';
update permissions set label = 'Manage Classifieds: Requests', description = 'Manage the Classifieds page''s Requests tab.' where key = 'view_classifieds_requests';
update permissions set label = 'Manage Classifieds: Archive', description = 'Manage the Classifieds page''s Archive tab.' where key = 'view_classifieds_archive';
update permissions set label = 'Manage Shop: Orders', description = 'Manage the Shop page''s Orders tab.' where key = 'view_store_orders';
update permissions set label = 'Manage Shop: Archived', description = 'Manage the Shop page''s Archived tab.' where key = 'view_store_archived';
update permissions set label = 'Manage Shop: Analytics', description = 'Manage the Shop page''s Analytics tab.' where key = 'view_store_analytics';
update permissions set label = 'Manage Shop: Settings', description = 'Manage the Shop page''s Settings tab.' where key = 'view_store_settings';
update permissions set label = 'Manage Babysitters: Approvals', description = 'Manage the Babysitters page''s Approvals tab.' where key = 'view_babysitters_approvals';
update permissions set label = 'Manage Babysitters: Settings', description = 'Manage the Babysitters page''s Settings tab.' where key = 'view_babysitters_settings';
update permissions set label = 'Manage Family School Management (Transcripts)', description = 'Manage Main Admin''s own Family School Management page (transcript creation).' where key = 'view_family_school_main_admin';
update permissions set label = 'Manage Family School Management: Diplomas', description = 'Manage Main Admin''s own Family School Management Diplomas subpage.' where key = 'view_family_school_diplomas_main_admin';
update permissions set label = 'Manage Fun: Student Reading Challenge', description = 'Manage the Fun page''s Student Reading Challenge subpage.' where key = 'view_fun_student_reading_challenge';
update permissions set label = 'Manage Fun: Parent Reading Challenge', description = 'Manage the Fun page''s Parent Reading Challenge subpage.' where key = 'view_fun_parent_reading_challenge';
update permissions set label = 'Manage Fun: Games', description = 'Manage the Fun page''s Games subpage.' where key = 'view_fun_games';
update permissions set label = 'Manage Fun: Vocabulary Game', description = 'Manage the Fun page''s Vocabulary Game subpage.' where key = 'view_fun_vocabulary_game';
update permissions set label = 'Manage Fun: Pets', description = 'Manage the Fun page''s Pets subpage.' where key = 'view_fun_pets';
