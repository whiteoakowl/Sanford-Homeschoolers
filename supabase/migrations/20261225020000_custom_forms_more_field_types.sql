-- Main Admin portal, Forms tab - a real request: "Add element should
-- include all of jotform's basic options and widget options" (with a
-- screenshot of Jotform's own "Form Elements" panel: Heading, Full
-- Name, Email, Address, Phone, Date Picker, Appointment, Signature,
-- Fill in the Blank, ...). This app already had 16 of those (see
-- utils/customForms.js's own FIELD_TYPES and the original field_type
-- check constraint, supabase/migrations/20261225010000_custom_forms_
-- builder_upgrade.sql) - this adds the five that were still missing:
-- full_name, address, appointment, signature, fill_blank. No new
-- columns needed - every one of these still stores its answer as plain
-- text in custom_form_answers.value_text (full_name/address/appointment
-- as a combined display string, signature as a PNG data URL, fill_blank
-- as a JSON array of its blanks), same as every other non-choice field
-- type already does.

alter table custom_form_fields drop constraint if exists custom_form_fields_field_type_check;
alter table custom_form_fields add constraint custom_form_fields_field_type_check
  check (field_type in (
    'short_text', 'long_text', 'number', 'date', 'single_choice', 'multiple_choice',
    'dropdown', 'checkbox', 'file', 'email', 'phone', 'url', 'rating', 'scale',
    'heading', 'paragraph', 'full_name', 'address', 'appointment', 'signature', 'fill_blank'
  ));
