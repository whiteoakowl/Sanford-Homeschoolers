// A real request: "All printing should allow you to filter by family name,
// semester, day." Every member-based bulk print picker on the Design/Print
// hub (Co-op Admin's /admin/design and Main Admin's /main-admin/name-tags)
// filters client-side (public/js/design-print-hub.js's wireFilterPopup)
// against per-row data attributes - this works out, per member, which
// semesters and days they're in: enrolled in (class_enrollments) or
// staffing (class_staff) a class on that day / in that semester. Semester
// values match utils/qrSheetPages.js's qrPickerFilterOptions ('none' for a
// class with no semester), so the same Semester/Day option lists serve the
// class QR picker and the member pickers alike.
const db = require('../db');

async function memberClassFacets() {
  const rows = await db
    .prepare(
      `SELECT x.member_id AS "memberId", c.semester_id AS "semesterId", c.day AS day
       FROM (
         SELECT student_id AS member_id, class_id FROM class_enrollments
         UNION
         SELECT member_id, class_id FROM class_staff
       ) x
       JOIN classes c ON c.id = x.class_id`
    )
    .all();
  const byMember = new Map();
  for (const r of rows) {
    if (!byMember.has(r.memberId)) byMember.set(r.memberId, { semesters: new Set(), days: new Set() });
    const facet = byMember.get(r.memberId);
    facet.semesters.add(r.semesterId != null ? String(r.semesterId) : 'none');
    if (r.day) facet.days.add(r.day);
  }
  return byMember;
}

// Space-separated lists, ready for data-semesters / data-days.
function facetAttrs(facets, memberId) {
  const facet = facets.get(memberId);
  return {
    filterSemesters: facet ? [...facet.semesters].join(' ') : '',
    filterDays: facet ? [...facet.days].join(' ') : '',
  };
}

// Adds filterSemesters/filterDays to every member row (in place copy).
async function withClassFacets(members) {
  const facets = await memberClassFacets();
  return members.map((m) => ({ ...m, ...facetAttrs(facets, m.id) }));
}

module.exports = { memberClassFacets, facetAttrs, withClassFacets };
