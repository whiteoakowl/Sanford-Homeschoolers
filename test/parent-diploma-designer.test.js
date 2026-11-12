// Coverage for two real requests bundled together:
// 1. "Parent portal move transcripts to a subpage under family school
//    management. Move diploma subpage to family school management tab.
//    Remove stand alone academics tab and make name tags its own tab."
//    (views/partials/portal-nav.ejs - Transcripts/Diplomas keep their
//    existing /parent/academics* routes; only their nav placement moved.)
// 2. "Diploma subpage. Be able to design and create a diploma with four
//    templates to choose from, colors and edit name, dates, and
//    signatures." (utils/academics.js's own issueDiploma, routes/parent-
//    portal.js, views/partials/diploma-certificate.ejs.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `parent-diploma-designer-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `parent-diploma-designer-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.MAIN_ADMIN_EMAIL = 'mainadmin@coop.local';
process.env.MAIN_ADMIN_PASSWORD = 'changeme123';

const request = require('supertest');
const app = require('../server');

test.before(() => app.ready);
const db = require('../db');
const { diplomaForStudent } = require('../utils/academics');

test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

let counter = 0;
async function createFamily(name) {
  counter += 1;
  return (await db.prepare('INSERT INTO families (name) VALUES (?) RETURNING id').get(`${name} ${counter}`)).id;
}

async function createPortalMember({ name, familyId, memberType, roleKey }) {
  counter += 1;
  const code = `diploma${counter}`;
  const memberId = (
    await db
      .prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, is_primary_parent, active) VALUES (?, ?, ?, ?, ?, ?, 1) RETURNING id")
      .get(name, code, code, memberType, familyId, memberType === 'parent' ? 1 : 0)
  ).id;
  const { hashPassword } = require('../utils/portalAuth');
  const email = `${code}@example.com`;
  const accountId = (
    await db
      .prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text()) RETURNING id")
      .get(memberId, email, hashPassword('testpassword123'))
  ).id;
  const role = await db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey);
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountId, role.id);
  const loginRes = await request(app).post('/login').type('form').send({ email, password: 'testpassword123', next: `/${roleKey}` });
  return { memberId, accountId, cookie: loginRes.headers['set-cookie'] };
}

async function csrfFrom(cookie, url) {
  const page = await request(app).get(url).set('Cookie', cookie);
  return /name="csrf-token" content="([^"]*)"/.exec(page.text)[1];
}

// Same buffered-binary-response idiom test/parent-family-school-print-
// preview-and-pdf.test.js already uses to check a real PDF body.
async function getBuffer(url, cookie) {
  return request(app)
    .get(url)
    .set('Cookie', cookie)
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
}

async function loginAsMainAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: process.env.MAIN_ADMIN_EMAIL, password: process.env.MAIN_ADMIN_PASSWORD, next: '/main-admin' });
  return loginRes.headers['set-cookie'];
}

// Family School Management is its own portal now (test/family-school-
// management.test.js covers the switch) - Transcripts/Diplomas are its
// own top-level tabs there, not a Parent Portal subpage.
test('Parent Portal nav: no standalone Academics tab, Name Tags is its own tab, and Transcripts/Diplomas are Family School Management tabs', async () => {
  const familyId = await createFamily('Nav Family');
  const parent = await createPortalMember({ name: 'Nav Parent', familyId, memberType: 'parent', roleKey: 'parent' });
  const page = await request(app).get('/parent').set('Cookie', parent.cookie);
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, />Academics</);
  assert.match(page.text, /href="\/parent\/name-tags"[^>]*>(?:(?!<\/a>).)*Name Tags/s);

  const fsmPage = await request(app).get('/parent/family-school').set('Cookie', parent.cookie);
  assert.match(fsmPage.text, /href="\/parent\/academics"[^>]*>(?:(?!<\/a>).)*Transcripts/s);
  assert.match(fsmPage.text, /href="\/parent\/academics\/diplomas"[^>]*>(?:(?!<\/a>).)*Diplomas/s);
});

test('a parent designs a diploma: design choice, school details, seals, three signatures with roles; Update Preview and Print both save', async () => {
  // A real request: "Diploma choices should look like this. Then text
  // boxes below to edit the information. For signature choices there
  // should be a dropdown menu for each... logo options... update
  // preview... and a print button."
  const familyId = await createFamily('Diploma Design Family');
  const parent = await createPortalMember({ name: 'Design Parent', familyId, memberType: 'parent', roleKey: 'parent' });
  const student = await createPortalMember({ name: 'Design Student', familyId, memberType: 'student', roleKey: 'student' });
  const csrf = await csrfFrom(parent.cookie, '/parent/academics/diplomas');

  const blank = await request(app).get('/parent/academics/diplomas').set('Cookie', parent.cookie);
  assert.equal(blank.status, 200);
  for (const n of [1, 2, 3, 4]) assert.match(blank.text, new RegExp(`High School Diploma - Design ${n}`));
  assert.equal((blank.text.match(/<label class="dip-choice[ "]/g) || []).length, 4);
  assert.match(blank.text, /<option value="Principal"/);
  assert.match(blank.text, /<option value="Administrator"/);
  assert.match(blank.text, /name="seal1" value="coop"/);
  assert.match(blank.text, /Update Preview/);
  // The wording from the examples, on each design's card.
  assert.match(blank.text, /This Certifies That/);
  assert.match(blank.text, /all requirements of law and standards for high school graduation/);
  assert.match(blank.text, /<span class="dip-witness">In Witness Whereof<\/span> our affixed signatures on this/);
  assert.match(blank.text, /This Diploma is awarded to/);
  assert.match(blank.text, /who has satisfactorily completed the/);
  assert.match(blank.text, /Academic Course of Four Years/);
  assert.match(blank.text, /<span class="dip-sig-role">Superintendent of Schools<\/span>/);
  assert.match(blank.text, /<span class="dip-sig-role">Chair, Board of Education<\/span>/);
  assert.match(blank.text, /name="next" value="print" formtarget="_blank"/);

  const res = await request(app)
    .post('/parent/academics/diplomas')
    .set('Cookie', parent.cookie)
    .type('form')
    .send({
      studentId: student.memberId,
      template: 'design3',
      schoolName: 'Sanford Classical Academy',
      schoolCity: 'Sanford',
      schoolState: 'North Carolina',
      headerText: 'Board of Education',
      displayName: 'Designed Student Full Legal Name',
      issuedDate: '2026-06-18',
      title: 'Diploma',
      bodyText: 'Having completed all requirements.',
      seal1: 'blue',
      seal2: 'coop',
      signature1Name: 'Jane Smith',
      signature1Title: 'Principal',
      signature2Name: 'John Smith',
      signature2Title: 'Parent',
      signature3Name: '',
      signature3Title: 'Teacher',
      next: 'preview',
      _csrf: csrf,
    });
  assert.equal(res.status, 302);
  assert.match(res.headers.location, new RegExp(`studentId=${student.memberId}&notice=.*#diploma-preview$`));

  const diploma = await diplomaForStudent(student.memberId);
  assert.equal(diploma.template, 'design3');
  assert.equal(diploma.school_name, 'Sanford Classical Academy');
  assert.equal(diploma.seal1, 'blue');
  assert.equal(diploma.seal2, 'coop');
  assert.equal(diploma.signature1_title, 'Principal');
  assert.equal(diploma.signature3_title, 'Teacher');

  const page = await request(app).get(`/parent/academics/diplomas?studentId=${student.memberId}`).set('Cookie', parent.cookie);
  assert.match(page.text, /class="diploma-cert dip dip-design3"/);
  assert.match(page.text, /Designed Student Full Legal Name/);
  assert.match(page.text, /June 18th, 2026/);
  assert.match(page.text, /<option value="Principal" selected>/);
  assert.match(page.text, /<a class="icon-btn" href="\/parent\/academics\/diplomas\/\d+\/download\.pdf" aria-label="Download PDF"/);

  const print = await request(app).get(`/parent/academics/diplomas/${student.memberId}/print`).set('Cookie', parent.cookie);
  assert.equal(print.status, 200);
  assert.match(print.text, /@page \{ size: letter landscape/);
  assert.match(print.text, /Sanford Classical Academy/);
  assert.match(print.text, /Having completed all requirements\./);
  assert.match(print.text, /src="\/img\/logo\.png"/, 'the second seal is the co-op logo');
  assert.match(print.text, /<span class="dip-sig-role">Teacher<\/span>/);

  // Print saves first, then opens the print page.
  const printRes = await request(app)
    .post('/parent/academics/diplomas')
    .set('Cookie', parent.cookie)
    .type('form')
    .send({ studentId: student.memberId, template: 'design1', issuedDate: '2026-06-18', next: 'print', _csrf: csrf });
  assert.equal(printRes.headers.location, `/parent/academics/diplomas/${student.memberId}/print`);
  const d1 = await request(app).get(`/parent/academics/diplomas/${student.memberId}/print`).set('Cookie', parent.cookie);
  assert.match(d1.text, /dip-design1/);
  assert.match(d1.text, /Given this eighteenth day of June, two thousand and twenty-six/);

  const pdfRes = await getBuffer(`/parent/academics/diplomas/${student.memberId}/download.pdf`, parent.cookie);
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers['content-type'], 'application/pdf');
  assert.match(pdfRes.headers['content-disposition'], /attachment; filename="Design-Student-diploma\.pdf"/);
  assert.equal(pdfRes.body.slice(0, 5).toString(), '%PDF-');

  // Another family's parent cannot download this child's diploma by
  // guessing the studentId.
  const otherFamilyId = await createFamily('Diploma Download Snooping Family');
  const otherParent = await createPortalMember({ name: 'Diploma Download Snooping Parent', familyId: otherFamilyId, memberType: 'parent', roleKey: 'parent' });
  const hijackRes = await request(app).get(`/parent/academics/diplomas/${student.memberId}/download.pdf`).set('Cookie', otherParent.cookie);
  assert.equal(hijackRes.status, 404);
});

test('a brand new diploma defaults to Design 1, a gold seal, and the default wording; unknown roles are dropped', async () => {
  const familyId = await createFamily('Default Design Family');
  const parent = await createPortalMember({ name: 'Default Parent', familyId, memberType: 'parent', roleKey: 'parent' });
  const student = await createPortalMember({ name: 'Default Student', familyId, memberType: 'student', roleKey: 'student' });
  const csrf = await csrfFrom(parent.cookie, '/parent/academics/diplomas');

  await request(app)
    .post('/parent/academics/diplomas')
    .set('Cookie', parent.cookie)
    .type('form')
    .send({ studentId: student.memberId, issuedDate: '2026-06-01', signature1Title: 'Wizard', _csrf: csrf });

  const diploma = await diplomaForStudent(student.memberId);
  assert.equal(diploma.template, 'design1');
  assert.equal(diploma.seal1, 'gold');
  assert.equal(diploma.signature1_title, null);
  const print = await request(app).get(`/parent/academics/diplomas/${student.memberId}/print`).set('Cookie', parent.cookie);
  assert.match(print.text, /having satisfactorily completed all requirements of law and standards for high school graduation as prescribed by the State Board of Education/);
  assert.match(print.text, /Given this first day of June, two thousand and twenty-six/);
});

test('diploma date wording', () => {
  const { dateInWords, dateShort } = require('../utils/diplomaDesign');
  assert.equal(dateInWords('2026-06-18'), 'eighteenth day of June, two thousand and twenty-six');
  assert.equal(dateInWords('1997-06-07'), 'seventh day of June, nineteen hundred ninety-seven');
  assert.equal(dateInWords('2030-05-22'), 'twenty-second day of May, two thousand and thirty');
  assert.equal(dateInWords('2026-03-30'), 'thirtieth day of March, two thousand and twenty-six');
  assert.equal(dateShort('2026-06-01'), 'June 1st, 2026');
  assert.equal(dateShort('2026-06-11'), 'June 11th, 2026');
  assert.equal(dateShort('2026-06-23'), 'June 23rd, 2026');
});

// A real request: "Main admin portal, remove academics tab and
// features. Only parent portal has those pages and admin doesn't need
// to control them with any settings." Main Admin's old issue-a-diploma/
// add-a-transcript-entry control panel is gone entirely - diplomas and
// transcripts are Parent Portal self-service only now.
test('Main Admin has no Academics tab or routes left - diplomas/transcripts are Parent Portal only', async () => {
  const adminCookie = await loginAsMainAdmin();
  const page = await request(app).get('/main-admin').set('Cookie', adminCookie);
  assert.doesNotMatch(page.text, />Academics</);

  assert.equal((await request(app).get('/main-admin/academics').set('Cookie', adminCookie)).status, 404);
  // A POST with no valid CSRF token is blocked at that global middleware
  // (403) before routing ever gets a chance to 404 it - still proof
  // nothing issues a diploma or adds a transcript entry here anymore.
  assert.equal((await request(app).post('/main-admin/academics/diploma').set('Cookie', adminCookie).type('form').send({})).status, 403);
  assert.equal((await request(app).post('/main-admin/academics/transcript').set('Cookie', adminCookie).type('form').send({})).status, 403);
});

test('Main Admin Diplomas uses the same builder and saves the same fields', async () => {
  const familyId = await createFamily('Main Admin Diploma Family');
  const admin = await createPortalMember({ name: 'Diploma Main Admin', familyId: null, memberType: 'parent', roleKey: 'main_admin' });
  const student = await createPortalMember({ name: 'Main Admin Diploma Student', familyId, memberType: 'student', roleKey: 'student' });
  const page = await request(app).get(`/main-admin/family-school/diplomas?studentId=${student.memberId}`).set('Cookie', admin.cookie);
  assert.equal(page.status, 200);
  assert.match(page.text, /High School Diploma - Design 4/);
  const csrf = /name="csrf-token" content="([^"]*)"/.exec(page.text)[1];
  const res = await request(app)
    .post('/main-admin/family-school/diplomas')
    .set('Cookie', admin.cookie)
    .type('form')
    .send({ studentId: student.memberId, template: 'design4', issuedDate: '2026-06-18', seal1: 'star', signature1Title: 'Administrator', next: 'preview', _csrf: csrf });
  assert.equal(res.status, 302);
  const diploma = await diplomaForStudent(student.memberId);
  assert.equal(diploma.template, 'design4');
  assert.equal(diploma.seal1, 'star');
  assert.equal(diploma.signature1_title, 'Administrator');
  const print = await request(app).get(`/main-admin/family-school/diplomas/${student.memberId}/print`).set('Cookie', admin.cookie);
  assert.match(print.text, /dip-design4/);
});

test('diploma title and description fonts are two separate choices', async () => {
  // A real request: "Allow choosing of font choice for titles and
  // descriptions. Two separate font choice options."
  const familyId = await createFamily('Diploma Font Family');
  const parent = await createPortalMember({ name: 'Font Parent', familyId, memberType: 'parent', roleKey: 'parent' });
  const student = await createPortalMember({ name: 'Font Student', familyId, memberType: 'student', roleKey: 'student' });
  const csrf = await csrfFrom(parent.cookie, '/parent/academics/diplomas');
  const page = await request(app).get('/parent/academics/diplomas').set('Cookie', parent.cookie);
  assert.match(page.text, /<select name="titleFont">/);
  assert.match(page.text, /<select name="bodyFont">/);
  assert.doesNotMatch(page.text, /--dip-title-font/, 'no font chosen yet keeps each design\'s own fonts');

  await request(app).post('/parent/academics/diplomas').set('Cookie', parent.cookie).type('form')
    .send({ studentId: student.memberId, template: 'design2', issuedDate: '2026-06-18', titleFont: 'engraved', bodyFont: 'flowing', _csrf: csrf });
  const diploma = await diplomaForStudent(student.memberId);
  assert.equal(diploma.title_font, 'engraved');
  assert.equal(diploma.body_font, 'flowing');
  const print = await request(app).get(`/parent/academics/diplomas/${student.memberId}/print`).set('Cookie', parent.cookie);
  assert.match(print.text, /dip-custom-title dip-custom-body/);
  assert.match(print.text, /--dip-title-font: &#39;Cinzel&#39;, serif;--dip-body-font: &#39;Great Vibes&#39;, cursive;/);

  await request(app).post('/parent/academics/diplomas').set('Cookie', parent.cookie).type('form')
    .send({ studentId: student.memberId, template: 'design2', issuedDate: '2026-06-18', titleFont: 'comic-sans', bodyFont: 'default', _csrf: csrf });
  const after = await diplomaForStudent(student.memberId);
  assert.equal(after.title_font, 'default', 'an unknown font falls back to the design\'s own');
});
