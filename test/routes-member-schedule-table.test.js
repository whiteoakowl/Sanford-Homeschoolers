// Coverage for a real request: "Co-op admin portal, schedules, member
// schedules. Each member's schedule should look like this image. Also,
// member profile, schedules should also look like this. All member
// schedule pages, tabs etc. Should have export, pdf and print icons, in a
// row side by side." Every member schedule surface now renders the one
// shared views/partials/member-schedule-table.ejs (Class Details /
// Location/ Instructor / Price, "Signed Up"/"Teaching"/... groups) with
// partials/member-schedule-actions.ejs's Export/PDF/Print row, backed by
// utils/schedule.js's memberScheduleTables and utils/memberScheduleOutput.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `member-schedule-table-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `member-schedule-table-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { createClass, setEnrollment, addStaff, createSemester } = require('../utils/classSchedule');
const { generateMemberCode } = require('../utils/members');
const { hashPassword } = require('../utils/portalAuth');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

async function loginAsAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  return loginRes.headers['set-cookie'];
}

async function getBuffer(url, cookie) {
  return request(app)
    .get(url)
    .set('Cookie', cookie)
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
}

function assertRealPdf(res) {
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.equal(res.body.subarray(0, 5).toString(), '%PDF-');
}

function assertPrintPreview(res) {
  assert.equal(res.status, 200);
  // print-auto.js convention: a preview page with its own Print button,
  // never an automatic window.print() on load.
  assert.match(res.text, /<button type="button" class="roster-action-btn print-action-btn" onclick="window.print\(\)">Print<\/button>/);
  assert.match(res.text, /<script src="\/js\/print-auto\.js"><\/script>/);
  assert.match(res.text, /class="member-schedule-table"/);
}

// The Export / PDF / Print trio, in one row, in that order.
function assertActionRow(html, base, query) {
  const q = query ? `\\?${query}` : '';
  const re = new RegExp(
    '<div class="member-schedule-actions no-print">\\s*' +
      `<a class="icon-btn" href="${base.csv}${q}" aria-label="Export CSV"[^>]*><svg class="icon"><use href="#icon-download"/></svg></a>\\s*` +
      `<a class="icon-btn" href="${base.pdf}${q}" aria-label="Download PDF"[^>]*><svg class="icon"><use href="#icon-pdf"/></svg></a>\\s*` +
      `<a class="icon-btn" href="${base.print}${q}" target="_blank" aria-label="Print"[^>]*><svg class="icon"><use href="#icon-printer"/></svg></a>`
  );
  assert.match(html, re);
}

const COOP = { csv: '/admin/schedule/export\\.csv', pdf: '/admin/schedule/download\\.pdf', print: '/admin/schedule/print' };
const MAIN = { csv: '/main-admin/members/schedule-export\\.csv', pdf: '/main-admin/members/schedule-download\\.pdf', print: '/main-admin/members/schedule-print' };
const OWN = { csv: '/portal/profile/schedules/export\\.csv', pdf: '/portal/profile/schedules/download\\.pdf', print: '/portal/profile/schedules/print' };

let counter = 0;
async function seedFamily() {
  counter += 1;
  const n = counter;
  const familyId = (await db.prepare('INSERT INTO families (name) VALUES (?)').run(`Vanderbilt ${n}`)).lastInsertRowid;
  const parentCode = await generateMemberCode();
  const parentId = (
    await db
      .prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, is_primary_parent, active) VALUES (?, ?, ?, 'parent', ?, 1, 1)")
      .run(`Paula Vanderbilt ${n}`, parentCode, parentCode, familyId)
  ).lastInsertRowid;
  const studentCode = await generateMemberCode();
  const studentId = (
    await db
      .prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, active, birthday) VALUES (?, ?, ?, 'student', ?, 1, '2014-03-01')")
      .run(`Eden Vanderbilt ${n}`, studentCode, studentCode, familyId)
  ).lastInsertRowid;
  const teacherCode = await generateMemberCode();
  const teacherId = (
    await db
      .prepare("INSERT INTO members (name, barcode, member_code, member_type, active, email, phone) VALUES (?, ?, ?, 'parent', 1, ?, '919-555-0142')")
      .run(`Lara Snyder ${n}`, teacherCode, teacherCode, `lara${n}@example.com`)
  ).lastInsertRowid;

  // Dates from the class's semester+day Class Schedule Grid (class_schedules)
  // - the class itself has no Start/End Date of its own.
  const semester = await createSemester(`Fall 2026 #${n}`);
  await db
    .prepare("INSERT INTO class_schedules (title, day_of_week, semester_id, start_date, end_date) VALUES (?, 'monday', ?, '2026-08-24', '2026-11-16')")
    .run(`Fall Monday ${n}`, semester.id);
  // Created Wednesday-first so the Monday-before-Wednesday order below is
  // the sort's doing, not insertion order.
  const wedClassId = await createClass({
    day: 'wednesday', hourPosition: 1, className: `Art Studio ${n}`, room: 'Room 7', startTime: '9:00 AM', endTime: '9:45 AM',
    startDate: '2026-08-26', endDate: '2026-11-18', semesterId: semester.id,
  });
  const peClassId = await createClass({
    day: 'monday', hourPosition: 2, className: `PE & Health ${n}`, room: 'Room 3', startTime: '10:00 AM', endTime: '10:45 AM',
    priceCents: 1500, semesterId: semester.id,
  });
  await addStaff(peClassId, teacherId, 'teacher');
  await addStaff(wedClassId, parentId, 'teacher');
  await setEnrollment(peClassId, [studentId]);
  await setEnrollment(wedClassId, [studentId]);
  return { n, familyId, parentId, studentId, teacherId, peClassId, wedClassId };
}

async function loginAsParent(parentId, n) {
  const email = `schedule-table-parent-${n}@example.com`;
  const accountId = (
    await db
      .prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text()) RETURNING id")
      .get(parentId, email, hashPassword('testpassword123'))
  ).id;
  const parentRole = await db.prepare("SELECT id FROM roles WHERE key = 'parent'").get();
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountId, parentRole.id);
  const loginRes = await request(app).post('/login').type('form').send({ email, password: 'testpassword123', next: '/portal/profile' });
  return loginRes.headers['set-cookie'];
}

// The enrolled student's own table - every field the reference
// screenshot shows.
function assertStudentTable(html, f) {
  assert.match(html, new RegExp(`<h[12] class="member-schedule-name">(<a [^>]*>)?Eden Vanderbilt ${f.n}(</a>)?</h[12]>`));
  assert.match(html, /<h[23] class="member-schedule-subheading">Signed Up<\/h[23]>/);
  assert.match(html, /<th scope="col">Class Details<\/th>\s*<th scope="col">Location\/ Instructor<\/th>/);
  assert.match(html, new RegExp(`class="member-schedule-class-title"[^>]*>PE &amp; Health ${f.n}<`));
  assert.match(html, /Aug\. 24, 2026 – Nov\. 16, 2026/, 'date range from the class\'s semester+day grid');
  assert.match(html, /Mon 10:00 AM – 10:45 AM/);
  assert.match(html, new RegExp(`Room 3 / Lara Snyder ${f.n}`));
  assert.match(html, new RegExp(`<a class="member-schedule-line member-schedule-email" href="mailto:lara${f.n}@example.com">lara${f.n}@example.com</a>`));
  assert.match(html, /<span class="member-schedule-line member-schedule-phone">919-555-0142<\/span>/);
  assert.match(html, /<td class="member-schedule-price" data-label="Price">\$15\.00<\/td>/);
  // The class's own Start/End Date wins over its grid's.
  assert.match(html, /Aug\. 26, 2026 – Nov\. 18, 2026/);
  assert.match(html, /Wed 9:00 AM – 9:45 AM/);
  const studentIdx = html.search(new RegExp(`class="member-schedule-name">(<a [^>]*>)?Eden Vanderbilt ${f.n}<`));
  const peIdx = html.indexOf(`PE &amp; Health ${f.n}`, studentIdx);
  const artIdx = html.indexOf(`Art Studio ${f.n}`, studentIdx);
  assert.ok(peIdx > -1 && artIdx > -1 && peIdx < artIdx, 'sorted by semester start date/day/time - the Monday class comes before the Wednesday one');
}

test('Co-op Admin member profile Class Schedule tab: shared table + Export/PDF/Print that all work', async () => {
  const cookie = await loginAsAdmin();
  const f = await seedFamily();

  const page = await request(app).get(`/admin/members/${f.studentId}?tab=schedule`).set('Cookie', cookie);
  assert.equal(page.status, 200);
  assertStudentTable(page.text, f);
  assert.match(page.text, new RegExp(`href="/admin/class-schedule/classes/${f.peClassId}/manage"`), 'class title is a link on the admin side');
  assertActionRow(page.text, COOP, `memberId=${f.studentId}`);

  const csv = await request(app).get(`/admin/schedule/export.csv?memberId=${f.studentId}`).set('Cookie', cookie);
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  const lines = csv.text.replace(/^\uFEFF/, '').split('\n');
  assert.equal(lines[0], '"Member Name","Role","Class","Semester","Start Date","End Date","Day","Time","Room","Instructor","Instructor Email","Instructor Phone","Price"');
  assert.equal(lines.length, 3, 'one line per class');
  assert.equal(
    lines[1],
    `"Eden Vanderbilt ${f.n}","Signed Up","PE & Health ${f.n}","Fall 2026 #${f.n}","2026-08-24","2026-11-16","Mon","10:00 AM – 10:45 AM","Room 3","Lara Snyder ${f.n}","lara${f.n}@example.com","919-555-0142","$15.00"`
  );

  assertRealPdf(await getBuffer(`/admin/schedule/download.pdf?memberId=${f.studentId}`, cookie));
  const print = await request(app).get(`/admin/schedule/print?memberId=${f.studentId}`).set('Cookie', cookie);
  assertPrintPreview(print);
  assertStudentTable(print.text, f);
});

test('Co-op Admin profile family "All" view: every member\'s table, parent\'s classes under Teaching, family-wide Export/PDF/Print', async () => {
  const cookie = await loginAsAdmin();
  const f = await seedFamily();

  const page = await request(app).get(`/admin/members/${f.parentId}?tab=schedule&family=all`).set('Cookie', cookie);
  assert.equal(page.status, 200);
  assertStudentTable(page.text, f);
  assertActionRow(page.text, COOP, `familyId=${f.familyId}`);
  const parentIdx = page.text.indexOf(`Paula Vanderbilt ${f.n}</`);
  const teachingIdx = page.text.indexOf('>Teaching<', parentIdx);
  assert.ok(parentIdx > -1 && teachingIdx > parentIdx, 'the parent\'s own class shows under a Teaching subheading');
  assert.ok(page.text.indexOf(`Paula Vanderbilt ${f.n}`) < page.text.indexOf(`Eden Vanderbilt ${f.n}`), 'parents first, then students');

  const csv = await request(app).get(`/admin/schedule/export.csv?familyId=${f.familyId}`).set('Cookie', cookie);
  assert.equal(csv.status, 200);
  assert.match(csv.text, new RegExp(`"Paula Vanderbilt ${f.n}","Teaching","Art Studio ${f.n}"`));
  assert.match(csv.text, new RegExp(`"Eden Vanderbilt ${f.n}","Signed Up","PE & Health ${f.n}"`));
  assert.doesNotMatch(csv.text, new RegExp(`Lara Snyder ${f.n}","Teaching`), 'a member outside the family is not exported');

  assertRealPdf(await getBuffer(`/admin/schedule/download.pdf?familyId=${f.familyId}`, cookie));
  assertPrintPreview(await request(app).get(`/admin/schedule/print?familyId=${f.familyId}`).set('Cookie', cookie));
});

test('Co-op Admin > Schedules > Member Schedules: shared table per member, and Export/PDF/Print honor the filter', async () => {
  const cookie = await loginAsAdmin();
  const f = await seedFamily();

  const page = await request(app).get(`/admin/schedule?tab=members&familyId=${f.familyId}`).set('Cookie', cookie);
  assert.equal(page.status, 200);
  assertStudentTable(page.text, f);
  assert.doesNotMatch(page.text, /schedule-card-grid/, 'the designed Schedule Card grid is replaced by the table');
  // Export / PDF / Print side by side (next to Import), same order.
  assert.match(
    page.text,
    new RegExp(
      `href="/admin/schedule/export\\.csv\\?tab=members&amp;familyId=${f.familyId}" aria-label="Export CSV"[^>]*>.*?</a>\\s*` +
        `<a class="icon-btn" href="/admin/schedule/download\\.pdf\\?tab=members&amp;familyId=${f.familyId}" aria-label="Download PDF"[^>]*>.*?</a>\\s*` +
        `<a class="icon-btn" href="/admin/schedule/print\\?tab=members&amp;familyId=${f.familyId}" target="_blank" aria-label="Print"`
    )
  );

  const csv = await request(app).get(`/admin/schedule/export.csv?tab=members&type=student&familyId=${f.familyId}`).set('Cookie', cookie);
  assert.equal(csv.status, 200);
  assert.match(csv.text, new RegExp(`"Eden Vanderbilt ${f.n}","Signed Up","PE & Health ${f.n}"`));
  assert.doesNotMatch(csv.text, new RegExp(`\\n"Paula Vanderbilt ${f.n}"`), 'type=student leaves parents out');

  assertRealPdf(await getBuffer(`/admin/schedule/download.pdf?tab=members&familyId=${f.familyId}`, cookie));
  assertPrintPreview(await request(app).get(`/admin/schedule/print?tab=members&familyId=${f.familyId}`).set('Cookie', cookie));

  // The per-member page and the Members page's Schedule dialog share it too.
  const manage = await request(app).get(`/admin/schedule/member/${f.studentId}/manage`).set('Cookie', cookie);
  assert.equal(manage.status, 200);
  assertStudentTable(manage.text, f);
  assertActionRow(manage.text, COOP, `memberId=${f.studentId}`);
  const fragment = await request(app).get(`/admin/members/${f.studentId}/schedule-fragment`).set('Cookie', cookie);
  assert.equal(fragment.status, 200);
  assertStudentTable(fragment.text, f);
  assertActionRow(fragment.text, COOP, `memberId=${f.studentId}`);
});

test('Main Admin member profile Class Schedule tab: shared table + its own Export/PDF/Print', async () => {
  const cookie = await loginAsAdmin();
  const f = await seedFamily();

  const page = await request(app).get(`/main-admin/members/${f.studentId}?tab=schedule`).set('Cookie', cookie);
  assert.equal(page.status, 200);
  assertStudentTable(page.text, f);
  assertActionRow(page.text, MAIN, `memberId=${f.studentId}`);

  const all = await request(app).get(`/main-admin/members/${f.parentId}?tab=schedule&family=all`).set('Cookie', cookie);
  assert.equal(all.status, 200);
  assertActionRow(all.text, MAIN, `familyId=${f.familyId}`);

  const csv = await request(app).get(`/main-admin/members/schedule-export.csv?memberId=${f.studentId}`).set('Cookie', cookie);
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, new RegExp(`"Eden Vanderbilt ${f.n}","Signed Up","PE & Health ${f.n}"`));

  assertRealPdf(await getBuffer(`/main-admin/members/schedule-download.pdf?familyId=${f.familyId}`, cookie));
  const print = await request(app).get(`/main-admin/members/schedule-print?memberId=${f.studentId}`).set('Cookie', cookie);
  assertPrintPreview(print);
  assertStudentTable(print.text, f);
});

test('My Profile > Schedules: shared table + Export/PDF/Print scoped to the member\'s own family', async () => {
  const f = await seedFamily();
  const other = await seedFamily();
  const cookie = await loginAsParent(f.parentId, f.n);

  const page = await request(app).get('/portal/profile?tab=schedules').set('Cookie', cookie);
  assert.equal(page.status, 200);
  assertStudentTable(page.text, f);
  assertActionRow(page.text, OWN, '');
  assert.doesNotMatch(page.text, /href="\/admin\/class-schedule/, 'no admin-only class links on a member\'s own profile');

  const csv = await request(app).get('/portal/profile/schedules/export.csv').set('Cookie', cookie);
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, new RegExp(`"Eden Vanderbilt ${f.n}","Signed Up","PE & Health ${f.n}"`));
  assert.match(csv.text, new RegExp(`"Paula Vanderbilt ${f.n}","Teaching","Art Studio ${f.n}"`));
  assert.doesNotMatch(csv.text, new RegExp(`Vanderbilt ${other.n}`), 'another family never shows up in this family\'s export');

  const kidOnly = await request(app).get(`/portal/profile/schedules/export.csv?memberId=${f.studentId}`).set('Cookie', cookie);
  assert.equal(kidOnly.status, 200);
  assert.doesNotMatch(kidOnly.text, new RegExp(`\\n"Paula Vanderbilt ${f.n}"`), 'only the requested family member\'s own rows');

  assertRealPdf(await getBuffer('/portal/profile/schedules/download.pdf', cookie));
  const print = await request(app).get('/portal/profile/schedules/print').set('Cookie', cookie);
  assertPrintPreview(print);
  assertStudentTable(print.text, f);
  assert.doesNotMatch(print.text, /href="\/admin\/search/, 'a member\'s own print page uses the portal nav, not Co-op Admin\'s');

  // Authorization: another family's member is a 404 in every format.
  for (const output of ['export.csv', 'download.pdf', 'print']) {
    const res = await request(app).get(`/portal/profile/schedules/${output}?memberId=${other.studentId}`).set('Cookie', cookie);
    assert.equal(res.status, 404, `${output} must not expose another family's schedule`);
  }
  // ...and a member can't use the admin export routes either.
  const adminCsv = await request(app).get(`/admin/schedule/export.csv?memberId=${other.studentId}`).set('Cookie', cookie);
  assert.notEqual(adminCsv.status, 200);
  const mainAdminCsv = await request(app).get(`/main-admin/members/schedule-export.csv?memberId=${other.studentId}`).set('Cookie', cookie);
  assert.notEqual(mainAdminCsv.status, 200);

  // Signed out: sent to log in.
  const anon = await request(app).get('/portal/profile/schedules/export.csv');
  assert.equal(anon.status, 302);
  assert.match(anon.headers.location, /^\/login/);
});

test('a parent\'s Floater Assignments hour shows under its own "Floater" group, never priced', async () => {
  const { getListByDay, sectionsForList, addMemberToSection } = require('../utils/volunteers');
  const { memberScheduleTables } = require('../utils/schedule');
  const floaterId = (await db.prepare("INSERT INTO members (name, barcode, member_type, active) VALUES ('Floater Fiona', 'floater-fiona', 'parent', 1)").run()).lastInsertRowid;
  const list = await getListByDay('monday');
  const sections = await sectionsForList(list.id);
  await addMemberToSection(list.id, floaterId, sections.find((s) => s.position === 3).id);

  const [table] = await memberScheduleTables([{ id: floaterId, name: 'Floater Fiona' }]);
  const floater = table.groups.find((g) => g.key === 'floater');
  assert.ok(floater, 'expected a Floater group');
  assert.equal(floater.label, 'Floater');
  assert.equal(floater.entries.length, 1);
  assert.equal(floater.entries[0].title, 'Floater');
  assert.equal(floater.entries[0].dayShort, 'Mon');
  assert.equal(floater.entries[0].priceLabel, '');
});
