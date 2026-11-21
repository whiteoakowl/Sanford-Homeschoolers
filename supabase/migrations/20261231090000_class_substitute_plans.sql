-- A real request: "In teacher portal and co-op admin portal, class
-- details. Next to add a lesson plan button should be the add a
-- substitute plan button ... type a detail, description, upload a
-- worksheet for printing, link to a video or song. Special notes from
-- teacher. Can add multiple substitute plans to a class lesson plan."
-- One row per substitute plan; a class can have many. worksheet_key is
-- stored the same way as lesson attachments (utils/academics.js's
-- saveLessonAttachment - the lesson-attachments bucket, or
-- public/uploads/lesson-attachments locally). Shown read-only on the
-- class QR code's View Substitute Plan page (routes/kiosk-class-checkin.js).
create table if not exists class_substitute_plans (
  id integer generated always as identity primary key,
  class_id integer not null references classes(id) on delete cascade,
  title text not null,
  description text,
  worksheet_key text,
  worksheet_name text,
  media_url text,
  teacher_notes text,
  position integer not null default 0,
  created_by_account_id integer references member_accounts(id) on delete set null,
  created_at text not null default now_text(),
  updated_at text not null default now_text()
);
create index if not exists idx_class_substitute_plans_class on class_substitute_plans(class_id);
