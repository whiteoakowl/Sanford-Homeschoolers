// A real request: "In teacher portal and co-op admin portal, class
// details. Next to add a lesson plan button should be the add a
// substitute plan button ... type a detail, description, upload a
// worksheet for printing, link to a video or song. Special notes from
// teacher. Can add multiple substitute plans." (routes/substitutePlanRoutes.js,
// utils/substitutePlans.js), and the class QR code's View Substitute Plan
// page showing them (routes/kiosk-class-checkin.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `substitute-plans-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `substitute-plans-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { generateMemberCode } = require('../utils/members');
const { hashPassword } = require('../utils/portalAuth');
const { createClass } = require('../utils/classSchedule');
const { cleanMediaUrl } = require('../utils/substitutePlans');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

function extractCsrf(html) {
  return /name="csrf-token" content="([^"]*)"/.exec(html)[1];
}

let teacherCounter = 0;
async function loginTeacher(classIds) {
  teacherCounter += 1;
  const code = await generateMemberCode();
  const memberId = (
    await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, active) VALUES ('Sub Plan Teacher', ?, ?, 'parent', 1) RETURNING id").get(code, code)
  ).id;
  for (const classId of classIds) {
    await db.prepare("INSERT INTO class_staff (class_id, member_id, role) VALUES (?, ?, 'teacher')").run(classId, memberId);
  }
  const email = `sub-plan-teacher-${teacherCounter}@example.com`;
  const accountId = (
    await db
      .prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text()) RETURNING id")
      .get(memberId, email, hashPassword('testpassword123'))
  ).id;
  const teacherRole = await db.prepare("SELECT id FROM roles WHERE key = 'teacher'").get();
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountId, teacherRole.id);
  const loginRes = await request(app).post('/login').type('form').send({ email, password: 'testpassword123', next: '/teacher' });
  return loginRes.headers['set-cookie'];
}

async function loginAsAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  return loginRes.headers['set-cookie'];
}

test('video/song links keep only http(s), adding https:// when left off', () => {
  assert.equal(cleanMediaUrl('youtube.com/watch?v=abc'), 'https://youtube.com/watch?v=abc');
  assert.equal(cleanMediaUrl('http://example.com/song'), 'http://example.com/song');
  assert.equal(cleanMediaUrl('javascript:alert(1)'), null);
  assert.equal(cleanMediaUrl(''), null);
});

test('teacher: Add/Edit Substitute Plan button, then add, edit and delete several plans with a worksheet', async () => {
  const classId = await createClass({ day: 'monday', hourPosition: 1, className: 'Sub Plan Class', room: 'Room 3' });
  const cookie = await loginTeacher([classId]);

  const detail = await request(app).get(`/teacher/classes/${classId}`).set('Cookie', cookie);
  assert.match(detail.text, new RegExp(`Add/Edit Lesson Plan</(a|button)>\\s*(<%#[\\s\\S]*?%>)?\\s*<a class="roster-action-btn" href="/teacher/classes/${classId}/substitute-plan">Add/Edit Substitute Plan</a>`));

  const page = await request(app).get(`/teacher/classes/${classId}/substitute-plan`).set('Cookie', cookie);
  assert.equal(page.status, 200);
  assert.match(page.text, /No substitute plans yet/);
  const csrf = extractCsrf(page.text);
  const base = `/teacher/classes/${classId}/substitute-plan`;

  const created = await request(app)
    .post(`${base}?_csrf=${csrf}`)
    .set('Cookie', cookie)
    .field('title', 'Rainy Day Plan')
    .field('description', 'Read the story, then do the worksheet.')
    .field('mediaUrl', 'youtube.com/watch?v=song')
    .field('teacherNotes', 'Sam needs a front-row seat.')
    .attach('worksheet', Buffer.from('%PDF-1.4 test'), { filename: 'leaves.pdf', contentType: 'application/pdf' });
  assert.equal(created.status, 302);
  await request(app).post(`${base}?_csrf=${csrf}`).set('Cookie', cookie).field('title', 'Backup Plan');

  const plans = await db.prepare('SELECT * FROM class_substitute_plans WHERE class_id = ? ORDER BY position').all(classId);
  assert.equal(plans.length, 2, 'more than one plan per class');
  assert.equal(plans[0].worksheet_name, 'leaves.pdf');
  assert.equal(plans[0].media_url, 'https://youtube.com/watch?v=song');
  assert.equal(plans[0].teacher_notes, 'Sam needs a front-row seat.');

  const listed = await request(app).get(base).set('Cookie', cookie);
  assert.match(listed.text, /Substitute Plans \(2\)/);
  assert.match(listed.text, /Print Worksheet/);
  assert.match(listed.text, /Open Video or Song/);

  await request(app)
    .post(`${base}/${plans[0].id}?_csrf=${csrf}`)
    .set('Cookie', cookie)
    .field('title', 'Rainy Day Plan v2')
    .field('removeWorksheet', '1');
  const edited = await db.prepare('SELECT * FROM class_substitute_plans WHERE id = ?').get(plans[0].id);
  assert.equal(edited.title, 'Rainy Day Plan v2');
  assert.equal(edited.worksheet_key, null);

  await request(app).post(`${base}/${plans[1].id}/delete`).set('Cookie', cookie).type('form').send({ _csrf: csrf });
  const left = await db.prepare('SELECT COUNT(*) AS n FROM class_substitute_plans WHERE class_id = ?').get(classId);
  assert.equal(Number(left.n), 1);
});

test("teacher can't open or add to another teacher's class substitute plans", async () => {
  const mine = await createClass({ day: 'monday', hourPosition: 2, className: 'Mine', room: 'Room 4' });
  const theirs = await createClass({ day: 'monday', hourPosition: 3, className: 'Theirs', room: 'Room 5' });
  const cookie = await loginTeacher([mine]);
  const page = await request(app).get(`/teacher/classes/${theirs}/substitute-plan`).set('Cookie', cookie);
  assert.equal(page.status, 403);
});

test('Co-op Admin: button next to + New Lesson, and plans added there show on the class QR code page', async () => {
  const classId = await createClass({ day: 'monday', hourPosition: 4, className: 'Admin Sub Class', room: 'Room 6' });
  const cookie = await loginAsAdmin();
  const manage = await request(app).get(`/admin/class-schedule/classes/${classId}/manage?tab=assignments`).set('Cookie', cookie);
  assert.match(manage.text, /\+ New Lesson<\/button>[\s\S]{0,300}href="\/admin\/class-schedule\/classes\/\d+\/substitute-plan">Add\/Edit Substitute Plan</);

  const page = await request(app).get(`/admin/class-schedule/classes/${classId}/substitute-plan`).set('Cookie', cookie);
  assert.equal(page.status, 200);
  const csrf = extractCsrf(page.text);
  await request(app)
    .post(`/admin/class-schedule/classes/${classId}/substitute-plan?_csrf=${csrf}`)
    .set('Cookie', cookie)
    .field('title', 'Field Trip Day')
    .field('teacherNotes', 'Bus leaves at 10.');

  const kiosk = request.agent(app);
  await kiosk.post('/kiosk/class-checkin/unlock').type('form').send({ pin: '0000' });
  const view = await kiosk.get(`/kiosk/class-checkin/classes/${classId}/substitute-plan`);
  assert.equal(view.status, 200);
  assert.match(view.text, /Field Trip Day/);
  assert.match(view.text, /Bus leaves at 10\./);
  assert.doesNotMatch(view.text, /Edit Substitute Plan/, 'read-only on the QR code page');
});
