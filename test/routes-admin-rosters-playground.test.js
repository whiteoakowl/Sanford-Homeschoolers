// Real HTTP-level coverage for the Attendance page's new Playground tab -
// a real request: "add this as a tab under attendance called playground.
// each hour will be listed. when you click on them it opens to the log
// for that day, with a drop down to choose date of which log to look at.
// log shows check in time and check out time" (routes/admin-rosters.js's
// 'playground'/'playground-<day>-<hour>' tabs, utils/playground.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `admin-rosters-playground-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `admin-rosters-playground-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.ADMIN_USERNAME = 'testadmin';
process.env.ADMIN_PASSWORD = 'testpassword123';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { todayISO } = require('../utils/dates');
const { ensurePlaygroundRoster } = require('../utils/playground');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

async function loginAsAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: process.env.MAIN_ADMIN_EMAIL || 'mainadmin@coop.local', password: process.env.MAIN_ADMIN_PASSWORD || 'changeme123' });
  return loginRes.headers['set-cookie'];
}

// A later real request: the Playground page "should be called
// Playground roster" with a Semester/Day/Date filter, listing each hour.
test('the Playground Roster nav link and page list each hour for the chosen day', async () => {
  const cookie = await loginAsAdmin();
  const res = await request(app).get('/admin/rosters?tab=playground&day=monday').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /href="\/admin\/rosters\?tab=playground">Playground Roster<\/a>/);
  assert.match(res.text, /id="playground-filter-form"/);
  for (const day of ['monday', 'wednesday']) assert.match(res.text, new RegExp(`<option value="${day}"`));
});

// A real request: "This sub page should be called Playground roster."
test('the Playground page\'s own title says "Playground Roster"', async () => {
  const cookie = await loginAsAdmin();
  const res = await request(app).get('/admin/rosters?tab=playground').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /<h1>Playground Roster<\/h1>/);
});

test('a specific Playground hour\'s log page keeps the same "Playground Attendance" title', async () => {
  const cookie = await loginAsAdmin();
  const res = await request(app).get('/admin/rosters?tab=playground-monday-1').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /<h1>Playground Attendance<\/h1>/);
});

test('a specific playground hour shows a Session Date dropdown and today\'s log', async () => {
  const cookie = await loginAsAdmin();
  const today = todayISO();

  const studentRoster = await db.prepare("SELECT id FROM rosters WHERE name = 'Monday Students'").get();
  await db
    .prepare('INSERT INTO roster_dates (roster_id, session_date) VALUES (?, ?) ON CONFLICT (roster_id, session_date) DO NOTHING')
    .run(studentRoster.id, today);

  const rosterId = await ensurePlaygroundRoster('monday', 1);
  const memberInfo = await db
    .prepare("INSERT INTO members (name, barcode, member_type) VALUES ('Playground Admin Test Kid', 'Playground Admin Test Kid', 'student')")
    .run();
  await db
    .prepare(
      `INSERT INTO attendance (member_id, roster_id, session_date, status, check_in_time, source)
       VALUES (?, ?, ?, 'present', ?, 'kiosk_playground')`
    )
    .run(memberInfo.lastInsertRowid, rosterId, today, Date.now());

  const res = await request(app).get('/admin/rosters?tab=playground-monday-1').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /id="playground-date-select"/);
  assert.match(res.text, /Playground Admin Test Kid/);
  assert.match(res.text, /Monday Playground/);
  // Nobody checked out yet - the row should show a blank dash, not a
  // fabricated time.
  assert.match(res.text, /<td class="roster-name-col">Playground Admin Test Kid<\/td>\s*<td>[^<]+<\/td>\s*<td>—<\/td>/);
});

test('an hour with no session dates yet shows an empty state instead of crashing', async () => {
  const cookie = await loginAsAdmin();
  // Wednesday hour 4 - never given a session date in this test file.
  const res = await request(app).get('/admin/rosters?tab=playground-wednesday-4').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /No session dates yet/);
});

// A real request: "a filter button that filters by semester, the day, then
// date. Page then shows the date and times and a list of those that were
// checked in under each time."
test('Playground Roster: Semester/Day/Date filter, then each hour with its times and who checked in', async () => {
  const cookie = await loginAsAdmin();
  const { ensureDayRoster } = require('../utils/classSchedule');
  const fall = (await db.prepare("INSERT INTO semesters (title) VALUES ('PG Fall Test') RETURNING id").get()).id;
  const spring = (await db.prepare("INSERT INTO semesters (title) VALUES ('PG Spring Test') RETURNING id").get()).id;
  const fallRoster = await ensureDayRoster('wednesday', 'student', fall);
  const springRoster = await ensureDayRoster('wednesday', 'student', spring);
  await db.prepare('INSERT INTO roster_dates (roster_id, session_date) VALUES (?, ?) ON CONFLICT DO NOTHING').run(fallRoster, '2025-10-01');
  await db.prepare('INSERT INTO roster_dates (roster_id, session_date) VALUES (?, ?) ON CONFLICT DO NOTHING').run(springRoster, '2026-03-04');
  await db.prepare("UPDATE class_schedule_hours SET start_time = '09:00', end_time = '09:55' WHERE day = 'wednesday' AND position = 1 AND semester_id IS NULL").run();

  const h1 = await ensurePlaygroundRoster('wednesday', 1);
  const h3 = await ensurePlaygroundRoster('wednesday', 3);
  const kid = async (name) => (await db.prepare("INSERT INTO members (name, barcode, member_type) VALUES (?, ?, 'student') RETURNING id").get(name, name)).id;
  const checkIn = (m, r, d) => db.prepare("INSERT INTO attendance (member_id, roster_id, session_date, status, check_in_time, source) VALUES (?, ?, ?, 'present', ?, 'kiosk_playground')").run(m, r, d, Date.now());
  await checkIn(await kid('Hour One Kid'), h1, '2025-10-01');
  await checkIn(await kid('Hour Three Kid'), h3, '2025-10-01');
  await checkIn(await kid('Spring Kid'), h1, '2026-03-04');

  const res = await request(app).get(`/admin/rosters?tab=playground&semesterId=${fall}&day=wednesday&date=2025-10-01`).set('Cookie', cookie);
  assert.equal(res.status, 200);
  // The date heading and each hour with its time.
  assert.match(res.text, /Wed, October 1, 2025|Wednesday, October 1, 2025/);
  assert.match(res.text, /9:00 AM - 9:55 AM/);
  const hourSections = res.text.split('<section class="pg-roster-hour">').slice(1);
  assert.ok(hourSections.length >= 4, 'every hour is listed');
  assert.match(hourSections[0], /Hour One Kid/);
  assert.match(hourSections[2], /Hour Three Kid/);
  assert.match(hourSections[1], /Nobody checked in during this time/);
  assert.doesNotMatch(res.text, /Spring Kid/, 'only the chosen date');

  // The filter's Date list follows the semester + day.
  const dates = JSON.parse(/data-dates="([^"]*)"/.exec(res.text)[1].replace(/&#34;/g, '"'));
  assert.deepEqual(dates[String(fall)].wednesday.map((d) => d.date), ['2025-10-01']);
  assert.deepEqual(dates[String(spring)].wednesday.map((d) => d.date), ['2026-03-04']);
  assert.match(res.text, new RegExp(`<option value="${fall}" selected>PG Fall Test</option>`));

  const springRes = await request(app).get(`/admin/rosters?tab=playground&semesterId=${spring}&day=wednesday`).set('Cookie', cookie);
  assert.match(springRes.text, /Spring Kid/, "defaults to that semester's latest date");
  assert.doesNotMatch(springRes.text, /Hour One Kid/);

  // Print and PDF follow the same filter.
  const print = await request(app).get(`/admin/rosters/print?tab=playground&semesterId=${fall}&day=wednesday&date=2025-10-01`).set('Cookie', cookie);
  assert.equal(print.status, 200);
  assert.match(print.text, /<h1>Playground Roster<\/h1>/);
  assert.match(print.text, /Hour Three Kid/);
  const pdf = await request(app).get(`/admin/rosters/download.pdf?tab=playground&semesterId=${fall}&day=wednesday&date=2025-10-01`).set('Cookie', cookie);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
});
