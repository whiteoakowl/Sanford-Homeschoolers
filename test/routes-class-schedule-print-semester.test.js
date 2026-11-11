// A real bug report: "Print and pdf for a schedule. I'm on spring Wednesday
// and went to print. It's showing all schedules for Wednesday fall and
// spring. It should be by semester/day and have a header." The day grid's
// Export/PDF/Print now carry the semester being viewed and filter by it
// the same way the on-screen grid does, and the printout header names the
// semester and day.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `class-schedule-print-semester-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `class-schedule-print-semester-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const { createClass, createSemester } = require('../utils/classSchedule');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

test('Spring Wednesday Print/PDF/Export cover only Spring classes, with a semester + day header', async () => {
  const fall = await createSemester('Fall Print Semester');
  const spring = await createSemester('Spring Print Semester');
  await createClass({ day: 'wednesday', hourPosition: 1, className: 'Fall Only Pottery', room: 'Room 1', semesterId: fall.id });
  await createClass({ day: 'wednesday', hourPosition: 1, className: 'Spring Only Robotics', room: 'Room 2', semesterId: spring.id });

  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/admin' });

  const page = await agent.get(`/admin/schedule?tab=wednesday&semesterId=${spring.id}`);
  assert.equal(page.status, 200);
  for (const action of ['export.csv', 'download.pdf', 'print']) {
    assert.match(page.text, new RegExp(`href="/admin/class-schedule/wednesday/${action.replace('.', '\\.')}\\?semesterId=${spring.id}"`), `${action} link carries the semester`);
  }

  const print = await agent.get(`/admin/class-schedule/wednesday/print?semesterId=${spring.id}`);
  assert.equal(print.status, 200);
  assert.match(print.text, /Spring Only Robotics/);
  assert.doesNotMatch(print.text, /Fall Only Pottery/);
  assert.match(print.text, /<p class="print-header-sub">Spring Print Semester &middot; Wednesday Schedule<\/p>/);
  assert.match(print.text, /<h1>Spring Print Semester &middot; Wednesday Schedule<\/h1>/);

  const csv = await agent.get(`/admin/class-schedule/wednesday/export.csv?semesterId=${spring.id}`);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /Spring Only Robotics/);
  assert.doesNotMatch(csv.text, /Fall Only Pottery/);
  assert.match(csv.headers['content-disposition'], /spring-print-semester-wednesday-class-schedule\.csv/);

  const pdf = await agent.get(`/admin/class-schedule/wednesday/download.pdf?semesterId=${spring.id}`).buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.match(pdf.headers['content-disposition'], /spring-print-semester-wednesday-class-schedule\.pdf/);
  assert.equal(pdf.body.slice(0, 5).toString(), '%PDF-');

  const fallPrint = await agent.get(`/admin/class-schedule/wednesday/print?semesterId=${fall.id}`);
  assert.match(fallPrint.text, /Fall Only Pottery/);
  assert.doesNotMatch(fallPrint.text, /Spring Only Robotics/);
});
