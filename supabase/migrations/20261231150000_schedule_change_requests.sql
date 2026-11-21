-- A real request: "Make a schedule change request form. Should be listed
-- under co-op classes. As a family list log. Request form will show
-- students current classes. Parent can choose cancel next to the classes
-- they want to cancel. Then below they can add classes from list of
-- available classes that have room. Admin can approve switch. When it is
-- approved the member is removed from the canceled classes and added to
-- the roster of the new classes. Can decline individual classes additions
-- admin. This also follows invoice/class payment settings."
create table if not exists schedule_change_requests (
  id integer generated always as identity primary key,
  family_id integer references families(id) on delete cascade,
  member_id integer references members(id) on delete set null,
  account_id integer references member_accounts(id) on delete set null,
  note text,
  status text not null default 'pending',
  decided_by text,
  decided_at text,
  created_at text not null default now_text()
);
create index if not exists idx_schedule_change_requests_status on schedule_change_requests(status, created_at);

-- One row per class to cancel ('drop') or add ('add') for one student.
create table if not exists schedule_change_items (
  id integer generated always as identity primary key,
  request_id integer not null references schedule_change_requests(id) on delete cascade,
  student_id integer not null references members(id) on delete cascade,
  class_id integer not null references classes(id) on delete cascade,
  action text not null check (action in ('drop', 'add')),
  status text not null default 'pending',
  result text
);
create index if not exists idx_schedule_change_items_request on schedule_change_items(request_id);
