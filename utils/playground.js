// Playground Check-In: an open drop-in log, not a fixed roster - "anybody
// can check in and out of the playground. it doesn't have a set roster."
// Reuses the same rosters/attendance/checkouts tables every other roster
// on this site uses (one roster per (day, hour_position), lazily created
// the same way a class's own roster is - see ensureClassRoster in
// utils/classSchedule.js), so every existing table/index/constraint
// already covers it. The one real difference: "who's on it" is never a
// fixed roster_members list - it's simply whoever has an attendance/
// checkouts row for that roster+date, since anybody can walk up and check
// in with no enrollment step at all (see playgroundLogForDate below).
const db = require('../db');
const { CLASS_DAY_LABELS_FULL, hoursForDay, listActiveClassDays, listSemesters, ensureDayRoster, HOUR_POSITIONS } = require('./classSchedule');
const { getActiveKioskSemesterId } = require('./kioskSettings');
const { rosterDates } = require('./rosterGrid');
const { byLastName } = require('./members');
const { formatTime, formatClockTime, formatDateLabel, formatDateLong, isValidISODate, todayISO, weekdayOf } = require('./dates');

// The same per-day hour label (e.g. "Hour 1", or whatever an admin has
// renamed it to on the Class Schedule page's Edit Hours dialog) every
// class under that slot already shows - playground runs alongside classes
// during the same hour blocks, so it reuses their labels rather than
// keeping a second, independent set.
async function playgroundHourLabel(day, hourPosition) {
  const hours = await hoursForDay(day);
  const hour = hours.find((h) => h.position === hourPosition);
  return hour ? hour.label : `Hour ${hourPosition}`;
}

// Creates (once) the roster backing one (day, hour) playground slot, or
// returns the existing one - same lazy-create-on-first-use shape as
// ensureClassRoster/ensureDayRoster in utils/classSchedule.js.
async function ensurePlaygroundRoster(day, hourPosition) {
  const existing = await db.prepare('SELECT roster_id FROM playground_rosters WHERE day = ? AND hour_position = ?').get(day, hourPosition);
  if (existing) {
    const roster = await db.prepare('SELECT id FROM rosters WHERE id = ?').get(existing.roster_id);
    if (roster) return existing.roster_id;
  }
  const label = await playgroundHourLabel(day, hourPosition);
  const info = await db
    .prepare('INSERT INTO rosters (name, category, schedule_day) VALUES (?, ?, ?)')
    .run(`Playground - ${CLASS_DAY_LABELS_FULL[day]} ${label}`, 'Playground', day);
  const rosterId = info.lastInsertRowid;
  await db
    .prepare(
      `INSERT INTO playground_rosters (day, hour_position, roster_id) VALUES (?, ?, ?)
       ON CONFLICT (day, hour_position) DO UPDATE SET roster_id = excluded.roster_id`
    )
    .run(day, hourPosition, rosterId);
  return rosterId;
}

// The open drop-in log for one playground roster on one date: whoever has
// an attendance and/or checkouts row for it, regardless of whether they
// were ever "enrolled" anywhere (there's nothing to enroll in) - unlike
// rosterMembers (utils/rosterGrid.js), which starts from roster_members
// and would show nobody at all here, since a playground roster never gets
// roster_members rows in the first place.
async function playgroundLogForDate(rosterId, date) {
  if (!date) return [];
  const rows = await db
    .prepare(
      `SELECT m.name AS name, a.check_in_time AS "checkInTime", c.check_out_time AS "checkOutTime"
       FROM members m
       LEFT JOIN attendance a ON a.member_id = m.id AND a.roster_id = ? AND a.session_date = ?
       LEFT JOIN checkouts c ON c.member_id = m.id AND c.roster_id = ? AND c.session_date = ?
       WHERE a.id IS NOT NULL OR c.id IS NOT NULL`
    )
    .all(rosterId, date, rosterId, date);
  return rows
    .sort(byLastName)
    .map((r) => ({
      name: r.name,
      checkInTime: r.checkInTime ? formatTime(r.checkInTime) : null,
      checkOutTime: r.checkOutTime ? formatTime(r.checkOutTime) : null,
    }));
}

// A real request: "Co-op admin portal, attendance playground check in/out.
// This sub page should be called Playground roster. On this page their
// should be a filter button that filters by semester, the day, then date.
// Page then shows the date and times and a list of those that were
// checked in under each time." Session dates come from that semester's
// own Student roster for the day (the same dates a class/playground
// slot already borrows); the hours and their times from that semester's
// own Class Schedule hours. A playground slot's check-ins are per (day,
// hour) and date, so the date alone already scopes them to the semester.
async function playgroundRosterFilterOptions() {
  const semesters = await listSemesters();
  const days = await listActiveClassDays();
  // { [semesterKey]: { [day]: [{ date, label }] } } - semesterKey '' when
  // there are no semesters at all (the site-wide active one is used).
  const keys = semesters.length ? semesters.map((s) => String(s.id)) : [''];
  const datesBySemesterDay = {};
  for (const key of keys) {
    datesBySemesterDay[key] = {};
    for (const day of days) {
      const rosterId = await ensureDayRoster(day, 'student', key === '' ? undefined : Number(key));
      datesBySemesterDay[key][day] = (await rosterDates(rosterId)).map((d) => ({ date: d, label: formatDateLabel(d) }));
    }
  }
  return {
    semesters: semesters.map((s) => ({ id: String(s.id), title: s.title })),
    days: days.map((d) => ({ day: d, label: CLASS_DAY_LABELS_FULL[d] })),
    datesBySemesterDay,
  };
}

function hourTimeLabel(hour) {
  if (!hour) return null;
  if (hour.start_time && hour.end_time) return `${formatClockTime(hour.start_time)} - ${formatClockTime(hour.end_time)}`;
  if (hour.start_time) return formatClockTime(hour.start_time);
  return null;
}

// query: { semesterId, day, date } (strings, any may be missing/invalid).
// Defaults: the Kiosk's active semester, today's weekday when it's an
// active day (else the first one), then the latest session date on or
// before today (else the last one).
async function playgroundRosterPage(query) {
  const options = await playgroundRosterFilterOptions();
  const semesterKeys = Object.keys(options.datesBySemesterDay);
  const activeSemester = await getActiveKioskSemesterId();
  const semesterId = semesterKeys.includes(String(query.semesterId || ''))
    ? String(query.semesterId || '')
    : semesterKeys.includes(String(activeSemester)) ? String(activeSemester) : semesterKeys[0];
  const dayKeys = options.days.map((d) => d.day);
  const today = todayISO();
  const todayDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][weekdayOf(today)];
  const day = dayKeys.includes(query.day) ? query.day : dayKeys.includes(todayDay) ? todayDay : dayKeys[0] || null;
  const dates = day ? options.datesBySemesterDay[semesterId][day] || [] : [];
  const dateList = dates.map((d) => d.date);
  const date = isValidISODate(query.date) && dateList.includes(query.date)
    ? query.date
    : [...dateList].reverse().find((d) => d <= today) || dateList[dateList.length - 1] || null;

  const hours = [];
  if (day) {
    const semesterArg = semesterId === '' ? undefined : Number(semesterId);
    const hourRows = await hoursForDay(day, semesterArg);
    const positions = hourRows.length ? hourRows.map((h) => h.position) : HOUR_POSITIONS;
    for (const position of positions) {
      const row = hourRows.find((h) => h.position === position);
      const slot = await db.prepare('SELECT roster_id FROM playground_rosters WHERE day = ? AND hour_position = ?').get(day, position);
      const log = date && slot ? await playgroundLogForDate(slot.roster_id, date) : [];
      hours.push({ position, label: (row && row.label) || `Hour ${position}`, timeLabel: hourTimeLabel(row), log });
    }
  }
  const semester = options.semesters.find((s) => s.id === semesterId);
  return {
    filterOptions: options,
    semesterId,
    semesterTitle: semester ? semester.title : null,
    day,
    dayLabel: day ? CLASS_DAY_LABELS_FULL[day] : null,
    date,
    dateLongLabel: date ? formatDateLong(date) : null,
    hours,
    totalCheckedIn: hours.reduce((n, h) => n + h.log.length, 0),
  };
}

module.exports = { ensurePlaygroundRoster, playgroundHourLabel, playgroundLogForDate, playgroundRosterPage };
