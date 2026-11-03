// Export (CSV) / PDF / Print for every member schedule surface - Co-op
// Admin's Member Schedules list and member profile, Main Admin's member
// profile, and a member's own My Profile > Schedules tab (a real request:
// "All member schedule pages, tabs etc. Should have export, pdf and
// print icons"). Each caller does its OWN authorization and picks the
// members it's allowed to show; this module only turns that member list
// into the shared table (utils/schedule.js's memberScheduleTables) in
// the requested format, so all three outputs always match what's on
// screen.
const { memberScheduleTables, memberScheduleCsvLines } = require('./schedule');
const { sendCsv } = require('./spreadsheet');
const { renderViewToPdf } = require('./pdfRender');
const { ageFromBirthday } = require('./dates');

const PRINT_VIEW = 'admin-schedule-print';

// A real request (a family's Print Schedules): "List parents first, then
// students starting with the oldest." Stable otherwise - members keep
// the caller's own order (by last name) within each group.
function sortFamilyForPrint(members) {
  return [...members].sort((a, b) => {
    const aIsStudent = a.member_type === 'student';
    const bIsStudent = b.member_type === 'student';
    if (aIsStudent !== bIsStudent) return aIsStudent ? 1 : -1;
    if (!aIsStudent) return 0;
    const aAge = ageFromBirthday(a.birthday);
    const bAge = ageFromBirthday(b.birthday);
    if (aAge == null && bAge == null) return 0;
    if (aAge == null) return 1;
    if (bAge == null) return -1;
    return bAge - aAge;
  });
}

// format: 'csv' | 'pdf' | 'print'. extraLocals is passed to the print
// view on both the Print page and the PDF render - e.g. portalTitle for a
// portal caller, or isFullAdmin for Co-op Admin's own nav (req.app.render,
// which renderViewToPdf uses, never sees res.locals).
async function sendMemberSchedules(req, res, format, { members, filenameBase = 'member-schedules', extraLocals = {} }) {
  const tables = await memberScheduleTables(members);
  if (format === 'csv') return sendCsv(res, `${filenameBase}.csv`, memberScheduleCsvLines(tables));
  const locals = { title: 'Print Schedules', tables, ...extraLocals };
  if (format === 'print') return res.render(PRINT_VIEW, locals);
  const pdf = await renderViewToPdf(req, PRINT_VIEW, locals);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${filenameBase}.pdf"`);
  return res.send(pdf);
}

module.exports = { sendMemberSchedules, sortFamilyForPrint };
