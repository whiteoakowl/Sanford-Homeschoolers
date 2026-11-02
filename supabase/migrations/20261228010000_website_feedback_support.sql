-- A real request: "Parent portal homepage. Add button called Website
-- Feedback and support. Main admin portal add a support tab with
-- Website feedback subpage and [Support] subpage. Both pages have a
-- create form button, allows you to add different fields like jotform.
-- Then a log of entries on each page... On those logs there should be a
-- complete button to mark them done." See utils/supportRequests.js.

-- Each request type's own extra fields ("create form") are built in the
-- existing Custom Forms builder: one dedicated custom_forms row per type,
-- tagged here so it's hidden from the regular Custom Forms list and from
-- /forms (utils/customForms.js's listForms/formsVisibleTo).
alter table custom_forms add column if not exists system_key text;
create unique index if not exists idx_custom_forms_system_key on custom_forms(system_key) where system_key is not null;

-- One row per submitted contact form. Not custom_form_submissions -
-- that table is unique per (form, member), and a parent can send any
-- number of these. extra_answers_json snapshots each extra field's own
-- label/type alongside its answer ([{fieldId, label, fieldType,
-- valueText, choiceLabels}]), so the log still reads correctly after an
-- admin renames or deletes a field.
create table if not exists support_requests (
  id integer generated always as identity primary key,
  request_type text not null check (request_type in ('feedback', 'support')),
  subject text not null,
  message text not null,
  member_id integer references members(id) on delete set null,
  submitted_by_account_id integer references member_accounts(id) on delete set null,
  extra_answers_json text,
  submitted_at text not null default now_text(),
  completed_at text,
  completed_by_account_id integer references member_accounts(id) on delete set null
);
create index if not exists idx_support_requests_type on support_requests(request_type, completed_at);
