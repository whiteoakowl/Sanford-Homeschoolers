-- A real request: "Transcripts should print like this" (an Official High
-- School Transcript: Student Information, School Information, an
-- Academic Record box per school year with its Grade Level, courses with
-- Credits/Grade and Honors/College marks, per-year and cumulative GPA,
-- an Academic Summary, Grading Scale, Test Scores and activities, and a
-- certification with Signature/Title/Date). "Make sure the Transcript
-- creations features and settings account for what is on this
-- Transcript image."

-- Honors (*) / College Course (**) mark per transcript class.
alter table parent_transcript_entries add column if not exists course_level text;

-- One row per student: everything on the transcript that isn't a class.
-- Blank student contact fields fall back to the member record, then the
-- family's primary parent (utils/academics.js's transcriptDetailsFor).
create table if not exists transcript_details (
  student_id integer primary key references members(id) on delete cascade,
  student_address text,
  student_phone text,
  student_email text,
  birthday text,
  graduation_date text,
  attendance text,
  test_scores text,
  activities text,
  diploma_name text,
  updated_at text not null default now_text()
);

-- Grade Level (9th/10th/...) for each school year on a student's transcript.
create table if not exists transcript_year_levels (
  student_id integer not null references members(id) on delete cascade,
  school_year text not null,
  grade_level text,
  primary key (student_id, school_year)
);

-- School Information box: address/phone/email beside the school name.
alter table family_school_settings add column if not exists school_address text;
alter table family_school_settings add column if not exists school_phone text;
alter table family_school_settings add column if not exists school_email text;
