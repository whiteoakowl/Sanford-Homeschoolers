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

// A real request: "When selecting all classes to edit it should only edit
// the class grid you are viewing. Bulk edit should include Close
// Registration, Parents Can Complete Lessons, Parents Can Use Class Chat,
// Price, Charged per, Account category, Lock class by age, Lock class by
// grade."
test('Bulk Edit sets the new fields, leaves "Don\'t change" alone, and only touches the grid\'s own day', async () => {
  const mon = await createClass({ day: 'monday', hourPosition: 1, className: 'Bulk Mon', room: 'R1', priceCents: 1000 });
  const wed = await createClass({ day: 'wednesday', hourPosition: 1, className: 'Bulk Wed', room: 'R1' });
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const page = await admin.get('/admin/schedule?tab=monday');
  const dialog = /<dialog id="bulk-edit-dialog-monday"[\s\S]*?<\/dialog>/.exec(page.text)[0];
  for (const name of ['closeClass', 'allowParentCompleteLessons', 'allowParentChat', 'priceDollars', 'pricePer', 'accountingCategoryId', 'lockByAge', 'lockByGrade']) {
    assert.match(dialog, new RegExp(`name="${name}"`), name);
  }
  assert.match(dialog, /Close Registration<\/label>/);
  assert.match(page.text, /data-select-all-for="class-bulk-edit-form-monday" data-select-visible-only/);

  await admin.post('/admin/class-schedule/monday/bulk-edit').type('form').send({
    _csrf: csrfOf(page.text), classIds: `${mon},${wed}`, closeClass: '1', allowParentCompleteLessons: '1', allowParentChat: '0', lockByGrade: '0', lockByAge: '', pricePer: 'students_and_staff', accountingCategoryId: '',
  });
  const m = await db.prepare('SELECT * FROM classes WHERE id = ?').get(mon);
  assert.equal(Number(m.registration_open), 0);
  assert.equal(Number(m.allow_parent_complete_lessons), 1);
  assert.equal(Number(m.allow_parent_chat), 0);
  assert.equal(Number(m.lock_by_grade), 0);
  assert.equal(Number(m.lock_by_age), 1, "Don't change leaves it");
  assert.equal(m.price_cents, 1000, 'blank price leaves it');
  assert.equal(m.price_per, 'students_and_staff');
  const w = await db.prepare('SELECT registration_open, price_per FROM classes WHERE id = ?').get(wed);
  assert.equal(Number(w.registration_open), 1, 'another day\'s class is never touched');
  assert.equal(w.price_per, 'students');

  await admin.post('/admin/class-schedule/monday/bulk-edit').type('form').send({ _csrf: csrfOf(page.text), classIds: String(mon), makeFree: '1' });
  assert.equal((await db.prepare('SELECT price_cents FROM classes WHERE id = ?').get(mon)).price_cents, null, 'Make free clears the price');
});
