-- A real request: "Parent portal, classroom dashboard. At the top add a
-- button that says Withdraw from co-op classes... On admin side shows up
-- under classes subpage called co-op Withdraw. Listed by family click to
-- view their full schedule and note. Confirm or reject buttons. Confirm
-- removes entire family from co-op classes, teaching positions, assistant
-- positions, floater, setup/cleanup lists etc."
create table if not exists coop_withdrawals (
  id integer generated always as identity primary key,
  family_id integer references families(id) on delete cascade,
  member_id integer references members(id) on delete set null,
  account_id integer references member_accounts(id) on delete set null,
  note text,
  status text not null default 'pending',
  -- What Confirm removed, as JSON (classes/staff spots/lists), for the log.
  removed_json text,
  decided_by text,
  decided_at text,
  created_at text not null default now_text()
);
create index if not exists idx_coop_withdrawals_status on coop_withdrawals(status, created_at);
