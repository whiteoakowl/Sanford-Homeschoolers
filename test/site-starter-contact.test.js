// A real request: "Customize the public homepage. Using the information
// in this photo... Link for more class information. Link for more group
// community information (activities and events). Contact button and
// page. Co-op classes are only on Wednesdays 9am-2pm."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `site-starter-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `site-starter-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const site = require('../utils/siteBuilder');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));
const csrfOf = (html) => /name="csrf-token" content="([^"]*)"/.exec(html)[1];

test('Main Admin loads the Sanford Homeschoolers pages into the draft; once published the site shows them and the contact form works', async () => {
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const dash = await admin.get('/main-admin/website');
  assert.match(dash.text, /Load the Sanford Homeschoolers Pages/);
  await admin.post('/main-admin/website/load-starter').type('form').send({ _csrf: csrfOf(dash.text) });

  let live = await request(app).get('/');
  assert.doesNotMatch(live.text, /150 families strong/, 'nothing goes live before Publish');
  await site.publish(null, 'test');

  live = await request(app).get('/');
  for (const s of [/Welcome to Sanford Homeschoolers!/, /501\(c\)\(3\) nonprofit, secular and inclusive/, /Wednesdays (·|&middot;) 9:00 am (–|&ndash;) 2:00 pm/, /Field Trips/, /Park Days/, /Holiday Parties/, /High School Diplomas/, /Custom Transcripts/, /Reading Challenges/, /Rewards/, /Student Portal/, /Homeschool Management/, /href="\/classes"/, /href="\/community"/, /href="\/contact"/]) {
    assert.match(live.text, s, String(s));
  }
  assert.doesNotMatch(live.text, /Monday/, 'co-op classes are only on Wednesdays');
  assert.match((await request(app).get('/classes')).text, /Every Wednesday/);
  assert.match((await request(app).get('/community')).text, /Teen Hangouts/);
  const contact = await request(app).get('/contact');
  assert.match(contact.text, /action="\/contact\/send"/);

  // A visitor sends a message; it lands in Main Admin and notifies admins.
  const sent = await request(app).post('/contact/send').type('form').send({ back: '/contact', name: 'Casey Visitor', email: 'casey@example.com', phone: '555-0100', topic: 'Co-op Classes', message: 'Do you have room for a 7 year old?' });
  assert.equal(sent.status, 303);
  assert.equal(sent.headers.location, '/contact?sent=1#contact-form');
  assert.match((await request(app).get('/contact?sent=1')).text, /Your message was sent/);
  const bot = await request(app).post('/contact/send').type('form').send({ back: '/contact', name: 'Bot', email: 'bot@example.com', message: 'spam', website: 'http://spam' });
  assert.equal(bot.status, 303);
  const rows = await db.prepare("SELECT * FROM support_requests WHERE request_type = 'contact'").all();
  assert.equal(rows.length, 1, 'the honeypot drops bot messages');
  assert.equal(rows[0].contact_email, 'casey@example.com');
  const log = await admin.get('/main-admin/support/contact');
  assert.match(log.text, /Casey Visitor/);
  assert.match(log.text, /Do you have room for a 7 year old\?/);
  assert.match(log.text, /Co-op Classes/);
  const n = await db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE type_key = 'website_contact_message'").get();
  assert.ok(Number(n.c) >= 1);
});
