-- Storage audit: students' handed-in co-op class work was being saved in
-- the PUBLIC lesson-attachments bucket (the same one teachers' handouts
-- use), so anyone with a link could open a child's homework. New
-- submissions now go to this PRIVATE bucket and are only served through
-- the app's own GET /class-submissions/:key route, which checks the
-- viewer is the student, their family, the class's teacher, or a Co-op
-- Admin (routes/class-submission-files.js). Older submissions stay where
-- they are and are still served through that same checked route.
--
-- Guarded on the storage schema existing, same as
-- 20261227010000_storage_buckets.sql (PGlite in tests has none).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values
      ('assignment-submissions', 'assignment-submissions', false)
    on conflict (id) do nothing;
  end if;
end $$;
