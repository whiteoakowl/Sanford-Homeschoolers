// A real request: "The new training cards should be on all training page
// portals" - the Co-op Admin and Main Admin Training lists use the same
// card as the Teacher / Parent / My Training pages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `training-card-admin-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const T = require('../utils/training');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
});

test('Co-op Admin and Main Admin Training lists show the new training cards', async () => {
  const id = await T.createTraining({ title: 'Classroom Safety', estimatedMinutes: 25 });
  await T.createLesson(id, { title: 'Intro', type: 'text', content: 'hi' });
  await T.setTrainingStatus(id, 'published');
  await T.createTraining({ title: 'Draft Training' });

  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123', next: '/admin' });
  for (const base of ['/admin', '/main-admin']) {
    const res = await admin.get(`${base}/training`);
    assert.equal(res.status, 200);
    assert.match(res.text, /class="training-card-grid"/);
    assert.equal((res.text.match(/<article class="training-card">/g) || []).length, 2);
    assert.doesNotMatch(res.text, /team-info-card/);
    assert.match(res.text, /1 lesson &bull; 25 minutes/);
    assert.match(res.text, /training-card-status-passed"><svg class="icon"><use href="#icon-check"\/><\/svg>Published/);
    assert.match(res.text, />Draft</);
    for (const page of ['builder', 'assign', 'report']) assert.match(res.text, new RegExp(`href="${base}/training/${id}/${page}"`));
    assert.match(res.text, /0 assigned &bull; passing \d+%/);
  }
});
