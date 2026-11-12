-- A real request: "Should be able to upload a photo for each training
-- that will show on the card." Stored in the existing public
-- training-resources bucket (same as lesson images).
-- Safe to re-run (local PGlite re-applies every migration on boot).
alter table trainings add column if not exists image_key text;
