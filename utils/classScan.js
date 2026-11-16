// Class Check In / Check Out by barcode (or exact name) for one class -
// Co-op Admin's Attendance > Class Rosters > class page
// (routes/admin-rosters.js). Same rules as the Kiosk's class check-in
// (routes/kiosk-class-checkin.js) and Co-op Teacher Portal's
// (routes/teacher-portal.js): the class must have a roster, the member
// must be on it, and the class must be in session today (the day's
// Student roster has today as a session date - a class roster borrows
// its dates from there). Unlike the Kiosk, any semester's class can be
// scanned from here - an admin opened that exact class's roster.
// Every function returns a { ok, message, ... } JSON-ready result.
const db = require('../db');
const { todayISO } = require('./dates');
const { ensureDayRoster, isClassArchived } = require('./classSchedule');
const { findMemberByBarcodeOrName } = require('./memberLookup');

async function resolveClassScan(classId, barcode) {
  const cls = await db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!cls || !cls.roster_id) return { error: { ok: false, message: 'Class not found.' } };
  if (await isClassArchived(classId)) return { error: { ok: false, message: `${cls.class_name} is in an archived semester - it's view-only.` } };

  const { member, ambiguous } = await findMemberByBarcodeOrName(barcode);
  if (ambiguous) return { error: { ok: false, message: 'More than one member has that name - please scan a barcode instead.' } };
  if (!member) return { error: { ok: false, message: 'Not recognized. Please see an attendant.' } };

  const today = todayISO();
  const studentRosterId = await ensureDayRoster(cls.day, 'student', cls.semester_id);
  const inSessionToday = await db.prepare('SELECT 1 FROM roster_dates WHERE roster_id = ? AND session_date = ?').get(studentRosterId, today);
  if (!inSessionToday) return { error: { ok: false, message: `${cls.class_name} isn't in session today.` } };

  const enrolled = await db.prepare('SELECT 1 FROM roster_members WHERE roster_id = ? AND member_id = ?').get(cls.roster_id, member.id);
  if (!enrolled) return { error: { ok: false, message: `${member.name} is not enrolled in ${cls.class_name}.` } };

  return { cls, member, today };
}

// source: the attendance.source label for who recorded it.
async function classScanCheckIn(classId, barcode, source) {
  const ctx = await resolveClassScan(classId, barcode);
  if (ctx.error) return ctx.error;
  const { cls, member, today } = ctx;
  const existing = await db.prepare('SELECT status FROM attendance WHERE member_id = ? AND roster_id = ? AND session_date = ?').get(member.id, cls.roster_id, today);
  if (existing && existing.status === 'present') {
    return { ok: true, alreadyChecked: true, name: member.name, message: `${member.name} is already checked in to ${cls.class_name}.` };
  }
  await db
    .prepare(
      `INSERT INTO attendance (member_id, roster_id, session_date, status, check_in_time, source)
       VALUES (?, ?, ?, 'present', ?, ?)
       ON CONFLICT(member_id, roster_id, session_date)
       DO UPDATE SET status = 'present', check_in_time = excluded.check_in_time, source = excluded.source, recorded_at = now_text()`
    )
    .run(member.id, cls.roster_id, today, Date.now(), source);
  return { ok: true, name: member.name, message: `Welcome, ${member.name}!` };
}

async function classScanCheckOut(classId, barcode) {
  const ctx = await resolveClassScan(classId, barcode);
  if (ctx.error) return ctx.error;
  const { cls, member, today } = ctx;
  const existing = await db.prepare('SELECT check_out_time FROM checkouts WHERE member_id = ? AND roster_id = ? AND session_date = ?').get(member.id, cls.roster_id, today);
  if (existing) {
    return { ok: true, alreadyChecked: true, name: member.name, message: `${member.name} is already checked out of ${cls.class_name}.` };
  }
  await db
    .prepare(
      `INSERT INTO checkouts (member_id, roster_id, session_date, number, check_out_time)
       VALUES (?, ?, ?, NULL, ?)
       ON CONFLICT(member_id, roster_id, session_date)
       DO UPDATE SET check_out_time = excluded.check_out_time, recorded_at = now_text()`
    )
    .run(member.id, cls.roster_id, today, Date.now());
  return { ok: true, name: member.name, message: `${member.name} checked out of ${cls.class_name}.` };
}

module.exports = { classScanCheckIn, classScanCheckOut };
