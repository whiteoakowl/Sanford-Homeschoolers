// A real request: "When you log out of website it should go back to the
// homepage."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `logout-home-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `logout-home-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

test('logging out lands on the public homepage, signed out', async () => {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const page = await agent.get('/admin');
  assert.equal(page.status, 200);
  const csrf = /name="csrf-token" content="([^"]*)"/.exec(page.text)[1];
  const out = await agent.post('/logout').type('form').send({ _csrf: csrf });
  assert.equal(out.status, 302);
  assert.equal(out.headers.location, '/');
  const home = await agent.get('/');
  assert.equal(home.status, 200);
  const after = await agent.get('/admin');
  assert.equal(after.status, 302, 'signed out');
});
