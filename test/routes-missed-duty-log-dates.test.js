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
