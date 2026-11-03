// Coverage for Teacher Reimbursements - a real request: "Co-op admin
// portal, teacher assistant tab, add a subpage called teacher
// reimbursements. This will be a log of reimbursement forms that have
// been submitted for approval..." (routes/admin-teachers.js's
// /teachers/reimbursements*, routes/teacher-reimbursements.js,
// utils/reimbursements.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `teacher-reimbursements-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `teacher-reimbursements-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { generateMemberCode } = require('../utils/members');
const { hashPassword } = require('../utils/portalAuth');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

async function csrfFrom(cookie, url) {
  const page = await request(app).get(url).set('Cookie', cookie);
  return /name="csrf-token" content="([^"]*)"/.exec(page.text)[1];
}

async function loginAsAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const cookie = loginRes.headers['set-cookie'];
  return { cookie, csrfToken: await csrfFrom(cookie, '/admin/teachers/reimbursements') };
}

async function createMember(name, memberType = 'parent') {
  const code = await generateMemberCode();
  return (await db.prepare('INSERT INTO members (name, barcode, member_code, member_type, active) VALUES (?, ?, ?, ?, 1) RETURNING id').get(name, code, code, memberType)).id;
}

let teacherCounter = 0;
async function loginTeacher(name) {
  teacherCounter += 1;
  const memberId = await createMember(name);
  const email = `reimb-teacher-${teacherCounter}@example.com`;
  const accountId = (
    await db
      .prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text()) RETURNING id")
      .get(memberId, email, hashPassword('testpassword123'))
  ).id;
  const teacherRole = await db.prepare("SELECT id FROM roles WHERE key = 'teacher'").get();
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountId, teacherRole.id);
  const loginRes = await request(app).post('/login').type('form').send({ email, password: 'testpassword123', next: '/teacher' });
  const cookie = loginRes.headers['set-cookie'];
  return { memberId, cookie, csrfToken: await csrfFrom(cookie, '/teacher') };
}

async function createSemester(title) {
  return (await db.prepare('INSERT INTO semesters (title) VALUES (?) RETURNING id').get(title)).id;
}
async function createClass({ day, className, semesterId }) {
  return (await db.prepare('INSERT INTO classes (day, hour_position, class_name, semester_id) VALUES (?, 1, ?, ?) RETURNING id').get(day, className, semesterId)).id;
}
async function addStaff(classId, memberId, role = 'teacher') {
  await db.prepare('INSERT INTO class_staff (class_id, member_id, role) VALUES (?, ?, ?)').run(classId, memberId, role);
}
async function createAdminMember(name) {
  const memberId = await createMember(name, 'admin');
  const pos = await db.prepare('INSERT INTO admin_positions (title, position) VALUES (?, 0) RETURNING id').get(`Treasurer ${name}`);
  await db.prepare('INSERT INTO member_admin_positions (member_id, admin_position_id) VALUES (?, ?)').run(memberId, pos.id);
  return memberId;
}

let fixture;
async function setup() {
  if (fixture) return fixture;
  const semesterId = await createSemester('Fall 2026');
  const artId = await createClass({ day: 'monday', className: 'Art Studio', semesterId });
  const scienceId = await createClass({ day: 'wednesday', className: 'Science Lab', semesterId });
  fixture = { semesterId, artId, scienceId };
  return fixture;
}

function submitForm(cookie, url, fields) {
  return request(app).post(url).set('Cookie', cookie).type('form').send(fields);
}

test('Co-op Admin nav lists Teacher Reimbursements under Teachers/Assistants; Teacher Portal nav has Reimbursements', async () => {
  const { cookie } = await loginAsAdmin();
  const res = await request(app).get('/admin/teachers/reimbursements').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /href="\/admin\/teachers\/reimbursements"[^>]*>[\s\S]*?Teacher Reimbursements/);
  // Import · Export · Print · PDF on one row, plus Edit Form.
  const row = /<div class="roster-btn-row[^"]*reimbursement-toolbar-row">([\s\S]*?)<\/div>/.exec(res.text)[1];
  const order = ['aria-label="Import"', 'aria-label="Export CSV"', 'aria-label="Print"', 'aria-label="Download PDF"', '>Edit Form<'].map((s) => row.indexOf(s));
  order.forEach((i) => assert.ok(i !== -1));
  assert.deepEqual([...order].sort((a, b) => a - b), order);

  const teacher = await loginTeacher('Nav Teacher');
  const home = await request(app).get('/teacher').set('Cookie', teacher.cookie);
  assert.match(home.text, /<a href="\/teacher\/reimbursements">[\s\S]*?Reimbursements<\/a>/);
});

test('teacher submits a multi-item form: total is computed server-side and it appears in the admin log', async () => {
  const { semesterId, artId } = await setup();
  const teacher = await loginTeacher('Rosa Painter');
  await addStaff(artId, teacher.memberId);

  const form = await request(app).get('/teacher/reimbursements/new').set('Cookie', teacher.cookie);
  assert.equal(form.status, 200);
  assert.match(form.text, new RegExp(`<option value="${teacher.memberId}" selected>Rosa Painter</option>`), 'defaults to the signed-in teacher');
  assert.match(form.text, /Add an Item/);
  assert.match(form.text, /Submit for Reimbursement/);

  const res = await submitForm(teacher.cookie, '/teacher/reimbursements', {
    _csrf: teacher.csrfToken,
    memberId: teacher.memberId,
    semesterId,
    day: 'monday',
    classId: artId,
    itemDescription: ['Paint', 'Brushes', 'Canvas', ''],
    itemDate: ['2026-09-01', '2026-09-02', '9/3/2026', ''],
    itemAmount: ['12.50', '$7.25', '1,000', ''],
  });
  assert.equal(res.status, 302);

  const row = await db.prepare('SELECT * FROM reimbursement_requests WHERE member_id = ?').get(teacher.memberId);
  assert.equal(Number(row.total_cents), 101975);
  assert.equal(row.status, 'submitted');
  assert.equal(row.class_name, 'Art Studio');
  const items = await db.prepare('SELECT * FROM reimbursement_items WHERE request_id = ? ORDER BY position').all(row.id);
  assert.deepEqual(items.map((i) => [i.description, i.purchase_date, Number(i.amount_cents)]), [
    ['Paint', '2026-09-01', 1250],
    ['Brushes', '2026-09-02', 725],
    ['Canvas', '2026-09-03', 100000],
  ]);

  const { cookie } = await loginAsAdmin();
  const log = await request(app).get('/admin/teachers/reimbursements').set('Cookie', cookie);
  assert.match(log.text, /Rosa Painter/);
  assert.match(log.text, /\$1,019\.75/);

  const mine = await request(app).get('/teacher/reimbursements').set('Cookie', teacher.cookie);
  assert.match(mine.text, /\$1,019\.75/);
  assert.match(mine.text, /Submitted/);
});

test('class must match the chosen semester and day; bad amounts are rejected', async () => {
  const { semesterId, scienceId, artId } = await setup();
  const teacher = await loginTeacher('Mismatch Teacher');
  const before = (await db.prepare('SELECT COUNT(*) AS n FROM reimbursement_requests').get()).n;

  const wrongDay = await submitForm(teacher.cookie, '/teacher/reimbursements', {
    _csrf: teacher.csrfToken,
    memberId: teacher.memberId,
    semesterId,
    day: 'monday',
    classId: scienceId,
    itemDescription: 'Beakers',
    itemDate: '2026-09-01',
    itemAmount: '5',
  });
  assert.equal(wrongDay.status, 400);
  assert.match(wrongDay.text, /not offered on the selected semester and day/);

  const otherSemester = await createSemester('Spring 2027');
  const wrongSemester = await submitForm(teacher.cookie, '/teacher/reimbursements', {
    _csrf: teacher.csrfToken,
    memberId: teacher.memberId,
    semesterId: otherSemester,
    day: 'monday',
    classId: artId,
    itemDescription: 'Beakers',
    itemDate: '2026-09-01',
    itemAmount: '5',
  });
  assert.equal(wrongSemester.status, 400);

  const zero = await submitForm(teacher.cookie, '/teacher/reimbursements', {
    _csrf: teacher.csrfToken,
    memberId: teacher.memberId,
    semesterId,
    day: 'monday',
    classId: artId,
    itemDescription: 'Free thing',
    itemDate: '2026-09-01',
    itemAmount: '0',
  });
  assert.equal(zero.status, 400);
  assert.match(zero.text, /greater than \$0\.00/);
  assert.match(zero.text, /value="Free thing"/, 'entered lines are kept on re-render');

  const after = (await db.prepare('SELECT COUNT(*) AS n FROM reimbursement_requests').get()).n;
  assert.equal(Number(after), Number(before));
});

test('a teacher sees only their own submissions and never the Admin Only section', async () => {
  const { semesterId, artId } = await setup();
  const alice = await loginTeacher('Alice Owner');
  const bob = await loginTeacher('Bob Other');
  await submitForm(alice.cookie, '/teacher/reimbursements', {
    _csrf: alice.csrfToken,
    memberId: alice.memberId,
    semesterId,
    day: 'monday',
    classId: artId,
    itemDescription: 'Alice glue',
    itemDate: '2026-09-01',
    itemAmount: '3.33',
  });
  const aliceReq = await db.prepare('SELECT id FROM reimbursement_requests WHERE member_id = ?').get(alice.memberId);

  const own = await request(app).get(`/teacher/reimbursements/${aliceReq.id}`).set('Cookie', alice.cookie);
  assert.equal(own.status, 200);
  assert.match(own.text, /Alice glue/);
  assert.doesNotMatch(own.text, /Admin Only/);
  assert.doesNotMatch(own.text, /name="checkNumber"/);

  const bobList = await request(app).get('/teacher/reimbursements').set('Cookie', bob.cookie);
  assert.doesNotMatch(bobList.text, /Alice Owner/);
  const bobView = await request(app).get(`/teacher/reimbursements/${aliceReq.id}`).set('Cookie', bob.cookie);
  assert.equal(bobView.status, 404);

  // A teacher can't reach the admin log or admin detail either.
  const adminLog = await request(app).get('/admin/teachers/reimbursements').set('Cookie', alice.cookie);
  assert.notEqual(adminLog.status, 200);
});

test('admin Admin Only section: check #, date and an admin approver mark it Approved/Paid; a non-admin approver is refused', async () => {
  const { semesterId, artId } = await setup();
  const teacher = await loginTeacher('Pat Approve');
  await submitForm(teacher.cookie, '/teacher/reimbursements', {
    _csrf: teacher.csrfToken,
    memberId: teacher.memberId,
    semesterId,
    day: 'monday',
    classId: artId,
    itemDescription: 'Markers',
    itemDate: '2026-09-01',
    itemAmount: '9.99',
  });
  const { id } = await db.prepare('SELECT id FROM reimbursement_requests WHERE member_id = ?').get(teacher.memberId);
  const adminMemberId = await createAdminMember('Tess Treasurer');
  const nonAdminId = await createMember('Not Anadmin');
  const { cookie, csrfToken } = await loginAsAdmin();

  const detail = await request(app).get(`/admin/teachers/reimbursements/${id}`).set('Cookie', cookie);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Admin Only/);
  assert.match(detail.text, new RegExp(`<option value="${adminMemberId}"[^>]*>Tess Treasurer</option>`));
  assert.doesNotMatch(detail.text, />Not Anadmin</);

  const refused = await submitForm(cookie, `/admin/teachers/reimbursements/${id}/admin`, { _csrf: csrfToken, checkNumber: '1001', checkDate: '2026-09-10', approvedByMemberId: nonAdminId });
  assert.equal(refused.status, 400);
  let row = await db.prepare('SELECT * FROM reimbursement_requests WHERE id = ?').get(id);
  assert.equal(row.status, 'submitted');
  assert.equal(row.check_number, null);

  const saved = await submitForm(cookie, `/admin/teachers/reimbursements/${id}/admin`, { _csrf: csrfToken, checkNumber: '1001', checkDate: '2026-09-10', approvedByMemberId: adminMemberId });
  assert.equal(saved.status, 302);
  row = await db.prepare('SELECT * FROM reimbursement_requests WHERE id = ?').get(id);
  assert.equal(row.status, 'approved');
  assert.equal(row.check_number, '1001');
  assert.equal(row.check_date, '2026-09-10');
  assert.equal(row.approved_by_member_id, adminMemberId);

  const filtered = await request(app).get('/admin/teachers/reimbursements?status=approved').set('Cookie', cookie);
  assert.match(filtered.text, /Pat Approve/);
  assert.match(filtered.text, /Approved\/Paid/);
  const pending = await request(app).get('/admin/teachers/reimbursements?status=submitted').set('Cookie', cookie);
  assert.doesNotMatch(pending.text, /Pat Approve/);

  const teacherView = await request(app).get(`/teacher/reimbursements/${id}`).set('Cookie', teacher.cookie);
  assert.match(teacherView.text, /Approved\/Paid/);
  assert.doesNotMatch(teacherView.text, /1001/);
});

test('export CSV lists the log with totals', async () => {
  const { semesterId, artId } = await setup();
  const teacher = await loginTeacher('Csv Exporter');
  await submitForm(teacher.cookie, '/teacher/reimbursements', {
    _csrf: teacher.csrfToken,
    memberId: teacher.memberId,
    semesterId,
    day: 'monday',
    classId: artId,
    itemDescription: ['Tape', 'Scissors'],
    itemDate: ['2026-09-01', '2026-09-01'],
    itemAmount: ['2.00', '4.50'],
  });
  const { cookie } = await loginAsAdmin();
  const res = await request(app).get(`/admin/teachers/reimbursements/export.csv?semesterId=${semesterId}`).set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  const lines = res.text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  assert.equal(lines[0], '"Submitted","Name","Semester","Day","Class","Items","Receipts","Total","Status","Check Number","Check Date","Approved By"');
  const line = lines.find((l) => l.includes('Csv Exporter'));
  assert.ok(line);
  assert.match(line, /"Fall 2026","Monday","Art Studio","2","0","6\.50","Submitted"/);

  const items = await request(app).get('/admin/teachers/reimbursements/export-items.csv').set('Cookie', cookie);
  assert.match(items.text, /"Csv Exporter","Fall 2026","Monday","Art Studio","Scissors","2026-09-01","4\.50"/);
});

test('import: template downloads, valid rows import grouped by form, bad rows are reported', async () => {
  const { semesterId } = await setup();
  await db.prepare('INSERT INTO classes (day, hour_position, class_name, semester_id) VALUES (?, 1, ?, ?)').run('monday', 'Pottery', semesterId);
  await createMember('Ivy Importer');
  const { cookie, csrfToken } = await loginAsAdmin();

  const tpl = await request(app).get('/admin/teachers/reimbursements/import-template.xlsx').set('Cookie', cookie).buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(tpl.status, 200);
  assert.match(tpl.headers['content-type'], /spreadsheetml/);
  assert.equal(tpl.body.slice(0, 2).toString(), 'PK');

  const csv = [
    'Name,Semester,Day,Class,Item,Purchase Date,Amount,Submitted Date,Check Number,Check Date,Approved By',
    'Ivy Importer,Fall 2026,Monday,Pottery,Clay,2026-08-20,15.00,2026-08-25,,,',
    'Ivy Importer,Fall 2026,Monday,Pottery,Glaze,2026-08-21,5.00,2026-08-25,,,',
    'Ghost Person,Fall 2026,Monday,Pottery,Clay,2026-08-20,15.00,2026-08-25,,,',
    'Ivy Importer,Fall 2026,Wednesday,Pottery,Kiln,2026-08-20,3.00,2026-08-25,,,',
  ].join('\n');
  const res = await request(app)
    .post(`/admin/teachers/reimbursements/import?_csrf=${encodeURIComponent(csrfToken)}`)
    .set('Cookie', cookie)
    .attach('file', Buffer.from(csv), 'reimbursements.csv');
  assert.equal(res.status, 200);
  assert.match(res.text, /Imported 1 reimbursement form\./);
  assert.match(res.text, /Row 4: no member named &#34;Ghost Person&#34;/);
  assert.match(res.text, /Row 5: no class &#34;Pottery&#34; on Wednesday/);

  const imported = await db.prepare("SELECT * FROM reimbursement_requests WHERE member_name = 'Ivy Importer'").all();
  assert.equal(imported.length, 1);
  assert.equal(Number(imported[0].total_cents), 2000);
  assert.equal(imported[0].submitted_at.slice(0, 10), '2026-08-25');
});

test('print preview renders and PDF returns application/pdf', async () => {
  const { cookie } = await loginAsAdmin();
  const print = await request(app).get('/admin/teachers/reimbursements/print').set('Cookie', cookie);
  assert.equal(print.status, 200);
  assert.match(print.text, /print-page/);
  assert.match(print.text, /Teacher Reimbursements/);
  assert.match(print.text, /print-auto\.js/);

  const pdf = await request(app)
    .get('/admin/teachers/reimbursements/download.pdf')
    .set('Cookie', cookie)
    .buffer(true)
    .parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(pdf.body.slice(0, 5).toString(), '%PDF-');
});

test('Edit Form changes the title/instructions teachers see; admin can fill one in on someone\'s behalf', async () => {
  const { semesterId, artId } = await setup();
  const { cookie, csrfToken } = await loginAsAdmin();
  const settingsPage = await request(app).get('/admin/teachers/reimbursements/form-settings').set('Cookie', cookie);
  assert.equal(settingsPage.status, 200);
  assert.match(settingsPage.text, /\/reimbursement-form/);

  await submitForm(cookie, '/admin/teachers/reimbursements/form-settings', { _csrf: csrfToken, title: 'Supply Money Back', intro: 'Bring receipts!', footer: 'Turn receipts in to the Treasurer.' });
  const teacher = await loginTeacher('Settings Viewer');
  await addStaff(artId, teacher.memberId, 'assistant');
  const form = await request(app).get('/teacher/reimbursements/new').set('Cookie', teacher.cookie);
  assert.match(form.text, /<h1>Supply Money Back<\/h1>/);
  assert.match(form.text, /Bring receipts!/);
  assert.match(form.text, /Turn receipts in to the Treasurer\./);

  const res = await submitForm(cookie, '/admin/teachers/reimbursements', {
    _csrf: csrfToken,
    memberId: teacher.memberId,
    semesterId,
    day: 'monday',
    classId: artId,
    itemDescription: 'Yarn',
    itemDate: '2026-09-04',
    itemAmount: '8',
  });
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /^\/admin\/teachers\/reimbursements\/\d+/);
  const mine = await request(app).get('/teacher/reimbursements').set('Cookie', teacher.cookie);
  assert.match(mine.text, /\$8\.00/, 'a form filed for a teacher by an admin shows on that teacher\'s own list');
});

// A 1x1 PNG and a minimal PDF - real enough bytes for the type checks.
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

function multipartSubmit(cookie, csrfToken, url, fields, files) {
  let r = request(app).post(`${url}?_csrf=${encodeURIComponent(csrfToken)}`).set('Cookie', cookie);
  for (const [k, v] of Object.entries(fields)) for (const one of [].concat(v)) r = r.field(k, String(one));
  for (const f of files) r = r.attach('receipts', f.buffer, { filename: f.name, contentType: f.type });
  return r;
}

test('receipts: two uploads are listed and viewable by admin and the submitting teacher only; other types are rejected', async () => {
  const { semesterId, artId } = await setup();
  const teacher = await loginTeacher('Receipt Keeper');
  const other = await loginTeacher('Receipt Snoop');
  const fields = { memberId: teacher.memberId, semesterId, day: 'monday', classId: artId, itemDescription: 'Paper', itemDate: '2026-09-01', itemAmount: '4.00' };

  const bad = await multipartSubmit(teacher.cookie, teacher.csrfToken, '/teacher/reimbursements', fields, [{ buffer: Buffer.from('hello'), name: 'notes.txt', type: 'text/plain' }]);
  assert.equal(bad.status, 400);
  assert.match(bad.text, /Receipts must be photos/);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM reimbursement_requests WHERE member_id = ?').get(teacher.memberId)).n), 0);

  const ok = await multipartSubmit(teacher.cookie, teacher.csrfToken, '/teacher/reimbursements', fields, [
    { buffer: PNG_BYTES, name: 'store.png', type: 'image/png' },
    { buffer: PDF_BYTES, name: 'invoice.pdf', type: 'application/pdf' },
  ]);
  assert.equal(ok.status, 302);
  const { id } = await db.prepare('SELECT id FROM reimbursement_requests WHERE member_id = ?').get(teacher.memberId);
  const receipts = await db.prepare('SELECT * FROM reimbursement_receipts WHERE request_id = ? ORDER BY id').all(id);
  assert.equal(receipts.length, 2);
  assert.ok(!receipts[0].storage_key.startsWith('/'), 'never a public path');

  const { cookie } = await loginAsAdmin();
  const detail = await request(app).get(`/admin/teachers/reimbursements/${id}`).set('Cookie', cookie);
  assert.match(detail.text, new RegExp(`<img src="/reimbursement-receipts/${receipts[0].id}"`));
  assert.match(detail.text, new RegExp(`href="/reimbursement-receipts/${receipts[1].id}"[\\s\\S]*?#icon-pdf`));
  const log = await request(app).get('/admin/teachers/reimbursements').set('Cookie', cookie);
  assert.match(log.text, /Receipt Keeper[\s\S]*?<td>1<\/td>\s*<td>2<\/td>/);

  const asAdmin = await request(app).get(`/reimbursement-receipts/${receipts[0].id}`).set('Cookie', cookie);
  assert.equal(asAdmin.status, 200);
  assert.equal(asAdmin.headers['content-type'], 'image/png');
  const asTeacher = await request(app).get(`/reimbursement-receipts/${receipts[1].id}`).set('Cookie', teacher.cookie);
  assert.equal(asTeacher.status, 200);
  assert.equal(asTeacher.headers['content-type'], 'application/pdf');
  const teacherDetail = await request(app).get(`/teacher/reimbursements/${id}`).set('Cookie', teacher.cookie);
  assert.match(teacherDetail.text, /store\.png/);
  const asOther = await request(app).get(`/reimbursement-receipts/${receipts[0].id}`).set('Cookie', other.cookie);
  assert.equal(asOther.status, 404);
  const anonymous = await request(app).get(`/reimbursement-receipts/${receipts[0].id}`);
  assert.equal(anonymous.status, 302);
});

test('reject (message required) -> teacher sees it, edits and resubmits -> Submitted again with history kept; read-only otherwise', async () => {
  const { semesterId, artId, scienceId } = await setup();
  const teacher = await loginTeacher('Rae Resubmit');
  const other = await loginTeacher('Otto Outsider');
  await submitForm(teacher.cookie, '/teacher/reimbursements', {
    _csrf: teacher.csrfToken, memberId: teacher.memberId, semesterId, day: 'monday', classId: artId,
    itemDescription: 'Crayons', itemDate: '2026-09-01', itemAmount: '5.00',
  });
  const { id } = await db.prepare('SELECT id FROM reimbursement_requests WHERE member_id = ?').get(teacher.memberId);
  const { cookie, csrfToken } = await loginAsAdmin();

  const earlyEdit = await request(app).get(`/teacher/reimbursements/${id}/edit`).set('Cookie', teacher.cookie);
  assert.equal(earlyEdit.status, 302, 'a Submitted form is read-only for the teacher');

  const detail = await request(app).get(`/admin/teachers/reimbursements/${id}`).set('Cookie', cookie);
  assert.match(detail.text, /id="reject-reimbursement-dialog"/);
  assert.match(detail.text, /name="message"[^>]*required/);

  const noMessage = await submitForm(cookie, `/admin/teachers/reimbursements/${id}/reject`, { _csrf: csrfToken, message: '  ' });
  assert.equal(noMessage.status, 400);
  assert.equal((await db.prepare('SELECT status FROM reimbursement_requests WHERE id = ?').get(id)).status, 'submitted');

  const rejected = await submitForm(cookie, `/admin/teachers/reimbursements/${id}/reject`, { _csrf: csrfToken, message: 'Please attach the receipt for the crayons.' });
  assert.equal(rejected.status, 302);
  assert.equal((await db.prepare('SELECT status FROM reimbursement_requests WHERE id = ?').get(id)).status, 'rejected');
  const note = await db
    .prepare("SELECT n.* FROM notifications n JOIN member_accounts ma ON ma.id = n.member_account_id WHERE ma.member_id = ? AND n.type_key = 'reimbursement_status'")
    .get(teacher.memberId);
  assert.ok(note);
  assert.match(note.body, /attach the receipt/);

  const adminId = await createAdminMember('Ann Approver');
  const blocked = await submitForm(cookie, `/admin/teachers/reimbursements/${id}/admin`, { _csrf: csrfToken, checkNumber: '5', checkDate: '2026-09-09', approvedByMemberId: adminId });
  assert.equal(blocked.status, 400, 'a Rejected form cannot be approved until resubmitted');
  assert.equal((await db.prepare('SELECT status FROM reimbursement_requests WHERE id = ?').get(id)).status, 'rejected');

  const list = await request(app).get('/teacher/reimbursements').set('Cookie', teacher.cookie);
  assert.match(list.text, /badge-pill-red">Rejected/);
  const view = await request(app).get(`/teacher/reimbursements/${id}`).set('Cookie', teacher.cookie);
  assert.match(view.text, /Please attach the receipt for the crayons\./);
  assert.match(view.text, new RegExp(`href="/teacher/reimbursements/${id}/edit"`));

  const otherView = await request(app).get(`/teacher/reimbursements/${id}`).set('Cookie', other.cookie);
  assert.equal(otherView.status, 404);
  const otherEdit = await request(app).get(`/teacher/reimbursements/${id}/edit`).set('Cookie', other.cookie);
  assert.equal(otherEdit.status, 404);
  const otherResubmit = await submitForm(other.cookie, `/teacher/reimbursements/${id}/resubmit`, {
    _csrf: other.csrfToken, memberId: other.memberId, semesterId, day: 'monday', classId: artId, itemDescription: 'Hijack', itemDate: '2026-09-01', itemAmount: '999',
  });
  assert.equal(otherResubmit.status, 404);

  const edit = await request(app).get(`/teacher/reimbursements/${id}/edit`).set('Cookie', teacher.cookie);
  assert.equal(edit.status, 200);
  assert.match(edit.text, /value="Crayons"/);
  assert.match(edit.text, /Resubmit for Reimbursement/);

  const invalid = await submitForm(teacher.cookie, `/teacher/reimbursements/${id}/resubmit`, {
    _csrf: teacher.csrfToken, memberId: teacher.memberId, semesterId, day: 'monday', classId: scienceId, itemDescription: 'Crayons', itemDate: '2026-09-01', itemAmount: '5',
  });
  assert.equal(invalid.status, 400, 'a resubmit validates the class like a new one');

  const resubmitted = await multipartSubmit(teacher.cookie, teacher.csrfToken, `/teacher/reimbursements/${id}/resubmit`, {
    memberId: teacher.memberId, semesterId, day: 'monday', classId: artId,
    itemDescription: ['Crayons', 'Markers'], itemDate: ['2026-09-01', '2026-09-02'], itemAmount: ['5.00', '3.00'],
  }, [{ buffer: PNG_BYTES, name: 'crayons.png', type: 'image/png' }]);
  assert.equal(resubmitted.status, 302);
  const row = await db.prepare('SELECT * FROM reimbursement_requests WHERE id = ?').get(id);
  assert.equal(row.status, 'submitted');
  assert.equal(Number(row.submission_count), 2);
  assert.ok(row.resubmitted_at);
  assert.equal(Number(row.total_cents), 800);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM reimbursement_receipts WHERE request_id = ?').get(id)).n), 1);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM reimbursement_rejections WHERE request_id = ?').get(id)).n), 1);

  const adminView = await request(app).get(`/admin/teachers/reimbursements/${id}`).set('Cookie', cookie);
  assert.match(adminView.text, /Rejection History[\s\S]*Please attach the receipt for the crayons\./);
  const teacherView = await request(app).get(`/teacher/reimbursements/${id}`).set('Cookie', teacher.cookie);
  assert.doesNotMatch(teacherView.text, /Edit &amp; Resubmit/);

  const again = await submitForm(teacher.cookie, `/teacher/reimbursements/${id}/resubmit`, {
    _csrf: teacher.csrfToken, memberId: teacher.memberId, semesterId, day: 'monday', classId: artId, itemDescription: 'Sneaky', itemDate: '2026-09-01', itemAmount: '1',
  });
  assert.equal(again.status, 302);
  assert.equal(Number((await db.prepare('SELECT total_cents FROM reimbursement_requests WHERE id = ?').get(id)).total_cents), 800);

  const approved = await submitForm(cookie, `/admin/teachers/reimbursements/${id}/admin`, { _csrf: csrfToken, checkNumber: '77', checkDate: '2026-09-12', approvedByMemberId: adminId });
  assert.equal(approved.status, 302);
  const approvedNote = await db
    .prepare("SELECT n.* FROM notifications n JOIN member_accounts ma ON ma.id = n.member_account_id WHERE ma.member_id = ? AND n.title = 'Reimbursement approved'")
    .get(teacher.memberId);
  assert.ok(approvedNote);
  const rejectApproved = await submitForm(cookie, `/admin/teachers/reimbursements/${id}/reject`, { _csrf: csrfToken, message: 'too late' });
  assert.equal(rejectApproved.status, 400, 'only a Submitted form can be rejected');
});
