-- A real request: the Co-op Admin Lesson Plans library should use the
-- same lesson/assignment design as the Teacher Portal - a plan holds
-- lessons (each added from an "Add Lesson" popup and shown as a bar), and
-- each lesson holds its own assignments. lesson_plan_content_items keeps
-- its lesson_plan_id and gains lesson_id. Assigning a plan to a class
-- makes one class lesson per plan lesson; a family using a plan gets one
-- Family Classes lesson per plan lesson (source_lesson_plan_lesson_id).
-- Existing plans become a single lesson holding all their assignments.
-- Safe to re-run (local PGlite re-applies every migration on boot).
create table if not exists lesson_plan_lessons (
  id integer generated always as identity primary key,
  lesson_plan_id integer not null references lesson_plans(id) on delete cascade,
  title text not null,
  description text,
  position integer not null default 0,
  created_at text not null default now_text()
);
create index if not exists idx_lesson_plan_lessons_plan on lesson_plan_lessons(lesson_plan_id);
alter table lesson_plan_content_items add column if not exists lesson_id integer references lesson_plan_lessons(id) on delete cascade;
create index if not exists idx_lesson_plan_content_items_lesson on lesson_plan_content_items(lesson_id);
alter table family_school_lessons add column if not exists source_lesson_plan_lesson_id integer references lesson_plan_lessons(id) on delete set null;

insert into lesson_plan_lessons (lesson_plan_id, title, description, position)
select lp.id, lp.title, lp.description, 0 from lesson_plans lp
where exists (select 1 from lesson_plan_content_items ci where ci.lesson_plan_id = lp.id and ci.lesson_id is null)
  and not exists (select 1 from lesson_plan_lessons l where l.lesson_plan_id = lp.id);
update lesson_plan_content_items ci
  set lesson_id = (select min(l.id) from lesson_plan_lessons l where l.lesson_plan_id = ci.lesson_plan_id)
  where ci.lesson_id is null;
