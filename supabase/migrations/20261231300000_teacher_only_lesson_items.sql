-- A real request: "When adding assignments to lessons plans be able to
-- mark them teacher only. Then that particular resource or assignment
-- will only be available to teachers, subs and admins. It won't be
-- available for students or parents." Set on a class lesson's item and
-- on a library lesson plan's item (copied along when the plan is
-- assigned to a class; never copied into a family's own plan).
alter table lesson_content_items add column if not exists teacher_only boolean not null default false;
alter table lesson_plan_content_items add column if not exists teacher_only boolean not null default false;
