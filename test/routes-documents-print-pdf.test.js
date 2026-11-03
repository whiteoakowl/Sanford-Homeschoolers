// A real request: "Members should be able to print and download a pdf of
// all documents. Add a print and pdf icons to all document pages." -
// routes/documents.js's own GET /:token/print and /:token/download.pdf,
// per uploaded file type (PDF, .docx converted with mammoth, old binary
// .doc offered as a plain download), plus the Print/PDF icons on every
// document view and list page (Parent Portal, Co-op Admin, Main Admin).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `documents-print-pdf-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `documents-print-pdf-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.ADMIN_USERNAME = 'testadmin';
process.env.ADMIN_PASSWORD = 'testpassword123';
process.env.MAIN_ADMIN_EMAIL = 'mainadmin@coop.local';
process.env.MAIN_ADMIN_PASSWORD = 'changeme123';

const request = require('supertest');
const app = require('../server');
const db = require('../db');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// A tiny real .docx (three-part OOXML zip) whose body is two paragraphs.
const SAMPLE_DOCX = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-document.docx'));
const DOCX_TEXT = 'Every student needs a signed permission slip.';

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

function binaryParser(res, cb) {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

async function loginAsMainAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: process.env.MAIN_ADMIN_EMAIL, password: process.env.MAIN_ADMIN_PASSWORD, next: '/main-admin' });
  const cookie = loginRes.headers['set-cookie'];
  const page = await request(app).get('/main-admin/documents').set('Cookie', cookie);
  const csrfToken = /name="csrf-token" content="([^"]*)"/.exec(page.text)[1];
  return { cookie, csrfToken };
}

async function upload(title, buffer, filename, contentType) {
  const { cookie, csrfToken } = await loginAsMainAdmin();
  const res = await request(app)
    .post('/main-admin/documents/upload?_csrf=' + encodeURIComponent(csrfToken))
    .set('Cookie', cookie)
    .field('title', title)
    .attach('file', buffer, { filename, contentType });
  assert.equal(res.status, 302);
  assert.doesNotMatch(res.headers.location, /error=/);
  return db.prepare('SELECT * FROM documents WHERE title = ?').get(title);
}

let pdfDoc;
let docxDoc;
let wordDoc;

test('upload one PDF, one .docx and one .doc', async () => {
  pdfDoc = await upload('Print Test Handbook', Buffer.from('%PDF-1.4 fake pdf content'), 'handbook.pdf', 'application/pdf');
  docxDoc = await upload('Field Trip Policy', SAMPLE_DOCX, 'policy.docx', DOCX_MIME);
  wordDoc = await upload('Old Word Form', Buffer.from('fake legacy doc bytes'), 'form.doc', 'application/msword');
  assert.ok(pdfDoc && docxDoc && wordDoc);
});

test('PDF: download.pdf is the original PDF as an attachment named after the title', async () => {
  const res = await request(app).get(`/documents/${pdfDoc.public_token}/download.pdf`).buffer(true).parse(binaryParser);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^application\/pdf/);
  assert.equal(res.headers['content-disposition'], 'attachment; filename="Print Test Handbook.pdf"');
  assert.equal(res.body.toString(), '%PDF-1.4 fake pdf content');
});

test('PDF: print page embeds the PDF full-page with a Print button', async () => {
  const res = await request(app).get(`/documents/${pdfDoc.public_token}/print`);
  assert.equal(res.status, 200);
  assert.match(res.text, new RegExp(`<iframe[^>]*id="document-print-frame"[^>]*src="/documents/${pdfDoc.public_token}/file"`));
  assert.match(res.text, /data-document-print/);
  assert.match(res.text, /src="\/js\/document-print\.js"/);
  assert.match(res.text, /src="\/js\/print-auto\.js"/);
});

test('PDF: the view page keeps the iframe and shows Print + PDF icons', async () => {
  const res = await request(app).get(`/documents/${pdfDoc.public_token}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /class="document-view-frame"/);
  assert.match(res.text, new RegExp(`href="/documents/${pdfDoc.public_token}/print" target="_blank"`));
  assert.match(res.text, new RegExp(`href="/documents/${pdfDoc.public_token}/download.pdf"[^>]*title="Download PDF"`));
  assert.match(res.text, /href="#icon-printer"/);
  assert.match(res.text, /href="#icon-pdf"/);
});

test('.docx: the view page shows the converted text instead of an iframe', async () => {
  const res = await request(app).get(`/documents/${docxDoc.public_token}`);
  assert.equal(res.status, 200);
  assert.match(res.text, new RegExp(DOCX_TEXT));
  assert.match(res.text, /<strong>Co-op Field Trip Policy<\/strong>/);
  assert.doesNotMatch(res.text, /class="document-view-frame"/);
  assert.match(res.text, new RegExp(`href="/documents/${docxDoc.public_token}/download.pdf"[^>]*title="Download PDF"`));
});

test('.docx: print page contains the converted text on a print sheet', async () => {
  const res = await request(app).get(`/documents/${docxDoc.public_token}/print`);
  assert.equal(res.status, 200);
  assert.match(res.text, /class="print-page document-print-page"/);
  assert.match(res.text, new RegExp(DOCX_TEXT));
  assert.match(res.text, /data-document-print/);
});

test('.docx: download.pdf is a real rendered PDF attachment', async () => {
  const res = await request(app).get(`/documents/${docxDoc.public_token}/download.pdf`).buffer(true).parse(binaryParser);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^application\/pdf/);
  assert.equal(res.headers['content-disposition'], 'attachment; filename="Field Trip Policy.pdf"');
  assert.equal(res.body.subarray(0, 5).toString(), '%PDF-');
});

test('.doc: download returns the original file as an attachment, not a PDF', async () => {
  const res = await request(app).get(`/documents/${wordDoc.public_token}/download.pdf`).buffer(true).parse(binaryParser);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^application\/msword/);
  assert.equal(res.headers['content-disposition'], 'attachment; filename="Old Word Form.doc"');
  assert.equal(res.body.toString(), 'fake legacy doc bytes');
});

test('.doc: print page says it can\'t be printed in the browser and offers a Download link', async () => {
  const res = await request(app).get(`/documents/${wordDoc.public_token}/print`);
  assert.equal(res.status, 200);
  assert.match(res.text, /can&#39;t be printed in the browser/);
  assert.match(res.text, new RegExp(`href="/documents/${wordDoc.public_token}/download.pdf" download>Download<`));
  assert.doesNotMatch(res.text, /<iframe/);
});

test('.doc: the view page labels the button Download (not PDF) with a hint', async () => {
  const res = await request(app).get(`/documents/${wordDoc.public_token}`);
  assert.equal(res.status, 200);
  assert.match(res.text, new RegExp(`href="/documents/${wordDoc.public_token}/download.pdf"[^>]*aria-label="Download Old Word Form \\(Word .doc file\\)"`));
  assert.doesNotMatch(res.text, /href="#icon-pdf"/);
  assert.match(res.text, /href="#icon-download"/);
  assert.match(res.text, /file can't be turned into a PDF/);
});

test('an unknown token 404s on print and download', async () => {
  assert.equal((await request(app).get('/documents/no-such-token/print')).status, 404);
  assert.equal((await request(app).get('/documents/no-such-token/download.pdf')).status, 404);
});

function assertListIcons(html) {
  for (const d of [pdfDoc, docxDoc, wordDoc]) {
    assert.match(html, new RegExp(`href="/documents/${d.public_token}/print"`), `print icon for ${d.title}`);
    assert.match(html, new RegExp(`href="/documents/${d.public_token}/download.pdf"`), `download icon for ${d.title}`);
  }
  // The icons sit beside the card's own link, never nested inside it.
  assert.doesNotMatch(html, /<a class="landing-card[^"]*"[^>]*>(?:(?!<\/a>)[^])*document-card-action-btn/);
}

test('Co-op Admin and Main Admin lists and view pages show Print/PDF icons; .docx view shows converted text', async () => {
  const { cookie } = await loginAsMainAdmin();

  const mainList = await request(app).get('/main-admin/documents').set('Cookie', cookie);
  assert.equal(mainList.status, 200);
  assertListIcons(mainList.text);

  const coopList = await request(app).get('/admin/documents').set('Cookie', cookie);
  assert.equal(coopList.status, 200);
  assertListIcons(coopList.text);

  for (const base of ['/main-admin/documents', '/admin/documents']) {
    const pdfView = await request(app).get(`${base}/${pdfDoc.id}/view`).set('Cookie', cookie);
    assert.equal(pdfView.status, 200);
    assert.match(pdfView.text, new RegExp(`src="${base}/${pdfDoc.id}/file"`));
    assert.match(pdfView.text, new RegExp(`href="/documents/${pdfDoc.public_token}/print"`));
    assert.match(pdfView.text, new RegExp(`href="/documents/${pdfDoc.public_token}/download.pdf"`));

    const docxView = await request(app).get(`${base}/${docxDoc.id}/view`).set('Cookie', cookie);
    assert.equal(docxView.status, 200);
    assert.match(docxView.text, new RegExp(DOCX_TEXT));
    assert.doesNotMatch(docxView.text, /class="document-view-frame"/);

    const docView = await request(app).get(`${base}/${wordDoc.id}/view`).set('Cookie', cookie);
    assert.match(docView.text, /href="#icon-download"/);
  }
});

test('Parent Portal Documents list shows Print/PDF icons on every card', async () => {
  const familyId = (await db.prepare("INSERT INTO families (name) VALUES ('DocsPrintFamily') RETURNING id").get()).id;
  const { generateMemberCode } = require('../utils/members');
  const { hashPassword } = require('../utils/portalAuth');
  const code = await generateMemberCode();
  const parentInfo = await db
    .prepare("INSERT INTO members (name, barcode, member_code, member_type, family_id, is_primary_parent, active) VALUES ('Docs Print Parent', ?, ?, 'parent', ?, 1, 1) RETURNING id")
    .get(code, code, familyId);
  const email = 'docs-print-parent@example.com';
  const accountInfo = await db
    .prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text()) RETURNING id")
    .get(parentInfo.id, email, hashPassword('testpassword123'));
  const parentRole = await db.prepare("SELECT id FROM roles WHERE key = 'parent'").get();
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountInfo.id, parentRole.id);

  const loginRes = await request(app).post('/login').type('form').send({ email, password: 'testpassword123', next: '/parent' });
  const cookie = loginRes.headers['set-cookie'];
  const res = await request(app).get('/parent/documents').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assertListIcons(res.text);
  assert.match(res.text, /title="Download PDF"/);
});
