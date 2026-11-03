// A real request: "Members who already were on the list and imported
// before changes were made. The primary parent should automatically have
// the changeme123 password and be able to be assigned to sections and
// portals." Covers db/bootstrapPg.js's backfillPrimaryParentAccounts (run
// at every boot) and utils/portalPermissions.js's login-on-first-portal.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `primary-parent-backfill-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `primary-parent-backfill-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { backfillPrimaryParentAccounts } = require('../db/bootstrapPg');
const { setMemberRoles, addMemberRoles, setMemberSections } = require('../utils/portalPermissions');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

async function addMember(name, { email = null, primary = 0, type = 'parent', active = 1 } = {}) {
  const fam = (await db.prepare('INSERT INTO families (name) VALUES (?)').run(`${name} Family`)).lastInsertRowid;
  return (
    await db
      .prepare('INSERT INTO members (name, barcode, member_code, member_type, family_id, is_primary_parent, active, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(name, name, name, type, fam, primary, active, email)
  ).lastInsertRowid;
}
const accountFor = (memberId) => db.prepare('SELECT * FROM member_accounts WHERE member_id = ?').get(memberId);

test('existing primary parents with an email get a changeme123 login with Parent Portal; others are left alone', async () => {
  const primary = await addMember('Imported Primary', { email: 'imported.primary@example.com', primary: 1 });
  const nonPrimary = await addMember('Imported Second Parent', { email: 'second.parent@example.com', primary: 0 });
  const noEmail = await addMember('Imported No Email', { primary: 1 });
  const inactive = await addMember('Imported Inactive', { email: 'inactive.primary@example.com', primary: 1, active: 0 });

  await backfillPrimaryParentAccounts(db);
  await backfillPrimaryParentAccounts(db);

  assert.ok(await accountFor(primary), 'primary parent got a login');
  assert.equal((await db.prepare('SELECT COUNT(*) AS c FROM member_accounts WHERE member_id = ?').get(primary)).c, 1, 'running twice does not duplicate it');
  assert.equal(await accountFor(nonPrimary), undefined);
  assert.equal(await accountFor(noEmail), undefined);
  assert.equal(await accountFor(inactive), undefined);

  const login = await request(app).post('/login').type('form').send({ email: 'imported.primary@example.com', password: 'changeme123', next: '/parent' });
  assert.equal(login.status, 302);
  assert.equal(login.headers.location, '/parent', 'the changeme123 password works and lands in Parent Portal');
  const roles = await db.prepare('SELECT r.key FROM member_account_roles mar JOIN roles r ON r.id = mar.role_id WHERE mar.member_account_id = ?').all((await accountFor(primary)).id);
  assert.deepEqual(roles.map((r) => r.key), ['parent']);
});

test('assigning a portal to an older member with no login creates one; sections work without a login', async () => {
  const member = await addMember('Old Member With Email', { email: 'old.member@example.com' });
  const parentRole = await db.prepare("SELECT id FROM roles WHERE key = 'parent'").get();
  assert.equal(await setMemberRoles(member, [parentRole.id], null), true);
  assert.ok(await accountFor(member), 'a login was created on first portal assignment');

  const bulkMember = await addMember('Old Bulk Member', { email: 'old.bulk@example.com' });
  assert.equal(await addMemberRoles(bulkMember, [parentRole.id], null), true);
  assert.ok(await accountFor(bulkMember));

  const noEmail = await addMember('Old No Email Member');
  assert.equal(await setMemberRoles(noEmail, [parentRole.id], null), false, 'no email means no login to create');
  assert.equal(await setMemberRoles(await addMember('Old No Portal', { email: 'old.noportal@example.com' }), [], null), false, 'choosing no portal does not create a login');

  const section = (await db.prepare("INSERT INTO sections (name) VALUES ('Backfill Section') RETURNING id").get()).id;
  await setMemberSections(noEmail, [section]);
  assert.ok(await db.prepare('SELECT 1 FROM member_sections WHERE member_id = ? AND section_id = ?').get(noEmail, section));
});

test('the member edit page offers the Portals picker for a member with an email but no login yet', async () => {
  const member = await addMember('Edit Page Older Member', { email: 'edit.older@example.com' });
  const noEmail = await addMember('Edit Page No Email');
  const login = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/admin' });
  const cookie = login.headers['set-cookie'];
  const page = await request(app).get(`/admin/members/${member}/edit`).set('Cookie', cookie);
  assert.equal(page.status, 200);
  assert.match(page.text, new RegExp(`name="roleIds_${member}"`));
  assert.match(page.text, /saving with a portal selected creates one \(password changeme123\)/);
  const page2 = await request(app).get(`/admin/members/${noEmail}/edit`).set('Cookie', cookie);
  assert.match(page2.text, /Add an email to this member to give them portal access/);
});
