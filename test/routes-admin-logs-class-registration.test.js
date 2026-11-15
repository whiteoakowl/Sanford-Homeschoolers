// A real request: "Co-op admin portal. Under logs tab add a class
// registration tab organized chart by day and family, families grouped
// together under a particular date." Mirrors the Absence Log's own
// family-then-date accordion (routes/admin-logs.js's own
// groupAbsenceSubmissionsByFamilyAndDate, reused as-is) - one row per
// class_registrations entry (not class_enrollments, which would drop a
// since-cancelled registration from the log), grouped by family and the
// calendar date the registration action happened.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `admin-logs-class-registration-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `admin-logs-class-registration-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.ADMIN_USERNAME = 'testadmin';
process.env.ADMIN_PASSWORD = 'testpassword123';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { generateMemberCode } = require('../utils/members');
const { hashPassword } = require('../utils/portalAuth');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

function extractCsrf(html) {
  return /name="csrf-token" content="([^"]*)"/.exec(html)[1];
}

async function loginAsAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: process.env.MAIN_ADMIN_EMAIL || 'mainadmin@coop.local', password: process.env.MAIN_ADMIN_PASSWORD || 'changeme123' });
  const cookie = loginRes.headers['set-cookie'];
  const page = await request(app).get('/admin/members').set('Cookie', cookie);
  return { cookie, csrfToken: extractCsrf(page.text) };
}

let familyCounter = 0;
async function createParentWithChild(familyName) {
  familyCounter += 1;
  const familyId = (await db.prepare('INSERT INTO families (name) VALUES (?)').run(familyName)).lastInsertRowid;
  const parentCode = await generateMemberCode();
  const parentInfo = await db
    .prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, is_primary_parent, active) VALUES (?, ?, ?, 'parent', ?, 1, 1)")
    .run(`${familyName} Parent`, parentCode, parentCode, familyId);
  const childCode = await generateMemberCode();
  const childInfo = await db
    .prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, active) VALUES (?, ?, ?, 'student', ?, 1)")
    .run(`${familyName} Child ${familyCounter}`, childCode, childCode, familyId);
  const email = `${familyName.toLowerCase().replace(/\s+/g, '-')}-${familyCounter}@example.com`;
  const accountInfo = await db
    .prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text())")
    .run(parentInfo.lastInsertRowid, email, hashPassword('testpassword123'));
  const parentRole = await db.prepare("SELECT id FROM roles WHERE key = 'parent'").get();
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountInfo.lastInsertRowid, parentRole.id);

  const loginRes = await request(app).post('/login').type('form').send({ email, password: 'testpassword123', next: '/parent' });
  const cookie = loginRes.headers['set-cookie'];
  const homePage = await request(app).get('/parent').set('Cookie', cookie);
  return { cookie, csrfToken: extractCsrf(homePage.text), childId: childInfo.lastInsertRowid, childName: `${familyName} Child ${familyCounter}` };
}

async function createOpenClass(admin, overrides) {
  const className = overrides.className;
  await request(app)
    .post('/admin/class-schedule/classes/new')
    .set('Cookie', admin.cookie)
    .type('form')
    .send({ day: 'monday', className, hourPosition: '1', room: 'Room A', color: '#EE9A4D', _csrf: admin.csrfToken, ...overrides });
  const cls = await db.prepare('SELECT * FROM classes WHERE class_name = ?').get(className);
  await db.prepare('UPDATE classes SET registration_open = 1 WHERE id = ?').run(cls.id);
  return cls;
}

test('Logs > Class Registration lists real registrations grouped by family and date, with class/day detail and a status badge', async () => {
  const admin = await loginAsAdmin();
  const cls = await createOpenClass(admin, { className: 'Logs Test Pottery' });

  const family = await createParentWithChild('Logreg Family');
  const reg = await request(app)
    .post(`/parent/classes/${cls.id}/register`)
    .set('Cookie', family.cookie)
    .type('form')
    .send({ studentId: String(family.childId), day: 'monday', _csrf: family.csrfToken });
  assert.match(reg.headers.location, /notice=/);

  const page = await request(app).get('/admin/logs?tab=classregistration').set('Cookie', admin.cookie);
  assert.equal(page.status, 200);
  assert.match(page.text, /Logreg Family/);
  assert.match(page.text, /Logs Test Pottery/);
  assert.match(page.text, />Monday</);
  assert.match(page.text, /Confirmed/);
  assert.match(page.text, new RegExp(family.childName));

  // The nav lists it as its own Logs subpage.
  assert.match(page.text, /Class Registration Log/);
});

test('cancelling a registration keeps it in the log (never deleted) with a Cancelled status, unlike class_enrollments', async () => {
  const admin = await loginAsAdmin();
  const cls = await createOpenClass(admin, { className: 'Logs Test Robotics' });
  const family = await createParentWithChild('Cancelreg Family');

  await request(app)
    .post(`/parent/classes/${cls.id}/register`)
    .set('Cookie', family.cookie)
    .type('form')
    .send({ studentId: String(family.childId), day: 'monday', _csrf: family.csrfToken });

  await request(app)
    .post(`/parent/classes/${cls.id}/unregister`)
    .set('Cookie', family.cookie)
    .type('form')
    .send({ studentId: String(family.childId), day: 'monday', _csrf: family.csrfToken });

  const enrollment = await db.prepare('SELECT * FROM class_enrollments WHERE class_id = ? AND student_id = ?').get(cls.id, family.childId);
  assert.equal(enrollment, undefined, 'the enrollment row is gone');

  const page = await request(app).get('/admin/logs?tab=classregistration').set('Cookie', admin.cookie);
  assert.match(page.text, /Cancelreg Family/, 'the cancelled registration should still show up in the log');
  assert.match(page.text, /Cancelled/);
});

test('the date filter narrows the list to just that day, and the CSV export carries the same columns', async () => {
  const admin = await loginAsAdmin();
  const cls = await createOpenClass(admin, { className: 'Logs Test Art' });
  const family = await createParentWithChild('Datefilter Family');

  await request(app)
    .post(`/parent/classes/${cls.id}/register`)
    .set('Cookie', family.cookie)
    .type('form')
    .send({ studentId: String(family.childId), day: 'monday', _csrf: family.csrfToken });

  const today = (await db.prepare('SELECT now_text() AS now').get()).now.slice(0, 10);

  const wrongDate = await request(app).get('/admin/logs?tab=classregistration&date=2020-01-01').set('Cookie', admin.cookie);
  assert.doesNotMatch(wrongDate.text, /Datefilter Family/);

  const rightDate = await request(app).get(`/admin/logs?tab=classregistration&date=${today}`).set('Cookie', admin.cookie);
  assert.match(rightDate.text, /Datefilter Family/);

  const csv = await request(app).get('/admin/logs/classregistration/export.csv').set('Cookie', admin.cookie);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /Name.*Class.*Day.*Date.*Status/);
  assert.match(csv.text, /Logs Test Art/);
});

// A real request: "Class registration log. Show new next to members name
// if its the first class they have signed up for so we know that its a
// new family." Both registration logs (Logs > Class Registration and
// Classes > Class Registration Log), plus their CSV exports.
test('both class registration logs mark a member\'s first sign-up as New, not a returning member\'s', async () => {
  const admin = await loginAsAdmin();
  const cls = await createOpenClass(admin, { className: 'Logs Test Weaving' });
  const olderCls = await createOpenClass(admin, { className: 'Logs Test Older Class' });

  const newbie = await createParentWithChild('Newbie Family');
  const returning = await createParentWithChild('Returning Family');
  // The returning child signed up for a class last year already.
  await db
    .prepare("INSERT INTO class_registrations (class_id, student_id, registered_by_account_id, status, created_at) VALUES (?, ?, (SELECT MIN(id) FROM member_accounts), 'confirmed', '2025-09-01 12:00:00')")
    .run(olderCls.id, returning.childId);

  for (const fam of [newbie, returning]) {
    await request(app)
      .post(`/parent/classes/${cls.id}/register`)
      .set('Cookie', fam.cookie)
      .type('form')
      .send({ studentId: String(fam.childId), day: 'monday', _csrf: fam.csrfToken });
  }

  const today = (await db.prepare('SELECT now_text() AS now').get()).now.slice(0, 10);
  for (const url of [`/admin/logs?tab=classregistration&date=${today}`, `/admin/schedule?tab=classregistrationlog&date=${today}`]) {
    const page = await request(app).get(url).set('Cookie', admin.cookie);
    assert.equal(page.status, 200, url);
    const rowOf = (name) => page.text.split('<tr>').map((r) => r.split('</tr>')[0]).find((r) => r.includes(name));
    assert.match(rowOf(newbie.childName), /class="crl-new"[^>]*>NEW</, `${url}: the first-time member is marked NEW`);
    assert.ok(rowOf(returning.childName), `${url}: the returning member is listed`);
    assert.doesNotMatch(rowOf(returning.childName), /crl-new/, `${url}: the returning member is not marked NEW`);
  }

  const csv = (await request(app).get('/admin/logs/classregistration/export.csv').set('Cookie', admin.cookie)).text;
  assert.match(csv, /"Name","New","Class","Day","Date","Time","Status"/);
  assert.ok(csv.split('\n').some((l) => l.includes(newbie.childName) && l.includes(',"New",')));
  assert.ok(csv.split('\n').some((l) => l.includes(returning.childName) && l.includes('Weaving') && l.includes(',"",')));
  const csv2 = (await request(app).get('/admin/schedule/classregistrationlog/export.csv').set('Cookie', admin.cookie)).text;
  assert.match(csv2, /"Date","Time","Family","Name","New","Class","Day","Action"/);
  assert.ok(csv2.split('\n').some((l) => l.includes(newbie.childName) && l.includes(',"New",')));
});

// A real request: "Class Registration log should look like this" - one
// table with a search box, Total/Confirmed/Waitlisted counts, and a trash
// button that cancels the registration (same as the roster's Remove).
test('Class Registration Log table: search, counts, and the trash button cancels a registration', async () => {
  const admin = await loginAsAdmin();
  const cls = await createOpenClass(admin, { className: 'Logs Test Pottery Wheel' });
  const family = await createParentWithChild('Trash Family');
  await request(app)
    .post(`/parent/classes/${cls.id}/register`)
    .set('Cookie', family.cookie)
    .type('form')
    .send({ studentId: String(family.childId), day: 'monday', _csrf: family.csrfToken });
  const reg = await db.prepare("SELECT * FROM class_registrations WHERE class_id = ? AND student_id = ? AND status = 'confirmed'").get(cls.id, family.childId);
  assert.ok(reg, 'registered');
  assert.ok(await db.prepare('SELECT 1 FROM class_enrollments WHERE class_id = ? AND student_id = ?').get(cls.id, family.childId), 'on the class list');

  // Search narrows to matching student or class names.
  const byClass = await request(app).get('/admin/schedule?tab=classregistrationlog&q=pottery%20wheel').set('Cookie', admin.cookie);
  assert.match(byClass.text, new RegExp(family.childName));
  assert.match(byClass.text, /Total Registrations<\/span><strong>1</);
  assert.match(byClass.text, /Confirmed<\/span><strong>1</);
  const noMatch = await request(app).get('/admin/logs?tab=classregistration&q=zzzz-nobody').set('Cookie', admin.cookie);
  assert.match(noMatch.text, /No class registrations match &#34;zzzz-nobody&#34;/);
  assert.match(noMatch.text, /Total Registrations<\/span><strong>0</);

  // The trash button posts to the cancel route and comes back to the log.
  const row = byClass.text.split('<tr>').find((r) => r.includes(family.childName));
  assert.match(row, new RegExp(`action="/admin/class-registrations/${reg.id}/cancel"`));
  assert.match(row, /name="returnTo" value="\/admin\/schedule\?tab=classregistrationlog&amp;q=pottery\+wheel"/);
  const cancel = await request(app)
    .post(`/admin/class-registrations/${reg.id}/cancel`)
    .set('Cookie', admin.cookie)
    .type('form')
    .send({ returnTo: '/admin/schedule?tab=classregistrationlog&q=pottery+wheel', _csrf: admin.csrfToken });
  assert.equal(cancel.status, 302);
  assert.match(cancel.headers.location, /^\/admin\/schedule\?tab=classregistrationlog&q=pottery\+wheel&notice=/);
  assert.equal((await db.prepare('SELECT status FROM class_registrations WHERE id = ?').get(reg.id)).status, 'cancelled');
  assert.equal(await db.prepare('SELECT 1 FROM class_enrollments WHERE class_id = ? AND student_id = ?').get(cls.id, family.childId), undefined, 'off the class list');

  // It stays in the log as Cancelled, with no trash button.
  const after = await request(app).get('/admin/schedule?tab=classregistrationlog&q=pottery%20wheel').set('Cookie', admin.cookie);
  const afterRow = after.text.split('<tr>').find((r) => r.includes(family.childName));
  assert.match(afterRow, /crl-status-cancelled/);
  assert.doesNotMatch(afterRow, /class-registrations\/\d+\/cancel/);

  // Cancelling again is refused; an outside returnTo falls back to the log.
  const again = await request(app)
    .post(`/admin/class-registrations/${reg.id}/cancel`)
    .set('Cookie', admin.cookie)
    .type('form')
    .send({ returnTo: 'https://example.com/evil', _csrf: admin.csrfToken });
  assert.match(again.headers.location, /^\/admin\/schedule\?tab=classregistrationlog&error=/);
});

// A later real request: "It should still be organized by family, order is
// based on newest registration. Family dropdown shows their log based on
// date. Include time stamps of 9:47pm example for all registrations."
test('Class Registration Log: family dropdowns, newest registration first, with times', async () => {
  const admin = await loginAsAdmin();
  const a = await createOpenClass(admin, { className: 'Logs Test Order A' });
  const b = await createOpenClass(admin, { className: 'Logs Test Order B' });
  const early = await createParentWithChild('Early Bird Family');
  const late = await createParentWithChild('Late Owl Family');
  const acct = (await db.prepare('SELECT MIN(id) AS id FROM member_accounts').get()).id;
  const reg = (cls, kid, at) => db.prepare("INSERT INTO class_registrations (class_id, student_id, registered_by_account_id, status, created_at) VALUES (?, ?, ?, 'confirmed', ?)").run(cls, kid, acct, at);
  // UTC times: 01:47 next day UTC is 9:47 PM Eastern (EDT) on Aug 19.
  await reg(a.id, early.childId, '2026-08-18 14:05:00');
  await reg(b.id, early.childId, '2026-08-20 01:47:00');
  await reg(a.id, late.childId, '2026-08-19 15:30:00');

  for (const url of ['/admin/schedule?tab=classregistrationlog&q=Order', '/admin/logs?tab=classregistration&q=Order']) {
    const page = (await request(app).get(url).set('Cookie', admin.cookie)).text;
    const families = page.split('<details class="crl-family"').slice(1);
    const names = families.map((f) => /crl-family-name">[\s\S]*?<\/svg>\s*([^<]+?)\s*<\/span>/.exec(f)[1]);
    assert.deepEqual(names.slice(0, 2), ['Early Bird Family', 'Late Owl Family'], `${url}: the family with the newest registration first`);
    // Early Bird's dropdown: newest first, with Eastern times.
    assert.match(families[0], /Aug 19, 2026 · 9:47 PM/, 'family header shows its newest registration');
    const rows = families[0].split('<tr>').slice(2);
    assert.match(rows[0], /Logs Test Order B[\s\S]*Aug 19, 2026 <span class="crl-time">9:47 PM<\/span>/);
    assert.match(rows[1], /Logs Test Order A[\s\S]*Aug 18, 2026 <span class="crl-time">10:05 AM<\/span>/);
    assert.match(families[0], /2 registrations/);
  }

  const print = await request(app).get('/admin/schedule/classregistrationlog/print').set('Cookie', admin.cookie);
  assert.match(print.text, /<th>Time<\/th>/);
  assert.match(print.text, /9:47 PM/);
});
