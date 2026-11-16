// A real request: "Co-op admin portal. When you click on member schedules
// it should show a list of primary parent name and a dropdown to show the
// families schedules."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `member-schedules-family-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `member-schedules-family-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

test('Member Schedules lists families by primary parent, each a dropdown of the family schedules', async () => {
  const login = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const cookie = login.headers['set-cookie'];
  const fam = (await db.prepare("INSERT INTO families (name) VALUES ('Zeller') RETURNING id").get()).id;
  await db.prepare("INSERT INTO members (name, barcode, member_type, active, family_id, is_primary_parent) VALUES ('Dan Zeller', 'z1', 'parent', 1, ?, 0)").run(fam);
  await db.prepare("INSERT INTO members (name, barcode, member_type, active, family_id, is_primary_parent) VALUES ('Amy Zeller', 'z2', 'parent', 1, ?, 1)").run(fam);
  await db.prepare("INSERT INTO members (name, barcode, member_type, active, family_id) VALUES ('Kid Zeller', 'z3', 'student', 1, ?)").run(fam);
  const fam2 = (await db.prepare("INSERT INTO families (name) VALUES ('Abbott') RETURNING id").get()).id;
  await db.prepare("INSERT INTO members (name, barcode, member_type, active, family_id, is_primary_parent) VALUES ('Beth Abbott', 'a1', 'parent', 1, ?, 1)").run(fam2);

  const res = await request(app).get('/admin/schedule?tab=members').set('Cookie', cookie);
  assert.equal(res.status, 200);
  const summaries = [...res.text.matchAll(/<details class="ms-family">\s*<summary>\s*<span class="ms-family-name">[\s\S]*?<\/svg> ([^<]+)<\/span>/g)].map((m) => m[1].trim());
  assert.ok(summaries.includes('Amy Zeller'), 'the primary parent names the family');
  assert.ok(!summaries.includes('Dan Zeller') && !summaries.includes('Kid Zeller'), 'other members are inside the dropdown, not separate entries');
  assert.ok(summaries.indexOf('Beth Abbott') < summaries.indexOf('Amy Zeller'), 'sorted by last name');
  const zeller = /<details class="ms-family">\s*<summary>\s*<span class="ms-family-name">[\s\S]*?Amy Zeller[\s\S]*?<\/details>/.exec(res.text)[0];
  assert.match(zeller, /3 members/);
  const order = ['Amy Zeller', 'Dan Zeller', 'Kid Zeller'].map((n) => zeller.indexOf(`>${n}<`));
  assert.ok(order.every((i) => i > -1) && order[0] < order[1] && order[1] < order[2], 'primary parent first, then parents, then students');

  const one = await request(app).get(`/admin/schedule?tab=members&familyId=${fam}`).set('Cookie', cookie);
  assert.match(one.text, /<details class="ms-family" open>/, 'a single family opens automatically');
});
