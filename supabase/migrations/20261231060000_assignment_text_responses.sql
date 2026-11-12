-- A real request: "When choosing the upload assignment option, there
-- should be a place for students to upload their assignment on their
-- end. Word, pdf etc. Student should be able to type their response with
-- full editing features or a button to upload their assignment." A
-- submission can now hold a typed (rich-text) response as well as, or
-- instead of, an uploaded file.
-- Safe to re-run (local PGlite re-applies every migration on boot).
alter table assignment_submissions add column if not exists response_body text;
alter table family_school_assignment_submissions add column if not exists response_body text;
