// A real request: "Co-op admin portal, logs, no show/missed job log.
// Should only count that day and the previous dates. Should not count
// nothing being marked for upcoming dates."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `missed-duty-log-dates-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `missed-duty-log-dates-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { ensureDayRoster } = require('../utils/classSchedule');
const { todayISO, formatDateLabel } = require('../utils/dates');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

function shift(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test('Missed Duty / No-Show log counts today and earlier dates, never upcoming ones', async () => {
  const today = todayISO();
  const past = shift(today, -7);
  const future = shift(today, 7);
  const rosterId = await ensureDayRoster('monday', 'parent');
  const memberId = (await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, active) VALUES ('Nora Noshow', 'nn1', 'nn1', 'parent', 1) RETURNING id").get()).id;
  await db.prepare('INSERT INTO roster_members (roster_id, member_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(rosterId, memberId);
  for (const d of [past, today, future]) {
    await db.prepare('INSERT INTO roster_dates (roster_id, session_date) VALUES (?, ?) ON CONFLICT DO NOTHING').run(rosterId, d);
  }

  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/admin' });
  const page = await admin.get('/admin/logs?tab=missedduty');
  assert.equal(page.status, 200);
  const csv = await admin.get('/admin/logs/missedduty/export.csv');
  assert.match(csv.text, new RegExp(`"${formatDateLabel(past)}"`));
  assert.match(csv.text, new RegExp(`"${formatDateLabel(today)}"`), 'today counts too');
  assert.doesNotMatch(csv.text, new RegExp(`"${formatDateLabel(future)}"`), 'an upcoming date is never counted');
  // Running total counts only today and the past date, never the upcoming one.
  assert.match(csv.text, new RegExp(`"${formatDateLabel(today)}","Nora Noshow","","","Yes","0","2"`));
  assert.match(csv.text, /Nora Noshow/);
});

// A real request: "Check if manual input of attendance is checked." A
// parent an admin marks Present or Late by hand on the Attendance grid
// isn't a no-show; one left unmarked (or marked Absent with no absence
// form) still is.
test('Manually marked Present/Late on the Attendance grid is not a no-show', async () => {
  const today = todayISO();
  const date = shift(today, -14);
  const rosterId = await ensureDayRoster('monday', 'parent');
  await db.prepare('INSERT INTO roster_dates (roster_id, session_date) VALUES (?, ?) ON CONFLICT DO NOTHING').run(rosterId, date);
  const make = async (name) => {
    const id = (await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, active) VALUES (?, ?, ?, 'parent', 1) RETURNING id").get(name, name, name)).id;
    await db.prepare('INSERT INTO roster_members (roster_id, member_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(rosterId, id);
    return id;
  };
  const presentId = await make('Manual Present');
  const lateId = await make('Manual Late');
  const absentId = await make('Manual Absent');
  await make('Never Marked');

  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/admin' });
  const page = await admin.get('/admin/rosters?tab=monday-parent');
  const csrf = /name="csrf-token" content="([^"]*)"/.exec(page.text)[1];
  const save = await admin.post('/admin/rosters/monday-parent/attendance').type('form')
    .send({ _csrf: csrf, [`status:${presentId}:${date}`]: 'present', [`status:${lateId}:${date}`]: 'late', [`status:${absentId}:${date}`]: 'absent' });
  assert.equal(save.status, 302);
  assert.equal((await db.prepare("SELECT source FROM attendance WHERE member_id = ? AND session_date = ?").get(presentId, date)).source, 'manual');

  const csv = (await admin.get(`/admin/logs/missedduty/export.csv?date=${date}`)).text;
  assert.doesNotMatch(csv, /Manual Present/);
  assert.doesNotMatch(csv, /Manual Late/);
  assert.match(csv, /Manual Absent/);
  assert.match(csv, /Never Marked/);
});

