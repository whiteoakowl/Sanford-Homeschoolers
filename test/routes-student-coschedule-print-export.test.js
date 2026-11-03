// A real request: "Student portal, co-op class schedule. Remove the
// description. Add export, print and pdf icons. In a row, not a column,
// clean side by side. This row should be at the top under title." Covers
// views/student-classes.ejs losing its old <p class="hint"> description,
// gaining its own Export/Print/PDF icon row right under the <h1> (not
// folded into the semester/view-toggle/day-toggle filter-row below it),
// and routes/student-portal.js's new GET /classes/export.csv, /print,
// and /download.pdf routes - same three-icon convention as every other
// schedule-shaped page in the app (e.g. Co-op Teacher Portal's own
// /teacher/classes).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `student-coschedule-print-export-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `student-coschedule-print-export-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');
const classSchedule = require('../utils/classSchedule');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

let counter = 0;
async function createStudentAndLogin() {
  counter += 1;
  const code = `coscheduleprint${counter}`;
  const memberId = (
    await db.prepare("INSERT INTO members (name, barcode, member_type) VALUES (?, ?, 'student')").run(`Co-op Schedule Student ${counter}`, code)
  ).lastInsertRowid;
  const email = `${code}@example.com`;
  const accountId = (
    await db
      .prepare("INSERT INTO member_accounts (member_id, email, password_hash, status) VALUES (?, ?, ?, 'active')")
      .run(memberId, email, hashPassword('testpassword123'))
  ).lastInsertRowid;
  const role = await db.prepare("SELECT id FROM roles WHERE key = 'student'").get();
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountId, role.id);
  const loginRes = await request(app).post('/login').type('form').send({ email, password: 'testpassword123' });
  return loginRes.headers['set-cookie'];
}

async function createClassWithTeacher(day, className, teacherName) {
  const classId = await classSchedule.createClass({ day, hourPosition: 1, className, room: 'Room 1' });
  const teacherId = (
    await db.prepare("INSERT INTO members (name, barcode, member_type) VALUES (?, ?, 'admin')").run(teacherName, `teacher-${classId}`)
  ).lastInsertRowid;
  await classSchedule.addStaff(classId, teacherId, 'teacher');
  return classId;
}

test('Co-op Schedule page: the old description is gone, replaced by its own Export/Print/PDF icon row right under the title', async () => {
  const cookie = await createStudentAndLogin();
  const res = await request(app).get('/student/classes?day=monday').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, /The co-op's current class schedule - every class scheduled this day, for browsing only\./);

  const h1Index = res.text.indexOf('<h1>Co-op Schedule</h1>');
  assert.notEqual(h1Index, -1);
  const toolbarIndex = res.text.indexOf('class="co-op-schedule-file-icons no-print"', h1Index);
  const filterRowIndex = res.text.indexOf('class="filter-row no-print"', h1Index);
  assert.ok(toolbarIndex !== -1 && toolbarIndex < filterRowIndex, 'the icon row should come before the semester/view-toggle/day-toggle filter row');

  const toolbar = res.text.slice(toolbarIndex, filterRowIndex);
  const exportIdx = toolbar.indexOf('aria-label="Export CSV"');
  const printIdx = toolbar.indexOf('aria-label="Print"');
  const pdfIdx = toolbar.indexOf('aria-label="Download PDF"');
  assert.notEqual(exportIdx, -1);
  assert.notEqual(printIdx, -1);
  assert.notEqual(pdfIdx, -1);
  assert.ok(exportIdx < printIdx && printIdx < pdfIdx, 'Export, Print, PDF in that order, side by side in one row');
  assert.match(toolbar, /href="\/student\/classes\/export\.csv\?day=monday"/);
  assert.match(toolbar, /href="\/student\/classes\/print\?day=monday"/);
  assert.match(toolbar, /href="\/student\/classes\/download\.pdf\?day=monday"/);
});

// classSchedule.createClass alone doesn't create a class_schedules combo
// row (listActiveClassDays' own source) - routes/student-portal.js's own
// day resolution falls back to 'monday' whenever the requested day isn't
// in that (here, empty) active-days list, same fallback every other
// schedule page in the app already relies on, so every class below is
// created on 'monday' to match what day=... actually resolves to.
test('GET /student/classes/export.csv downloads a CSV of the day\'s visible schedule', async () => {
  const cookie = await createStudentAndLogin();
  await createClassWithTeacher('monday', 'Export Test Chemistry', 'Mr. Beaker');

  const res = await request(app).get('/student/classes/export.csv?day=monday').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.text, /Class Name.*Time.*Room.*Grade Level.*Teachers.*Assistants/);
  assert.match(res.text, /Export Test Chemistry/);
  assert.match(res.text, /Mr\. Beaker/);
});

test('GET /student/classes/print renders a print preview of the day\'s visible schedule', async () => {
  const cookie = await createStudentAndLogin();
  await createClassWithTeacher('monday', 'Print Preview Art', 'Ms. Brush');

  const res = await request(app).get('/student/classes/print?day=monday').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /Print Preview Art/);
  assert.match(res.text, /Ms\. Brush/);
  assert.match(res.text, /onclick="window\.print\(\)"/);
});

test('GET /student/classes/download.pdf returns a real PDF of the same print preview', async () => {
  const cookie = await createStudentAndLogin();
  await createClassWithTeacher('monday', 'PDF Download Music', 'Mr. Note');

  const res = await request(app)
    .get('/student/classes/download.pdf?day=monday')
    .set('Cookie', cookie)
    .buffer(true)
    .parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.match(res.headers['content-disposition'], /attachment; filename="monday-co-op-schedule\.pdf"/);
  assert.equal(res.body.slice(0, 5).toString(), '%PDF-');
});

test('export/print/pdf routes require Student Portal auth', async () => {
  const resExport = await request(app).get('/student/classes/export.csv?day=monday');
  const resPrint = await request(app).get('/student/classes/print?day=monday');
  const resPdf = await request(app).get('/student/classes/download.pdf?day=monday');
  assert.equal(resExport.status, 302);
  assert.equal(resPrint.status, 302);
  assert.equal(resPdf.status, 302);
});
