// Coverage for a real request: "Student portal, events tab should say
// event calendar. Export, pdf and print icons should be in a single
// row, not column, side by side. Calendar and list view icons should be
// on the same row as the calendar month/year picker, appearing on the
// left before the back arrow. Next arrow doesn't have an arrow. Shrink
// to fit entire row together clean on mobile. Still should be able to
// read the full month and year." Replaces an earlier, narrower "desktop
// only" design (views/events-list.ejs's own former desktopTrailingIcons/
// desktopTopRightToggle locals, see git history) with one unified nav
// row at every width - views/partials/event-calendar-grid.ejs's own
// leadingViewToggle/trailingIcons.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `student-events-calendar-nav-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `student-events-calendar-nav-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

let counter = 0;
async function createStudentAndLogin() {
  counter += 1;
  const code = `evcalnav${counter}`;
  const familyId = (await db.prepare("INSERT INTO families (name) VALUES (?) RETURNING id").get(`Events Nav Family ${counter}`)).id;
  const memberId = (
    await db
      .prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, active) VALUES (?, ?, ?, 'student', ?, 1) RETURNING id")
      .get(`Events Nav Student ${counter}`, code, code, familyId)
  ).id;
  const email = `${code}@example.com`;
  const accountId = (
    await db
      .prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text()) RETURNING id")
      .get(memberId, email, hashPassword('testpassword123'))
  ).id;
  const role = await db.prepare("SELECT id FROM roles WHERE key = 'student'").get();
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountId, role.id);
  const loginRes = await request(app).post('/login').type('form').send({ email, password: 'testpassword123', next: '/student' });
  return loginRes.headers['set-cookie'];
}

test('Student Portal nav tab says "Event Calendar", not "Events"', async () => {
  const cookie = await createStudentAndLogin();
  const page = await request(app).get('/student').set('Cookie', cookie);
  assert.equal(page.status, 200);
  assert.match(page.text, /href="\/events\?view=calendar&amp;portal=student"[^>]*><svg class="icon"><use href="#icon-calendar-check"\/><\/svg><span>Event<br\/?>Calendar<\/span>/);
  assert.doesNotMatch(page.text, /<span>Events<\/span>/);
});

test('Student Portal Events page heading says "Event Calendar"', async () => {
  const cookie = await createStudentAndLogin();
  const page = await request(app).get('/events?view=calendar&portal=student').set('Cookie', cookie);
  assert.equal(page.status, 200);
  assert.match(page.text, /<h1>Event Calendar<\/h1>/);
});

test('Student Portal calendar view: Prev/Month/Year/Next/Export/Print/PDF share one row, with the List/Calendar view toggle on its own row underneath (not folded into that row, not a duplicate)', async () => {
  const cookie = await createStudentAndLogin();
  const page = await request(app).get('/events?view=calendar&portal=student').set('Cookie', cookie);
  assert.equal(page.status, 200);

  const rowMatch = /<div class="event-calendar-nav-row event-calendar-nav-row-unified">([\s\S]*?)<\/div>/.exec(page.text);
  assert.ok(rowMatch, 'expected the Prev/Month/Year/Next/Export/Print/PDF row');
  const row = rowMatch[1];

  // The view toggle is NOT in this row at all (it moved to its own row -
  // "Calendar vs list view icons should be on the 3rd row by
  // themselves").
  assert.doesNotMatch(row, /aria-label="List view"/);
  assert.doesNotMatch(row, /aria-label="Calendar view"/);

  // Order: Prev, month select, year select, Next, then Export/Print/PDF -
  // each index strictly increasing confirms the order.
  const prevIdx = row.indexOf('data-nav-dir="prev"');
  const monthIdx = row.indexOf('id="event-month-select"');
  const yearIdx = row.indexOf('id="event-year-select"');
  const nextIdx = row.indexOf('data-nav-dir="next"');
  const exportIdx = row.indexOf('aria-label="Export CSV"');
  const printIdx = row.indexOf('aria-label="Print"');
  const pdfIdx = row.indexOf('aria-label="Download PDF"');
  for (const idx of [prevIdx, monthIdx, yearIdx, nextIdx, exportIdx, printIdx, pdfIdx]) {
    assert.notEqual(idx, -1);
  }
  assert.ok(prevIdx < monthIdx && monthIdx < yearIdx && yearIdx < nextIdx, 'Prev, Month, Year, Next in order');
  assert.ok(nextIdx < exportIdx && exportIdx < printIdx && printIdx < pdfIdx, 'Export, Print, PDF after Next, in order');

  // Its own row, right after the Prev/Month/Year/Next/Export/Print/PDF
  // row, not a second redundant copy.
  const unifiedRowIdx = page.text.indexOf('class="event-calendar-nav-row event-calendar-nav-row-unified"');
  const toggleRowIdx = page.text.indexOf('class="class-schedule-view-toggle" role="group" aria-label="List or calendar view">');
  assert.notEqual(toggleRowIdx, -1, 'expected the standalone List/Calendar toggle row');
  assert.ok(unifiedRowIdx < toggleRowIdx, 'the view toggle row comes after the Prev/Month/Year/Next row');
  const toggleRowMatch = /class="class-schedule-view-toggle" role="group" aria-label="List or calendar view">([\s\S]*?)<\/div>/.exec(page.text);
  assert.ok(toggleRowMatch);
  assert.match(toggleRowMatch[1], /aria-label="List view"/);
  assert.match(toggleRowMatch[1], /aria-label="Calendar view"/);
});

test('Student Portal list view keeps its own separate view-toggle + Export/Print/PDF row (no month/year picker to merge into)', async () => {
  const cookie = await createStudentAndLogin();
  const page = await request(app).get('/events?view=list&portal=student').set('Cookie', cookie);
  assert.equal(page.status, 200);
  assert.match(page.text, /class="class-schedule-view-toggle" role="group" aria-label="List or calendar view">/);
  assert.match(page.text, /<a class="icon-btn" href="\/events\/export\.csv" aria-label="Export CSV"/);
  assert.doesNotMatch(page.text, /event-calendar-nav-row-unified/);
});

test('Next arrow is fixed: the mobile icon-only CSS keys off data-nav-dir, not :first-child/:last-child, so it still matches once trailing icons share the row', async () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'styles.css'), 'utf8');
  assert.doesNotMatch(css, /event-calendar-nav-btn:last-child::before/, 'the broken :last-child selector should be gone entirely');
  assert.doesNotMatch(css, /event-calendar-nav-btn:first-child::before/, 'the broken :first-child selector should be gone entirely');
  assert.match(css, /\[data-nav-dir="prev"\]::before\s*\{\s*content: '\\2190';?\s*\}/);
  assert.match(css, /\[data-nav-dir="next"\]::before\s*\{\s*content: '\\2192';?\s*\}/);
});

test('The unified row\'s Prev/Next buttons override the global .roster-action-btn width: 100% mobile rule, and Prev/Next are no longer the widest things in the row', async () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'styles.css'), 'utf8');
  // A real, confirmed-via-screenshot bug: styles.css's own unscoped
  // "@media (max-width: 640px) { .roster-action-btn, .roster-btn-form {
  // width: 100%; ... } }" rule (written for .roster-btn-row's CSS-grid
  // layout) applies to ANY .roster-action-btn below that breakpoint, not
  // just one inside a .roster-btn-row - Prev/Next carry that class too
  // (for the orange button styling), so without an explicit width: auto
  // override scoped to this unified row, each one stretched to fill the
  // row's entire remaining width on a phone, pushing the month/year
  // selects, Next, and the Export/Print/PDF icons off past this row's
  // own overflow: hidden edge, rendering as one long blank orange block.
  assert.match(css, /\.event-calendar-nav-row-unified \.event-calendar-nav-btn \{\s*flex: 0 0 auto;\s*width: auto;\s*\}/);

  const cookie = await createStudentAndLogin();
  const page = await request(app).get('/events?view=calendar&portal=student').set('Cookie', cookie);
  assert.equal(page.status, 200);
  // The month select should still have its own id for a browser to key
  // off (no change expected here - just confirms the page still renders
  // the full row's real markup after the CSS fix, not just a CSS-only
  // regression test).
  assert.match(page.text, /id="event-month-select"/);
  assert.match(page.text, /id="event-year-select"/);
});

test('Parent Portal and Main Admin calendar views are unaffected - no unified row, original markup unchanged', async () => {
  const familyId = (await db.prepare("INSERT INTO families (name) VALUES ('Events Nav Parent Family') RETURNING id").get()).id;
  const memberId = (
    await db
      .prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, is_primary_parent, active) VALUES (?, ?, ?, 'parent', ?, 1, 1) RETURNING id")
      .get('Events Nav Parent', 'evcalnavparent', 'evcalnavparent', familyId)
  ).id;
  const email = 'evcalnavparent@example.com';
  await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text())").run(memberId, email, hashPassword('testpassword123'));
  const role = await db.prepare("SELECT id FROM roles WHERE key = 'parent'").get();
  const acct = await db.prepare('SELECT id FROM member_accounts WHERE email = ?').get(email);
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(acct.id, role.id);
  const loginRes = await request(app).post('/login').type('form').send({ email, password: 'testpassword123', next: '/parent' });
  const cookie = loginRes.headers['set-cookie'];

  const page = await request(app).get('/events?view=calendar&portal=parent').set('Cookie', cookie);
  assert.equal(page.status, 200);
  assert.match(page.text, /<h1>Event Calendar<\/h1>/);
  assert.doesNotMatch(page.text, /event-calendar-nav-row-unified/);
  assert.match(page.text, /class="roster-btn-row event-calendar-nav-row" data-fixed-column-widths="1fr 2fr 2fr 1fr"/);
});
