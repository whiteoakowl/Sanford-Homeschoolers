// Storage/security audit: a student's handed-in co-op homework is saved
// in a private store and served only through GET /class-submissions/:key,
// which lets in the student, their family, the class teacher and Co-op
// Admins - never another family, never a signed-out visitor. Re-uploading
// replaces (deletes) the old file instead of leaving it behind.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(os.tmpdir(), `class-submission-privacy-${process.pid}.db`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { generateMemberCode } = require('../utils/members');
const { hashPassword } = require('../utils/portalAuth');

const SUBMISSIONS_DIR = path.join(__dirname, '..', 'private-uploads', 'assignment-submissions');
const createdKeys = [];

test.before(() => app.ready);
test.after(() => {
  for (const key of createdKeys) fs.rmSync(path.join(SUBMISSIONS_DIR, key), { force: true });
});

function extractCsrf(html) {
  return /name="csrf-token" content="([^"]*)"/.exec(html)[1];
}

async function login(email) {
  const res = await request(app).post('/login').type('form').send({ email, password: 'testpassword123' });
  return res.headers['set-cookie'];
}

async function makeMember({ name, type, familyId, email, roleKey }) {
  const code = await generateMemberCode();
  const memberId = (
    await db
      .prepare("INSERT INTO members (name, barcode, member_code, member_type, active, family_id) VALUES (?, ?, ?, ?, 1, ?) RETURNING id")
      .get(name, code, code, type, familyId)
  ).id;
  const accountId = (
    await db
      .prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text()) RETURNING id")
      .get(memberId, email, hashPassword('testpassword123'))
  ).id;
  const role = await db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey);
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountId, role.id);
  return { memberId, cookie: await login(email) };
}

async function makeFamily(name) {
  return (await db.prepare('INSERT INTO families (name) VALUES (?) RETURNING id').get(name)).id;
}

test('homework files are private: only the student, family, teacher and admins can open them', async () => {
  const classId = (await db.prepare("INSERT INTO classes (class_name, day, hour_position) VALUES ('Privacy Class', 'monday', 2) RETURNING id").get()).id;
  const adminLogin = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const adminCookie = adminLogin.headers['set-cookie'];
  const adminCsrf = extractCsrf((await request(app).get('/admin/schedule?tab=monday').set('Cookie', adminCookie)).text);
  await request(app).post(`/admin/class-schedule/classes/${classId}/assignments`).set('Cookie', adminCookie).type('form').send({ _csrf: adminCsrf, title: 'Week 1' });
  const assignmentId = (await db.prepare('SELECT id FROM class_assignments WHERE class_id = ?').get(classId)).id;
  await request(app)
    .post(`/admin/class-schedule/assignments/${assignmentId}/content`)
    .set('Cookie', adminCookie)
    .type('form')
    .send({ _csrf: adminCsrf, type: 'assignment_submission', title: 'Essay', submissionBody: '<p>Write it.</p>', submissionPointsPossible: '10' });
  const contentItemId = (await db.prepare("SELECT id FROM lesson_content_items WHERE assignment_id = ? AND type = 'assignment_submission'").get(assignmentId)).id;

  const familyA = await makeFamily('Privacy Family A');
  const familyB = await makeFamily('Privacy Family B');
  const student = await makeMember({ name: 'Privacy Student', type: 'student', familyId: familyA, email: 'privacy-student@example.com', roleKey: 'student' });
  await db.prepare('INSERT INTO class_enrollments (class_id, student_id) VALUES (?, ?)').run(classId, student.memberId);
  const parent = await makeMember({ name: 'Privacy Parent', type: 'parent', familyId: familyA, email: 'privacy-parent@example.com', roleKey: 'parent' });
  const stranger = await makeMember({ name: 'Other Parent', type: 'parent', familyId: familyB, email: 'privacy-stranger@example.com', roleKey: 'parent' });
  const teacher = await makeMember({ name: 'Privacy Teacher', type: 'parent', familyId: familyB, email: 'privacy-teacher@example.com', roleKey: 'teacher' });
  await db.prepare("INSERT INTO class_staff (class_id, member_id, role) VALUES (?, ?, 'teacher')").run(classId, teacher.memberId);

  async function submit(contents) {
    const page = await request(app).get(`/student/content/${contentItemId}`).set('Cookie', student.cookie);
    assert.equal(page.status, 200);
    const tmp = path.join(os.tmpdir(), `privacy-essay-${process.pid}.pdf`);
    fs.writeFileSync(tmp, contents);
    const res = await request(app)
      .post(`/student/content/${contentItemId}/submit?_csrf=${encodeURIComponent(extractCsrf(page.text))}`)
      .set('Cookie', student.cookie)
      .attach('submissionFile', tmp, { filename: 'essay.pdf', contentType: 'application/pdf' });
    fs.rmSync(tmp, { force: true });
    assert.equal(res.status, 302);
    const row = await db.prepare('SELECT file_url FROM assignment_submissions WHERE content_item_id = ? AND student_id = ?').get(contentItemId, student.memberId);
    createdKeys.push(row.file_url);
    return row.file_url;
  }

  const firstKey = await submit('%PDF-1.4 first draft');
  // Not saved anywhere under public/ - nothing static can serve it.
  assert.ok(fs.existsSync(path.join(SUBMISSIONS_DIR, firstKey)));
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'public', 'uploads', 'lesson-attachments', firstKey)));

  const url = `/class-submissions/${encodeURIComponent(firstKey)}`;
  const studentRes = await request(app).get(url).set('Cookie', student.cookie);
  assert.equal(studentRes.status, 200);
  assert.match(studentRes.headers['cache-control'], /no-store/);
  assert.equal((await request(app).get(url).set('Cookie', parent.cookie)).status, 200);
  assert.equal((await request(app).get(url).set('Cookie', teacher.cookie)).status, 200);
  assert.equal((await request(app).get(url).set('Cookie', adminCookie)).status, 200);

  assert.equal((await request(app).get(url).set('Cookie', stranger.cookie)).status, 404);
  const signedOut = await request(app).get(url);
  assert.equal(signedOut.status, 302);
  assert.match(signedOut.headers.location, /^\/login/);

  // Re-uploading replaces the old file rather than leaving it behind.
  const secondKey = await submit('%PDF-1.4 final draft');
  assert.notEqual(secondKey, firstKey);
  assert.ok(!fs.existsSync(path.join(SUBMISSIONS_DIR, firstKey)), 'the replaced file should be deleted');
  assert.equal((await request(app).get(`/class-submissions/${encodeURIComponent(firstKey)}`).set('Cookie', student.cookie)).status, 404);
});
