-- A real request: "Make sure every type of invoice has due date
-- settings. Make sure invoices can be split to have multiple payments or
-- pay a 2nd part later."
--  * Event tickets billed to an account (online payments off, a waitlist
--    promotion, or an admin-added registration) are due on the event's
--    own payment due date, or the event's date when none is set.
--  * Store orders billed to an account are due a set number of days after
--    the order (Shop settings).
--  * Class fees already use their semester's due date; manual invoices
--    have always had one; every invoice's due date can be edited.
--  * Split Invoice moves part of an unpaid balance into a second invoice
--    with its own due date; split_from_charge_id links it back.
alter table events add column if not exists payment_due_date text;
alter table store_settings add column if not exists payment_due_days integer not null default 7;
alter table payment_charges add column if not exists split_from_charge_id integer references payment_charges(id) on delete cascade;
create index if not exists idx_payment_charges_split_from on payment_charges(split_from_charge_id) where split_from_charge_id is not null;
