// A real request: "Shrink to fit 6 columns on the schedule grid for
// mobile... Be able to move columns like we do rows."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `grid-column-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `grid-column-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { createClass, roomGridForDay } = require('../utils/classSchedule');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

const csrfOf = (html) => /name="csrf-token" content="([^"]*)"/.exec(html)[1];

test('moving a column saves a display order; classes keep their own hour; a span only joins columns still side by side', async () => {
  const sem = (await db.prepare("INSERT INTO semesters (title) VALUES ('Col Sem') RETURNING id").get()).id;
  await db.prepare("INSERT INTO class_schedules (title, day_of_week, semester_id) VALUES ('Col Sem - Wednesday', 'wednesday', ?)").run(sem);
  const ids = {};
  for (let h = 1; h <= 4; h++) ids[h] = await createClass({ day: 'wednesday', hourPosition: h, className: `Col H${h}`, room: 'R1', semesterId: sem });
  // A two-hour class in R2 (same name/color/grade in hours 1 and 2 merges into one spanned cell).
  await createClass({ day: 'wednesday', hourPosition: 1, className: 'Two Hour Lab', room: 'R2', semesterId: sem, color: '#f6b26b' });
  await createClass({ day: 'wednesday', hourPosition: 2, className: 'Two Hour Lab', room: 'R2', semesterId: sem, color: '#f6b26b' });

  let grid = await roomGridForDay('wednesday', sem);
  assert.deepEqual(grid.hours.map((h) => h.position), [1, 2, 3, 4]);
  assert.equal(grid.rows.find((r) => r.room === 'R2').cells[0].span, 2, 'side by side: spans');

  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const page = await admin.get(`/admin/schedule?tab=wednesday&semesterId=${sem}`);
  assert.match(page.text, /<th data-col-position="1">\s*<span class="col-drag-handle no-print"/);
  const res = await admin.post('/admin/class-schedule/wednesday/columns/reorder').set('X-CSRF-Token', csrfOf(page.text)).send({ positions: [3, 1, 4, 2], semesterId: String(sem) });
  assert.equal(res.status, 200);

  grid = await roomGridForDay('wednesday', sem);
  assert.deepEqual(grid.hours.map((h) => h.position), [3, 1, 4, 2]);
  assert.deepEqual(grid.rows.find((r) => r.room === 'R1').cells.map((c) => c.classes[0].class_name), ['Col H3', 'Col H1', 'Col H4', 'Col H2']);
  const r2 = grid.rows.find((r) => r.room === 'R2').cells;
  assert.equal(r2.length, 4, 'hours 1 and 2 are no longer side by side, so no span');
  assert.ok(r2.every((c) => c.span === 1));
  assert.equal((await db.prepare('SELECT hour_position FROM classes WHERE id = ?').get(ids[3])).hour_position, 3, 'the class keeps its own hour');

  const reloaded = await admin.get(`/admin/schedule?tab=wednesday&semesterId=${sem}`);
  const order = [...reloaded.text.matchAll(/<th data-col-position="(\d)">/g)].map((m) => m[1]).join(',');
  assert.equal(order, '3,1,4,2');
});
