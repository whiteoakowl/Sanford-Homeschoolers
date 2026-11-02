-- Babysitter Directory follow-up - a real request: "Babysitter profiles.
-- Contact method should say phone number. Add a line for email address.
-- Add checkboxes for how can parent contact you. Checkboxes are lined in
-- a single column and say text, call, email."
--
-- contact_method (existing) keeps its column name - this is purely a
-- display-label change ("Phone Number" everywhere it's shown/edited),
-- not a schema change, so no rename here.
--
-- email is a genuinely new column - the babysitter's own listed contact
-- email for the directory, separate from the member account's own sign-
-- in email, same "don't reuse an unrelated email for a different
-- purpose" reasoning phone/contact_method already follow here.
alter table babysitter_profiles add column if not exists email text;

-- "how can a parent contact you" - Text/Call/Email, multiple selectable
-- at once (unlike the existing single-choice contact_preference added by
-- 20260828040000_babysitter_directory_polish.sql, which this does not
-- replace). Three separate booleans, one per fixed checkbox, is this
-- schema's own established shape for "a few checked-off options on one
-- row" - see registration_windows.open_for_parent_teacher/
-- open_for_parent_assistant/open_for_parent_register_student/
-- open_for_student_register_self
-- (20261031010000_registration_windows_action_types.sql), rendered the
-- same way views/partials/registration-window-form.ejs and
-- views/admin-events-builder.ejs's own .checkbox-group.checkbox-group-
-- stack blocks already do, rather than a CSV/array column.
alter table babysitter_profiles add column if not exists contact_text boolean not null default false;
alter table babysitter_profiles add column if not exists contact_call boolean not null default false;
alter table babysitter_profiles add column if not exists contact_email boolean not null default false;
