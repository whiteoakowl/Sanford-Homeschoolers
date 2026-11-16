// A real request: "Teacher interest form. Submissions and edit form button
// found under teachers/assistants tab. Teacher interest form on parent
// portal homepages under links and forms. Edit form request name, days
// available, age groups, class hours available, subject willing to teach
// added one by one and offered as checkboxes. Class idea 1, class idea 2,
// class idea 3 with large text boxes. Log on admin side shows date and
// time stamp in correct format."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `teacher-interest-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `teacher-interest-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { generateMemberCode } = require('../utils/members');
const { hashPassword } = require('../utils/portalAuth');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

const csrfOf = (html) => /name="csrf-token" content="([^"]*)"/.exec(html)[1];

async function parentAgent() {
  const code = await generateMemberCode();
  const memberId = (await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, active) VALUES ('Interested Parent', ?, ?, 'parent', 1) RETURNING id").get(code, code)).id;
  const acct = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, 'ti-parent@example.com', ?, 'active', now_text()) RETURNING id").get(memberId, hashPassword('testpassword123'))).id;
  await db.prepare("INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = 'parent'))").run(acct);
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'ti-parent@example.com', password: 'testpassword123', next: '/parent' });
  return agent;
}

test('admin edits the form one option at a time, a parent submits it, and the log shows it with its date and time', async () => {
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });

  const log0 = await admin.get('/admin/teachers/interest-form');
  assert.equal(log0.status, 200);
  assert.match(log0.text, /href="\/admin\/teachers\/interest-form\/edit"[^>]*>[\s\S]*?Edit Form<\/a>/);
  assert.match(log0.text, /href="\/admin\/teachers\/interest-form">Teacher Interest Form</, 'under Teachers/Assistants in the nav');

  const edit = await admin.get('/admin/teachers/interest-form/edit');
  const csrf = csrfOf(edit.text);
  await admin.post('/admin/teachers/interest-form/options/add').type('form').send({ _csrf: csrf, list: 'subjects', value: 'Robotics' });
  await admin.post('/admin/teachers/interest-form/options/remove').type('form').send({ _csrf: csrf, list: 'subjects', value: 'Music' });
  await admin.post('/admin/teachers/interest-form/options/add').type('form').send({ _csrf: csrf, list: 'days', value: 'Friday' });

  const parent = await parentAgent();
  const home = await parent.get('/parent');
  assert.match(home.text, /<a href="\/parent\/teacher-interest">Teacher Interest Form<\/a>/);
  const form = await parent.get('/parent/teacher-interest');
  assert.match(form.text, /name="name" value="Interested Parent"/);
  assert.match(form.text, /name="subjects" value="Robotics"/);
  assert.doesNotMatch(form.text, /name="subjects" value="Music"/);
  assert.match(form.text, /name="days" value="Friday"/);
  for (const n of [1, 2, 3]) assert.match(form.text, new RegExp(`<textarea name="idea${n}" rows="5"`));

  const sent = await parent.post('/parent/teacher-interest').type('form').send({ _csrf: csrfOf(form.text), name: 'Interested Parent', days: ['Monday', 'Friday'], subjects: ['Robotics', 'Not An Option'], hours: 'Hour 2', idea1: 'Lego robotics for 4th-6th', idea2: '', idea3: 'Nature journaling' });
  assert.equal(sent.headers.location, '/parent/teacher-interest?sent=1');

  const log = await admin.get('/admin/teachers/interest-form');
  assert.match(log.text, /Interested Parent/);
  assert.match(log.text, /<span class="ti-submission-when">[\s\S]*?[A-Z][a-z]{2} \d{1,2}, \d{4} · \d{1,2}:\d{2} [AP]M<\/span>/);
  assert.match(log.text, /<span class="ti-chip">Robotics<\/span>/);
  assert.doesNotMatch(log.text, /Not An Option/);
  assert.match(log.text, /Lego robotics for 4th-6th/);
  assert.match(log.text, /Nature journaling/);
});

// A real request: "Add all of the new requests to the pending request on
// the co-op admin portal homepage."
test('the Co-op Admin homepage Pending Requests card counts the new request types', async () => {
  const m = (await db.prepare("INSERT INTO members (name, barcode, member_type, active) VALUES ('Pending Person', 'PP-1', 'parent', 1) RETURNING id").get()).id;
  await db.prepare('INSERT INTO schedule_change_requests (member_id) VALUES (?)').run(m);
  await db.prepare('INSERT INTO coop_withdrawals (member_id) VALUES (?)').run(m);
  await db.prepare("INSERT INTO teacher_interest_submissions (name) VALUES ('Unseen One')").run();
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const home = await admin.get('/admin');
  for (const [href, label] of [['/admin/schedule-changes', 'Schedule Change Requests'], ['/admin/coop-withdraw', 'Co-op Withdraw'], ['/admin/teachers/interest-form', 'Teacher Interest Forms']]) {
    assert.match(home.text, new RegExp(`<a class="pr-card-item" href="${href}">[\\s\\S]*?<span class="pr-card-count"[^>]*>\\d+</span>[\\s\\S]*?${label}</span>`));
  }
  await admin.get('/admin/teachers/interest-form');
  const after = await admin.get('/admin');
  const item = /<a class="pr-card-item" href="\/admin\/teachers\/interest-form">((?:(?!<\/a>)[\s\S])*)<\/a>/.exec(after.text)[1];
  assert.doesNotMatch(item, /pr-card-count/, 'opening the log clears its count');
});
