// Member Help Center (/help): signed-in only, role-aware, and never
// shows Co-op Admin or Main Admin material to members who aren't admins
// - not through browsing, direct links, or search.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(os.tmpdir(), `help-center-${process.pid}.db`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const help = require('../utils/helpCenter');
const { generateMemberCode } = require('../utils/members');
const { hashPassword } = require('../utils/portalAuth');

test.before(() => app.ready);

async function makeAccount(email, roleKeys, memberType = 'parent') {
  const code = await generateMemberCode();
  const memberId = (await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, active) VALUES (?, ?, ?, ?, 1) RETURNING id").get(email, code, code, memberType)).id;
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

// Admin guides live only in the Admin Help Center (/admin-help).
const ADMIN_ONLY_SLUGS = [...require('../utils/helpCenter/admin').ARTICLES.keys()];
const INTERNAL_WORDS = /supabase|stripe|api key|database|service_role|vapid|netlify|main admin portal/i;

test('signed-out visitors are sent to log in and returned to the Help Center', async () => {
  for (const url of ['/help', '/help/faq', '/help/search?q=class', '/help/a/register-for-a-class', '/help/c/classes']) {
    const res = await request(app).get(url);
    assert.equal(res.status, 302, url);
    assert.match(res.headers.location, /^\/login\?next=/, url);
    assert.ok(decodeURIComponent(res.headers.location).includes(url.split('?')[0]), url);
  }
});

test('a parent sees parent help, but no Co-op Admin help, by browsing, link or search', async () => {
  const cookie = await makeAccount('help-parent@example.com', ['parent']);
  const home = await request(app).get('/help').set('Cookie', cookie);
  assert.equal(home.status, 200);
  assert.match(home.text, /Classes &amp; Registration/);
  assert.doesNotMatch(home.text, /href="\/help\/c\/coop-admin"/);

  assert.equal((await request(app).get('/help/a/register-for-a-class').set('Cookie', cookie)).status, 200);
  assert.ok(ADMIN_ONLY_SLUGS.length > 0);
  for (const slug of ADMIN_ONLY_SLUGS) {
    assert.equal((await request(app).get(`/help/a/${slug}`).set('Cookie', cookie)).status, 404, slug);
  }
  const search = await request(app).get('/help/search?q=kiosk+pin').set('Cookie', cookie);
  for (const slug of ADMIN_ONLY_SLUGS) assert.doesNotMatch(search.text, new RegExp(`/help/a/${slug}"`), slug);
  const faq = await request(app).get('/help/faq').set('Cookie', cookie);
  assert.doesNotMatch(faq.text, /unlock the kiosk for the day/);
});

test('a student sees student help and not parent-only or admin help', async () => {
  const cookie = await makeAccount('help-student@example.com', ['student'], 'student');
  const home = await request(app).get('/help').set('Cookie', cookie);
  assert.match(home.text, /For Students/);
  assert.equal((await request(app).get('/help/a/student-portal-overview').set('Cookie', cookie)).status, 200);
  assert.equal((await request(app).get('/help/a/register-for-a-class').set('Cookie', cookie)).status, 404);
  assert.equal((await request(app).get('/help/a/take-attendance').set('Cookie', cookie)).status, 404);
  assert.equal((await request(app).get('/help/c/coop-admin').set('Cookie', cookie)).status, 404);
});

test('a teacher sees teacher help', async () => {
  const cookie = await makeAccount('help-teacher@example.com', ['teacher']);
  assert.equal((await request(app).get('/help/a/take-attendance').set('Cookie', cookie)).status, 200);
  assert.equal((await request(app).get('/help/a/lesson-plans').set('Cookie', cookie)).status, 200);
});

test('search finds the right articles and handles no results', async () => {
  const cookie = await makeAccount('help-search@example.com', ['parent']);
  for (const [q, slug] of [
    ['register', 'register-for-a-class'], ['class', 'find-classes'], ['schedule', 'view-your-schedule'], ['absence', 'report-an-absence'],
    ['event', 'register-for-an-event'], ['calendar', 'view-the-calendar'], ['password', 'change-password'], ['profile', 'edit-your-profile'],
    ['family', 'add-a-child'], ['notification', 'notification-preferences'], ['name tag', 'print-your-name-tags'], ['print', 'print-and-export'],
    ['barcode', 'check-in-at-the-kiosk'], ['payment', 'how-to-pay'], ['membership', 'how-membership-works'], ['volunteer', 'volunteer-assignments'],
    ['cleanup', 'setup-cleanup-teams'], ['attendance', 'view-attendance'],
  ]) {
    const res = await request(app).get(`/help/search?q=${encodeURIComponent(q)}`).set('Cookie', cookie);
    assert.equal(res.status, 200, q);
    assert.match(res.text, new RegExp(`/help/a/${slug}"`), `"${q}" should find ${slug}`);
  }
  const none = await request(app).get('/help/search?q=zzqqxx').set('Cookie', cookie);
  assert.match(none.text, /No matching articles/);
  const xss = await request(app).get('/help/search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E').set('Cookie', cookie);
  assert.doesNotMatch(xss.text, /<script>alert\(1\)<\/script>/);
});

test('every visible page and link works for a parent+teacher+student+co-op admin account', async () => {
  const cookie = await makeAccount('help-all@example.com', ['parent', 'teacher', 'student', 'coop_admin']);
  const viewer = { audiences: new Set(['member', 'parent', 'teacher', 'student', 'coop_admin']), permissions: new Set(), allPermissions: true };
  for (const cat of help.visibleCategories(viewer)) {
    assert.equal((await request(app).get(`/help/c/${cat.slug}`).set('Cookie', cookie)).status, 200, cat.slug);
    for (const a of cat.articles) {
      const res = await request(app).get(`/help/a/${a.slug}`).set('Cookie', cookie);
      assert.equal(res.status, 200, a.slug);
    }
  }
  assert.equal((await request(app).get('/help/a/no-such-article').set('Cookie', cookie)).status, 404);
  assert.match((await request(app).get('/help/a/no-such-article').set('Cookie', cookie)).text, /find that help page/);
});

test('content: every related link and FAQ points at a real article, and nothing internal is documented', () => {
  for (const a of help.ARTICLES.values()) {
    for (const r of a.related || []) assert.ok(help.ARTICLES.has(r), `${a.slug} -> ${r}`);
    const text = JSON.stringify(a);
    assert.doesNotMatch(text, INTERNAL_WORDS, `${a.slug} mentions internal details`);
    assert.doesNotMatch(text, /\/main-admin/, `${a.slug} links into Main Admin`);
  }
  for (const f of help.FAQS) assert.ok(help.ARTICLES.has(f.article), f.q);
});

test('the Help link keeps the portal\'s menu, and Help pages show that portal\'s own menu', async () => {
  const cookie = await makeAccount('help-nav@example.com', ['parent']);
  const page = await request(app).get('/parent').set('Cookie', cookie);
  assert.match(page.text, /href="\/help\?portal=parent"/);
  const helpPage = await request(app).get('/help?portal=parent').set('Cookie', cookie);
  assert.match(helpPage.text, /<span class="brand-text">Parent Portal|Parent Portal/);
  // No Help Center links take over the phone's bottom bar.
  const bottom = /<nav class="admin-mobile-tabs"[\s\S]*?<\/nav>/.exec(helpPage.text)[0];
  assert.doesNotMatch(bottom, /Help Center|Search Help|>FAQ</);
});
