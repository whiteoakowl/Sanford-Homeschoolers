-- Security audit: failed sign-in / PIN attempts are now counted in the
-- database instead of in each server instance's memory. On Netlify every
-- request can land on a different (or brand new) function instance, so
-- the old in-memory counter reset constantly and gave almost no real
-- protection against password or 4-digit-PIN guessing.
-- bucket: '<limiter>:<ip or email>' (see utils/persistentRateLimit.js).
create table if not exists login_failures (
  id integer generated always as identity primary key,
  bucket text not null,
  failed_at bigint not null
);
create index if not exists login_failures_bucket_time on login_failures (bucket, failed_at);
alter table public.login_failures enable row level security;
