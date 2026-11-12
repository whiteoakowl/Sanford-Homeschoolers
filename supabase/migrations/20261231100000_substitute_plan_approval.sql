-- A real request: "When teachers submit lessons for approval it will send
-- the entire lesson and any substitute lessons together for approval."
-- A teacher-made substitute plan starts as 'draft' (same statuses as a
-- lesson, see the lesson_plan_approval migrations); Submit for Admin
-- Approval on the teacher's Lesson Plan page sends it along with the
-- lesson(s) being submitted - submitted_with_assignment_id is the lesson
-- it travels with, and Co-op Admin's approve/reject of that lesson
-- decides it too (utils/substitutePlans.js). Existing rows and every
-- Co-op Admin-made plan are 'approved'. Only approved plans show on the
-- class QR code's View Substitute Plan page.
alter table class_substitute_plans add column if not exists approval_status text not null default 'approved' check (approval_status in ('draft', 'pending', 'approved', 'rejected'));
alter table class_substitute_plans add column if not exists submitted_with_assignment_id integer references class_assignments(id) on delete set null;
alter table class_substitute_plans add column if not exists submitted_at text;
alter table class_substitute_plans add column if not exists submitted_by_account_id integer references member_accounts(id) on delete set null;
alter table class_substitute_plans add column if not exists reviewed_at text;
alter table class_substitute_plans add column if not exists review_note text;
create index if not exists idx_class_substitute_plans_submitted_with on class_substitute_plans(submitted_with_assignment_id);
