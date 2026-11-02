-- A real request: "Co-op admin portal, teacher assistant tab, add a
-- subpage called teacher reimbursements. This will be a log of
-- reimbursement forms that have been submitted for approval." Teachers/
-- assistants fill the form in from Co-op Teacher Portal > Reimbursements
-- (routes/teacher-reimbursements.js); Co-op Admin reviews it at
-- /admin/teachers/reimbursements and fills in the Admin Only check
-- number/date/approved-by section. member_name/semester_title/class_name
-- are snapshots so a historical (or imported) request still reads
-- correctly after the member, semester or class itself is deleted.
-- Money is integer cents throughout.
create table if not exists reimbursement_requests (
  id integer generated always as identity primary key,
  member_id integer references members(id) on delete set null,
  member_name text not null default '',
  semester_id integer references semesters(id) on delete set null,
  semester_title text not null default '',
  day text,
  class_id integer references classes(id) on delete set null,
  class_name text not null default '',
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  total_cents integer not null default 0,
  submitted_at text not null default now_text(),
  resubmitted_at text,
  submission_count integer not null default 1,
  submitted_by_account_id integer references member_accounts(id) on delete set null,
  check_number text,
  check_date text,
  approved_by_member_id integer references members(id) on delete set null,
  approved_by_name text,
  admin_updated_at text
);
create index if not exists idx_reimbursement_requests_member on reimbursement_requests(member_id);
create index if not exists idx_reimbursement_requests_semester on reimbursement_requests(semester_id);

create table if not exists reimbursement_items (
  id integer generated always as identity primary key,
  request_id integer not null references reimbursement_requests(id) on delete cascade,
  description text not null,
  purchase_date text,
  amount_cents integer not null check (amount_cents > 0),
  position integer not null default 0
);
create index if not exists idx_reimbursement_items_request on reimbursement_items(request_id);

-- Co-op Teacher Portal's new Reimbursements page gets its own page
-- permission, same shape as every other Teacher Portal page
-- (20261226010000_portal_page_permissions.sql). db/bootstrapPg.js's own
-- PORTAL_PERMISSIONS and utils/portalPageCatalog.js's TEACHER_PAGES
-- carry the same key by hand. Form title/intro/footer text lives in
-- app_settings (reimbursement_form_* keys) - no table needed.
insert into permissions (key, label, description, portal) values
  ('view_teacher_reimbursements', 'View Reimbursements', 'View and submit the Reimbursements form from Co-op Teacher Portal.', 'teacher')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.key = 'view_teacher_reimbursements'
where r.key in ('main_admin', 'teacher')
on conflict (role_id, permission_id) do nothing;

-- A later real request: "add a place to upload the receipt and a add more
-- receipts button... Admin side can click and view the receipts." Files
-- live in the existing PRIVATE 'accounting-receipts' bucket under a
-- 'reimbursements/' key prefix (local dev: data/reimbursement-receipts,
-- outside public/), and are only ever served through the authenticated
-- GET /reimbursement-receipts/:id proxy route.
create table if not exists reimbursement_receipts (
  id integer generated always as identity primary key,
  request_id integer not null references reimbursement_requests(id) on delete cascade,
  storage_key text not null,
  original_name text not null default '',
  mime_type text not null,
  size_bytes integer,
  uploaded_at text not null default now_text()
);
create index if not exists idx_reimbursement_receipts_request on reimbursement_receipts(request_id);

-- A later real request: "add a rejection button... you can add a message
-- and send. The teacher then shows on the submission side rejected or
-- approved... edit the form to fix it and resubmit." One row per
-- rejection, kept after a resubmit so the admin view shows the history;
-- the newest row is the message a teacher sees while it's Rejected.
create table if not exists reimbursement_rejections (
  id integer generated always as identity primary key,
  request_id integer not null references reimbursement_requests(id) on delete cascade,
  message text not null,
  rejected_at text not null default now_text(),
  rejected_by_account_id integer references member_accounts(id) on delete set null,
  rejected_by_name text not null default '',
  submission_number integer not null default 1
);
create index if not exists idx_reimbursement_rejections_request on reimbursement_rejections(request_id);

-- In-app + email (no text by default) when a reimbursement is rejected or
-- approved/paid - utils/notifications.js's notify().
insert into notification_types (key, label, description, auto_send_email_enabled, auto_send_sms_enabled) values
  ('reimbursement_status', 'Reimbursement Update', 'Your teacher reimbursement form was approved/paid or sent back for changes.', 1, 0)
on conflict (key) do nothing;
