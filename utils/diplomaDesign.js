// A real request: "For all portals, diplomas creation. Diploma choices
// should look like this [four traditional high school diploma designs].
// Then text boxes below to edit the information. For signature choices
// there should be a dropdown menu for each to choose principal, teacher,
// parent, administrator etc. There should be logo options to choose from
// as well. At the bottom should have update preview which shows all of
// your changes on the diploma for view and a print button."
//
// Everything the certificate partial (views/partials/diploma-
// certificate.ejs) needs is worked out here, once, from a saved diplomas
// row (or none yet) - the designs, the seal/logo choices, the signature
// roles, each design's default wording, and the date written out in
// words - so the Parent (Family School Management), Main Admin and
// Student Portal pages all print the exact same certificate.

const DIPLOMA_DESIGNS = [
  { key: 'design1', label: 'High School Diploma - Design 1' },
  { key: 'design2', label: 'High School Diploma - Design 2' },
  { key: 'design3', label: 'High School Diploma - Design 3' },
  { key: 'design4', label: 'High School Diploma - Design 4' },
];
const DESIGN_KEYS = DIPLOMA_DESIGNS.map((d) => d.key);

// Seal / logo choices. 'school' only shows when the family has uploaded
// a logo under Family School Management > Settings.
const DIPLOMA_SEALS = [
  { key: 'gold', label: 'Gold Seal' },
  { key: 'blue', label: 'Blue Seal' },
  { key: 'star', label: 'Gold Star Seal' },
  { key: 'coop', label: 'Sanford Homeschoolers Logo' },
  { key: 'school', label: 'Our School Logo' },
  { key: 'none', label: 'No Seal' },
];
const SEAL_KEYS = DIPLOMA_SEALS.map((s) => s.key);

const SIGNATURE_ROLES = [
  'Principal',
  'Teacher',
  'Parent',
  'Guardian',
  'Administrator',
  'Superintendent',
  'Director',
  'Head of School',
  'President, Board of Education',
  'Chair, Board of Education',
];

// Each design's own wording when the family hasn't typed their own.
const DEFAULT_BODY = {
  design1: 'having satisfactorily completed all requirements for high school graduation as prescribed by this school, and is hereby awarded this',
  design2: 'has satisfactorily completed the Course of Study prescribed for graduation by this school and is awarded this',
  design3: 'who has satisfactorily completed the Academic Course of Study, and by proficiency in scholarship and integrity of character has merited graduation',
  design4: 'has satisfactorily completed the Course of Study prescribed by this school and is awarded this Diploma.',
};

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORDINAL_ONES = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
const ORDINAL_TENS = { 20: 'twentieth', 30: 'thirtieth' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function underHundred(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
}

function ordinalDay(n) {
  if (n < 20) return ORDINAL_ONES[n];
  if (n % 10 === 0) return ORDINAL_TENS[n];
  return TENS[Math.floor(n / 10)] + '-' + ORDINAL_ONES[n % 10];
}

// 2026 -> "two thousand twenty-six", 1997 -> "nineteen hundred ninety-seven"
function yearWords(y) {
  if (y >= 2000 && y < 2100) return 'two thousand' + (y % 100 ? ' ' + underHundred(y % 100) : '');
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  return underHundred(hi) + ' hundred' + (lo ? ' ' + underHundred(lo) : '');
}

function ordinalSuffix(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
}

function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

// "eighteenth day of June, two thousand twenty-six"
function dateInWords(iso) {
  const p = parseIso(iso);
  if (!p) return '';
  return `${ordinalDay(p.day)} day of ${MONTHS[p.month - 1]}, ${yearWords(p.year)}`;
}

// "June 18th, 2026"
function dateShort(iso) {
  const p = parseIso(iso);
  if (!p) return '';
  return `${MONTHS[p.month - 1]} ${p.day}${ordinalSuffix(p.day)}, ${p.year}`;
}

function normalizeDesign(template) {
  return DESIGN_KEYS.includes(template) ? template : 'design1';
}

function normalizeSeal(seal, fallback) {
  return SEAL_KEYS.includes(seal) ? seal : fallback;
}

// The saved row (or nothing yet) -> exactly what the certificate shows.
// design overrides the saved one (the builder's design-choice cards each
// render the same details in a different design).
function diplomaView(diploma, member, familySettings, design) {
  const d = diploma || {};
  const fs = familySettings || {};
  const key = normalizeDesign(design || d.template);
  const schoolLogoUrl = fs.logoUrl || null;
  const sealUrl = (seal) => (seal === 'coop' ? '/img/logo.png' : seal === 'school' ? schoolLogoUrl : null);
  const resolveSeal = (seal) => {
    const s = seal === 'school' && !schoolLogoUrl ? 'gold' : seal;
    return { key: s, url: sealUrl(s) };
  };
  const issued = d.issued_date || '';
  const signatures = [1, 2, 3]
    .map((n) => ({ name: d[`signature${n}_name`] || '', role: d[`signature${n}_title`] || '' }))
    .map((s, i) => ({ ...s, slot: i + 1, show: Boolean(s.name || s.role) }));
  const schoolName = d.school_name || fs.school_name || 'Your High School Name';
  return {
    design: key,
    schoolName,
    city: d.school_city || 'Your City',
    state: d.school_state || 'Your State',
    headerText: d.header_text || 'Board of Education',
    studentName: d.display_name || (member && member.name) || 'Student Name',
    title: d.title && d.title !== 'Diploma of Completion' ? d.title : 'Diploma',
    body: d.body_text || DEFAULT_BODY[key],
    dateWords: dateInWords(issued),
    dateShort: dateShort(issued),
    seal1: resolveSeal(normalizeSeal(d.seal1, 'gold')),
    seal2: resolveSeal(normalizeSeal(d.seal2, 'gold')),
    signatures,
  };
}

// The form's fields -> issueDiploma's arguments (shared by Parent and
// Main Admin, so both save exactly the same things).
function diplomaFieldsFromBody(body) {
  const text = (name) => String(body[name] || '').trim();
  const role = (name) => {
    const v = text(name);
    return SIGNATURE_ROLES.includes(v) ? v : '';
  };
  const bodyText = text('bodyText');
  const isDefaultBody = Object.values(DEFAULT_BODY).includes(bodyText);
  return {
    title: text('title') || 'Diploma',
    issuedDate: /^\d{4}-\d{2}-\d{2}$/.test(text('issuedDate')) ? text('issuedDate') : null,
    bodyText: isDefaultBody ? '' : bodyText,
    template: normalizeDesign(text('template')),
    displayName: text('displayName'),
    schoolName: text('schoolName'),
    schoolCity: text('schoolCity'),
    schoolState: text('schoolState'),
    headerText: text('headerText'),
    seal1: normalizeSeal(text('seal1'), 'gold'),
    seal2: normalizeSeal(text('seal2'), 'gold'),
    signature1Name: text('signature1Name'),
    signature1Title: role('signature1Title'),
    signature2Name: text('signature2Name'),
    signature2Title: role('signature2Title'),
    signature3Name: text('signature3Name'),
    signature3Title: role('signature3Title'),
  };
}

module.exports = {
  DIPLOMA_DESIGNS,
  DIPLOMA_SEALS,
  SIGNATURE_ROLES,
  DEFAULT_BODY,
  dateInWords,
  dateShort,
  diplomaView,
  diplomaFieldsFromBody,
};
