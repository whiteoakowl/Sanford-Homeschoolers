-- A real request: diploma creation with four traditional high school
-- diploma designs, editable school name/city/state, a Board of Education
-- style header line (Design 3), seal/logo choices (two on Design 3), and
-- up to three signatures each with a role chosen from a dropdown
-- (utils/diplomaDesign.js). signature1_title/signature2_title already
-- exist and now hold the chosen role.
alter table diplomas add column if not exists school_name text;
alter table diplomas add column if not exists school_city text;
alter table diplomas add column if not exists school_state text;
alter table diplomas add column if not exists header_text text;
alter table diplomas add column if not exists course_text text;
alter table diplomas add column if not exists seal1 text;
alter table diplomas add column if not exists seal2 text;
alter table diplomas add column if not exists signature3_name text;
alter table diplomas add column if not exists signature3_title text;
