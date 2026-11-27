-- A real request: "Under parent settings. There should be a tab for
-- delete account, in red... Add delete account notification to main
-- admin notification menu. Member delete requests is a subpage under
-- members." Deleting closes the account straight away (status 'closed',
-- email released so the family can sign up again later) and logs a
-- request here for a Main Admin to finish removing the member's records.
alter table member_accounts drop constraint if exists member_accounts_status_check;
alter table member_accounts add constraint member_accounts_status_check check (status in ('pending', 'active', 'suspended', 'denied', 'closed'));

create table if not exists member_delete_requests (
  id integer generated always as identity primary key,
  account_id integer references member_accounts(id) on delete set null,
  member_id integer references members(id) on delete set null,
  member_name text not null,
  email text,
  family_name text,
  balance_cents integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'deleted', 'dismissed')),
  created_at text not null default now_text(),
  decided_at text,
  decided_by_account_id integer references member_accounts(id) on delete set null
);
create index if not exists idx_member_delete_requests_status on member_delete_requests(status, created_at);

insert into notification_types (key, label, description) values
  ('member_delete_request', 'Member Account Deleted', 'A member deleted their account from Parent Portal Settings (Main Admin).')
on conflict (key) do nothing;

-- Same as every other table (20261231200000_rls_all_tables.sql): the app
-- connects as the owner; nothing reaches this table through Supabase's
-- public API.
alter table public.member_delete_requests enable row level security;
