-- A real request: "Teachers can create lesson plans in their teacher
-- portal for a class and click submit for approval button... When the
-- admin approves the lesson plan, it will show on the teacher side...
-- Only when it has been approved by admins will it be visible to the
-- students who have signed up for the class." class_assignments IS a
-- class's "lessons" (see 20261001010000_lesson_content_and_quizzes.sql).
--
-- approval_status: draft -> pending (submitted) -> approved | declined.
-- The column is added with DEFAULT 'approved' so every lesson that
-- already exists at migration time is backfilled as approved (nothing a
-- student can see today disappears), then the default flips to 'draft'
-- for rows inserted afterwards. Both statements are safe to re-run
-- (local PGlite re-applies every migration file on each boot): the
-- ADD COLUMN IF NOT EXISTS is a no-op once the column exists, so the
-- backfill only ever happens the first time.
alter table class_assignments add column if not exists approval_status text not null default 'approved'
  check (approval_status in ('draft', 'pending', 'approved', 'declined'));
alter table class_assignments alter column approval_status set default 'draft';
alter table class_assignments add column if not exists submitted_at text;
alter table class_assignments add column if not exists submitted_by_account_id integer references member_accounts(id) on delete set null;
alter table class_assignments add column if not exists reviewed_at text;
alter table class_assignments add column if not exists reviewed_by_account_id integer references member_accounts(id) on delete set null;
-- Optional note an admin leaves when declining, shown to the teacher.
alter table class_assignments add column if not exists review_note text;
create index if not exists idx_class_assignments_approval_status on class_assignments(approval_status);

-- In-app + email by default; texting is off by default (a Main Admin can
-- turn it on under Notifications like any other type).
insert into notification_types (key, label, description, auto_send_email_enabled, auto_send_sms_enabled) values
  ('lesson_plan_review', 'Lesson Plan Review', 'A Co-op Admin approved or declined a lesson plan you submitted for approval.', 1, 0)
on conflict (key) do nothing;
