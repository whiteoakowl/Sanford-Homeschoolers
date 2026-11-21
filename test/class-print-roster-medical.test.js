// A real request: "Co-op admin portal, class schedules. When you click on
// a class it should have a print roster button at the top. Pop up asks if
// you want to include medical/allergy information with a check box."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `class-print-roster-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `class-print-roster-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { createClass, setEnrollment } = require('../utils/classSchedule');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

test('class page has Print Roster with a medical/allergy checkbox; the roster shows medical only when asked', async () => {
  const login = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const cookie = login.headers['set-cookie'];
  const classId = await createClass({ day: 'monday', hourPosition: 1, className: 'Garden Club', room: 'Room 3' });
  const kid = (await db.prepare("INSERT INTO members (name, barcode, member_type, active, medical_notes) VALUES ('Mia Rivera', 'MR-1', 'student', 1, 'Peanut allergy - EpiPen in bag') RETURNING id").get()).id;
  await setEnrollment(classId, [kid]);

  const manage = await request(app).get(`/admin/class-schedule/classes/${classId}/manage`).set('Cookie', cookie);
  assert.match(manage.text, /Print Roster<\/button>/);
  assert.match(manage.text, new RegExp(`<dialog id="print-roster-dialog"[\\s\\S]*action="/admin/class-schedule/classes/${classId}/roster/print"[\\s\\S]*name="medical" value="1" /> Include medical/allergy information`));

  const plain = await request(app).get(`/admin/class-schedule/classes/${classId}/roster/print`).set('Cookie', cookie);
  assert.match(plain.text, /Mia Rivera/);
  assert.doesNotMatch(plain.text, /Medical\/Allergy Notes|Peanut allergy/);

  const withMedical = await request(app).get(`/admin/class-schedule/classes/${classId}/roster/print?medical=1`).set('Cookie', cookie);
  assert.match(withMedical.text, /Medical\/Allergy Notes/);
  assert.match(withMedical.text, /Peanut allergy - EpiPen in bag/);
});
