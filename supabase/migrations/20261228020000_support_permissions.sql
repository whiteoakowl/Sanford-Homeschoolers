-- Main Admin's new Support tab (routes/main-admin-support.js) - its own
-- page permission (Website Feedback, the tab's first subpage) plus one
-- for its Support subpage, same shape every other Main Admin tab got in
-- 20261226010000_portal_page_permissions.sql. db/bootstrapPg.js's own
-- PORTAL_PERMISSIONS and utils/portalPageCatalog.js's MAIN_ADMIN_PAGES
-- carry the same two keys by hand.
insert into permissions (key, label, description, portal) values
  ('manage_support', 'Manage Support', 'Manage the Support page’s Website Feedback log and its contact form fields.', 'main_admin'),
  ('view_support_requests', 'Manage Support: Support', 'Manage the Support page’s Support log and its contact form fields.', 'main_admin')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.key in (
  'manage_support',
  'view_support_requests'
) where r.key = 'main_admin'
on conflict (role_id, permission_id) do nothing;
