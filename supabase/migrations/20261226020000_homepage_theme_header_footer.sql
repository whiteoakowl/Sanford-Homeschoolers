-- A real request: "Add options to edit header and footer of website. Be
-- able to upload images for header." homepage_theme_settings (the
-- earlier homepage_theme_settings migration) already has logo_key/
-- favicon_key for the site header's own small round logo - this adds a
-- genuine header BACKGROUND image (a banner behind the header bar,
-- visually distinct from that small logo once you look at how
-- .site-header actually renders - see views/public-home.ejs) plus a new
-- Footer section: a free-text footerText field (off until an admin fills
-- it in, same "don't show an empty thing" pattern announcement_text
-- already uses) and an optional footer_image_key, both read/written the
-- exact same way logo_key/favicon_key already are (see utils/homepage.js's
-- own themeRowToObject/saveThemeSettings/resetThemeSettings and
-- routes/admin-website.js's own theme-settings POST handler).
alter table homepage_theme_settings add column if not exists header_image_key text;
alter table homepage_theme_settings add column if not exists footer_text text;
alter table homepage_theme_settings add column if not exists footer_image_key text;
