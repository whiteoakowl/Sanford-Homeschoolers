// A real request: "Should be able to upload a photo for each training
// that will show on the card."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `training-card-photo-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `training-card-photo-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const T = require('../utils/training');
const { hashPassword } = require('../utils/portalAuth');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

test('Admin uploads a card photo in the builder; the member card shows it; removing it brings back the scene', async () => {
  const trainingId = await T.createTraining({ title: 'Photo Training', estimatedMinutes: 20 });
  await T.createLesson(trainingId, { title: 'Intro', type: 'text', content: 'hi' });
  await T.setTrainingStatus(trainingId, 'published');
  const memberId = (await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, active) VALUES ('Photo Teacher', 'pt1', 'pt1', 'parent', 1) RETURNING id").get()).id;
  const accountId = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, 'pt@example.com', ?, 'active', now_text()) RETURNING id").get(memberId, hashPassword('pw123456'))).id;
  await db.prepare("INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = 'teacher'))").run(accountId);
  await T.assignTrainingToMembers(trainingId, [memberId], '2026-08-28');

  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/admin' });
  const builder = await admin.get(`/admin/training/${trainingId}/builder`);
  assert.match(builder.text, /Card Photo/);
  const csrf = /name="csrf-token" content="([^"]*)"/.exec(builder.text)[1];
  const up = await admin.post(`/admin/training/${trainingId}/image?_csrf=${encodeURIComponent(csrf)}`).attach('image', PNG, { filename: 'card.png', contentType: 'image/png' });
  assert.equal(up.status, 302);
  const key = (await db.prepare('SELECT image_key FROM trainings WHERE id = ?').get(trainingId)).image_key;
  assert.ok(key, 'the photo key is saved');

  const teacher = request.agent(app);
  await teacher.post('/login').type('form').send({ email: 'pt@example.com', password: 'pw123456', next: '/teacher' });
  const cards = await teacher.get('/teacher/training');
  assert.match(cards.text, new RegExp(`class="training-card-photo" src="[^"]*${key}"`));
  assert.doesNotMatch(cards.text, /class="training-card-scene"/);
  // A real request: training dates read "August 1, 2025" (and times "4:45pm").
  assert.match(cards.text, /Due August 28, 2026/);
  const assignmentId = (await db.prepare('SELECT id FROM training_assignments WHERE training_id = ?').get(trainingId)).id;
  await db.prepare("UPDATE training_assignments SET assigned_at = '2025-08-01 20:45:00' WHERE id = ?").run(assignmentId);
  const detail = await admin.get(`/admin/training/${trainingId}/assignments/${assignmentId}`);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Assigned August 1, 2025 4:45pm/);
  assert.match(detail.text, /Due August 28, 2026/);

  const del = await admin.post(`/admin/training/${trainingId}/image/delete`).type('form').send({ _csrf: csrf });
  assert.equal(del.status, 302);
  assert.equal((await db.prepare('SELECT image_key FROM trainings WHERE id = ?').get(trainingId)).image_key, null);
  assert.match((await teacher.get('/teacher/training')).text, /class="training-card-scene"/);
});
