-- A real request: "Complete the tasks that aren't fully there yet" - in
-- the Wix-style site editor's Media Manager, "Replace" used to swap the
-- file behind a media row in place, which changed the LIVE site before
-- Publish. Replacing now stores a brand-new row/object and the draft is
-- repointed to it; the old row stays (hidden from the library, marked
-- replaced_by) so the published snapshot and version history keep
-- rendering the old file until they no longer reference it.
alter table site_media add column if not exists replaced_by integer references site_media(id) on delete set null;
