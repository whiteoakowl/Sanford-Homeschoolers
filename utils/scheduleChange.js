// Schedule Change Requests - a real request: "Make a schedule change
// request form. Should be listed under co-op classes. As a family list
// log. Request form will show students current classes. Parent can choose
// cancel next to the classes they want to cancel. Then below they can add
// classes from list of available classes that have room. Admin can
// approve switch. When it is approved the member is removed from the
// canceled classes and added to the roster of the new classes. Can
// decline individual classes additions admin. This also follows
// invoice/class payment settings. This form can be found on the parent
// portal under class registration tab as a subpage. Quick links is added
// under the quicklink links tab in settings for co-op admin. This will
// also automatically trigger a name tag request."
// Parent side: routes/parent-portal.js (/parent/classes/schedule-change).
// Admin side: routes/admin-schedule-change.js (Classes > Schedule Change
// Requests).
const db = require('../db');
const { allClassesList, setEnrollment } = require('./classSchedule');
const { adminRemoveStudentFromClass, adminAddStudentToClass, easternStamp } = require('./classRegistration');

// Classes a student could switch into: registration open, in a current
// (non-archived) semester, not already theirs, and with a seat left.
async function availableClassesFor(studentId) {
  const all = await allClassesList(null);
  const mine = new Set((await db.prepare('SELECT class_id FROM class_enrollments WHERE student_id = ?').all(studentId)).map((r) => r.class_id));
  const counts = new Map(
    (await db.prepare('SELECT class_id, COUNT(*) AS n FROM class_enrollments GROUP BY class_id').all()).map((r) => [r.class_id, Number(r.n)])
  );
  const open = new Set((await db.prepare('SELECT id FROM classes WHERE registration_open = 1').all()).map((r) => r.id));
  return all
    .filter((c) => open.has(c.id) && !mine.has(c.id))
    .map((c) => ({ ...c, enrolled: counts.get(c.id) || 0, spotsLeft: c.capacity != null ? Number(c.capacity) - (counts.get(c.id) || 0) : null }))
    .filter((c) => c.spotsLeft == null || c.spotsLeft > 0);
}

// body.drop: ["<studentId>:<classId>", ...]; body.add: same. Only the
// family's own students, a drop only from a class they're in, an add
// only into one of availableClassesFor.
async function submitRequest({ member, accountId, children, body }) {
  const childIds = new Set(children.map((c) => c.id));
  const parse = (v) => (Array.isArray(v) ? v : v != null ? [v] : []).map((x) => String(x).split(':').map((n) => parseInt(n, 10))).filter(([s, c]) => childIds.has(s) && Number.isFinite(c));
  const items = [];
  for (const [studentId, classId] of parse(body.drop)) {
    if (await db.prepare('SELECT 1 FROM class_enrollments WHERE class_id = ? AND student_id = ?').get(classId, studentId)) items.push({ studentId, classId, action: 'drop' });
  }
  const availableByStudent = new Map();
  for (const [studentId, classId] of parse(body.add)) {
    if (!availableByStudent.has(studentId)) availableByStudent.set(studentId, new Set((await availableClassesFor(studentId)).map((c) => c.id)));
    if (availableByStudent.get(studentId).has(classId)) items.push({ studentId, classId, action: 'add' });
  }
  if (!items.length) return { ok: false, error: 'Choose at least one class to cancel or add.' };
  const req = await db
    .prepare('INSERT INTO schedule_change_requests (family_id, member_id, account_id, note) VALUES (?, ?, ?, ?) RETURNING id')
    .get(member.family_id || null, member.id, accountId || null, String(body.note || '').trim() || null);
  for (const it of items) {
    await db.prepare('INSERT INTO schedule_change_items (request_id, student_id, class_id, action) VALUES (?, ?, ?, ?)').run(req.id, it.studentId, it.classId, it.action);
  }
  return { ok: true, id: req.id };
}

const DAY_LABEL = { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' };

async function itemsFor(requestId) {
  return (
    await db
      .prepare(
        `SELECT i.*, m.name AS student_name, c.class_name, c.day, c.hour_position, c.room
         FROM schedule_change_items i JOIN members m ON m.id = i.student_id JOIN classes c ON c.id = i.class_id
         WHERE i.request_id = ? ORDER BY m.name, i.action DESC, c.day, c.hour_position`
      )
      .all(requestId)
  ).map((i) => ({ ...i, classLabel: `${i.class_name} (${DAY_LABEL[i.day] || i.day} Hour ${i.hour_position})` }));
}

function decorate(r) {
  const asked = easternStamp(r.created_at);
  const decided = r.decided_at ? easternStamp(r.decided_at) : null;
  return {
    ...r,
    familyLabel: r.family_name ? `${r.family_name} Family` : r.member_name || 'Unknown family',
    requestedLabel: `${asked.dateLabel} · ${asked.timeLabel}`,
    decidedLabel: decided ? `${decided.dateLabel} · ${decided.timeLabel}` : null,
  };
}

const SELECT = `SELECT r.*, f.name AS family_name, m.name AS member_name FROM schedule_change_requests r
  LEFT JOIN families f ON f.id = r.family_id LEFT JOIN members m ON m.id = r.member_id`;

// The family list log: pending first, then newest.
async function listRequests() {
  const rows = await db.prepare(`${SELECT} ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC, r.id DESC`).all();
  const out = [];
  for (const r of rows) out.push({ ...decorate(r), items: await itemsFor(r.id) });
  return out;
}

async function getRequest(id) {
  const r = await db.prepare(`${SELECT} WHERE r.id = ?`).get(id);
  return r ? { ...decorate(r), items: await itemsFor(r.id) } : null;
}

async function requestsForFamily(familyId, memberId) {
  const rows = familyId
    ? await db.prepare(`${SELECT} WHERE r.family_id = ? ORDER BY r.created_at DESC, r.id DESC`).all(familyId)
    : await db.prepare(`${SELECT} WHERE r.member_id = ? ORDER BY r.created_at DESC, r.id DESC`).all(memberId);
  const out = [];
  for (const r of rows) out.push({ ...decorate(r), items: await itemsFor(r.id) });
  return out;
}

async function pendingCount() {
  return Number((await db.prepare("SELECT COUNT(*) AS n FROM schedule_change_requests WHERE status = 'pending'").get()).n);
}

// Approve the switch: every cancel goes through (out of the class and its
// registration cancelled, the charge settled per Co-op Class Settings),
// then every addition not in declinedItemIds is added (a registration and
// charge per the class's own price settings, or the waitlist if it filled
// up meanwhile). Each affected student gets a schedule-change name tag
// request.
async function approveRequest(id, { declinedItemIds = [], adminAccountId, decidedBy } = {}) {
  const r = await getRequest(id);
  if (!r || r.status !== 'pending') return null;
  const declined = new Set(declinedItemIds.map(Number));
  const touched = new Map();
  for (const it of r.items.filter((i) => i.action === 'drop')) {
    const remaining = (await db.prepare('SELECT student_id FROM class_enrollments WHERE class_id = ?').all(it.class_id)).map((x) => x.student_id).filter((s) => s !== it.student_id);
    await setEnrollment(it.class_id, remaining);
    await adminRemoveStudentFromClass(it.class_id, it.student_id, adminAccountId);
    await db.prepare("UPDATE schedule_change_items SET status = 'approved', result = 'Cancelled' WHERE id = ?").run(it.id);
    if (!touched.has(it.student_id)) touched.set(it.student_id, new Set());
    touched.get(it.student_id).add(it.day);
  }
  for (const it of r.items.filter((i) => i.action === 'add')) {
    if (declined.has(it.id)) {
      await db.prepare("UPDATE schedule_change_items SET status = 'declined', result = 'Declined' WHERE id = ?").run(it.id);
      continue;
    }
    const res = await adminAddStudentToClass(it.class_id, it.student_id, adminAccountId);
    if (res.ok && res.status === 'confirmed') {
      const cls = await db.prepare('SELECT day FROM classes WHERE id = ?').get(it.class_id);
      const others = (await db.prepare('SELECT student_id FROM class_enrollments WHERE class_id = ?').all(it.class_id)).map((x) => x.student_id);
      await setEnrollment(it.class_id, others);
      if (!touched.has(it.student_id)) touched.set(it.student_id, new Set());
      touched.get(it.student_id).add(cls.day);
    }
    await db
      .prepare('UPDATE schedule_change_items SET status = ?, result = ? WHERE id = ?')
      .run(res.ok ? 'approved' : 'declined', res.ok ? (res.status === 'waitlisted' ? 'Waitlisted (class filled)' : 'Added') : res.error, it.id);
  }
  for (const [studentId, days] of touched) {
    const day = days.size === 1 ? [...days][0] : 'both';
    await db
      .prepare("INSERT INTO name_tag_requests (member_id, request_type, day, description) VALUES (?, 'schedule_change', ?, ?)")
      .run(studentId, day, 'Schedule change request approved - schedule needs to be reprinted.');
  }
  const anyAdded = r.items.some((i) => i.action === 'add' && !declined.has(i.id));
  const anyDeclined = r.items.some((i) => i.action === 'add' && declined.has(i.id));
  const status = anyDeclined && (anyAdded || r.items.some((i) => i.action === 'drop')) ? 'partial' : 'approved';
  await db.prepare('UPDATE schedule_change_requests SET status = ?, decided_by = ?, decided_at = now_text() WHERE id = ?').run(status, decidedBy || null, id);
  return getRequest(id);
}

async function declineRequest(id, decidedBy) {
  await db.prepare("UPDATE schedule_change_items SET status = 'declined', result = 'Declined' WHERE request_id = ? AND status = 'pending'").run(id);
  await db.prepare("UPDATE schedule_change_requests SET status = 'declined', decided_by = ?, decided_at = now_text() WHERE id = ? AND status = 'pending'").run(decidedBy || null, id);
}

module.exports = { availableClassesFor, submitRequest, listRequests, getRequest, requestsForFamily, pendingCount, approveRequest, declineRequest };
