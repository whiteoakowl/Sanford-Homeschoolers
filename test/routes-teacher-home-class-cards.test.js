// A real request: "This is how the class cards should look on the teacher
// portal homepage" - class name pill, big enrolled count, day/time,
// grades, "Co-taught with" (everyone else on the class), View Roster.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `teacher-home-cards-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

async function member(name, code) {
  return (await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, active) VALUES (?, ?, ?, 'parent', 1) RETURNING id").get(name, code, code)).id;
}

test('Teacher homepage shows the new class card', async () => {
  const classId = (await db.prepare("INSERT INTO classes (day, hour_position, class_name) VALUES ('monday', 1, 'PE & Health') RETURNING id").get()).id;
  const me = await member('Card Teacher', 'ct1');
  const co = await member('Kimberly Reid', 'kr1');
  await db.prepare("INSERT INTO class_staff (class_id, member_id, role) VALUES (?, ?, 'teacher')").run(classId, me);
  await db.prepare("INSERT INTO class_staff (class_id, member_id, role) VALUES (?, ?, 'assistant')").run(classId, co);
  const accountId = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, 'ct@example.com', ?, 'active', now_text()) RETURNING id").get(me, hashPassword('pw123456'))).id;
  await db.prepare("INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = 'teacher'))").run(accountId);

  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'ct@example.com', password: 'pw123456', next: '/teacher' });
  const res = await agent.get('/teacher');
  assert.equal(res.status, 200);
  assert.match(res.text, /<article class="teacher-class-card">/);
  assert.match(res.text, /class="teacher-class-card-pill">PE &amp; Health</);
  assert.match(res.text, /class="teacher-class-card-count-num">0</);
  assert.match(res.text, /Monday/);
  assert.match(res.text, /All grades|Grades /);
  assert.match(res.text, /Co-taught with <strong>Kimberly Reid<\/strong>/);
  assert.doesNotMatch(res.text, /Co-taught with <strong>[^<]*Card Teacher/);
  assert.match(res.text, new RegExp(`class="teacher-class-card-btn" href="/teacher/classes/${classId}"`));
});
