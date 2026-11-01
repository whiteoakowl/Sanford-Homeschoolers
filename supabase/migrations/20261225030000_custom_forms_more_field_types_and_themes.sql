-- Main Admin portal, Forms tab - two more real requests on top of
-- supabase/migrations/20261225020000_custom_forms_more_field_types.sql:
--
-- 1. "Look at all of the basic and widget list of elements to add on
--    jotform. Include all of them." Jotform's own "Widgets" category is
--    an open-ended 300+ item third-party marketplace with no fixed
--    list, so this adds the rest of Jotform's actual fixed "Basic
--    Elements" (Image, Input Table/Matrix) plus a few generic widget-
--    style elements that make sense for this app (Divider, embedded
--    Video, a Spinner/slider number input) - scoped down from "all of
--    them" with the user's own go-ahead. See utils/customForms.js's own
--    FIELD_TYPES/DISPLAY_ONLY_TYPES for what each one does.
-- 2. "Be able to add fun visual themes to custom forms, holidays,
--    activities, sports etc." - a curated preset on top of the existing
--    theme_primary_color/theme_button_style columns (supabase/
--    migrations/20261225010000_custom_forms_builder_upgrade.sql),
--    optionally also setting a decorative emoji shown next to the
--    form's own title. Picking a preset pre-fills the existing color/
--    button fields rather than replacing them - an admin can still
--    freely override the color after picking one, so "theme" here never
--    becomes a second, conflicting source of truth for color.

alter table custom_form_fields drop constraint if exists custom_form_fields_field_type_check;
alter table custom_form_fields add constraint custom_form_fields_field_type_check
  check (field_type in (
    'short_text', 'long_text', 'number', 'date', 'single_choice', 'multiple_choice',
    'dropdown', 'checkbox', 'file', 'email', 'phone', 'url', 'rating', 'scale',
    'heading', 'paragraph', 'full_name', 'address', 'appointment', 'signature', 'fill_blank',
    'image', 'input_table', 'divider', 'video', 'spinner'
  ));

-- Image - a decorative picture placed in the form (Jotform's own
-- "Image" element - distinct from the existing File Upload type, which
-- is a respondent-submitted answer, not admin-placed content). Display-
-- only, like heading/paragraph (utils/customForms.js's DISPLAY_ONLY_TYPES) -
-- never an answer, so it needs its own storage key rather than reusing
-- any answer column. Same local-disk-or-Supabase-Storage key convention
-- as every other image upload in this app (routes/admin-custom-forms.js's
-- own saveFieldImageIfProvided, modeled on routes/admin-website.js's
-- saveBlockImageIfProvided).
alter table custom_form_fields add column if not exists image_path text;

-- Input Table / Matrix - a grid of rows x columns, one single-select
-- answer per row (e.g. "Monday / Can attend, Can't attend, Maybe").
-- Rows reuse the existing custom_form_field_options table (same table
-- single_choice/multiple_choice/dropdown already use for their own
-- options) - this column is just the column headers, newline-separated
-- same as every "one per line" textarea already in this builder.
alter table custom_form_fields add column if not exists matrix_columns text;

alter table custom_forms add column if not exists theme_preset text not null default 'none';
alter table custom_forms drop constraint if exists custom_forms_theme_preset_check;
alter table custom_forms add constraint custom_forms_theme_preset_check
  check (theme_preset in ('none', 'halloween', 'christmas', 'valentines', 'back_to_school', 'sports', 'summer', 'spring'));
