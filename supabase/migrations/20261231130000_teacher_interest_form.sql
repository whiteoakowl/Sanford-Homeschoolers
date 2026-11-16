-- A real request: "Teacher interest form. Submissions and edit form
-- button found under teachers/assistants tab. Teacher interest form on
-- parent portal homepages under links and forms. Edit form request name,
-- days available, age groups, class hours available, subject willing to
-- teach added one by one and offered as checkboxes. Class idea 1, class
-- idea 2, class idea 3 with large text boxes. Log on admin side shows
-- date and time stamp in correct format."

-- The form's own settings (one row): its title/intro and each checkbox
-- list's options, kept as JSON arrays of strings in the order added.
create table if not exists teacher_interest_settings (
  id integer primary key,
  title text,
  intro text,
  days_json text,
  age_groups_json text,
  hours_json text,
  subjects_json text,
  updated_at text not null default now_text()
);

create table if not exists teacher_interest_submissions (
  id integer generated always as identity primary key,
  account_id integer references member_accounts(id) on delete set null,
  member_id integer references members(id) on delete set null,
  name text not null,
  days_json text,
  age_groups_json text,
  hours_json text,
  subjects_json text,
  idea1 text,
  idea2 text,
  idea3 text,
  created_at text not null default now_text()
);
create index if not exists idx_teacher_interest_submissions_created on teacher_interest_submissions(created_at);
