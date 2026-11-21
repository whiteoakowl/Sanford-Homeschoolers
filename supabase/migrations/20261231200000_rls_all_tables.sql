-- Security audit: only the tables from the very first migration had Row
-- Level Security turned on (its own loop at the end). 186 tables added by
-- later migrations - member_accounts (emails + password hashes), members,
-- payments, family-school records, chat, notifications and more - did
-- not. On a Supabase project whose public schema still grants the anon/
-- authenticated roles access by default, anyone holding the project's
-- publishable (anon) key could read or change those tables straight
-- through Supabase's REST API, never touching this app.
--
-- This app never talks to its tables through that API - the server
-- connects as the database owner, which bypasses RLS - so none of this
-- changes how the app behaves. It just closes the side door:
--   1. RLS on for every table in public, now and (re-run safe) later.
--   2. No direct table access for anon/authenticated at all.
--   3. Tables created from now on don't get that access by default.
-- test/rls-every-table.test.js fails if a future migration adds a table
-- without RLS.
do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'alter default privileges in schema public revoke all on tables from anon';
    execute 'alter default privileges in schema public revoke all on sequences from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
    execute 'alter default privileges in schema public revoke all on tables from authenticated';
    execute 'alter default privileges in schema public revoke all on sequences from authenticated';
  end if;
end $$;
