// Coverage for the Wix-style site editor (routes/admin-website.js,
// routes/public-site.js, utils/siteBuilder.js, public/js/site-render.js) -
// a real request: "The website homepage editor was built to mimic
// shopify. I would like to switch that to wix." Server-side validation
// of the site document, draft vs publish, versioned media replace, page
// URLs (reserved paths, members-only), the freeform header conversion,
// and sitemap.xml/robots.txt.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `site-builder-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `site-builder-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.MAIN_ADMIN_EMAIL = 'mainadmin@coop.local';
process.env.MAIN_ADMIN_PASSWORD = 'changeme123';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const site = require('../utils/siteBuilder');

const LOGO = fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'logo.png'));
const createdKeys = [];

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
  // Media uploads land in public/uploads/homepage/ locally (no Storage).
  for (const key of createdKeys) fs.rmSync(path.join(__dirname, '..', 'public', 'uploads', 'homepage', key), { force: true });
});

async function loginAsMainAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/main-admin' });
  const cookie = loginRes.headers['set-cookie'];
  const page = await request(app).get('/main-admin/website/editor').set('Cookie', cookie);
  const csrfToken = /name="csrf-token" content="([^"]*)"/.exec(page.text)[1];
  return { cookie, csrfToken };
}
async function getState(admin) {
  const res = await request(app).get('/main-admin/website/api/state').set('Cookie', admin.cookie);
  assert.equal(res.status, 200);
  return res.body;
}
async function putDraft(admin, doc, rev) {
  return request(app).put('/main-admin/website/api/draft').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrfToken).send({ doc, rev });
}
async function publish(admin) {
  const res = await request(app).post('/main-admin/website/api/publish').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrfToken).send({});
  assert.equal(res.status, 200);
  return res.body;
}
function textEl(id, html, extra) {
  return { id, type: 'text', layout: { desktop: { x: 40, y: 20, w: 600, h: 60 } }, props: { tag: 'p', html }, style: {}, z: 1, ...(extra || {}) };
}
async function homeWith(admin, elements) {
  const st = await getState(admin);
  const home = st.draft.pages.find((p) => p.isHome);
  home.sections.unshift({ id: 'stest', name: 'Test strip', height: { desktop: 300 }, bg: { type: 'color' }, elements });
  return { st, res: await putDraft(admin, st.draft, st.rev) };
}

test('existing homepage content is converted once into the site document', async () => {
  const admin = await loginAsMainAdmin();
  const st = await getState(admin);
  const home = st.draft.pages.find((p) => p.isHome);
  assert.ok(home, 'a homepage exists');
  const html = JSON.stringify(home.sections);
  assert.match(html, /A homeschool community built on connection/, 'seeded hero block text survives the conversion');
  assert.ok(home.sections.some((s) => s.elements.some((e) => e.type === 'faq')), 'the old fixed FAQ section becomes an FAQ widget');
  const before = await db.prepare('SELECT converted_at, draft_json FROM site_builder_state WHERE id = 1').get();
  await getState(admin);
  const after = await db.prepare('SELECT converted_at, draft_json FROM site_builder_state WHERE id = 1').get();
  assert.equal(after.converted_at, before.converted_at, 'conversion runs only once');
  assert.equal(after.draft_json, before.draft_json);
});

test('rich text keeps only allowlisted span styles and strips scripts/javascript: links', async () => {
  const admin = await loginAsMainAdmin();
  const dirty =
    '<span style="font-family: &quot;Dancing Script&quot;, cursive; position: fixed">A</span>' +
    '<span style="font-size: 30px; background-image: url(x)">B</span>' +
    '<span style="font-size: 9999px; color: rgb(10, 20, 30)">C</span>' +
    '<span style="font-family: Comic Sans MS">D</span>' +
    '<span style="color: expression(alert(1))">E</span>' +
    '<script>alert(1)</script><img src=x onerror=alert(2)><a href="javascript:alert(3)">F</a><b>G</b>';
  const { res } = await homeWith(admin, [textEl('rt1', dirty)]);
  assert.equal(res.status, 200);
  const st = await getState(admin);
  const el = st.draft.pages.find((p) => p.isHome).sections[0].elements.find((e) => e.id === 'rt1');
  const html = el.props.html;
  assert.match(html, /<span style="font-family: ?'Dancing Script', cursive">A<\/span>/, 'known font kept, normalized to the site stack');
  assert.match(html, /<span style="font-size: ?30px">B<\/span>/);
  assert.match(html, /<span style="color: ?rgb\(10, 20, 30\)">C<\/span>/, 'out-of-range size dropped, color kept');
  assert.doesNotMatch(html, /Comic/, 'fonts outside the site list are dropped');
  assert.doesNotMatch(html, /position|background|expression|url\(/);
  assert.doesNotMatch(html, /<script|onerror|<img|javascript:/);
  assert.match(html, /<strong>G<\/strong>/);
});

test('positions are clamped and rotation is normalized server-side', async () => {
  const admin = await loginAsMainAdmin();
  const els = [
    { id: 'r1', type: 'shape', layout: { desktop: { x: -50, y: -10, w: 5000, h: 40, r: 400 } }, props: {}, style: {}, z: 1 },
    { id: 'r2', type: 'shape', layout: { desktop: { x: 100, y: 10, w: 50, h: 40, r: -270 }, mobile: { x: 10, y: 10, w: 999, h: 20, r: 'abc' } }, props: {}, style: {}, z: 2 },
    { id: 'r3', type: 'shape', layout: { desktop: { x: 100, y: 10, w: 50, h: 40, r: 360 } }, props: {}, style: {}, z: 3 },
    { id: 'bad', type: 'not-a-type', layout: { desktop: { x: 0, y: 0, w: 10, h: 10 } } },
  ];
  await homeWith(admin, els);
  const st = await getState(admin);
  const strip = st.draft.pages.find((p) => p.isHome).sections[0];
  const r1 = strip.elements.find((e) => e.id === 'r1').layout.desktop;
  assert.deepEqual(r1, { x: 0, y: 0, w: 980, h: 40, r: 40 });
  const r2 = strip.elements.find((e) => e.id === 'r2').layout;
  assert.equal(r2.desktop.r, 90);
  assert.equal(r2.mobile.w, 310, 'mobile width clamped so it ends at the 320px mobile canvas edge');
  assert.equal(r2.mobile.r, undefined, 'non-numeric rotation dropped');
  assert.equal(strip.elements.find((e) => e.id === 'r3').layout.desktop.r, undefined, 'a full turn is no rotation');
  assert.ok(!strip.elements.some((e) => e.id === 'bad'), 'unknown element types are dropped');

  // Rendered publicly as a CSS rotation once published.
  await publish(admin);
  const home = await request(app).get('/');
  assert.match(home.text, /#e-r1\{[^}]*transform:rotate\(40deg\)/);
});

test('the draft does not reach the live site until Publish', async () => {
  const admin = await loginAsMainAdmin();
  await homeWith(admin, [textEl('draft1', 'Only in the draft so far')]);
  let live = await request(app).get('/');
  assert.equal(live.status, 200);
  assert.doesNotMatch(live.text, /Only in the draft so far/);
  const preview = await request(app).get(`/main-admin/website/preview/x`).set('Cookie', admin.cookie);
  assert.match(preview.text, /Only in the draft so far/, 'Preview renders the draft');
  assert.match(preview.text, /noindex/);
  await publish(admin);
  live = await request(app).get('/');
  assert.match(live.text, /Only in the draft so far/);
  const versions = await request(app).get('/main-admin/website/api/versions').set('Cookie', admin.cookie);
  assert.ok(versions.body.versions.length >= 1, 'each publish is kept in version history');
});

test('saving against a stale revision is refused, and CSRF is required', async () => {
  const admin = await loginAsMainAdmin();
  const st = await getState(admin);
  const ok = await putDraft(admin, st.draft, st.rev);
  assert.equal(ok.status, 200);
  const stale = await putDraft(admin, st.draft, st.rev);
  assert.equal(stale.status, 409);
  const noCsrf = await request(app).put('/main-admin/website/api/draft').set('Cookie', admin.cookie).set('Accept', 'application/json').send({ doc: st.draft, rev: ok.body.rev });
  assert.equal(noCsrf.status, 403);
  const anon = await request(app).get('/main-admin/website/api/state');
  assert.notEqual(anon.status, 200);
});

async function upload(admin, name) {
  const res = await request(app)
    .post('/main-admin/website/api/media')
    .set('Cookie', admin.cookie)
    .set('X-CSRF-Token', admin.csrfToken)
    .attach('files', LOGO, { filename: name, contentType: 'image/png' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.media[0];
}
async function replace(admin, id) {
  const res = await request(app)
    .post(`/main-admin/website/api/media/${id}/replace`)
    .set('Cookie', admin.cookie)
    .set('X-CSRF-Token', admin.csrfToken)
    .attach('file', LOGO, { filename: 'new.png', contentType: 'image/png' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}
function keyOf(url) {
  return url.split('/').pop();
}

test('replacing media keeps the published site on the old file until Publish', async () => {
  const admin = await loginAsMainAdmin();
  const m = await upload(admin, 'original.png');
  createdKeys.push(keyOf(m.url));
  await homeWith(admin, [{ id: 'img1', type: 'image', layout: { desktop: { x: 0, y: 0, w: 300, h: 200 } }, props: { mediaId: m.id, alt: 'Original' }, style: {}, z: 1 }]);
  await publish(admin);
  let live = await request(app).get('/');
  assert.ok(live.text.includes(m.url), 'live site shows the original file');

  const r = await replace(admin, m.id);
  createdKeys.push(keyOf(r.media.url));
  assert.equal(r.replacedId, m.id);
  assert.notEqual(r.media.id, m.id, 'replace creates a new media row');
  assert.notEqual(r.media.url, m.url, 'and a new stored object');
  const oldRow = await db.prepare('SELECT * FROM site_media WHERE id = ?').get(m.id);
  assert.equal(oldRow.replaced_by, r.media.id);

  live = await request(app).get('/');
  assert.ok(live.text.includes(m.url), 'live site unchanged right after Replace');

  // The editor repoints its draft (client side) and autosaves.
  const st = await getState(admin);
  const img = st.draft.pages.find((p) => p.isHome).sections[0].elements.find((e) => e.id === 'img1');
  img.props.mediaId = r.media.id;
  await putDraft(admin, st.draft, st.rev);
  live = await request(app).get('/');
  assert.ok(live.text.includes(m.url) && !live.text.includes(r.media.url), 'still the old file before Publish');

  await publish(admin);
  live = await request(app).get('/');
  assert.ok(live.text.includes(r.media.url), 'new file live after Publish');
  assert.ok(await db.prepare('SELECT id FROM site_media WHERE id = ?').get(m.id), 'old row kept - version history still references it');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'uploads', 'homepage', keyOf(m.url))), 'old file kept');

  // A replaced row nothing references is cleaned up after Publish.
  const orphan = await upload(admin, 'orphan.png');
  createdKeys.push(keyOf(orphan.url));
  const r2 = await replace(admin, orphan.id);
  createdKeys.push(keyOf(r2.media.url));
  await publish(admin);
  assert.equal(await db.prepare('SELECT id FROM site_media WHERE id = ?').get(orphan.id), undefined);
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'public', 'uploads', 'homepage', keyOf(orphan.url))));
});

test('media still used by the draft or live site cannot be deleted', async () => {
  const admin = await loginAsMainAdmin();
  const st = await getState(admin);
  const used = JSON.stringify(st.draft).match(/"mediaId":(\d+)/);
  assert.ok(used);
  const res = await request(app).post(`/main-admin/website/api/media/${used[1]}/delete`).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrfToken).set('Accept', 'application/json');
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Still used/);
});

test('page URLs: reserved app paths are refused, members-only pages need a login', async () => {
  const admin = await loginAsMainAdmin();
  const st = await getState(admin);
  st.draft.pages.push(
    { id: 'pclash', title: 'Login', slug: 'login', sections: [] },
    { id: 'pevents', title: 'Events', slug: 'events', sections: [] },
    { id: 'pmembers', title: 'Members Corner', slug: 'members-corner', access: 'members', sections: [{ id: 'smem', height: { desktop: 200 }, elements: [textEl('memtext', 'Members only text')] }] },
    { id: 'pdup', title: 'Dup', slug: 'members-corner', sections: [] }
  );
  const res = await putDraft(admin, st.draft, st.rev);
  assert.equal(res.status, 200);
  assert.ok(res.body.fixes.some((f) => /login-page/.test(f)));
  const after = (await getState(admin)).draft.pages;
  assert.equal(after.find((p) => p.id === 'pclash').slug, 'login-page');
  assert.equal(after.find((p) => p.id === 'pevents').slug, 'events-page');
  assert.equal(after.find((p) => p.id === 'pdup').slug, 'members-corner-2');
  assert.equal(site.slugError('admin') !== null, true);
  assert.equal(site.slugError('about-us'), null);

  await publish(admin);
  const anon = await request(app).get('/members-corner');
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.location, '/login?next=%2Fmembers-corner');
  const member = await request(app).get('/members-corner').set('Cookie', admin.cookie);
  assert.equal(member.status, 200);
  assert.match(member.text, /Members only text/);
  const loginPage = await request(app).get('/login');
  assert.doesNotMatch(loginPage.text, /id="wx-site"/, '/login is still the app login, not a site page');
  assert.equal((await request(app).get('/no-such-page-here')).status, 404);
  const home = after.find((p) => p.isHome);
  const homeSlug = await request(app).get('/' + home.slug);
  assert.equal(homeSlug.status, 301);
  assert.equal(homeSlug.headers.location, '/');
});

test('the old fixed header converts to the freeform header strip idempotently', () => {
  const legacy = {
    pages: [{ id: 'p1', title: 'Home', slug: 'home', isHome: true, sections: [] }],
    header: { show: true, height: 100, showLogo: true, showSiteName: true, showLogin: false, burgerAt: 'tablet', sticky: true },
  };
  const once = site.normalizeDoc(legacy).doc;
  const strip = once.header.strip;
  assert.equal(strip.id, 'hdr');
  assert.deepEqual(
    strip.elements.map((e) => e.id),
    ['hdr-logo', 'hdr-name', 'hdr-menu']
  );
  assert.equal(strip.height.desktop, 100);
  assert.equal(strip.elements.find((e) => e.type === 'menu').props.burgerAt, 'tablet');
  assert.equal(once.header.sticky, true, 'header settings that still apply are kept');
  assert.equal(once.header.showLogin, undefined, 'replaced fixed-header switches are gone');
  const twice = site.normalizeDoc(JSON.parse(JSON.stringify(once))).doc;
  assert.deepEqual(twice.header, once.header);
  const again = site.normalizeDoc(legacy).doc;
  assert.deepEqual(again.header, once.header, 'converting the same legacy doc twice gives the same result');
});

test('the freeform header renders on the public site with its log-in element', async () => {
  const live = await request(app).get('/');
  assert.match(live.text, /<header class="wx-header[^"]*" id="s-hdr">/);
  assert.match(live.text, /href="\/login">Log in<\/a>/);
});

test('sitemap.xml and robots.txt follow the published pages and settings', async () => {
  const admin = await loginAsMainAdmin();
  let sm = await request(app).get('/sitemap.xml');
  assert.equal(sm.status, 200);
  assert.match(sm.headers['content-type'], /xml/);
  assert.match(sm.text, /<loc>http:\/\/[^<]+\/<\/loc>/);
  assert.match(sm.text, /\/login-page<\/loc>/);
  assert.doesNotMatch(sm.text, /members-corner<\/loc>/, 'members-only pages are not listed');
  let robots = await request(app).get('/robots.txt');
  assert.match(robots.text, /Disallow: \/main-admin/);
  assert.match(robots.text, /Disallow: \/members-corner\n/);
  assert.match(robots.text, /Sitemap: /);

  const st = await getState(admin);
  st.draft.settings.allowIndexing = false;
  st.draft.settings.sitemap = false;
  await putDraft(admin, st.draft, st.rev);
  await publish(admin);
  robots = await request(app).get('/robots.txt');
  assert.match(robots.text, /Disallow: \/\n/);
  assert.doesNotMatch(robots.text, /Sitemap:/);
  sm = await request(app).get('/sitemap.xml');
  assert.equal(sm.status, 404);
  const home = await request(app).get('/');
  assert.match(home.text, /<meta name="robots" content="noindex, nofollow"/);
});
