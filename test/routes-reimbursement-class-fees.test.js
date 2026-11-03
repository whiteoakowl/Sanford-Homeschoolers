// Coverage for class supply-fee money on Teacher Reimbursements - a real
// request: "in the admin only section ... total amount available for
// reimbursement based off the invoices paid for that class, how much paid
// out ... and how much left", the Class Fees subpage under Teachers/
// Assistants, and Teacher Portal's My Classes (utils/reimbursements.js's
// classFeeSummary, shared by all three).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `reimbursement-class-fees-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `reimbursement-class-fees-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { generateMemberCode } = require('../utils/members');
const { hashPassword } = require('../utils/portalAuth');
const payments = require('../utils/payments');
const reimb = require('../utils/reimbursements');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

async function createMember(name) {
  const code = await generateMemberCode();
  return (await db.prepare("INSERT INTO members (name, barcode, member_code, member_type, active) VALUES (?, ?, ?, 'parent', 1) RETURNING id").get(name, code, code)).id;
}

let counter = 0;
async function loginTeacher(name) {
  counter += 1;
  const memberId = await createMember(name);
  const email = `class-fees-teacher-${counter}@example.com`;
  const accountId = (
    await db
      .prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, ?, ?, 'active', now_text()) RETURNING id")
      .get(memberId, email, hashPassword('testpassword123'))
  ).id;
  const role = await db.prepare("SELECT id FROM roles WHERE key = 'teacher'").get();
  await db.prepare('INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, ?)').run(accountId, role.id);
  const loginRes = await request(app).post('/login').type('form').send({ email, password: 'testpassword123', next: '/teacher' });
  return { memberId, accountId, cookie: loginRes.headers['set-cookie'] };
}

async function loginAsAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  return loginRes.headers['set-cookie'];
}

async function createClass(name, { day = 'monday', semesterId = null, priceCents = null } = {}) {
  return (
    await db
      .prepare('INSERT INTO classes (day, hour_position, class_name, semester_id, price_cents) VALUES (?, 1, ?, ?, ?) RETURNING id')
      .get(day, name, semesterId, priceCents)
  ).id;
}
async function addStaff(classId, memberId, role = 'teacher') {
  await db.prepare('INSERT INTO class_staff (class_id, member_id, role) VALUES (?, ?, ?)').run(classId, memberId, role);
}
async function registrationCharge(classId, payerId, amountCents) {
  return payments.createCharge(payerId, null, 'class_registration', classId, 'Class fee', amountCents);
}
async function reimbursement(classId, memberId, totalCents, status) {
  const cls = await db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  return (
    await db
      .prepare(
        "INSERT INTO reimbursement_requests (member_id, member_name, semester_id, semester_title, day, class_id, class_name, status, total_cents) VALUES (?, 'x', ?, '', ?, ?, ?, ?, ?) RETURNING id"
      )
      .get(memberId, cls.semester_id, cls.day, classId, cls.class_name, status, totalCents)
  ).id;
}

let fx;
async function fixture() {
  if (fx) return fx;
  const semesterId = (await db.prepare("INSERT INTO semesters (title) VALUES ('Fall 2026') RETURNING id").get()).id;
  const payer = await createMember('Paying Parent');
  const teacher = await loginTeacher('Wanda Woodwork');
  const coTeacher = await loginTeacher('Carl Cowork');
  const outsider = await loginTeacher('Oscar Outside');
  const woodId = await createClass('Woodworking', { semesterId, priceCents: 4000 });
  const freeId = await createClass('Free Reading', { semesterId, priceCents: null });
  const pottery = await createClass('Pottery', { day: 'wednesday', semesterId, priceCents: 2500 });
  await addStaff(woodId, teacher.memberId);
  await addStaff(woodId, coTeacher.memberId);
  await addStaff(freeId, teacher.memberId);
  await addStaff(pottery, outsider.memberId);

  // Woodworking: $40 paid in full, $25 partial on a second, $40 unpaid,
  // a cancelled charge with $40 paid (excluded), a $10 refund on the
  // first (reduces it) and a discount (never cash - ignored).
  const c1 = await registrationCharge(woodId, payer, 4000);
  await payments.recordPayment(c1, 4000, 'manual', null, null);
  await payments.recordPayment(c1, -1000, 'manual', null, null, 'refund');
  const c2 = await registrationCharge(woodId, payer, 4000);
  await payments.recordPayment(c2, 2500, 'manual', null, null);
  await payments.recordPayment(c2, -500, 'manual', null, null, 'discount');
  await registrationCharge(woodId, payer, 4000);
  const c4 = await registrationCharge(woodId, payer, 4000);
  await payments.recordPayment(c4, 4000, 'manual', null, null);
  await payments.cancelCharge(c4);
  // Pottery: $25 paid.
  const p1 = await registrationCharge(pottery, payer, 2500);
  await payments.recordPayment(p1, 2500, 'manual', null, null);

  // Reimbursements: only approved count as payout.
  await reimbursement(woodId, teacher.memberId, 3000, 'approved');
  const coRequest = await reimbursement(woodId, coTeacher.memberId, 2000, 'approved');
  await reimbursement(woodId, teacher.memberId, 9999, 'rejected');
  const pendingId = await reimbursement(woodId, teacher.memberId, 1500, 'submitted');
  await reimbursement(pottery, outsider.memberId, 500, 'approved');

  fx = { semesterId, teacher, coTeacher, outsider, woodId, freeId, pottery, pendingId, coRequest };
  return fx;
}

test('classFeeSummary: paid cash minus refunds on non-cancelled charges; only approved reimbursements are payout; leftover can go negative', async () => {
  const { woodId, freeId, pottery } = await fixture();
  const s = await reimb.classFeeSummary([woodId, freeId, pottery]);
  assert.equal(s[woodId].availableCents, 5500); // 4000 - 1000 + 2500
  assert.equal(s[woodId].payoutCents, 5000); // 3000 + 2000 approved
  assert.equal(s[woodId].leftoverCents, 500);
  assert.equal(s[woodId].chargeCount, 3);
  assert.deepEqual([s[freeId].availableCents, s[freeId].payoutCents, s[freeId].leftoverCents], [0, 0, 0]);
  assert.equal(s[pottery].leftoverCents, 2000);

  const extra = await reimbursement(pottery, null, 3000, 'approved');
  const after = (await reimb.classFeeSummary([pottery]))[pottery];
  assert.equal(after.leftoverCents, -1000);
  assert.equal(after.leftoverLabel, '-$10.00');
  await db.prepare('DELETE FROM reimbursement_requests WHERE id = ?').run(extra);
});

test('admin submission view shows Total Available, Paid Out, Left, this request and left-if-approved', async () => {
  const { pendingId } = await fixture();
  const cookie = await loginAsAdmin();
  const res = await request(app).get(`/admin/teachers/reimbursements/${pendingId}`).set('Cookie', cookie);
  assert.equal(res.status, 200);
  const panel = /<dl class="reimbursement-summary reimbursement-class-money"[\s\S]*?<\/dl>/.exec(res.text)[0];
  assert.match(panel, /Total Available[\s\S]*?\$55\.00/);
  assert.match(panel, /Paid Out[\s\S]*?\$50\.00/);
  assert.match(panel, /<dt>Left<\/dt><dd class="">\$5\.00/);
  assert.match(panel, /This Request[\s\S]*?\$15\.00/);
  assert.match(panel, /Left If Approved<\/dt><dd class="money-negative">-\$10\.00/);
});

test('Class Fees page: teacher -> fee-collecting classes with correct numbers; no-fee classes excluded; nav entry present', async () => {
  const { semesterId } = await fixture();
  const cookie = await loginAsAdmin();
  const res = await request(app).get(`/admin/teachers/class-fees?semesterId=${semesterId}`).set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /href="\/admin\/teachers\/class-fees"[^>]*>[\s\S]*?Class Fees/);
  const wanda = /data-class-fees-teacher="Wanda Woodwork">([\s\S]*?)<\/section>/.exec(res.text)[1];
  assert.match(wanda, /Woodworking<\/td>\s*<td>Monday<\/td>[\s\S]*?Fall 2026<\/td>\s*<td[^>]*>\$55\.00<\/td>\s*<td[^>]*>\$50\.00<\/td>\s*<td[^>]*>\$5\.00<\/td>/);
  assert.doesNotMatch(wanda, /Free Reading/);
  const carl = /data-class-fees-teacher="Carl Cowork">([\s\S]*?)<\/section>/.exec(res.text)[1];
  assert.match(carl, /Woodworking/, 'a co-taught class appears under each teacher');
  assert.match(res.text, /data-class-fees-teacher="Oscar Outside">[\s\S]*?Pottery/);
  assert.doesNotMatch(res.text, /Free Reading/);

  const csv = await request(app).get(`/admin/teachers/class-fees/export.csv?semesterId=${semesterId}`).set('Cookie', cookie);
  assert.match(csv.text, /"Wanda Woodwork","Woodworking","Monday","[^"]*","Fall 2026","55\.00","50\.00","5\.00"/);
  const print = await request(app).get(`/admin/teachers/class-fees/print?semesterId=${semesterId}`).set('Cookie', cookie);
  assert.equal(print.status, 200);
  assert.match(print.text, /print-page/);
  const pdf = await request(app)
    .get(`/admin/teachers/class-fees/download.pdf?semesterId=${semesterId}`)
    .set('Cookie', cookie)
    .buffer(true)
    .parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
});

test('Teacher Portal My Classes shows totals; class drill-down lists that class\'s submissions to its teachers only', async () => {
  const { teacher, coTeacher, outsider, woodId, coRequest } = await fixture();
  const page = await request(app).get('/teacher/reimbursements').set('Cookie', teacher.cookie);
  assert.equal(page.status, 200);
  assert.match(page.text, /My Classes/);
  const row = new RegExp(`data-class-fee-row="${woodId}">([\\s\\S]*?)</tr>`).exec(page.text)[1];
  assert.match(row, new RegExp(`href="/teacher/reimbursements/classes/${woodId}"`));
  assert.match(row, /\$55\.00[\s\S]*\$50\.00[\s\S]*\$5\.00/);
  assert.match(page.text, /Free Reading/, 'My Classes lists every class the teacher is staffed on');

  const drill = await request(app).get(`/teacher/reimbursements/classes/${woodId}`).set('Cookie', teacher.cookie);
  assert.equal(drill.status, 200);
  assert.equal((drill.text.match(/data-class-request=/g) || []).length, 4);
  assert.match(drill.text, /badge-pill-red">Rejected/);

  const coDrill = await request(app).get(`/teacher/reimbursements/classes/${woodId}`).set('Cookie', coTeacher.cookie);
  assert.equal(coDrill.status, 200);
  const outsiderDrill = await request(app).get(`/teacher/reimbursements/classes/${woodId}`).set('Cookie', outsider.cookie);
  assert.equal(outsiderDrill.status, 404);

  // A co-teacher's submission is viewable read-only by the class's other teacher.
  const coView = await request(app).get(`/teacher/reimbursements/${coRequest}`).set('Cookie', teacher.cookie);
  assert.equal(coView.status, 200);
  const outsiderView = await request(app).get(`/teacher/reimbursements/${coRequest}`).set('Cookie', outsider.cookie);
  assert.equal(outsiderView.status, 404);
});

test('a co-teacher can view but never edit someone else\'s rejected submission', async () => {
  const { teacher, coTeacher, woodId } = await fixture();
  const rejectedId = await reimbursement(woodId, coTeacher.memberId, 700, 'rejected');
  await db.prepare("INSERT INTO reimbursement_rejections (request_id, message) VALUES (?, 'Need receipt')").run(rejectedId);
  const view = await request(app).get(`/teacher/reimbursements/${rejectedId}`).set('Cookie', teacher.cookie);
  assert.equal(view.status, 200);
  assert.doesNotMatch(view.text, /Edit &amp; Resubmit/);
  const edit = await request(app).get(`/teacher/reimbursements/${rejectedId}/edit`).set('Cookie', teacher.cookie);
  assert.equal(edit.status, 404);
  const own = await request(app).get(`/teacher/reimbursements/${rejectedId}`).set('Cookie', coTeacher.cookie);
  assert.match(own.text, /Edit &amp; Resubmit/);
});
