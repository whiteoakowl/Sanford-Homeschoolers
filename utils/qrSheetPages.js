// A real bug report (photos of a printed Room 5 Wednesday sheet with QR
// cards overlapping each other and the next page's header): the class
// QR print sheet put every class a room has that day on ONE fixed 2x2,
// 8.5x11in page, assuming hour_position capped a room at 4 classes per
// day - but per-semester schedules can put more than 4 in one room/day,
// and the extras overflowed onto the next printed page. Splits any
// (day, room) group into pages of at most 4, each keeping the same
// room/day header.
const QR_CELLS_PER_PAGE = 4;

function chunkQrPages(pages) {
  const out = [];
  for (const page of pages) {
    if (page.classes.length <= QR_CELLS_PER_PAGE) {
      out.push(page);
      continue;
    }
    for (let i = 0; i < page.classes.length; i += QR_CELLS_PER_PAGE) {
      out.push({ ...page, classes: page.classes.slice(i, i + QR_CELLS_PER_PAGE) });
    }
  }
  return out;
}

// A real request: "When printing qr codes for class check in there needs
// to be a semester dropdown added to the filter." The picker's Filter
// popup offers only the semesters and days its classes actually use, days
// in calendar order (not a hardcoded Monday/Wednesday list).
const { CLASS_DAYS } = require('./classDays');
const { CLASS_DAY_LABELS_FULL } = require('./classSchedule');

function qrPickerFilterOptions(classes, semesters) {
  const usedSemesterIds = new Set(classes.map((c) => c.semester_id).filter((id) => id != null));
  const semesterOptions = semesters.filter((s) => usedSemesterIds.has(s.id)).map((s) => ({ value: String(s.id), label: s.title }));
  if (classes.some((c) => c.semester_id == null)) semesterOptions.push({ value: 'none', label: 'No semester' });
  const usedDays = new Set(classes.map((c) => c.day));
  const dayOptions = CLASS_DAYS.filter((d) => usedDays.has(d)).map((d) => ({ value: d, label: CLASS_DAY_LABELS_FULL[d] }));
  const semesterTitles = Object.fromEntries(semesters.map((s) => [s.id, s.title]));
  return { semesterOptions, dayOptions, semesterTitles };
}

module.exports = { chunkQrPages, qrPickerFilterOptions, QR_CELLS_PER_PAGE };
