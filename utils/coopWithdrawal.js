// Withdraw from Co-op Classes - a real request: "Parent portal, classroom
// dashboard. At the top add a button that says Withdraw from co-op
// classes. A popup occurs and asks are you sure you want to delete your
// enrollment to co-op and cancel all of your students classes? Option to
// add a note to admins. Confirm and cancel buttons. On admin side shows
// up under classes subpage called co-op Withdraw. Listed by family click
// to view their full schedule and note. Confirm or reject buttons.
// Confirm removes entire family from co-op classes, teaching positions,
// assistant positions, floater, setup/cleanup lists etc. They go back to
// only being listed as a group member on main admin portal."
// The parent's request only asks; nothing changes until Co-op Admin
// confirms (routes/admin-coop-withdraw.js). Members, accounts and past
// attendance are kept - only the family's co-op class participation goes.
const db = require('../db');
const { setEnrollment, removeStaff, syncDayMemberRosters, syncMemberSchedulesForDay } = require('./classSchedule');
const { easternStamp } = require('./classRegistration');
const { todayISO } = require('./dates');

async function familyIdForMember(memberId) {
  const m = await db.prepare('SELECT family_id FROM members WHERE id = ?').get(memberId);
  return m ? m.family_id : null;
}

async function pendingForFamily(familyId) {
  if (!familyId) return null;
  return (await db.prepare("SELECT * FROM coop_withdrawals WHERE family_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1").get(familyId)) || null;
}

// One pending request per family; asking again just updates its note.
async function requestWithdrawal({ member, accountId, note }) {
  const familyId = member.family_id;
  const text = String(note || '').trim() || null;
  const existing = await pendingForFamily(familyId);
  if (existing) {
    await db.prepare('UPDATE coop_withdrawals SET note = COALESCE(?, note) WHERE id = ?').run(text, existing.id);
    return existing.id;
  }
  const row = await db
    .prepare('INSERT INTO coop_withdrawals (family_id, member_id, account_id, note) VALUES (?, ?, ?, ?) RETURNING id')
    .get(familyId, member.id, accountId || null, text);
  return row.id;
}

async function familyMembers(familyId, fallbackMemberId) {
  if (familyId) return db.prepare('SELECT * FROM members WHERE family_id = ? ORDER BY is_primary_parent DESC, member_type, name').all(familyId);
  return fallbackMemberId ? db.prepare('SELECT * FROM members WHERE id = ?').all(fallbackMemberId) : [];
}

function decorate(r) {
  const asked = easternStamp(r.created_at);
  const decided = r.decided_at ? easternStamp(r.decided_at) : null;
  return {
    ...r,
    familyLabel: r.family_name ? `${r.family_name} Family` : r.member_name || 'Unknown family',
    requestedLabel: `${asked.dateLabel} · ${asked.timeLabel}`,
    decidedLabel: decided ? `${decided.dateLabel} · ${decided.timeLabel}` : null,
    removed: r.removed_json ? JSON.parse(r.removed_json) : null,
  };
}

const SELECT = `SELECT w.*, f.name AS family_name, m.name AS member_name
  FROM coop_withdrawals w LEFT JOIN families f ON f.id = w.family_id LEFT JOIN members m ON m.id = w.member_id`;

// Pending first, then newest.
async function listWithdrawals() {
  const rows = await db.prepare(`${SELECT} ORDER BY CASE w.status WHEN 'pending' THEN 0 ELSE 1 END, w.created_at DESC, w.id DESC`).all();
  return rows.map(decorate);
}

async function getWithdrawal(id) {
  const r = await db.prepare(`${SELECT} WHERE w.id = ?`).get(id);
  return r ? decorate(r) : null;
}

async function pendingCount() {
  return Number((await db.prepare("SELECT COUNT(*) AS n FROM coop_withdrawals WHERE status = 'pending'").get()).n);
}

// Takes the whole family out of co-op classes: students out of every
// class (their registrations cancelled), parents/students off every
// teacher and assistant spot, and everyone off the floater lists and
// assignments, setup/cleanup teams and task assignments, permanent jobs
// and substitute spots, and the auto-built class/day rosters. Returns a
// summary of what was removed.
async function withdrawFamily(familyId, fallbackMemberId) {
  const members = await familyMembers(familyId, fallbackMemberId);
  const ids = members.map((m) => m.id);
  const removed = { classes: [], staff: [], lists: 0 };
  if (!ids.length) return removed;
  const ph = ids.map(() => '?').join(',');
  const days = new Set();

  const enrolled = await db
    .prepare(`SELECT e.class_id, e.student_id, c.class_name, c.day FROM class_enrollments e JOIN classes c ON c.id = e.class_id WHERE e.student_id IN (${ph})`)
    .all(...ids);
  const byClass = new Map();
  for (const e of enrolled) {
    if (!byClass.has(e.class_id)) byClass.set(e.class_id, e);
    removed.classes.push(`${members.find((m) => m.id === e.student_id).name}: ${e.class_name}`);
  }
  for (const [classId, e] of byClass) {
    const remaining = (await db.prepare('SELECT student_id FROM class_enrollments WHERE class_id = ?').all(classId)).map((r) => r.student_id).filter((sid) => !ids.includes(sid));
    await setEnrollment(classId, remaining, { skipSync: true });
    days.add(e.day);
  }
  await db.prepare(`UPDATE class_registrations SET status = 'cancelled' WHERE student_id IN (${ph}) AND status <> 'cancelled'`).run(...ids);

  const staff = await db
    .prepare(`SELECT s.class_id, s.member_id, s.role, c.class_name, c.day FROM class_staff s JOIN classes c ON c.id = s.class_id WHERE s.member_id IN (${ph})`)
    .all(...ids);
  for (const s of staff) {
    await removeStaff(s.class_id, s.member_id);
    removed.staff.push(`${members.find((m) => m.id === s.member_id).name}: ${s.role === 'assistant' ? 'Assistant' : 'Teacher'}, ${s.class_name}`);
    days.add(s.day);
  }

  const today = todayISO();
  const del = async (sql, ...params) => {
    const info = await db.prepare(sql).run(...params);
    removed.lists += Number(info.changes) || 0;
  };
  await del(`DELETE FROM volunteer_members WHERE member_id IN (${ph})`, ...ids);
  await del(`DELETE FROM volunteer_assignments WHERE member_id IN (${ph}) AND session_date >= ?`, ...ids, today);
  await del(`DELETE FROM setup_team_members WHERE member_id IN (${ph})`, ...ids);
  await del(`DELETE FROM setup_task_assignments WHERE member_id IN (${ph}) AND session_date >= ?`, ...ids, today);
  await del(`DELETE FROM permanent_job_floaters WHERE member_id IN (${ph})`, ...ids);
  await del(`DELETE FROM substitute_assignments WHERE member_id IN (${ph})`, ...ids);
  await db
    .prepare(`DELETE FROM roster_members WHERE member_id IN (${ph}) AND roster_id IN (SELECT id FROM rosters WHERE category IN ('Class Schedule', 'Class Roster'))`)
    .run(...ids);

  for (const day of days) {
    await syncDayMemberRosters(day);
    await syncMemberSchedulesForDay(day);
  }
  return removed;
}

async function confirmWithdrawal(id, decidedBy) {
  const w = await getWithdrawal(id);
  if (!w || w.status !== 'pending') return null;
  const removed = await withdrawFamily(w.family_id, w.member_id);
  await db
    .prepare("UPDATE coop_withdrawals SET status = 'confirmed', removed_json = ?, decided_by = ?, decided_at = now_text() WHERE id = ?")
    .run(JSON.stringify(removed), decidedBy || null, id);
  return removed;
}

async function rejectWithdrawal(id, decidedBy) {
  await db.prepare("UPDATE coop_withdrawals SET status = 'rejected', decided_by = ?, decided_at = now_text() WHERE id = ? AND status = 'pending'").run(decidedBy || null, id);
}

module.exports = {
  familyIdForMember,
  pendingForFamily,
  requestWithdrawal,
  familyMembers,
  listWithdrawals,
  getWithdrawal,
  pendingCount,
  withdrawFamily,
  confirmWithdrawal,
  rejectWithdrawal,
};
