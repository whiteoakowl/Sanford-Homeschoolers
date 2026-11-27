-- A real request: "Accounting information for each member never
-- disappears. Even if the members account is deleted." A member's
-- invoices and payments used to be deleted along with the member row
-- (on delete cascade). Now the database refuses to delete a member who
-- has any invoice, and the app archives that member instead (their
-- login can still be removed). Deleting a login (member_accounts) never
-- touched accounting - account_id is only "who created it".
alter table payment_charges drop constraint if exists payment_charges_member_id_fkey;
alter table payment_charges add constraint payment_charges_member_id_fkey foreign key (member_id) references members(id) on delete restrict;
