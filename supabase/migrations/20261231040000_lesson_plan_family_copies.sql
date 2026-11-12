-- A real request: parents allowed to "edit or add to the lesson plan
-- from the Family School Management portal" must only change it for
-- their own family - "the only classes that parents can edit are the
-- ones in family school management portal for their personal family
-- use." Editing a library plan makes that family its own private copy
-- (a lesson_plans row with family_id set); the shared original is never
-- changed by a parent. Family copies are hidden from the admin library,
-- the Teacher Portal and every other family.
-- Safe to re-run (local PGlite re-applies every migration on boot).
alter table lesson_plans add column if not exists family_id integer references families(id) on delete cascade;
alter table lesson_plans add column if not exists copied_from_lesson_plan_id integer references lesson_plans(id) on delete set null;
create index if not exists idx_lesson_plans_family on lesson_plans(family_id);

-- A follow-up: a teacher edits a lesson plan only on the co-op class it
-- was assigned to (that class's own copy, seen by its parents/students),
-- never the shared library plan. The class copy remembers which plan it
-- came from so the plan's "Allow teachers to edit/add" checkbox and Lock
-- can still govern whether the teacher may edit that copy.
alter table class_assignments add column if not exists source_lesson_plan_id integer references lesson_plans(id) on delete set null;
