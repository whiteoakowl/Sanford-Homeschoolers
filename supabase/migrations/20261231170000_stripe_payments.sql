-- A real request: "Build the connection" - online card payments through
-- Stripe (utils/stripe.js, utils/onlinePayments.js). Safe to re-run.

-- A payment made online is method 'stripe' (the schema reserved
-- 'stripe_placeholder' for exactly this), with the Stripe PaymentIntent
-- it came from so a refund can go back to the same card.
alter table payment_payments drop constraint if exists payment_payments_method_check;
alter table payment_payments add constraint payment_payments_method_check check (method in ('manual', 'stripe_placeholder', 'stripe'));
alter table payment_payments add column if not exists stripe_payment_intent text;

-- One row per Stripe Checkout a family starts: which charges it covers
-- and for how much, so the payment is recorded exactly once when Stripe
-- confirms it (webhook or the return page, whichever comes first).
create table if not exists stripe_checkouts (
  id integer generated always as identity primary key,
  session_id text unique,
  account_id integer references member_accounts(id) on delete set null,
  member_id integer references members(id) on delete set null,
  charges_json text not null,
  amount_cents integer not null,
  fee_cents integer not null default 0,
  status text not null default 'pending',
  payment_intent text,
  created_at text not null default now_text(),
  completed_at text
);
create index if not exists idx_stripe_checkouts_member on stripe_checkouts(member_id, created_at);

-- A real request: "Admin must approve all refunds, even if the system
-- automated a refund. Admin must confirm it before it is officially
-- finalized." An automatic refund (e.g. a paid class registration
-- removed) waits here until an admin approves it (recorded, and sent back
-- to the card through Stripe if it was paid online) or declines it.
create table if not exists refund_requests (
  id integer generated always as identity primary key,
  charge_id integer not null references payment_charges(id) on delete cascade,
  member_id integer references members(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  reason text,
  source text not null default 'automatic',
  status text not null default 'pending',
  requested_by_account_id integer references member_accounts(id) on delete set null,
  decided_by text,
  decided_at text,
  result text,
  created_at text not null default now_text()
);
create index if not exists idx_refund_requests_status on refund_requests(status, created_at);
