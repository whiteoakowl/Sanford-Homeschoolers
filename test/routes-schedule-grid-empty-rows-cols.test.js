// A real request: "When printing or viewing pdf or viewing class schedule
// grid in any way, it should still show the rows and columns created for
// that class schedule grid, even if there isn't a class assigned to it at
// the moment. For better visual while planning."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `schedule-grid-empty-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `schedule-grid-empty-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const cs = require('../utils/classSchedule');
const { setActiveKioskSemesterId } = require('../utils/kioskSettings');
const { hashPassword } = require('../utils/portalAuth');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

function gridSummary(html) {
  const marker = html.indexOf('class-schedule-room-grid');
  const start = marker >= 0 ? marker : html.indexOf('<table');
  const table = html.slice(start, html.indexOf('</table>', start));
  return {
    rooms: ['Plan Room A', 'Plan Room B', 'Plan Room C'].filter((r) => table.includes(r)),
    hasHour5: table.includes('Hour Five'),
  };
}

test('Every schedule grid view keeps empty rooms and hour columns, including the member portals\' All Semesters default', async () => {
  const sem = await cs.createSemester('Planning Semester');
  await setActiveKioskSemesterId(sem.id);
  await cs.saveHourLabels('monday', ['Hour One', 'Hour Two', 'Hour Three', 'Hour Four', 'Hour Five'], [], [], sem.id);
  await cs.saveRoomsForGrid('monday', sem.id, ['Plan Room A', 'Plan Room B', 'Plan Room C']);
  await cs.createClass({ day: 'monday', hourPosition: 2, className: 'The Only Class', room: 'Plan Room B', semesterId: sem.id });

  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/admin' });
  const views = {
    'admin grid': (await admin.get('/admin/schedule?tab=monday')).text,
    'admin print': (await admin.get('/admin/class-schedule/monday/print')).text,
  };
  let n = 0;
  for (const role of ['teacher', 'parent', 'student']) {
    n += 1;
    const code = `grid${n}`;
    const memberId = (await db.prepare('INSERT INTO members (name, barcode, member_code, member_type, active) VALUES (?, ?, ?, ?, 1) RETURNING id').get(code, code, code, role === 'student' ? 'student' : 'parent')).id;
    const accountId = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text()) RETURNING id").get(memberId, `${code}@example.com`, hashPassword('pw123456'))).id;
    await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = ?))').run(accountId, role);
    const agent = request.agent(app);
    await agent.post('/login').type('form').send({ email: `${code}@example.com`, password: 'pw123456', next: `/${role}` });
    views[`${role} grid`] = (await agent.get(`/${role}/classes?view=grid&day=monday`)).text;
  }
  for (const [name, html] of Object.entries(views)) {
    const g = gridSummary(html);
    assert.deepEqual(g.rooms, ['Plan Room A', 'Plan Room B', 'Plan Room C'], `${name}: every room row shows, even empty ones`);
    assert.ok(g.hasHour5, `${name}: the added 5th hour column shows even with no class in it`);
  }
});

// A real request: "Each semester/day class schedule grid should have its
// own setting for rows and columns."
test('Each semester/day grid keeps its own column count and rooms', async () => {
  const fall = await cs.createSemester('Fall Columns');
  const spring = await cs.createSemester('Spring Columns');
  await cs.saveHourLabels('tuesday', ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'], [], [], fall.id);
  await cs.saveHourLabels('tuesday', ['S1', 'S2', 'S3'], [], [], spring.id);
  await cs.saveRoomsForGrid('tuesday', fall.id, ['Fall Room']);
  await cs.saveRoomsForGrid('tuesday', spring.id, ['Spring Room 1', 'Spring Room 2']);

  const fallGrid = await cs.roomGridForDay('tuesday', fall.id);
  const springGrid = await cs.roomGridForDay('tuesday', spring.id);
  assert.deepEqual(fallGrid.hours.map((h) => h.label), ['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
  assert.deepEqual(springGrid.hours.map((h) => h.label), ['S1', 'S2', 'S3']);
  assert.deepEqual(fallGrid.rows.map((r) => r.room), ['Fall Room']);
  assert.deepEqual(springGrid.rows.map((r) => r.room), ['Spring Room 1', 'Spring Room 2']);
  assert.equal(springGrid.rows[0].cells.reduce((n, c) => n + c.span, 0), 3, 'each row has exactly this grid\'s 3 columns');

  // Removing columns: a column that still has a class in it stays.
  await cs.createClass({ day: 'tuesday', hourPosition: 3, className: 'Col 3 Class', room: 'Spring Room 1', semesterId: spring.id });
  await cs.saveHourLabels('tuesday', ['S1'], [], [], spring.id);
  assert.deepEqual((await cs.roomGridForDay('tuesday', spring.id)).hours.map((h) => h.label), ['S1', 'Hour 2', 'Hour 3']);
  // The fall grid is untouched.
  assert.equal((await cs.roomGridForDay('tuesday', fall.id)).hours.length, 6);
});
