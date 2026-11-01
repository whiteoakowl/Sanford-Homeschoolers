-- A real bug report: "Website homepage editing won't allow me to save
-- adding an image." Root cause: utils/storage.js's uploadFile() writes to
-- a Supabase Storage bucket that has to already exist - Storage buckets
-- are never auto-created by the app itself, only by this SQL (or the
-- Supabase dashboard's own "New bucket" button, the only path
-- MIGRATION.md ever documented, and only for the original 5 buckets that
-- existed back when that doc was written). Every feature added since
-- then introduced its own new bucket in code (one `_BUCKET = '...'`
-- constant per upload feature - see utils/homepage.js's own
-- HOMEPAGE_IMAGES_BUCKET) without anyone ever being told to go create it
-- for real, so any of them can hit this exact same "upload just silently
-- fails" symptom the moment that feature is actually used for the first
-- time on a live site - not just the Public Homepage builder.
--
-- Storage buckets are themselves just rows in storage.buckets, in the
-- SAME Postgres database as every other table here - the Supabase SQL
-- Editor's own connection already has the privileges to insert into them
-- directly, so this needs no dashboard click-through at all. The app's
-- own server-side Storage calls always authenticate with
-- SUPABASE_SERVICE_ROLE_KEY (utils/storage.js's createStorageClient()),
-- which Supabase Storage treats as a full-access service role regardless
-- of a bucket's public/private flag or any RLS policy on storage.objects
-- - that flag only controls whether a SIGNED-OUT browser can fetch an
-- object's public URL directly (utils/storage.js's publicUrl()) without
-- going through this app at all. A handful of buckets below are
-- deliberately private (public = false) because the app always proxies
-- those files through its own authenticated routes instead
-- (utils/storage.js's downloadFile()) - see each one's own comment.
--
-- Idempotent (on conflict do nothing) - safe to run again after a future
-- feature adds another bucket; this file just grows its own list rather
-- than needing a brand new migration every time. Every id below is the
-- exact bucket name string Grep found as a `_BUCKET`/`bucket:` constant
-- across utils/*.js and routes/*.js as of this pass.
insert into storage.buckets (id, name, public) values
  -- Public (served via utils/storage.js's publicUrl() - a plain, stable
  -- <img src>/<a href> URL, same as everything under public/uploads/ was
  -- before Storage existed).
  ('class-images', 'class-images', true),
  ('custom-form-images', 'custom-form-images', true),
  ('event-images', 'event-images', true),
  ('member-photos', 'member-photos', true),
  ('homepage-images', 'homepage-images', true),
  ('lesson-attachments', 'lesson-attachments', true),
  ('text-campaign-images', 'text-campaign-images', true),
  ('classifieds-images', 'classifieds-images', true),
  ('directory-images', 'directory-images', true),
  ('member-text-images', 'member-text-images', true),
  ('name-tag-images', 'name-tag-images', true),
  ('schedule-card-images', 'schedule-card-images', true),
  ('setup-cleanup-notification-images', 'setup-cleanup-notification-images', true),
  ('store-images', 'store-images', true),
  ('training-resources', 'training-resources', true),
  ('floater-notification-images', 'floater-notification-images', true),
  -- Private (served only by the app's own routes, via downloadFile() -
  -- member balances/receipts, documents gated by admin role, babysitter/
  -- member photos that aren't meant to be a guessable public URL, etc.).
  ('documents', 'documents', false),
  ('private-photos', 'private-photos', false),
  ('private-babysitter-photos', 'private-babysitter-photos', false),
  ('private-nature-news', 'private-nature-news', false),
  ('custom-form-files', 'custom-form-files', false),
  ('accounting-receipts', 'accounting-receipts', false),
  ('family-school-attachments', 'family-school-attachments', false)
on conflict (id) do nothing;
