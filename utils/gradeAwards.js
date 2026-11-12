// A real request: "Under diplomas/transcripts tab on all portals. Add a
// subpage called grade level awards. Add a creator for each grade level.
// Be able to add name and parent names or leave blank for handwritten
// after printing. Allow for choosing 1 of these designs for any grade
// level. Choose grade level drop down. Preview updates when you click
// update preview. Then a print button. These should all be landscape,
// full page." Nothing is saved - the builder's own form fields (in the
// URL) are the award, so Update Preview and Print just render them.

const GRADE_LEVELS = [
  { key: 'preschool', label: 'Preschool', display: 'Preschool!', design: 'rainbow' },
  { key: 'prek', label: 'Pre-Kinder', display: 'Pre-Kinder!', design: 'bee' },
  { key: 'k', label: 'Kindergarten', display: 'Kindergarten!', design: 'apple' },
  { key: '1', label: '1st Grade', display: '1st Grade!', design: 'rocket' },
  { key: '2', label: '2nd Grade', display: '2nd Grade!', design: 'dinosaur' },
  { key: '3', label: '3rd Grade', display: '3rd Grade!', design: 'turtle' },
  { key: '4', label: '4th Grade', display: '4th Grade!', design: 'sports' },
  { key: '5', label: '5th Grade', display: '5th Grade!', design: 'butterfly' },
  { key: '6', label: '6th Grade', display: '6th Grade!', design: 'mountains' },
  { key: '7', label: '7th Grade', display: '7th Grade!', design: 'neon' },
  { key: '8', label: '8th Grade', display: '8th Grade!', design: 'paint' },
  { key: '9', label: '9th Grade', display: '9th Grade!', design: 'city' },
  { key: '10', label: '10th Grade', display: '10th Grade!', design: 'goldstars' },
  { key: '11', label: '11th Grade', display: '11th Grade!', design: 'laurel' },
  { key: '12', label: '12th Grade', display: '12th Grade!', design: 'blackgold' },
];

const AWARD_DESIGNS = [
  { key: 'rainbow', label: 'Rainbow & Sunshine' },
  { key: 'bee', label: 'Busy Bee' },
  { key: 'apple', label: 'Apple & Crayons' },
  { key: 'rocket', label: 'Rocket & Stars' },
  { key: 'dinosaur', label: 'Dinosaur Jungle' },
  { key: 'turtle', label: 'Sea Turtle' },
  { key: 'sports', label: 'Sports' },
  { key: 'butterfly', label: 'Butterflies & Flowers' },
  { key: 'mountains', label: 'Mountains & Pines' },
  { key: 'neon', label: 'Neon Game Controller' },
  { key: 'paint', label: 'Paint Splash' },
  { key: 'city', label: 'City Skyline' },
  { key: 'goldstars', label: 'Gold Stars' },
  { key: 'laurel', label: 'Blue & Gold Laurels' },
  { key: 'blackgold', label: 'Black & Gold' },
];
const DESIGN_KEYS = AWARD_DESIGNS.map((d) => d.key);

const clean = (v) => String(v || '').trim().slice(0, 80);

// The builder's query string -> exactly what one award shows.
function awardFromQuery(q) {
  const query = q || {};
  const grade = GRADE_LEVELS.find((g) => g.key === query.grade) || GRADE_LEVELS[0];
  const design = DESIGN_KEYS.includes(query.design) ? query.design : grade.design;
  return {
    grade: grade.key,
    gradeLabel: grade.label,
    gradeDisplay: grade.display,
    design,
    studentName: clean(query.studentName),
    parent1: clean(query.parent1),
    parent2: clean(query.parent2),
  };
}

// The same award as a query string (the Print link, the design cards).
function awardQuery(award, overrides) {
  const a = { ...award, ...(overrides || {}) };
  const params = new URLSearchParams({ grade: a.grade, design: a.design });
  if (a.studentName) params.set('studentName', a.studentName);
  if (a.parent1) params.set('parent1', a.parent1);
  if (a.parent2) params.set('parent2', a.parent2);
  return params.toString();
}

module.exports = { GRADE_LEVELS, AWARD_DESIGNS, awardFromQuery, awardQuery };
