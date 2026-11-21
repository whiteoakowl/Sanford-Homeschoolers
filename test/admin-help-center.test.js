// Admin Help Center (/admin-help): only Co-op Admins and Main Admins can
// open it; Co-op Admins don't get Main Admin guides; Main Admin guides
// follow page permissions; and nothing leaks through search.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(os.tmpdir(), `admin-help-center-${process.pid}.db`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const adminHelp = require('../utils/helpCenter/admin');
const { generateMemberCode } = require('../utils/members');
const { hashPassword } = require('../utils/portalAuth');

test.before(() => app.ready);

async function makeAccount(email, roleKeys) {
  const code = await generateMemberCode();
  const memberId = (await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, active) VALUES (?, ?, ?, 'parent', 1) RETURNING id").get(email, code, code)).id;
  const accountId = (
    await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text()) RETURNING id").get(memberId, email, hashPassword('testpassword123'))
  ).id;
  for (const key of roleKeys) {
    const role = await db.prepare('SELECT id FROM roles WHERE key = ?').get(key);
    await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountId, role.id);
  }
  const res = await request(app).post('/login').type('form').send({ email, password: 'testpassword123' });
  return res.headers['set-cookie'];
}

const MAIN_SLUGS = [...adminHelp.ARTICLES.values()].filter((a) => a.audiences.every((x) => x === 'main_admin')).map((a) => a.slug);
const COOP_SLUGS = [...adminHelp.ARTICLES.values()].filter((a) => a.audiences.every((x) => x === 'coop_admin')).map((a) => a.slug);

test('signed-out visitors are sent to log in', async () => {
  const res = await request(app).get('/admin-help');
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /^\/login\?next=%2Fadmin-help/);
});

test('parents, students and teachers are turned away', async () => {
  for (const role of ['parent', 'student', 'teacher']) {
    const cookie = await makeAccount(`admin-help-${role}@example.com`, [role]);
    for (const url of ['/admin-help', '/admin-help/faq', '/admin-help/search?q=pin', `/admin-help/a/${COOP_SLUGS[0]}`, `/admin-help/a/${MAIN_SLUGS[0]}`]) {
      const res = await request(app).get(url).set('Cookie', cookie);
      assert.equal(res.status, 403, `${role} ${url}`);
      assert.doesNotMatch(res.text, /Class Check In &amp; Out PIN|Approve Switch|Collect Payment/, `${role} ${url}`);
    }
  }
});

test('a Co-op Admin sees Co-op Admin guides but no Main Admin guides, by link or search', async () => {
  const cookie = await makeAccount('admin-help-coop@example.com', ['coop_admin']);
  const home = await request(app).get('/admin-help').set('Cookie', cookie);
  assert.equal(home.status, 200);
  assert.match(home.text, /Co-op Admin: Getting Started/);
  assert.doesNotMatch(home.text, /Main Admin: (Getting Started|Members|Accounting|Communication|Volunteers|Website)/);
  for (const slug of COOP_SLUGS) assert.equal((await request(app).get(`/admin-help/a/${slug}`).set('Cookie', cookie)).status, 200, slug);
  for (const slug of MAIN_SLUGS) assert.equal((await request(app).get(`/admin-help/a/${slug}`).set('Cookie', cookie)).status, 404, slug);
  const search = await request(app).get('/admin-help/search?q=invoice').set('Cookie', cookie);
  for (const slug of MAIN_SLUGS) assert.doesNotMatch(search.text, new RegExp(`/admin-help/a/${slug}"`), slug);
});

test('the master Main Admin account sees every guide, and every page and link works', async () => {
  const login = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const cookie = login.headers['set-cookie'];
  const home = await request(app).get('/admin-help').set('Cookie', cookie);
  assert.equal(home.status, 200);
  for (const cat of adminHelp.CATEGORIES) {
    assert.equal((await request(app).get(`/admin-help/c/${cat.slug}`).set('Cookie', cookie)).status, 200, cat.slug);
    for (const a of cat.articles) assert.equal((await request(app).get(`/admin-help/a/${a.slug}`).set('Cookie', cookie)).status, 200, a.slug);
  }
  assert.equal((await request(app).get('/admin-help/faq').set('Cookie', cookie)).status, 200);
  for (const [q, slug] of [['kiosk', 'coop-admin-kiosk-setup'], ['pin', 'coop-admin-settings'], ['invoice', 'main-admin-invoices'], ['approve', 'main-admin-approvals'], ['permissions', 'main-admin-portal-permissions'], ['event', 'main-admin-events'], ['registration window', 'coop-admin-class-settings']]) {
    const res = await request(app).get(`/admin-help/search?q=${encodeURIComponent(q)}`).set('Cookie', cookie);
    assert.match(res.text, new RegExp(`/admin-help/a/${slug}"`), `"${q}" should find ${slug}`);
  }
});

test('Main Admin guides follow page permissions', () => {
  const viewer = { audiences: new Set(['main_admin']), permissions: new Set(['manage_events']), allPermissions: false };
  assert.ok(adminHelp.findArticle(viewer, 'main-admin-events'));
  assert.equal(adminHelp.findArticle(viewer, 'main-admin-invoices'), null);
  assert.equal(adminHelp.findArticle(viewer, 'main-admin-approvals'), null);
  assert.ok(adminHelp.searchArticles(viewer, 'invoice').every((r) => r.article.permission === undefined || r.article.permission === 'manage_events'));
});

test('content: every related link and FAQ resolves, and no server internals are documented', () => {
  for (const a of adminHelp.ARTICLES.values()) {
    for (const r of a.related || []) assert.ok(adminHelp.ARTICLES.has(r), `${a.slug} -> ${r}`);
    assert.doesNotMatch(JSON.stringify(a), /supabase|stripe|api key|service_role|vapid|netlify|database password|\.env/i, a.slug);
  }
  for (const f of adminHelp.FAQS) assert.ok(adminHelp.ARTICLES.has(f.article), f.q);
});
