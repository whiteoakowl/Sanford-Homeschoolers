// A real request: "to change the role permissions for each admin, you
// should be able to go to the admin settings page, click on each admin
// title and then there will be a popup to check which permissions that
// admin may have. Save button and close button." Roles & Permissions used
// to show every role's full permission checkbox grid expanded inline,
// permanently on the page - each role's title (member-name-link, the same
// button-reset-to-plain-link class the Archive tables already use to open
// a popup) now opens its own <dialog> with that role's own checkboxes plus
// Save/Close, instead of a wall of always-visible grids.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `main-admin-roles-dialog-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `main-admin-roles-dialog-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.MAIN_ADMIN_EMAIL = 'mainadmin@coop.local';
process.env.MAIN_ADMIN_PASSWORD = 'changeme123';

const request = require('supertest');
const app = require('../server');
const db = require('../db');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

async function loginAsMainAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/main-admin' });
  return loginRes.headers['set-cookie'];
}

test('Portal Permissions: each non-Main-Admin role has a centered title, portal key underneath, and a "View" button opening its own dialog with Save/Close', async () => {
  const cookie = await loginAsMainAdmin();
  const res = await request(app).get('/main-admin/roles').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /<h1>Portal Permissions<\/h1>/);

  const role = await db.prepare("SELECT * FROM roles WHERE key != 'main_admin' LIMIT 1").get();
  assert.ok(role, 'expected at least one non-Main-Admin role to exist');

  // A real request: "each portal card should have a centered title,
  // portal key listed stacked underneath in next row." The title is now
  // a plain heading (not the dialog trigger itself) - a separate "View"
  // button opens this role's own dialog by id.
  const cardRe = new RegExp(
    `<section class="portal-dashboard-card main-admin-portal-permissions-card">\\s*<h2>${role.label}</h2>\\s*<p class="hint">portal key: ${role.key}</p>`
  );
  assert.match(res.text, cardRe);
  const viewBtnRe = new RegExp(`<button type="button" class="roster-action-btn" onclick="document\\.getElementById\\('role-permissions-dialog-${role.id}'\\)\\.showModal\\(\\)">View</button>`);
  assert.match(res.text, viewBtnRe);

  const dialogMatch = new RegExp(`<dialog id="role-permissions-dialog-${role.id}"[^]*?</dialog>`).exec(res.text);
  assert.ok(dialogMatch, 'expected this role to have its own dialog');
  const dialogHtml = dialogMatch[0];
  // A real request: "it says view, not manage. Portals will not have
  // management controls. Only admins." Same editable checkboxes/Save as
  // before (only an account with manage_roles can even reach this page)
  // - just worded as viewing a portal's pages rather than "managing
  // permissions".
  assert.match(dialogHtml, new RegExp(`<h3>View ${role.label}'s Pages</h3>`));
  assert.match(dialogHtml, /class="permission-checkbox-grid"/);
  assert.match(dialogHtml, new RegExp(`action="/main-admin/roles/${role.id}/permissions"`));
  assert.match(dialogHtml, /<button type="button" class="btn-secondary" onclick="this\.closest\('dialog'\)\.close\(\)">Close<\/button>/);
  assert.match(dialogHtml, /<button type="submit" class="primary-btn">Save<\/button>/);

  // The old always-expanded-inline form/checkbox-grid shape (one big
  // "Save Permissions for X" button per role, no dialog) should be gone.
  assert.doesNotMatch(res.text, /Save Permissions for/);
});

test('saving a role\'s permissions through the dialog\'s own form still persists correctly', async () => {
  const cookie = await loginAsMainAdmin();
  const page = await request(app).get('/main-admin/roles').set('Cookie', cookie);
  const csrfToken = /name="csrf-token" content="([^"]*)"/.exec(page.text)[1];

  // A permission that's actually part of this role's own catalog -
  // POST /roles/:id/permissions now scopes the save to exactly that
  // catalog (see the Family School Management test below for why), so
  // submitting an arbitrary permission id from a different role/portal
  // entirely would get silently dropped rather than saved.
  const role = await db.prepare("SELECT * FROM roles WHERE key = 'student'").get();
  assert.ok(role, 'expected a student role to exist');
  const perm = await db.prepare("SELECT id FROM permissions WHERE key = 'view_student_games'").get();
  assert.ok(perm, 'expected the seeded view_student_games permission to exist');

  const res = await request(app)
    .post(`/main-admin/roles/${role.id}/permissions`)
    .set('Cookie', cookie)
    .type('form')
    .send({ permissionIds: String(perm.id), _csrf: csrfToken });
  assert.equal(res.status, 302);

  const grant = await db.prepare('SELECT 1 FROM role_permissions WHERE role_id = ? AND permission_id = ?').get(role.id, perm.id);
  assert.ok(grant, 'the permission should have been saved');
});

// A real request: "Family school management is its own portal" - it has
// no DB role of its own (both this card and the real Parent card save
// against the exact same 'parent' role), so this locks in the two things
// that request actually needs: its own standing card/dialog, and that
// saving either dialog never wipes out the other's grants on that shared
// role.
test('Family School Management gets its own card/dialog, and saving it never wipes out Parent\'s own grants on the same role', async () => {
  const cookie = await loginAsMainAdmin();
  const page = await request(app).get('/main-admin/roles').set('Cookie', cookie);
  const csrfToken = /name="csrf-token" content="([^"]*)"/.exec(page.text)[1];

  const parentRole = await db.prepare("SELECT * FROM roles WHERE key = 'parent'").get();
  assert.ok(parentRole, 'expected a parent role to exist');

  assert.match(
    page.text,
    /<section class="portal-dashboard-card main-admin-portal-permissions-card">\s*<h2>Family School Management<\/h2>\s*<p class="hint">portal key: family_school<\/p>/
  );
  const dialogMatch = /<dialog id="role-permissions-dialog-family-school"[^]*?<\/dialog>/.exec(page.text);
  assert.ok(dialogMatch, 'expected Family School Management to have its own dialog');
  const dialogHtml = dialogMatch[0];
  assert.match(dialogHtml, new RegExp(`action="/main-admin/roles/${parentRole.id}/permissions"`));
  assert.match(dialogHtml, /<input type="hidden" name="scope" value="family_school" \/>/);
  assert.match(dialogHtml, /<h3>View Family School Management's Pages<\/h3>/);

  const parentPagePerm = await db.prepare("SELECT id FROM permissions WHERE key = 'view_parent_chat'").get();
  const fsmPerm = await db.prepare("SELECT id FROM permissions WHERE key = 'view_fsm_portfolio'").get();
  assert.ok(parentPagePerm && fsmPerm, 'expected the seeded Parent and Family School permissions to exist');

  // Start with both granted, as a fresh seed already does - confirm the
  // starting state this test's own assertions below depend on.
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(parentRole.id, parentPagePerm.id);
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(parentRole.id, fsmPerm.id);

  // Save the Family School dialog's own form with an EMPTY checkbox
  // selection (every FSM box unchecked) - a full, unscoped replace would
  // delete every row this role holds, including the unrelated Parent
  // Portal permission just granted above; the scoped replace should only
  // ever touch Family School's own keys.
  const res = await request(app)
    .post(`/main-admin/roles/${parentRole.id}/permissions`)
    .set('Cookie', cookie)
    .type('form')
    .send({ scope: 'family_school', _csrf: csrfToken });
  assert.equal(res.status, 302);

  const fsmGrant = await db.prepare('SELECT 1 FROM role_permissions WHERE role_id = ? AND permission_id = ?').get(parentRole.id, fsmPerm.id);
  assert.equal(fsmGrant, undefined, 'unchecking Family School\'s own box should have removed its own grant');
  const parentGrantStillThere = await db.prepare('SELECT 1 FROM role_permissions WHERE role_id = ? AND permission_id = ?').get(parentRole.id, parentPagePerm.id);
  assert.ok(parentGrantStillThere, 'the unrelated Parent Portal permission should have survived saving the Family School dialog');
});
