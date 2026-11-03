-- A real request: "Same for lesson plans approval, there should be
-- approval and rejection features just like for teacher reimbursements.
-- It should look and behave the same way." Follows up on
-- 20261231010000_lesson_plan_approval.sql (left untouched - it may
-- already have been run):
--   1. 'declined' is renamed 'rejected'. The CHECK constraint still
--      accepts 'declined' as a legacy value so anything written by the
--      previous code during a deploy doesn't fail; the app reads it as
--      'rejected', and the UPDATE below converts any such row on every
--      re-run.
--   2. lesson_approval_events keeps every submit/approve/reject (who,
--      when, rejection message), so resubmitting after a rejection no
--      longer loses the earlier messages.
-- Safe to re-run (local PGlite re-applies every migration on boot).
alter table class_assignments drop constraint if exists class_assignments_approval_status_check;
alter table class_assignments add constraint class_assignments_approval_status_check
  check (approval_status in ('draft', 'pending', 'approved', 'rejected', 'declined'));
update class_assignments set approval_status = 'rejected' where approval_status = 'declined';

create table if not exists lesson_approval_events (
  id integer generated always as identity primary key,
  assignment_id integer not null references class_assignments(id) on delete cascade,
  action text not null check (action in ('submitted', 'approved', 'rejected')),
  message text,
  actor_account_id integer references member_accounts(id) on delete set null,
  -- Snapshot so the history still names the person if their account goes.
  actor_name text,
  created_at text not null default now_text()
);
create index if not exists idx_lesson_approval_events_assignment on lesson_approval_events(assignment_id, id);

-- Carry over the one rejection message the previous version stored on
-- the lesson itself.
insert into lesson_approval_events (assignment_id, action, message, actor_account_id, created_at)
select ca.id, 'rejected', ca.review_note, ca.reviewed_by_account_id, coalesce(ca.reviewed_at, now_text())
from class_assignments ca
where ca.approval_status = 'rejected'
  and not exists (select 1 from lesson_approval_events e where e.assignment_id = ca.id and e.action = 'rejected');

update notification_types
  set description = 'A Co-op Admin approved or rejected a lesson plan you submitted for approval.'
  where key = 'lesson_plan_review';
