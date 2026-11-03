// Coverage for a real request: "All printing should allow you to filter by
// family name, semester, day. Should be able to change multiple items in
// the filter popup without it refreshing and click save." (Earlier
// requests: "all bulk printing should have filter by family name," then
// "there are currently two dropdown filters, we only need one, combine
// them.") Every member-based bulk print picker on the Design/Print hub
// (Co-op Admin's /admin/design and Main Admin's /main-admin/name-tags) now
// has a Filter button opening a popup (views/partials/member-print-
// filter.ejs -> print-filter-popup.ejs) with Member Type, Family Name,
// Semester and Day selects and a Save button, matched client-side against
// each row's data-type/-family-id/-semesters/-days (views/partials/print-
// picker-table.ejs, utils/printPickerFilters.js) by public/js/design-print-
// hub.js's wireFilterPopup. The filtering itself is client-side JS a
// jsdom-free route test can't exercise directly - this locks in the
// markup contract it depends on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `bulk-print-family-filter-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `bulk-print-family-filter-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.ADMIN_USERNAME = 'testadmin';
process.env.ADMIN_PASSWORD = 'testpassword123';
process.env.MAIN_ADMIN_EMAIL = 'mainadmin@coop.local';
process.env.MAIN_ADMIN_PASSWORD = 'changeme123';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { createClass, createSemester } = require('../utils/classSchedule');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

async function loginAsAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: process.env.MAIN_ADMIN_EMAIL, password: process.env.MAIN_ADMIN_PASSWORD });
  return loginRes.headers['set-cookie'];
}

async function loginAsMainAdmin() {
  const loginRes = await request(app)
    .post('/login')
    .type('form')
    .send({ email: process.env.MAIN_ADMIN_EMAIL, password: process.env.MAIN_ADMIN_PASSWORD, next: '/main-admin' });
  return loginRes.headers['set-cookie'];
}

function rowAttrs(html, memberId) {
  // name="memberIds" (not a bare value="<id>") - a family's own id and a
  // member's own id are separate sequences that can collide, and a bare
  // value="1" could just as easily match a Family option.
  const idx = html.indexOf(`name="memberIds" value="${memberId}"`);
  assert.ok(idx !== -1, `expected a picker row for member ${memberId}`);
  const rowStart = html.lastIndexOf('<tr class="print-picker-row"', idx);
  return html.slice(rowStart, idx);
}

function selectHtml(html, id) {
  const m = new RegExp(`<select id="${id}" data-filter-field="[a-z]+">[\\s\\S]*?</select>`).exec(html);
  assert.ok(m, `expected the ${id} select`);
  return m[0];
}

const MEMBER_PREFIXES = ['schedule-print', 'name-tag-bulk', 'cards-duplex', 'barcodes', 'barcode-labels'];

function assertMemberPopup(html, prefix, { semesterId, familyNames }) {
  assert.match(html, new RegExp(`<button type="button" class="roster-action-btn" id="${prefix}-filter-btn">Filter</button>`), `${prefix}: Filter button`);
  assert.match(html, new RegExp(`id="${prefix}-filter-summary"`), `${prefix}: active-filter summary`);
  assert.match(html, new RegExp(`<dialog id="${prefix}-filter-dialog" class="qr-filter-dialog">`), `${prefix}: popup`);
  assert.match(html, new RegExp(`id="${prefix}-filter-save-btn">Save</button>`), `${prefix}: Save button`);
  assert.match(html, new RegExp(`id="${prefix}-filter-clear-btn">Clear filters</button>`), `${prefix}: Clear filters`);

  const type = selectHtml(html, `${prefix}-filter-type-select`);
  assert.match(type, /<option value="primaryParent"[^>]*>Primary Parents Only<\/option>/);
  assert.match(type, /<option value="teacher"[^>]*>Teachers Only<\/option>/);

  const family = selectHtml(html, `${prefix}-filter-family-select`);
  assert.match(family, /<option value="">All Families<\/option>/);
  // Sorted by family name.
  const positions = familyNames.map((n) => family.indexOf(`>${n} Family</option>`));
  positions.forEach((p, i) => assert.ok(p !== -1, `${prefix}: ${familyNames[i]} Family option`));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, `${prefix}: families sorted by name`);

  const semester = selectHtml(html, `${prefix}-filter-semester-select`);
  assert.match(semester, new RegExp(`<option value="${semesterId}">Filter Popup Semester</option>`));

  const day = selectHtml(html, `${prefix}-filter-day-select`);
  // Only days with classes, calendar order.
  const mon = day.indexOf('<option value="monday">Monday</option>');
  const wed = day.indexOf('<option value="wednesday">Wednesday</option>');
  assert.ok(mon !== -1 && wed !== -1 && mon < wed, `${prefix}: Monday then Wednesday`);
  assert.doesNotMatch(day, /value="friday"/);
}

let seeded;
async function seed() {
  if (seeded) return seeded;
  const famB = (await db.prepare("INSERT INTO families (name) VALUES ('Baker')").run()).lastInsertRowid;
  const famA = (await db.prepare("INSERT INTO families (name) VALUES ('Anderson')").run()).lastInsertRowid;
  const student = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id) VALUES ('Andy Anderson', 'Andy Anderson', 'student', ?)").run(famA)).lastInsertRowid;
  const teacher = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id) VALUES ('Bea Baker', 'Bea Baker', 'parent', ?)").run(famB)).lastInsertRowid;
  const noClasses = (await db.prepare("INSERT INTO members (name, barcode, member_type) VALUES ('No Family', 'No Family', 'student')").run()).lastInsertRowid;
  const semester = await createSemester('Filter Popup Semester');
  const monClass = await createClass({ day: 'monday', hourPosition: 1, className: 'Popup Monday Class', room: 'Room 1', semesterId: semester.id });
  const wedClass = await createClass({ day: 'wednesday', hourPosition: 1, className: 'Popup Wednesday Class', room: 'Room 2', semesterId: null });
  await db.prepare('INSERT INTO class_enrollments (class_id, student_id) VALUES (?, ?)').run(monClass, student);
  await db.prepare("INSERT INTO class_staff (class_id, member_id, role) VALUES (?, ?, 'teacher')").run(wedClass, teacher);
  seeded = { famA, famB, student, teacher, noClasses, semesterId: semester.id };
  return seeded;
}

test('Design/Print hub (Co-op Admin): every member picker has a Filter popup with Type, Family, Semester and Day, and rows carry the matching data attributes', async () => {
  const s = await seed();
  const cookie = await loginAsAdmin();
  const res = await request(app).get('/admin/design?tab=print').set('Cookie', cookie);
  assert.equal(res.status, 200);

  for (const prefix of MEMBER_PREFIXES) assertMemberPopup(res.text, prefix, { semesterId: s.semesterId, familyNames: ['Anderson', 'Baker'] });
  // Name Tags still opens on Primary Parents Only.
  assert.match(selectHtml(res.text, 'name-tag-bulk-filter-type-select'), /<option value="primaryParent" selected>/);
  // The old instantly-applied inline dropdowns are gone.
  assert.doesNotMatch(res.text, /class="name-tag-bulk-filter-select"/);
  assert.doesNotMatch(res.text, /Select None/);

  // Enrolled student: that class's semester + day.
  const studentRow = rowAttrs(res.text, s.student);
  assert.match(studentRow, new RegExp(`data-family-id="${s.famA}"`));
  assert.match(studentRow, new RegExp(`data-semesters="${s.semesterId}"`));
  assert.match(studentRow, /data-days="monday"/);
  // Teacher: staffs a no-semester Wednesday class.
  const teacherRow = rowAttrs(res.text, s.teacher);
  assert.match(teacherRow, /data-semesters="none"/);
  assert.match(teacherRow, /data-days="wednesday"/);
  // No classes, no family.
  const loneRow = rowAttrs(res.text, s.noClasses);
  assert.match(loneRow, /data-family-id=""/);
  assert.match(loneRow, /data-semesters=""/);
  assert.match(loneRow, /data-days=""/);
});

test('Design/Print hub (Co-op Admin): Name Tag Requests rows carry the same filter attributes and get the same popup', async () => {
  const s = await seed();
  await db.prepare("INSERT INTO name_tag_requests (member_id, request_type, day) VALUES (?, 'lost_tag', 'monday')").run(s.student);

  const cookie = await loginAsAdmin();
  const res = await request(app).get('/admin/design?tab=print').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assertMemberPopup(res.text, 'name-tag-requests', { semesterId: s.semesterId, familyNames: ['Anderson', 'Baker'] });

  const tableStart = res.text.indexOf('id="name-tag-requests-bulk-list"');
  const row = rowAttrs(res.text.slice(tableStart), s.student);
  assert.match(row, /data-type="student"/);
  assert.match(row, new RegExp(`data-family-id="${s.famA}"`));
  assert.match(row, new RegExp(`data-semesters="${s.semesterId}"`));
  assert.match(row, /data-days="monday"/);
});

test('Design/Print hub (Co-op Admin): Schedules, Library Barcodes and Setup/Cleanup Badges filter through the same Save popup', async () => {
  await seed();
  const cookie = await loginAsAdmin();
  const res = await request(app).get('/admin/design?tab=print').set('Cookie', cookie);
  assert.equal(res.status, 200);
  // Schedules: Family + Day.
  assert.match(res.text, /<dialog id="schedules-filter-dialog"/);
  assert.match(res.text, /id="schedules-filter-family-select"/);
  assert.match(res.text, /id="schedules-filter-day-select"/);
  assert.match(res.text, /data-member-list href="\/admin\/schedule\/print"/);
  // Library: Category moved into a popup.
  assert.match(res.text, /<dialog id="library-barcodes-filter-dialog"/);
  assert.match(res.text, /id="library-barcodes-filter-category-select"/);
  // Class QR: Semester / Day / Room, no Family.
  assert.match(res.text, /id="classcheckin-qr-filter-semester-select"/);
  assert.doesNotMatch(res.text, /id="classcheckin-qr-filter-family-select"/);
});

test('Main Admin Design/Print hub: every member picker has the same Filter popup, and rows carry the data attributes', async () => {
  const s = await seed();
  const fam = (await db.prepare("INSERT INTO families (name) VALUES ('Douglas')").run()).lastInsertRowid;
  const memberId = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id) VALUES ('Dan Douglas', 'Dan Douglas', 'student', ?)").run(fam)).lastInsertRowid;

  const cookie = await loginAsMainAdmin();
  const res = await request(app).get('/main-admin/name-tags?tab=print').set('Cookie', cookie);
  assert.equal(res.status, 200);

  for (const prefix of MEMBER_PREFIXES) assertMemberPopup(res.text, prefix, { semesterId: s.semesterId, familyNames: ['Anderson', 'Baker', 'Douglas'] });
  assert.doesNotMatch(res.text, /Select None/);
  assert.match(rowAttrs(res.text, memberId), new RegExp(`data-family-id="${fam}"`));
  const studentRow = rowAttrs(res.text, s.student);
  assert.match(studentRow, new RegExp(`data-semesters="${s.semesterId}"`));
  assert.match(studentRow, /data-days="monday"/);
});

test('old Print tab URLs (with stray filter params) still render', async () => {
  const cookie = await loginAsAdmin();
  const res = await request(app).get('/admin/design?tab=print&familyId=1&semester=2&day=monday').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /id="schedule-print-filter-btn"/);
});
