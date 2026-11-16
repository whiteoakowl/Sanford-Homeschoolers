// A real request: "Lesson plan approval page. Should list all of the
// classes by semester/day. Drop down menu to switch semester/day. Hour
// sections, class name, teacher name, lesson plan column, substitute plan
// column. Bubbles under each column and each row and it says approved,
// rejected, submitted or nothing. Button at the end of each row that says
// view submission if something has been submitted."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `lesson-approval-grid-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `lesson-approval-grid-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { createClass, addStaff } = require('../utils/classSchedule');
const { createAssignment } = require('../utils/academics');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

function rowFor(html, className) {
  const m = new RegExp(`<tr>\\s*<td class="table-stack-heading"><a [^>]*>${className}</a></td>([\\s\\S]*?)</tr>`).exec(html);
  assert.ok(m, `row for ${className}`);
  return m[1];
}

test('By Class view: semester/day picker, hour sections, teacher, lesson and substitute plan bubbles, View Submission', async () => {
  const sem = (await db.prepare("INSERT INTO semesters (title) VALUES ('Spring 2027') RETURNING id").get()).id;
  const combo = (await db.prepare("INSERT INTO class_schedules (title, day_of_week, semester_id) VALUES ('Spring 2027 - Monday', 'monday', ?) RETURNING id").get(sem)).id;
  const teacher = (await db.prepare("INSERT INTO members (name, barcode, member_type, active) VALUES ('Tia Teacher', 'TT', 'parent', 1) RETURNING id").get()).id;
  const art = await createClass({ day: 'monday', hourPosition: 1, className: 'Grid Art', room: 'R1', semesterId: sem });
  const math = await createClass({ day: 'monday', hourPosition: 1, className: 'Grid Math', room: 'R2', semesterId: sem });
  const music = await createClass({ day: 'monday', hourPosition: 2, className: 'Grid Music', room: 'R3', semesterId: sem });
  await createClass({ day: 'monday', hourPosition: 2, className: 'Grid Quiet', room: 'R4', semesterId: sem });
  await addStaff(art, teacher, 'teacher');

  const a1 = await createAssignment({ classId: art, className: 'Grid Art', title: 'Week 1', approvalStatus: 'pending' });
  await db.prepare('UPDATE class_assignments SET submitted_at = now_text() WHERE id = ?').run(a1);
  await db.prepare("INSERT INTO class_substitute_plans (class_id, title, approval_status, submitted_with_assignment_id, submitted_at) VALUES (?, 'Rainy day', 'pending', ?, now_text())").run(art, a1);
  const a2 = await createAssignment({ classId: math, className: 'Grid Math', title: 'Fractions', approvalStatus: 'approved' });
  await db.prepare('UPDATE class_assignments SET submitted_at = now_text(), reviewed_at = now_text() WHERE id = ?').run(a2);
  const a3 = await createAssignment({ classId: music, className: 'Grid Music', title: 'Rhythm', approvalStatus: 'rejected' });
  await db.prepare('UPDATE class_assignments SET submitted_at = now_text(), reviewed_at = now_text() WHERE id = ?').run(a3);
  await db.prepare("INSERT INTO class_substitute_plans (class_id, title, approval_status, submitted_with_assignment_id, submitted_at, reviewed_at) VALUES (?, 'Sub', 'approved', ?, now_text(), now_text())").run(music, a3);

  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const page = await admin.get(`/admin/lesson-plans/approval?combo=${combo}`);
  assert.equal(page.status, 200);
  assert.match(page.text, new RegExp(`<option value="${combo}" selected>Spring 2027 - Monday</option>`));
  assert.match(page.text, /<h2 class="lpa-hour-title">Hour 1/);
  assert.match(page.text, /<h2 class="lpa-hour-title">Hour 2/);
  assert.match(page.text, /<th class="lpa-col">Lesson Plan<\/th><th class="lpa-col">Substitute Plan<\/th>/);

  const artRow = rowFor(page.text, 'Grid Art');
  assert.match(artRow, /Tia Teacher/);
  assert.match(artRow, /data-label="Lesson Plan" class="lpa-col"><span class="lpa-bubble lpa-bubble-pending">Submitted<\/span>/);
  assert.match(artRow, /data-label="Substitute Plan" class="lpa-col"><span class="lpa-bubble lpa-bubble-pending">Submitted<\/span>/);
  assert.match(artRow, new RegExp(`href="/admin/lesson-plans/approval/${a1}">View Submission</a>`));

  assert.match(rowFor(page.text, 'Grid Math'), /lpa-bubble-approved">Approved<\/span>[\s\S]*lpa-bubble-none/);
  const musicRow = rowFor(page.text, 'Grid Music');
  assert.match(musicRow, /data-label="Lesson Plan" class="lpa-col"><span class="lpa-bubble lpa-bubble-rejected">Rejected<\/span>/);
  assert.match(musicRow, /data-label="Substitute Plan" class="lpa-col"><span class="lpa-bubble lpa-bubble-approved">Approved<\/span>/);
  const quietRow = rowFor(page.text, 'Grid Quiet');
  assert.match(quietRow, /lpa-bubble-none[\s\S]*lpa-bubble-none/);
  assert.doesNotMatch(quietRow, /View Submission/, 'nothing submitted, no button');
});
