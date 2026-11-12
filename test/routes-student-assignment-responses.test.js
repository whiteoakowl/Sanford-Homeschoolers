// Real requests:
// - "When choosing the upload assignment option, there should be a place
//   for students to upload their assignment on their end. Word, pdf etc.
//   Student should be able to type their response with full editing
//   features or a button to upload their assignment."
// - Teacher Portal, mobile: "The teachers classes should not be their own
//   tabs. There should be a tab called My Classes and each of the
//   teachers classes should be subpages."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `student-assignment-responses-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `student-assignment-responses-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');
const { createAssignment, createContentItem } = require('../utils/academics');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

let n = 0;
async function account(name, memberType, roleKey) {
  n += 1;
  const memberId = (await db.prepare('INSERT INTO members (name, barcode, member_code, member_type, active) VALUES (?, ?, ?, ?, 1) RETURNING id').get(name, `sar${n}`, `sar${n}`, memberType)).id;
  const email = `sar${n}@example.com`;
  const accountId = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text()) RETURNING id").get(memberId, email, hashPassword('pw123456'))).id;
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = ?))').run(accountId, roleKey);
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email, password: 'pw123456', next: `/${roleKey}` });
  return { memberId, agent };
}

const csrfOf = (html) => /name="csrf-token" content="([^"]*)"/.exec(html)[1];

test('Upload assignment: a student types a rich response, then adds a Word file; the teacher reads both', async () => {
  const classId = (await db.prepare("INSERT INTO classes (class_name, day, hour_position) VALUES ('Response Class', 'monday', 1) RETURNING id").get()).id;
  const assignmentId = await createAssignment({ classId, className: 'Response Class', title: 'Week 1', createdByAccountId: null });
  const itemId = await createContentItem({ assignmentId, type: 'assignment_upload', title: 'Essay', body: '<p>Write about your summer.</p>' });
  const student = await account('Response Student', 'student', 'student');
  await db.prepare('INSERT INTO class_enrollments (class_id, student_id) VALUES (?, ?)').run(classId, student.memberId);
  const teacher = await account('Response Teacher', 'parent', 'teacher');
  await db.prepare("INSERT INTO class_staff (class_id, member_id, role) VALUES (?, ?, 'teacher')").run(classId, teacher.memberId);

  const page = await student.agent.get(`/student/content/${itemId}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Type your response/);
  assert.match(page.text, /data-forum-editor/);
  assert.match(page.text, /name="responseBody" data-forum-body-input/);
  assert.match(page.text, /Or upload your assignment/);
  assert.match(page.text, /accept="[^"]*\.docx[^"]*\.pdf/);
  assert.match(page.text, /<script src="\/js\/forum-editor.js"><\/script>/);
  const csrf = csrfOf(page.text);

  const empty = await student.agent.post(`/student/content/${itemId}/submit?_csrf=${encodeURIComponent(csrf)}`).field('responseBody', '');
  assert.match(decodeURIComponent(empty.headers.location), /Type your response or choose a file/);

  const typed = await student.agent.post(`/student/content/${itemId}/submit?_csrf=${encodeURIComponent(csrf)}`).field('responseBody', '<p>My <strong>summer</strong> was great.</p><script>alert(1)</script>');
  assert.equal(typed.status, 302);
  let sub = await db.prepare('SELECT * FROM assignment_submissions WHERE content_item_id = ? AND student_id = ?').get(itemId, student.memberId);
  assert.match(sub.response_body, /<strong>summer<\/strong>/);
  assert.doesNotMatch(sub.response_body, /<script/);
  assert.equal(sub.file_url, null);
  assert.ok(await db.prepare('SELECT 1 FROM lesson_item_completions WHERE content_item_id = ? AND student_id = ?').get(itemId, student.memberId), 'handing it in also marks it complete');

  const withFile = await student.agent.post(`/student/content/${itemId}/submit?_csrf=${encodeURIComponent(csrf)}`)

    .field('responseBody', '<p>My summer was great. See attached.</p>')
    .attach('submissionFile', Buffer.from('PK fake docx'), { filename: 'essay.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  assert.equal(withFile.status, 302);
  sub = await db.prepare('SELECT * FROM assignment_submissions WHERE content_item_id = ? AND student_id = ?').get(itemId, student.memberId);
  assert.equal(sub.file_name, 'essay.docx');
  assert.match(sub.response_body, /See attached/);

  const after = await student.agent.get(`/student/content/${itemId}`);
  assert.match(after.text, /Submitted/);
  assert.match(after.text, /essay\.docx/);
  assert.match(after.text, /See attached/, 'the editor starts with their earlier response');

  const review = await teacher.agent.get(`/teacher/content/${itemId}/submissions`);
  assert.equal(review.status, 200);
  assert.match(review.text, /essay\.docx/);
  assert.match(review.text, /Read typed response/);
  assert.match(review.text, /See attached/);
});

test('Teacher Portal mobile bar: one My Classes tab whose popup lists the classes; class pages get the title menu', async () => {
  const a = (await db.prepare("INSERT INTO classes (class_name, day, hour_position) VALUES ('Nav Class A', 'monday', 2) RETURNING id").get()).id;
  const b = (await db.prepare("INSERT INTO classes (class_name, day, hour_position) VALUES ('Nav Class B', 'monday', 3) RETURNING id").get()).id;
  const teacher = await account('Nav Teacher', 'parent', 'teacher');
  await db.prepare("INSERT INTO class_staff (class_id, member_id, role) VALUES (?, ?, 'teacher'), (?, ?, 'teacher')").run(a, teacher.memberId, b, teacher.memberId);

  const page = await teacher.agent.get('/teacher');
  const bar = page.text.slice(page.text.indexOf('id="admin-mobile-tabs"'), page.text.indexOf('</nav>', page.text.indexOf('id="admin-mobile-tabs"')));
  assert.match(bar, /data-subpages-prefix-match/);
  assert.match(bar, /data-subpages-dialog="mobile-subpages-my-classes"/);
  assert.match(bar, /My<br>Classes/);
  assert.doesNotMatch(bar, new RegExp(`<a href="/teacher/classes/${a}"`), 'classes are no longer their own tabs');
  const dialog = page.text.slice(page.text.indexOf('id="mobile-subpages-my-classes"'));
  assert.match(dialog, new RegExp(`href="/teacher/classes/${a}">Nav Class A<`));
  assert.match(dialog, new RegExp(`href="/teacher/classes/${b}">Nav Class B<`));
  // The desktop sidebar keeps its own My Classes section.
  assert.match(page.text, /class="portal-nav-title">My Classes</);
});
