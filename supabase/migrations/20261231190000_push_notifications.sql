-- Push notifications. Each phone/tablet/computer a member turns push on
-- for gets one row here (a browser "push subscription": the endpoint the
-- browser's push service gave it, plus the two public keys the payload
-- is encrypted with). A member can have several devices. Rows are
-- deleted when the member turns push off on that device, signs the
-- device out of push, or the push service reports the subscription is
-- gone (utils/pushProvider.js).
create table if not exists push_subscriptions (
  id integer generated always as identity primary key,
  member_account_id integer not null references member_accounts(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at text not null default now_text(),
  last_success_at text
);
create index if not exists push_subscriptions_account on push_subscriptions (member_account_id);
alter table public.push_subscriptions enable row level security;

-- Main Admin's per-type on/off switch for push, alongside the existing
-- email and text switches. On by default, like the others.
alter table notification_types add column if not exists auto_send_push_enabled integer not null default 1;

-- notify() now records a 'push' delivery row too.
alter table notification_deliveries drop constraint if exists notification_deliveries_channel_check;
alter table notification_deliveries add constraint notification_deliveries_channel_check check (channel in ('in_app', 'email', 'sms', 'push'));
