// Teacher Reimbursements - a real request: "Co-op admin portal, teacher
// assistant tab, add a subpage called teacher reimbursements. This will be
// a log of reimbursement forms that have been submitted for approval."
// Shared by Co-op Admin's log (routes/admin-teachers.js) and the
// teacher-facing form (routes/teacher-reimbursements.js). Money is integer
// cents everywhere; the client's running total is display-only and the
// server always recomputes it from the item lines.
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { createStorageClient, downloadFile, generateKey } = require('./storage');
const { byLastName } = require('./members');
const { listSemesters } = require('./classSchedule');
const { CLASS_DAY_ORDER, CLASS_DAY_LABELS_FULL, isValidClassDay, parseClassDayValue } = require('./classDays');
const { appSetting, setAppSetting } = require('./appSettings');
const { isValidISODate } = require('./dates');

const STATUS_LABELS = { submitted: 'Submitted', approved: 'Approved/Paid', rejected: 'Rejected' };
const MAX_ITEMS = 100;

// --- Receipts. Financial documents, so never a public URL: the existing
// private 'accounting-receipts' bucket under a 'reimbursements/' prefix,
// or (no storage client - local dev/tests) a directory outside public/
// that express.static never serves. Only GET /reimbursement-receipts/:id
// (routes/teacher-reimbursements.js) reads them back.
const RECEIPTS_BUCKET = 'accounting-receipts';
const RECEIPTS_KEY_PREFIX = 'reimbursements/';
const RECEIPTS_DIR = process.env.UPLOADS_DIR
  ? path.join(process.env.UPLOADS_DIR, 'reimbursement-receipts')
  : path.join(__dirname, '..', 'data', 'reimbursement-receipts');
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPTS = 10;
const RECEIPT_MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.pdf': 'application/pdf',
};
// Types a browser can show inline as an <img> thumbnail.
const THUMBNAIL_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// multer fileFilter: extension AND declared type must agree (same rule as
// utils/uploads.js). A rejected file is remembered on the request so the
// form can say why instead of silently dropping it.
function receiptFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const expected = RECEIPT_MIME_BY_EXT[ext];
  const ok = Boolean(expected) && (file.mimetype === expected || (expected.startsWith('image/hei') && /^image\/hei[cf]/.test(file.mimetype)));
  if (!ok) req.rejectedReceiptNames = (req.rejectedReceiptNames || []).concat(file.originalname || 'file');
  cb(null, ok);
}

async function saveReceipts(requestId, files) {
  const client = createStorageClient();
  for (const file of files || []) {
    const mime = RECEIPT_MIME_BY_EXT[path.extname(file.originalname || '').toLowerCase()] || file.mimetype;
    const key = RECEIPTS_KEY_PREFIX + generateKey(file.originalname);
    if (client) {
      const { error } = await client.storage.from(RECEIPTS_BUCKET).upload(key, file.buffer, { contentType: mime, upsert: false });
      if (error) throw new Error(`Supabase Storage upload failed (${RECEIPTS_BUCKET}/${key}): ${error.message}`);
    } else {
      fs.mkdirSync(path.join(RECEIPTS_DIR, RECEIPTS_KEY_PREFIX), { recursive: true });
      fs.writeFileSync(path.join(RECEIPTS_DIR, key), file.buffer);
    }
    await db
      .prepare('INSERT INTO reimbursement_receipts (request_id, storage_key, original_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)')
      .run(requestId, key, String(file.originalname || '').slice(0, 255), mime, file.size || file.buffer.length);
  }
}

async function getReceipt(id) {
  return db.prepare('SELECT * FROM reimbursement_receipts WHERE id = ?').get(id);
}

async function receiptBuffer(receipt) {
  const client = createStorageClient();
  if (client) return downloadFile(client, RECEIPTS_BUCKET, receipt.storage_key);
  // Keys are always generated server-side, but resolve defensively anyway.
  const filePath = path.resolve(RECEIPTS_DIR, receipt.storage_key);
  if (!filePath.startsWith(path.resolve(RECEIPTS_DIR) + path.sep)) return null;
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
}

async function removeReceiptFiles(requestId) {
  await removeReceiptRows(await db.prepare('SELECT storage_key FROM reimbursement_receipts WHERE request_id = ?').all(requestId));
}

const FORM_SETTING_DEFAULTS = {
  title: 'Teacher Reimbursement Form',
  intro: 'Use this form to request reimbursement for supplies you purchased for your co-op class. Choose your name, semester, day and class, then list each item you bought.',
  footer: '',
};

async function formSettings() {
  return {
    title: await appSetting('reimbursement_form_title', FORM_SETTING_DEFAULTS.title),
    intro: await appSetting('reimbursement_form_intro', FORM_SETTING_DEFAULTS.intro),
    footer: await appSetting('reimbursement_form_footer', FORM_SETTING_DEFAULTS.footer),
  };
}

async function saveFormSettings({ title, intro, footer }) {
  await setAppSetting('reimbursement_form_title', (title || '').trim() || FORM_SETTING_DEFAULTS.title);
  await setAppSetting('reimbursement_form_intro', (intro || '').trim());
  await setAppSetting('reimbursement_form_footer', (footer || '').trim());
}

// "$1,234.50" / "12" / "12.5" -> cents. null for anything unparseable,
// zero or negative (an item line must be a real purchase).
function parseAmountToCents(value) {
  const cleaned = String(value == null ? '' : value).replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(cleaned)) return null;
  const cents = Math.round(parseFloat(cleaned) * 100);
  return cents > 0 ? cents : null;
}

function formatCents(cents) {
  const n = Number(cents) || 0;
  return '$' + (n / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ISO or M/D/YYYY (M/D/YY) - what a typed date or a spreadsheet's
// formatted date cell comes back as.
function parseFlexibleDate(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return null;
  if (isValidISODate(v)) return v;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(v);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
  const iso = `${year}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  return isValidISODate(iso) ? iso : null;
}

// Name dropdown: every active member staffed on a class (teacher or
// assistant) plus every member whose portal account holds the teacher
// role - someone with the role who isn't on a class yet can still be
// reimbursed.
async function reimbursementPeople() {
  const rows = await db
    .prepare(
      `SELECT DISTINCT m.id, m.name FROM members m
       WHERE m.active = 1 AND (
         EXISTS (SELECT 1 FROM class_staff cs WHERE cs.member_id = m.id)
         OR EXISTS (
           SELECT 1 FROM member_accounts ma
           JOIN member_account_roles mar ON mar.member_account_id = ma.id
           JOIN roles r ON r.id = mar.role_id
           WHERE ma.member_id = m.id AND r.key = 'teacher'
         )
       )`
    )
    .all();
  return rows.sort(byLastName);
}

async function isReimbursementPerson(memberId) {
  return (await reimbursementPeople()).some((p) => p.id === memberId);
}

// "Who approved it should be a drop down menu of the members who are
// listed as admins in the system" - the same people Main Admin > Admins
// lists (anyone holding an admin position, utils/adminPositions.js's own
// membersByAdminPosition), plus any active member still typed 'admin'
// (that type is derived from holding a position, so normally the same
// set). The seeded Main Admin login is inactive and stays off the list.
async function adminMembers() {
  const rows = await db
    .prepare(
      `SELECT DISTINCT m.id, m.name FROM members m
       WHERE m.active = 1 AND (
         m.member_type = 'admin'
         OR EXISTS (SELECT 1 FROM member_admin_positions map WHERE map.member_id = m.id)
       )`
    )
    .all();
  return rows.sort(byLastName);
}

// The Semester -> Day -> Class cascade, built once per page render so the
// form can cascade client-side without extra requests. A semester's days
// are its own Day Settings rows plus any day it has classes on; a class
// counts for a semester when tagged with it or untagged (the same
// leniency utils/classSchedule.js's classesForDaySemester applies).
async function formCatalog() {
  const [semesters, schedules, classes, staff] = await Promise.all([
    listSemesters(),
    db.prepare('SELECT day_of_week, semester_id FROM class_schedules').all(),
    db.prepare('SELECT id, day, class_name, room, semester_id, hour_position FROM classes ORDER BY hour_position, LOWER(class_name)').all(),
    db.prepare('SELECT class_id, member_id FROM class_staff').all(),
  ]);
  const staffByClass = {};
  for (const s of staff) (staffByClass[s.class_id] = staffByClass[s.class_id] || []).push(s.member_id);
  return semesters.map((sem) => {
    const days = new Set(schedules.filter((s) => s.semester_id === sem.id).map((s) => s.day_of_week));
    const semClasses = classes.filter((c) => c.semester_id === sem.id || c.semester_id == null);
    semClasses.forEach((c) => days.add(c.day));
    return {
      id: sem.id,
      title: sem.title,
      days: [...days]
        .filter((d) => isValidClassDay(d))
        .sort((a, b) => CLASS_DAY_ORDER[a] - CLASS_DAY_ORDER[b])
        .map((day) => ({
          day,
          label: CLASS_DAY_LABELS_FULL[day],
          classes: semClasses
            .filter((c) => c.day === day)
            .map((c) => ({ id: c.id, name: c.class_name, room: c.room || '', staffIds: staffByClass[c.id] || [] })),
        })),
    };
  });
}

// Server-side check that the chosen class really belongs to the chosen
// semester + day - the client cascade is only a convenience.
async function resolveClassChoice(semesterId, day, classId) {
  const semester = semesterId ? await db.prepare('SELECT * FROM semesters WHERE id = ?').get(semesterId) : null;
  if (!semester) return { error: 'Please choose a semester.' };
  if (!isValidClassDay(day)) return { error: 'Please choose a day of co-op.' };
  const cls = classId ? await db.prepare('SELECT * FROM classes WHERE id = ?').get(classId) : null;
  if (!cls) return { error: 'Please choose a class.' };
  if (cls.day !== day || (cls.semester_id != null && cls.semester_id !== semester.id)) {
    return { error: 'That class is not offered on the selected semester and day.' };
  }
  return { semester, cls };
}

// Parallel itemDescription[]/itemDate[]/itemAmount[] arrays from the form.
// Fully blank lines are dropped; a partly filled line is an error.
function parseItemLines(body) {
  const descriptions = [].concat(body.itemDescription || []);
  const dates = [].concat(body.itemDate || []);
  const amounts = [].concat(body.itemAmount || []);
  const count = Math.max(descriptions.length, dates.length, amounts.length);
  const items = [];
  const errors = [];
  const raw = [];
  for (let i = 0; i < count; i++) {
    const description = String(descriptions[i] || '').trim();
    const date = String(dates[i] || '').trim();
    const amount = String(amounts[i] || '').trim();
    raw.push({ description, date, amount });
    if (!description && !date && !amount) continue;
    const amountCents = parseAmountToCents(amount);
    const purchaseDate = parseFlexibleDate(date);
    if (!description) errors.push(`Item ${i + 1}: enter what was purchased.`);
    if (!purchaseDate) errors.push(`Item ${i + 1}: enter a valid purchase date.`);
    if (amountCents == null) errors.push(`Item ${i + 1}: enter an amount greater than $0.00.`);
    if (description && purchaseDate && amountCents != null) items.push({ description: description.slice(0, 500), purchaseDate, amountCents });
  }
  if (items.length === 0 && errors.length === 0) errors.push('Add at least one item.');
  if (items.length > MAX_ITEMS) errors.push(`A single form can list at most ${MAX_ITEMS} items.`);
  return { items, errors, raw };
}

// Full validation of a submitted form body. memberIds limits who may be
// chosen (the Name dropdown's own list).
async function validateSubmission(body, allowedPeople) {
  const errors = [];
  const memberId = parseInt(body.memberId, 10);
  const person = allowedPeople.find((p) => p.id === memberId);
  if (!person) errors.push('Please choose your name.');
  const semesterId = parseInt(body.semesterId, 10) || null;
  const day = String(body.day || '');
  const classId = parseInt(body.classId, 10) || null;
  const choice = await resolveClassChoice(semesterId, day, classId);
  if (choice.error) errors.push(choice.error);
  const lines = parseItemLines(body);
  errors.push(...lines.errors);
  return { errors, person, choice, items: lines.items, rawItems: lines.raw };
}

async function createRequest({ person, semester, cls, items, accountId, submittedAt, admin }) {
  const total = items.reduce((sum, it) => sum + it.amountCents, 0);
  return db.withTransaction(async (tx) => {
    const row = await tx
      .prepare(
        `INSERT INTO reimbursement_requests
           (member_id, member_name, semester_id, semester_title, day, class_id, class_name, status, total_cents, submitted_at, submitted_by_account_id,
            check_number, check_date, approved_by_member_id, approved_by_name, admin_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, now_text()), ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .get(
        person.id,
        person.name,
        semester.id,
        semester.title,
        cls.day,
        cls.id,
        cls.class_name,
        admin && admin.approved ? 'approved' : 'submitted',
        total,
        submittedAt || null,
        accountId || null,
        (admin && admin.checkNumber) || null,
        (admin && admin.checkDate) || null,
        (admin && admin.approver && admin.approver.id) || null,
        (admin && admin.approver && admin.approver.name) || null,
        admin && (admin.checkNumber || admin.checkDate || admin.approver) ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null
      );
    for (let i = 0; i < items.length; i++) {
      await tx
        .prepare('INSERT INTO reimbursement_items (request_id, description, purchase_date, amount_cents, position) VALUES (?, ?, ?, ?, ?)')
        .run(row.id, items[i].description, items[i].purchaseDate, items[i].amountCents, i);
    }
    return row.id;
  });
}

function decorate(r) {
  return {
    ...r,
    dayLabel: CLASS_DAY_LABELS_FULL[r.day] || r.day || '',
    statusLabel: STATUS_LABELS[r.status] || r.status,
    totalLabel: formatCents(r.total_cents),
    itemCount: r.itemCount != null ? Number(r.itemCount) : undefined,
    receiptCount: r.receiptCount != null ? Number(r.receiptCount) : undefined,
  };
}

// filters: { status, semesterId, memberIdOrAccount: { memberId, accountId } }
async function listRequests(filters = {}) {
  const where = [];
  const params = [];
  if (filters.status && STATUS_LABELS[filters.status]) {
    where.push('r.status = ?');
    params.push(filters.status);
  }
  if (filters.semesterId) {
    where.push('r.semester_id = ?');
    params.push(filters.semesterId);
  }
  if (filters.owner) {
    where.push('(r.member_id = ? OR r.submitted_by_account_id = ?)');
    params.push(filters.owner.memberId || -1, filters.owner.accountId || -1);
  }
  const rows = await db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM reimbursement_items i WHERE i.request_id = r.id) AS "itemCount",
              (SELECT COUNT(*) FROM reimbursement_receipts rr WHERE rr.request_id = r.id) AS "receiptCount"
       FROM reimbursement_requests r
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY r.submitted_at DESC, r.id DESC`
    )
    .all(...params);
  return rows.map(decorate);
}

async function getRequest(id) {
  const row = await db.prepare('SELECT * FROM reimbursement_requests WHERE id = ?').get(id);
  if (!row) return null;
  const items = await db.prepare('SELECT * FROM reimbursement_items WHERE request_id = ? ORDER BY position, id').all(id);
  const receipts = await db.prepare('SELECT * FROM reimbursement_receipts WHERE request_id = ? ORDER BY id').all(id);
  const rejections = await db.prepare('SELECT * FROM reimbursement_rejections WHERE request_id = ? ORDER BY id DESC').all(id);
  return {
    ...decorate(row),
    rejections,
    currentRejection: row.status === 'rejected' ? rejections[0] || null : null,
    items: items.map((it) => ({ ...it, amountLabel: formatCents(it.amount_cents) })),
    receipts: receipts.map((rc) => ({ ...rc, url: `/reimbursement-receipts/${rc.id}`, isThumbnail: THUMBNAIL_TYPES.has(rc.mime_type), isPdf: rc.mime_type === 'application/pdf' })),
  };
}

async function itemsForRequests(ids) {
  if (!ids.length) return [];
  return db
    .prepare(`SELECT * FROM reimbursement_items WHERE request_id IN (${ids.map(() => '?').join(', ')}) ORDER BY request_id, position, id`)
    .all(...ids);
}

// Admin Only section. Approved/Paid once check number, check date and
// approver are all filled in; clearing any of them returns it to
// Submitted. Returns an error string for an invalid approver/date.
async function saveAdminSection(id, { checkNumber, checkDate, approvedByMemberId }) {
  const existing = await db.prepare('SELECT status FROM reimbursement_requests WHERE id = ?').get(id);
  if (!existing) return 'Not found.';
  if (existing.status === 'rejected') return 'This form was rejected - it can be approved once the teacher resubmits it.';
  const number = String(checkNumber || '').trim().slice(0, 50);
  const dateRaw = String(checkDate || '').trim();
  const date = dateRaw ? parseFlexibleDate(dateRaw) : null;
  if (dateRaw && !date) return 'Enter a valid check date.';
  let approver = null;
  if (approvedByMemberId) {
    const approverId = parseInt(approvedByMemberId, 10);
    approver = (await adminMembers()).find((m) => m.id === approverId) || null;
    if (!approver) return 'Approved By must be one of the co-op’s admins.';
  }
  const status = number && date && approver ? 'approved' : 'submitted';
  await db
    .prepare(
      `UPDATE reimbursement_requests SET check_number = ?, check_date = ?, approved_by_member_id = ?, approved_by_name = ?, status = ?, admin_updated_at = now_text()
       WHERE id = ?`
    )
    .run(number || null, date, approver ? approver.id : null, approver ? approver.name : null, status, id);
  if (status === 'approved' && existing.status !== 'approved') {
    const req = await getRequest(id);
    await notifyStatus(req, {
      title: 'Reimbursement approved',
      body: `Your reimbursement for ${req.class_name} (${req.totalLabel}) was approved and paid${number ? ` - check #${number}` : ''}.`,
    });
  }
  return null;
}

// Every account belonging to the reimbursed member, plus whoever submitted
// it. A failed notification never blocks the admin's action.
async function notifyStatus(request, { title, body }) {
  try {
    const notifications = require('./notifications');
    const rows = await db.prepare('SELECT id FROM member_accounts WHERE member_id = ?').all(request.member_id || -1);
    const ids = new Set(rows.map((r) => r.id));
    if (request.submitted_by_account_id) ids.add(request.submitted_by_account_id);
    for (const accountId of ids) {
      try {
        await notifications.notify(accountId, 'reimbursement_status', { title, body, linkUrl: `/teacher/reimbursements/${request.id}` });
      } catch (err) {
        console.error('Reimbursement notification failed:', err.message);
      }
    }
  } catch (err) {
    console.error('Reimbursement notification failed:', err.message);
  }
}

// "Reject" popup - only while Submitted (an approved one is paid; a
// rejected one is waiting on the teacher).
async function rejectRequest(id, message, accountId) {
  const text = String(message || '').trim().slice(0, 4000);
  if (!text) return 'Enter a message explaining why the form is being rejected.';
  const req = await getRequest(id);
  if (!req) return 'Not found.';
  if (req.status !== 'submitted') return 'Only a submitted form can be rejected.';
  const by = accountId ? await db.prepare('SELECT m.name FROM member_accounts ma JOIN members m ON m.id = ma.member_id WHERE ma.id = ?').get(accountId) : null;
  await db.withTransaction(async (tx) => {
    await tx
      .prepare('INSERT INTO reimbursement_rejections (request_id, message, rejected_by_account_id, rejected_by_name, submission_number) VALUES (?, ?, ?, ?, ?)')
      .run(id, text, accountId || null, by ? by.name : '', req.submission_count || 1);
    await tx.prepare("UPDATE reimbursement_requests SET status = 'rejected', admin_updated_at = now_text() WHERE id = ?").run(id);
  });
  await notifyStatus(req, { title: 'Reimbursement needs changes', body: `Your reimbursement for ${req.class_name} was sent back: ${text}` });
  return null;
}

// Edit & Resubmit of a Rejected form - the same validation as a new
// submission (done by the caller), then everything is replaced in place
// and it returns to Submitted. Rejection history stays.
async function resubmitRequest(id, { person, semester, cls, items, removeReceiptIds, files }) {
  const total = items.reduce((sum, it) => sum + it.amountCents, 0);
  const removeIds = (removeReceiptIds || []).map((x) => parseInt(x, 10)).filter(Boolean);
  const toRemove = removeIds.length
    ? await db.prepare(`SELECT * FROM reimbursement_receipts WHERE request_id = ? AND id IN (${removeIds.map(() => '?').join(', ')})`).all(id, ...removeIds)
    : [];
  await db.withTransaction(async (tx) => {
    await tx
      .prepare(
        `UPDATE reimbursement_requests SET member_id = ?, member_name = ?, semester_id = ?, semester_title = ?, day = ?, class_id = ?, class_name = ?,
           total_cents = ?, status = 'submitted', resubmitted_at = now_text(), submission_count = submission_count + 1
         WHERE id = ?`
      )
      .run(person.id, person.name, semester.id, semester.title, cls.day, cls.id, cls.class_name, total, id);
    await tx.prepare('DELETE FROM reimbursement_items WHERE request_id = ?').run(id);
    for (let i = 0; i < items.length; i++) {
      await tx
        .prepare('INSERT INTO reimbursement_items (request_id, description, purchase_date, amount_cents, position) VALUES (?, ?, ?, ?, ?)')
        .run(id, items[i].description, items[i].purchaseDate, items[i].amountCents, i);
    }
    for (const rc of toRemove) await tx.prepare('DELETE FROM reimbursement_receipts WHERE id = ?').run(rc.id);
  });
  await removeReceiptRows(toRemove);
  await saveReceipts(id, files);
}

async function removeReceiptRows(rows) {
  if (!rows.length) return;
  const client = createStorageClient();
  if (client) {
    await client.storage.from(RECEIPTS_BUCKET).remove(rows.map((r) => r.storage_key));
    return;
  }
  for (const r of rows) {
    const filePath = path.join(RECEIPTS_DIR, r.storage_key);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

async function deleteRequest(id) {
  await removeReceiptFiles(id);
  await db.prepare('DELETE FROM reimbursement_requests WHERE id = ?').run(id);
}

// --- Import (one spreadsheet row per item line; rows sharing the same
// Name/Semester/Day/Class/Submitted Date become one reimbursement). ---
const IMPORT_HEADERS = ['Name', 'Semester', 'Day', 'Class', 'Item', 'Purchase Date', 'Amount', 'Submitted Date', 'Check Number', 'Check Date', 'Approved By'];
const IMPORT_ALIASES = {
  name: ['name', 'teacher', 'member', 'member name'],
  semester: ['semester'],
  day: ['day', 'day of co-op', 'co-op day'],
  className: ['class', 'class name'],
  item: ['item', 'description', 'item description'],
  purchaseDate: ['purchase date', 'date purchased', 'date'],
  amount: ['amount', 'cost', 'price'],
  submittedDate: ['submitted date', 'submitted', 'date submitted'],
  checkNumber: ['check number', 'check #', 'check no'],
  checkDate: ['check date'],
  approvedBy: ['approved by', 'approver'],
};

function normalizeImportRow(row) {
  const lower = {};
  for (const key of Object.keys(row)) lower[key.trim().toLowerCase()] = row[key];
  const out = {};
  for (const [field, aliases] of Object.entries(IMPORT_ALIASES)) {
    out[field] = '';
    for (const alias of aliases) {
      if (lower[alias] !== undefined && String(lower[alias]).trim() !== '') {
        out[field] = String(lower[alias]).trim();
        break;
      }
    }
  }
  return out;
}

async function importRows(rawRows, accountId) {
  const rows = rawRows.map(normalizeImportRow);
  const [members, semesters, classes, admins] = await Promise.all([
    db.prepare('SELECT id, name FROM members').all(),
    listSemesters(),
    db.prepare('SELECT * FROM classes').all(),
    adminMembers(),
  ]);
  const byName = (list, name, key = 'name') => list.find((x) => String(x[key]).trim().toLowerCase() === name.toLowerCase());
  const errors = [];
  const groups = new Map();
  rows.forEach((r, idx) => {
    const rowNum = idx + 2; // header is row 1
    if (Object.values(r).every((v) => !v)) return;
    const rowErrors = [];
    const person = r.name ? byName(members, r.name) : null;
    if (!person) rowErrors.push(r.name ? `no member named "${r.name}"` : 'Name is required');
    const semester = r.semester ? byName(semesters, r.semester, 'title') : null;
    if (!semester) rowErrors.push(r.semester ? `no semester named "${r.semester}"` : 'Semester is required');
    const day = parseClassDayValue(r.day);
    if (!day) rowErrors.push('Day must be a day of the week');
    let cls = null;
    if (semester && day && r.className) {
      cls = classes.find(
        (c) => c.class_name.trim().toLowerCase() === r.className.toLowerCase() && c.day === day && (c.semester_id === semester.id || c.semester_id == null)
      );
      if (!cls) rowErrors.push(`no class "${r.className}" on ${CLASS_DAY_LABELS_FULL[day]} in ${semester.title}`);
    } else if (!r.className) rowErrors.push('Class is required');
    if (!r.item) rowErrors.push('Item is required');
    const purchaseDate = parseFlexibleDate(r.purchaseDate);
    if (!purchaseDate) rowErrors.push('Purchase Date must be a valid date');
    const amountCents = parseAmountToCents(r.amount);
    if (amountCents == null) rowErrors.push('Amount must be greater than $0.00');
    const submittedDate = r.submittedDate ? parseFlexibleDate(r.submittedDate) : null;
    if (r.submittedDate && !submittedDate) rowErrors.push('Submitted Date must be a valid date');
    const checkDate = r.checkDate ? parseFlexibleDate(r.checkDate) : null;
    if (r.checkDate && !checkDate) rowErrors.push('Check Date must be a valid date');
    const approver = r.approvedBy ? byName(admins, r.approvedBy) : null;
    if (r.approvedBy && !approver) rowErrors.push(`Approved By "${r.approvedBy}" is not an admin`);
    if (rowErrors.length) {
      errors.push(`Row ${rowNum}: ${rowErrors.join('; ')}.`);
      return;
    }
    const key = [person.id, semester.id, day, cls.id, submittedDate || ''].join('|');
    if (!groups.has(key)) {
      groups.set(key, {
        person,
        semester,
        cls,
        submittedAt: submittedDate ? `${submittedDate} 12:00:00` : null,
        admin: { checkNumber: r.checkNumber, checkDate, approver, approved: !!(r.checkNumber && checkDate && approver) },
        items: [],
      });
    }
    groups.get(key).items.push({ description: r.item.slice(0, 500), purchaseDate, amountCents });
  });
  let imported = 0;
  for (const g of groups.values()) {
    await createRequest({ ...g, accountId });
    imported += 1;
  }
  return { imported, errors };
}

module.exports = {
  STATUS_LABELS,
  FORM_SETTING_DEFAULTS,
  IMPORT_HEADERS,
  MAX_RECEIPT_BYTES,
  MAX_RECEIPTS,
  receiptFileFilter,
  saveReceipts,
  getReceipt,
  receiptBuffer,
  formSettings,
  saveFormSettings,
  parseAmountToCents,
  formatCents,
  parseFlexibleDate,
  reimbursementPeople,
  isReimbursementPerson,
  adminMembers,
  formCatalog,
  resolveClassChoice,
  parseItemLines,
  validateSubmission,
  createRequest,
  listRequests,
  getRequest,
  itemsForRequests,
  saveAdminSection,
  rejectRequest,
  resubmitRequest,
  deleteRequest,
  importRows,
};
