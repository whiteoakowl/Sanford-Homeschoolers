-- A real request: "Event calendar charges are immediate in order to book
-- their ticket. Store charges are immediate and added to a cart for final
-- purchases." A charge created by booking a ticket or checking out the
-- store cart is held until hold_until while the family pays on Stripe.
-- Paid: the hold clears. Not paid in time (or the family cancels on
-- Stripe's page): the ticket/order is released - seat freed, stock put
-- back, charge cancelled.
alter table payment_charges add column if not exists hold_until text;
create index if not exists idx_payment_charges_hold on payment_charges(hold_until) where hold_until is not null;
