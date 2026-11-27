-- A real request: "Contact button and page." The public site's contact
-- form (site element 'contactform', routes/contact.js) logs each message
-- in Main Admin > Support > Contact Messages - same log, complete/reopen
-- and filters as Website Feedback/Support, but from someone who may not
-- have an account, so their name/email/phone are kept on the row.
alter table support_requests drop constraint if exists support_requests_request_type_check;
alter table support_requests add constraint support_requests_request_type_check check (request_type in ('feedback', 'support', 'contact'));
alter table support_requests add column if not exists contact_name text;
alter table support_requests add column if not exists contact_email text;
alter table support_requests add column if not exists contact_phone text;

insert into notification_types (key, label, description) values
  ('website_contact_message', 'Website Contact Message', 'Someone sent a message from the public website''s contact form (Main Admin).')
on conflict (key) do nothing;
