// A real request: "Add a tab on the orange menu bar on the kiosk screen
// called orientation kiosk. When you click this button it asks for the
// code that is set for class check in and out. On this screen it looks
// like the normal kiosk screen but the large buttons are. Tour check in.
// Open house check in. Teacher check in. Volunteer check in. These are
// linked to the items under the orientation tab that are tracked per
// member."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `kiosk-orientation-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `kiosk-orientation-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

test('Orientation Kiosk: menu tab, PIN, four check-in buttons that mark Orientation Tracking', async () => {
  const home = await request(app).get('/kiosk');
  assert.match(home.text, /href="\/kiosk\/class-checkin\?next=%2Fkiosk%2Fclass-checkin%2Forientation"><svg class="icon"><use href="#icon-check-circle"\/><\/svg> Orientation Kiosk<\/a>/);

  const agent = request.agent(app);
  const locked = await agent.get('/kiosk/class-checkin/orientation');
  assert.equal(locked.status, 302);
  const pin = await agent.get(locked.headers.location);
  assert.match(pin.text, /<h1>Orientation Kiosk<\/h1>/);
  const unlock = await agent.post('/kiosk/class-checkin/unlock').type('form').send({ pin: '0000', next: '/kiosk/class-checkin/orientation' });
  assert.equal(unlock.headers.location, '/kiosk/class-checkin/orientation');

  const screen = await agent.get('/kiosk/class-checkin/orientation');
  for (const [kind, label] of [['tour', 'Tour Check In'], ['open-house', 'Open House Check In'], ['teacher', 'Teacher Check In'], ['volunteer', 'Volunteer Check In']]) {
    assert.match(screen.text, new RegExp(`href="/kiosk/class-checkin/orientation/${kind}/scan">[\\s\\S]*?${label}`));
  }

  const fam = (await db.prepare("INSERT INTO families (name) VALUES ('Orient Kiosk') RETURNING id").get()).id;
  const parent = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, is_primary_parent, active) VALUES ('Kiosk Parent', 'OK-P', 'parent', ?, 1, 1) RETURNING id").get(fam)).id;
  const kid = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, active) VALUES ('Kiosk Kid', 'OK-K', 'student', ?, 1) RETURNING id").get(fam)).id;
  const cls = (await db.prepare("INSERT INTO classes (class_name, day, hour_position) VALUES ('Kiosk Class', 'monday', 1) RETURNING id").get()).id;
  await db.prepare('INSERT INTO class_enrollments (class_id, student_id) VALUES (?, ?)').run(cls, kid);

  const scanPage = await agent.get('/kiosk/class-checkin/orientation/teacher/scan');
  assert.equal(scanPage.status, 200);
  assert.match(scanPage.text, /<h1>Teacher Check In<\/h1>/);
  assert.doesNotMatch(scanPage.text, /admin-sidebar/, 'kiosk frame, not the admin nav');

  for (const kind of ['tour', 'open-house', 'teacher', 'volunteer']) {
    const r = await agent.post(`/kiosk/class-checkin/orientation/${kind}/scan`).type('json').send({ barcode: 'OK-K', semesterId: '' });
    assert.equal(r.body.ok, true, kind);
  }
  const row = await db.prepare('SELECT * FROM orientation_progress WHERE member_id = ?').get(parent);
  assert.equal(Number(row.tour_complete), 1);
  assert.equal(Number(row.open_house_complete), 1);
  assert.equal(Number(row.teacher_training_complete), 1);
  assert.equal(Number(row.video_complete), 1, 'Volunteer Check In marks Parent Orientation');

  const anon = await request(app).post('/kiosk/class-checkin/orientation/tour/scan').type('json').send({ barcode: 'OK-K' });
  assert.equal(anon.status, 302, 'needs the PIN');
});
