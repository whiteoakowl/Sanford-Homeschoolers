// A real bug report: "When editing class. Class hour is not updating with
// the new edit schedule grid changes." Edit Schedule Grids saves a
// semester's own copy of a day's hours; the Edit Class form, the class's
// displayed time and the class lists now read that semester's copy instead
// of the shared day-only hours.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `class-edit-semester-hours-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `class-edit-semester-hours-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const { createClass, createSemester, saveHourLabels, allClassesList, HOUR_POSITIONS } = require('../utils/classSchedule');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

test('Edit Class and class lists use the class semester\'s Edit Schedule Grids hours', async () => {
  const spring = await createSemester('Spring Hours Semester');
  const labels = HOUR_POSITIONS.map((p) => (p === 1 ? 'Morning Block' : `Block ${p}`));
  const starts = HOUR_POSITIONS.map((p) => (p === 1 ? '9:00 AM' : ''));
  const ends = HOUR_POSITIONS.map((p) => (p === 1 ? '9:50 AM' : ''));
  await saveHourLabels('thursday', labels, starts, ends, spring.id);
  const classId = await createClass({ day: 'thursday', hourPosition: 1, className: 'Semester Hours Art', room: 'Room 4', semesterId: spring.id });

  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/admin' });

  const fragment = await agent.get(`/admin/class-schedule/classes/${classId}/view-fragment`);
  assert.equal(fragment.status, 200);
  assert.match(fragment.text, /<option value="1"[^>]*>Morning Block<\/option>/);
  assert.doesNotMatch(fragment.text, />Hour 1<\/option>/);

  const manage = await agent.get(`/admin/class-schedule/classes/${classId}/manage`);
  assert.equal(manage.status, 200);
  assert.match(manage.text, />Morning Block<\/option>/);

  const list = (await allClassesList('thursday', spring.id)).filter((c) => c.id === classId);
  assert.equal(list.length, 1, 'the class is listed once, not once per hours copy');
  assert.equal(list[0].hourLabel, 'Morning Block');
  assert.equal(list[0].timeLabel, '9:00 AM - 9:50 AM');
});

// A real request: "Bulk edit should include choose class hour. Class edit
// room should be a drop down of the room name options."
test('Bulk Edit can change Class Hour; Edit Class and Bulk Edit Room are dropdowns of room names', async () => {
  const { saveRoomsForGrid } = require('../utils/classSchedule');
  const fall = await createSemester('Fall Rooms Semester');
  await saveRoomsForGrid('wednesday', fall.id, ['Library', 'Gym']);
  const a = await createClass({ day: 'wednesday', hourPosition: 1, className: 'Bulk Hour A', room: 'Library', semesterId: fall.id });
  const b = await createClass({ day: 'wednesday', hourPosition: 1, className: 'Bulk Hour B', room: 'Studio 7', semesterId: fall.id });

  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/admin' });

  const grid = await agent.get(`/admin/schedule?tab=wednesday&semesterId=${fall.id}`);
  const csrf = /name="csrf-token" content="([^"]*)"/.exec(grid.text)[1];
  const dialog = grid.text.slice(grid.text.indexOf('id="bulk-edit-dialog-wednesday"'));
  assert.match(dialog, /<select name="hourPosition">\s*<option value="">Don(&#39;|')t change<\/option>/);
  assert.match(dialog, /<select name="room">\s*<option value="">Don(&#39;|')t change<\/option>[\s\S]*<option value="Studio 7">/);

  const res = await agent.post('/admin/class-schedule/wednesday/bulk-edit').type('form')
    .send({ _csrf: csrf, classIds: `${a},${b}`, gridSemesterId: String(fall.id), hourPosition: '2', room: '' });
  assert.equal(res.status, 302);
  const db = require('../db');
  const rows = await db.prepare('SELECT hour_position, room FROM classes WHERE id IN (?, ?) ORDER BY id').all(a, b);
  assert.deepEqual(rows.map((r) => r.hour_position), [2, 2]);
  assert.deepEqual(rows.map((r) => r.room), ['Library', 'Studio 7'], 'blank Room leaves each class\'s room alone');

  const fragment = await agent.get(`/admin/class-schedule/classes/${b}/view-fragment`);
  assert.match(fragment.text, /<select name="room" disabled>/);
  assert.match(fragment.text, /<option value="Studio 7" selected>Studio 7<\/option>/);
  assert.match(fragment.text, /<option value="Library" >Library<\/option>/);
  assert.doesNotMatch(fragment.text, /<input type="text" name="room"/);

  const manage = await agent.get(`/admin/class-schedule/classes/${b}/manage`);
  assert.match(manage.text, /<select name="room">[\s\S]*<option value="Studio 7" selected>/);
});
