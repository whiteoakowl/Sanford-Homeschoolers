-- A real request: "The website homepage editor was built to mimic
-- shopify. I would like to switch that to wix." The Wix-style site
-- editor (Main Admin > Settings > Public Homepage, routes/admin-
-- website.js, utils/siteBuilder.js) keeps the WHOLE public site - pages,
-- sections, freely positioned elements, header/menu, design, SEO - as
-- one JSON document, with a separate draft (autosaved by the editor) and
-- published snapshot (what the public site renders). Plain text columns,
-- not jsonb, so PGlite (local dev) and Supabase behave identically.
-- homepage_blocks/homepage_menu_items/homepage_theme_settings are left in
-- place, untouched: utils/siteBuilder.js converts them into the first
-- draft/published document once (converted_at), and they stay as the
-- pre-conversion backup.
create table if not exists site_builder_state (
  id integer primary key default 1,
  draft_json text,
  draft_rev integer not null default 0,
  draft_updated_at text,
  published_json text,
  published_at text,
  published_by_account_id integer references member_accounts(id) on delete set null,
  converted_at text,
  constraint site_builder_state_singleton check (id = 1)
);

insert into site_builder_state (id) values (1)
  on conflict (id) do nothing;

-- One row per Publish, newest first in the editor's Version History -
-- "Restore" copies a row's doc back into the draft (never straight to
-- live), so restoring is itself undoable by not publishing.
create table if not exists site_versions (
  id integer generated always as identity primary key,
  doc_json text not null,
  label text,
  published_at text not null default now_text(),
  published_by_account_id integer references member_accounts(id) on delete set null
);
create index if not exists idx_site_versions_published_at on site_versions(published_at);

-- Media Manager library. Elements reference a media row by id (never a
-- raw storage key), so "Replace" swaps the file everywhere it's used.
-- image_key lives in the existing 'homepage-images' bucket (or
-- public/uploads/homepage/ locally) - same bucket the old editor used.
create table if not exists site_media (
  id integer generated always as identity primary key,
  image_key text not null,
  kind text not null default 'image' check (kind in ('image', 'video')),
  display_name text not null default '',
  folder text not null default '',
  alt_text text not null default '',
  mime_type text,
  size_bytes integer,
  width integer,
  height integer,
  focal_x integer not null default 50 check (focal_x between 0 and 100),
  focal_y integer not null default 50 check (focal_y between 0 and 100),
  created_at text not null default now_text(),
  updated_at text not null default now_text()
);
create index if not exists idx_site_media_folder on site_media(folder);

-- "Save as my section" - a reusable copy of one section (its elements
-- included) offered back in the editor's Add Section panel.
create table if not exists site_saved_sections (
  id integer generated always as identity primary key,
  name text not null,
  section_json text not null,
  created_at text not null default now_text()
);
