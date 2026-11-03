const db = require('../db');
const {
  familyAttendanceWindowsForDay,
  liveMemberScheduleRowsForDay,
  minutesToClockLabelLocal,
  listActiveClassDays,
  hoursForDay,
  parseClockMinutesLocal,
} = require('./classSchedule');
const { CLASS_DAY_ORDER } = require('./classDays');
const { byLastName } = require('./members');
const { toCsvRow } = require('./spreadsheet');

const CLASS_NUMBERS = [1, 2, 3, 4];

// Always returns exactly 4 rows (class_number 1-4) for a day, filling any
// missing class number with a blank placeholder row so the UI/print layout
// never has to special-case "fewer than 4 classes".
function fourRows(rows) {
  const byNumber = {};
  rows.forEach((r) => { byNumber[r.class_number] = r; });
  return CLASS_NUMBERS.map((n) => byNumber[n] || { class_number: n, time: '', class_name: '', room: '', teacher: '' });
}

// A single member's full schedule, one entry per active day (Day
// Settings - "Full 7 day expansion..." widened this from a fixed Monday +
// Wednesday pair), computed live (see liveMemberScheduleRowsForDay's own
// comment for why - every "member schedule" display surface funnels
// through this one function or scheduleList below, so fixing it here
// fixes all of them at once, with no separate "did someone resync" step
// to go stale). Fine to call once per member for a single lookup (the
// member profile's Schedule popup, a family's few members); a caller
// iterating over many members at once should use scheduleList instead,
// which computes each day's live rows ONCE and reuses them, rather than
// recomputing the whole day per member. Returns { byDay: { [day]:
// fourRows }, activeDays, lastUpdated } - byDay rather than schedule, so a
// caller naming its own result `schedule` (most do) doesn't end up with
// the confusingly doubled-up schedule.schedule.
async function getMemberSchedule(memberId) {
  const activeDays = await listActiveClassDays();
  const rowsByDay = await Promise.all(activeDays.map((d) => liveMemberScheduleRowsForDay(d)));
  const byDay = {};
  activeDays.forEach((d, i) => { byDay[d] = fourRows(Object.values(rowsByDay[i][memberId] || {})); });
  return { byDay, activeDays, lastUpdated: null };
}

// Batch version of getMemberSchedule for an arbitrary list of member ids -
// not necessarily "every active member" the way scheduleList's own
// per-member computation is, so a bulk print flow with its own specific
// selection (Design/Print's Name Tags + Schedule Cards, Front & Back
// Duplex, and the per-member Cards dialog - see utils/cardPairs.js) can
// still compute each day's live schedule ONCE regardless of how many
// members are in that selection, instead of once per member. A real bug
// report: printing ~800 cards timed out - the exact same severe N+1 shape
// routes/admin-schedule.js's own print-cards route was already fixed for
// (see its own comment), just never applied to cardPairs.js. Returns
// { [memberId]: { [day]: fourRows } }.
async function schedulesForMembers(memberIds) {
  const activeDays = await listActiveClassDays();
  const rowsByDay = await Promise.all(activeDays.map((d) => liveMemberScheduleRowsForDay(d)));
  const result = {};
  for (const memberId of memberIds) {
    const schedule = {};
    activeDays.forEach((d, i) => { schedule[d] = fourRows(Object.values(rowsByDay[i][memberId] || {})); });
    result[memberId] = schedule;
  }
  return result;
}

function rowIsBlank(row) {
  return !row.time && !row.class_name && !row.room && !row.teacher;
}

// Parses a single "9:00 AM" / "1:15 PM" clock string into minutes-since-
// midnight for comparison. Returns null if it doesn't match (freeform
// admin-typed text isn't guaranteed to parse). Tolerates an optional
// ":SS" seconds component (discarded, never needed at minute
// resolution) - "10:00:00 AM" is exactly what a spreadsheet cell
// formatted as Excel's h:mm:ss AM/PM shows once utils/spreadsheetWorker.js
// reads its formatted text instead of a raw serial (see that file's own
// comment); without this, that real, common spreadsheet format would
// still fail to parse even after that fix.
function parseClockMinutes(raw) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|am|pm)?$/.exec((raw || '').trim());
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const period = m[3] ? m[3].toUpperCase() : null;
  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  return hour * 60 + minute;
}

// Splits a "9:00 - 9:45 AM" class time into its start/end pieces. If only
// the end has an AM/PM suffix, it's borrowed onto the start (same
// assumption public/js/name-tag-render-core.js makes for schedule cards -
// both halves of a class period are the same half of the day).
function splitTimeRange(raw) {
  const value = (raw || '').trim();
  const dashIndex = value.indexOf('-');
  if (dashIndex === -1) return { startRaw: value, endRaw: value };
  const start = value.slice(0, dashIndex).trim();
  let end = value.slice(dashIndex + 1).trim();
  const endAmPm = /(AM|PM|am|pm)\s*$/.exec(end);
  let startRaw = start;
  if (endAmPm && !/(AM|PM|am|pm)\s*$/.test(start)) startRaw += ' ' + endAmPm[1].toUpperCase();
  return { startRaw, endRaw: end };
}

// A family's earliest class start and latest class end - used to auto-fill
// Arrival/Departure on the roster view instead of requiring an admin to
// type them in by hand. Computed LIVE from current class enrollment/
// staffing/floater data (utils/classSchedule.js's
// familyAttendanceWindowsForDay) every time this is called, rather than
// read back from the separately-cached member_schedules table - that
// table only gets rebuilt when enrollment/staffing/floater assignments
// actually change, so a family whose schedule hasn't been touched since a
// fix to this computation landed would otherwise keep showing whatever
// was cached under the old logic. `day` scopes this to one roster's own
// day, matching that day's roster to that day's own schedule; omit it (or
// pass a day that isn't currently active) to fall back to every active
// day combined. Returns null for either half if nothing on the schedule
// resolves to a real time.
async function arrivalDepartureLabels(memberId, day) {
  const activeDays = await listActiveClassDays();
  const days = activeDays.includes(day) ? [day] : activeDays;
  let earliest = null;
  let latest = null;
  for (const d of days) {
    const window = (await familyAttendanceWindowsForDay(d))[memberId];
    if (!window) continue;
    if (earliest == null || window.start < earliest) earliest = window.start;
    if (latest == null || window.end > latest) latest = window.end;
  }
  return {
    arrival: earliest != null ? minutesToClockLabelLocal(earliest) : null,
    departure: latest != null ? minutesToClockLabelLocal(latest) : null,
  };
}

// Batch version of arrivalDepartureLabels for a whole roster's worth of
// members at once - computes familyAttendanceWindowsForDay(day) exactly
// ONCE and reuses it for every member, instead of a caller looping
// arrivalDepartureLabels(memberId, day) per member, which redundantly
// re-ran that same full-day computation (classes, enrollments, staffing,
// and every floater section's membership) from scratch for every single
// row. That N+1 was invisible against PGlite's local, in-process test
// data but made a real Postgres-backed roster with hundreds of members
// severely slow (reported live: the Attendance page became unresponsive).
// Only handles a single real day ('monday' or 'wednesday') - unlike
// arrivalDepartureLabels, there's no "combine both days" fallback, since
// every roster's own schedule_day is always one of those two; callers
// with anything else should fall back to arrivalDepartureLabels per
// member instead. Returns { [memberId]: { arrival, departure } }.
async function arrivalDepartureLabelsForMembers(memberIds, day) {
  const windowByMember = await familyAttendanceWindowsForDay(day);
  const result = {};
  for (const memberId of memberIds) {
    const window = windowByMember[memberId];
    result[memberId] = {
      arrival: window ? minutesToClockLabelLocal(window.start) : null,
      departure: window ? minutesToClockLabelLocal(window.end) : null,
    };
  }
  return result;
}

// 'none' - no classes at all. 'partial' - some classes filled in, but not
// every active day's 4 slots. 'complete' - every slot filled.
function scheduleStatus(scheduleByDay) {
  const all = Object.values(scheduleByDay).flat();
  const filled = all.filter((r) => !rowIsBlank(r));
  if (filled.length === 0) return 'none';
  if (filled.length === all.length) return 'complete';
  return 'partial';
}

const STATUS_LABELS = { none: 'No Schedule', partial: 'Incomplete', complete: 'Complete' };

// One row per active student, joined with their schedule summary, for the
// Class Schedules table. Filters are all optional/AND-combined.
async function scheduleList(filters) {
  filters = filters || {};
  const members = await scheduleMembers(filters);

  // Computed once for the whole filtered list, not once per member -
  // getMemberSchedule's own per-member version would otherwise redo each
  // day's full live computation (every class/enrollment/staffing/floater
  // row) once per member, the same severe N+1 shape already fixed once
  // for Arrival/Departure (see arrivalDepartureLabelsForMembers's own
  // comment) - this page can list every active member at once.
  const activeDays = await listActiveClassDays();
  const rowsByDay = await Promise.all(activeDays.map((d) => liveMemberScheduleRowsForDay(d)));
  let rows = members.map((m) => {
    const byDay = {};
    activeDays.forEach((d, i) => { byDay[d] = fourRows(Object.values(rowsByDay[i][m.id] || {})); });
    return { member: m, byDay, activeDays, lastUpdated: null, status: scheduleStatus(byDay) };
  });

  if (activeDays.includes(filters.day)) {
    rows = rows.filter((r) => r.byDay[filters.day].some((c) => !rowIsBlank(c)));
  }
  if (filters.teacher) {
    rows = rows.filter((r) => Object.values(r.byDay).flat().some((c) => c.teacher === filters.teacher));
  }
  if (filters.room) {
    rows = rows.filter((r) => Object.values(r.byDay).flat().some((c) => c.room === filters.room));
  }
  if (filters.className) {
    rows = rows.filter((r) => Object.values(r.byDay).flat().some((c) => c.class_name === filters.className));
  }
  if (filters.status) {
    rows = rows.filter((r) => r.status === filters.status);
  }

  return rows;
}

// Just the member-level half of scheduleList's filters (search/grade/
// roster/member/family/member type) - every active member matching
// them, by last name, without computing anyone's schedule. The Member
// Schedules list/Print/PDF/Export only ever filter on these, then hand
// the result to memberScheduleTables below.
async function scheduleMembers(filters) {
  filters = filters || {};
  let members = (await db.prepare('SELECT * FROM members WHERE active = 1').all()).sort(byLastName);

  if (filters.search) {
    const q = filters.search.toLowerCase();
    members = members.filter((m) => m.name.toLowerCase().includes(q));
  }
  if (filters.grade) {
    members = members.filter((m) => (m.grade_level || '') === filters.grade);
  }
  if (filters.rosterId) {
    const memberIds = new Set(
      (await db.prepare('SELECT member_id FROM roster_members WHERE roster_id = ?').all(filters.rosterId)).map((r) => r.member_id)
    );
    members = members.filter((m) => memberIds.has(m.id));
  }
  if (filters.memberId) {
    members = members.filter((m) => m.id === filters.memberId);
  }
  if (filters.familyId) {
    members = members.filter((m) => m.family_id === filters.familyId);
  }
  if (filters.memberType) {
    // Accepts either a single type or an array - the Schedules page's
    // Parent tab passes ['parent', 'admin'] so admin/leader members show
    // up there too (a real bug report: "when viewing parent schedules
    // under parent tab it won't show admins" - wherever there's a parent
    // filter site-wide, admins should still be included).
    const types = Array.isArray(filters.memberType) ? filters.memberType : [filters.memberType];
    members = members.filter((m) => types.includes(m.member_type));
  }
  return members;
}

// --- Member schedule table (views/partials/member-schedule-table.ejs) ---
// A real request: "Each member's schedule should look like this image" -
// one bordered, zebra-striped table per member (Class Details / Location/
// Instructor / Price), grouped under a small subheading per role:
// "Signed Up" (enrolled as a student), "Teaching", "Assisting", and
// "Floater" (the Floater Assignments hours liveMemberScheduleRowsForDay
// already fills in). Unlike the fixed 4-slot byDay shape above, this is a
// flat, sorted list of every real class the member is on - so two classes
// sharing an hour slot both show up here.

const DAY_SHORT = { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' };
// AP-style month abbreviations - the reference screenshot's own
// "Aug. 24, 2026 - Nov. 16, 2026".
const MONTH_SHORT = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
const SCHEDULE_GROUPS = [
  { key: 'student', label: 'Signed Up' },
  { key: 'teacher', label: 'Teaching' },
  { key: 'assistant', label: 'Assisting' },
  { key: 'floater', label: 'Floater' },
];
const GROUP_LABELS = Object.fromEntries(SCHEDULE_GROUPS.map((g) => [g.key, g.label]));

function formatScheduleDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  return `${MONTH_SHORT[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}, ${m[1]}`;
}

function dateRangeLabel(startDate, endDate) {
  const start = formatScheduleDate(startDate);
  const end = formatScheduleDate(endDate);
  if (start && end) return `${start} – ${end}`;
  if (start) return `Starts ${start}`;
  if (end) return `Ends ${end}`;
  return '';
}

function formatPrice(priceCents) {
  if (priceCents == null || priceCents === '') return '';
  const cents = Number(priceCents);
  if (!Number.isFinite(cents)) return '';
  return `$${(cents / 100).toFixed(2)}`;
}

function rangeLabel(startMin, endMin) {
  if (startMin == null) return '';
  return endMin != null ? `${minutesToClockLabelLocal(startMin)} – ${minutesToClockLabelLocal(endMin)}` : minutesToClockLabelLocal(startMin);
}

function compareEntries(a, b) {
  // Semester start date first (a class with no date at all sorts last),
  // then calendar day, then start time - Mon classes before Wed, earliest
  // first, same as the reference screenshot.
  const aDate = a.startDate || '9999-99-99';
  const bDate = b.startDate || '9999-99-99';
  if (aDate !== bDate) return aDate < bDate ? -1 : 1;
  if (a.day !== b.day) return (CLASS_DAY_ORDER[a.day] ?? 9) - (CLASS_DAY_ORDER[b.day] ?? 9);
  const aMin = a.startMin == null ? 24 * 60 : a.startMin;
  const bMin = b.startMin == null ? 24 * 60 : b.startMin;
  if (aMin !== bMin) return aMin - bMin;
  return (a.title || '').localeCompare(b.title || '');
}

// Batched for any number of members (the Member Schedules list can show
// every active member at once) - a fixed handful of queries no matter
// how many members, plus one liveMemberScheduleRowsForDay per active day
// for floater hours (the same live computation every other schedule
// surface already runs). Returns { [memberId]: entry[] }, each list
// already sorted (see compareEntries).
//
// Class dates: the class's own Start/End Date (its Details tab) when set,
// otherwise its semester+day Class Schedule Grid's own Start/End Date
// (class_schedules - the "Fall 2026 - Monday" combo it belongs to),
// otherwise that day's untagged grid's dates. Time: the class's own
// start/end time, falling back to its hour block's (effectiveClassRange's
// same rule), then the hour's raw label.
async function memberScheduleEntries(memberIds) {
  const ids = [...new Set((memberIds || []).filter((id) => id != null).map(Number))];
  const result = {};
  ids.forEach((id) => { result[id] = []; });
  if (ids.length === 0) return result;

  const activeDays = await listActiveClassDays();
  if (activeDays.length === 0) return result;
  const dayPh = activeDays.map(() => '?').join(',');
  const classes = await db
    .prepare(`SELECT c.*, s.title AS semester_title FROM classes c LEFT JOIN semesters s ON s.id = c.semester_id WHERE c.day IN (${dayPh})`)
    .all(...activeDays);
  const classById = {};
  classes.forEach((c) => { classById[c.id] = c; });

  const grids = await db.prepare('SELECT day_of_week, semester_id, start_date, end_date FROM class_schedules').all();
  const sameSemester = (a, b) => (a == null ? null : Number(a)) === (b == null ? null : Number(b));
  const gridFor = (day, semesterId) =>
    grids.find((g) => g.day_of_week === day && sameSemester(g.semester_id, semesterId)) ||
    grids.find((g) => g.day_of_week === day && g.semester_id == null);

  const hoursCache = {};
  async function hourFor(day, semesterId, position) {
    const key = `${day}|${semesterId == null ? '' : semesterId}`;
    if (!hoursCache[key]) hoursCache[key] = await hoursForDay(day, semesterId == null ? null : semesterId);
    return hoursCache[key].find((h) => Number(h.position) === Number(position)) || null;
  }

  const idPh = ids.map(() => '?').join(',');
  const enrollments = classes.length
    ? await db
      .prepare(`SELECT ce.class_id, ce.student_id AS member_id FROM class_enrollments ce JOIN members m ON m.id = ce.student_id WHERE ce.student_id IN (${idPh}) AND m.active = 1`)
      .all(...ids)
    : [];
  // Every class's staff (not just the requested members' own rows) - the
  // Location/Instructor column needs each class's teacher(s).
  const staffRows = classes.length
    ? await db
      .prepare('SELECT cs.class_id, cs.member_id, cs.role, m.name, m.email, m.phone FROM class_staff cs JOIN members m ON m.id = cs.member_id WHERE m.active = 1')
      .all()
    : [];
  const teachersByClass = {};
  staffRows
    .filter((r) => r.role === 'teacher')
    .sort(byLastName)
    .forEach((r) => {
      if (!teachersByClass[r.class_id]) teachersByClass[r.class_id] = [];
      teachersByClass[r.class_id].push({ id: r.member_id, name: r.name, email: r.email || '', phone: r.phone || '' });
    });

  const idSet = new Set(ids);
  const links = [
    ...enrollments.map((r) => ({ classId: r.class_id, memberId: Number(r.member_id), role: 'student' })),
    ...staffRows
      .filter((r) => idSet.has(Number(r.member_id)))
      .map((r) => ({ classId: r.class_id, memberId: Number(r.member_id), role: r.role === 'teacher' ? 'teacher' : 'assistant' })),
  ];

  for (const link of links) {
    const cls = classById[link.classId];
    if (!cls || !result[link.memberId]) continue;
    const hour = await hourFor(cls.day, cls.semester_id, cls.hour_position);
    const ownStart = parseClockMinutesLocal(cls.start_time);
    const ownEnd = parseClockMinutesLocal(cls.end_time);
    const startMin = ownStart != null ? ownStart : hour ? parseClockMinutesLocal(hour.start_time) : null;
    const endMin = ownEnd != null ? ownEnd : hour ? parseClockMinutesLocal(hour.end_time) : null;
    const grid = gridFor(cls.day, cls.semester_id);
    const startDate = cls.start_date || (grid && grid.start_date) || '';
    const endDate = cls.end_date || (grid && grid.end_date) || '';
    result[link.memberId].push({
      kind: link.role,
      roleLabel: GROUP_LABELS[link.role],
      classId: cls.id,
      title: cls.class_name,
      semesterTitle: cls.semester_title || '',
      day: cls.day,
      dayShort: DAY_SHORT[cls.day] || cls.day,
      startMin,
      endMin,
      timeLabel: rangeLabel(startMin, endMin) || (hour && hour.label) || '',
      startDate,
      endDate,
      dateRangeLabel: dateRangeLabel(startDate, endDate),
      room: cls.room || '',
      instructors: teachersByClass[cls.id] || [],
      // The class fee only applies to the student signed up for it - a
      // teacher/assistant isn't charged for the class they staff.
      priceLabel: link.role === 'student' ? formatPrice(cls.price_cents) : '',
    });
  }

  // Floater hours (Floater Assignments) - the same live rows every other
  // schedule surface shows as "Floater", matched by that row's own shape
  // (no room/teacher) so a real class that happens to be named Floater
  // still shows up above as a class, never twice.
  const rowsByDay = await Promise.all(activeDays.map((d) => liveMemberScheduleRowsForDay(d)));
  activeDays.forEach((day, i) => {
    const grid = gridFor(day, null);
    for (const id of ids) {
      Object.values(rowsByDay[i][id] || {})
        .filter((r) => r.class_name === 'Floater' && !r.room && !r.teacher)
        .forEach((r) => {
          const parts = String(r.time || '').split(' - ');
          const startMin = parseClockMinutesLocal(parts[0]);
          const endMin = parts[1] ? parseClockMinutesLocal(parts[1]) : null;
          const startDate = (grid && grid.start_date) || '';
          const endDate = (grid && grid.end_date) || '';
          result[id].push({
            kind: 'floater',
            roleLabel: GROUP_LABELS.floater,
            classId: null,
            title: 'Floater',
            semesterTitle: '',
            day,
            dayShort: DAY_SHORT[day] || day,
            startMin,
            endMin,
            timeLabel: rangeLabel(startMin, endMin) || r.time || '',
            startDate,
            endDate,
            dateRangeLabel: dateRangeLabel(startDate, endDate),
            room: '',
            instructors: [],
            priceLabel: '',
          });
        });
    }
  });

  ids.forEach((id) => result[id].sort(compareEntries));
  return result;
}

// [{ member, groups: [{ key, label, entries }], entryCount }] - exactly
// what views/partials/member-schedule-table.ejs renders, one per member
// in the order given.
async function memberScheduleTables(members) {
  const entriesById = await memberScheduleEntries(members.map((m) => m.id));
  return members.map((member) => {
    const entries = entriesById[Number(member.id)] || [];
    const groups = SCHEDULE_GROUPS.map((g) => ({ key: g.key, label: g.label, entries: entries.filter((e) => e.kind === g.key) })).filter(
      (g) => g.entries.length > 0
    );
    return { member, groups, entryCount: entries.length };
  });
}

const SCHEDULE_CSV_HEADER = ['Member Name', 'Role', 'Class', 'Semester', 'Start Date', 'End Date', 'Day', 'Time', 'Room', 'Instructor', 'Instructor Email', 'Instructor Phone', 'Price'];

// CSV lines (header first) for the same tables memberScheduleTables
// builds - same rows, same order, one line per class.
function memberScheduleCsvLines(tables) {
  const lines = [toCsvRow(SCHEDULE_CSV_HEADER)];
  tables.forEach((t) => {
    t.groups.forEach((g) => {
      g.entries.forEach((e) => {
        lines.push(
          toCsvRow([
            t.member.name,
            e.roleLabel,
            e.title,
            e.semesterTitle,
            e.startDate,
            e.endDate,
            e.dayShort,
            e.timeLabel,
            e.room,
            e.instructors.map((x) => x.name).join('; '),
            e.instructors.map((x) => x.email).filter(Boolean).join('; '),
            e.instructors.map((x) => x.phone).filter(Boolean).join('; '),
            e.priceLabel,
          ])
        );
      });
    });
  });
  return lines;
}

module.exports = {
  memberScheduleEntries,
  memberScheduleTables,
  memberScheduleCsvLines,
  formatScheduleDate,
  CLASS_NUMBERS,
  STATUS_LABELS,
  getMemberSchedule,
  schedulesForMembers,
  fourRows,
  rowIsBlank,
  scheduleStatus,
  scheduleList,
  scheduleMembers,
  arrivalDepartureLabels,
  arrivalDepartureLabelsForMembers,
  parseClockMinutes,
  splitTimeRange,
};
