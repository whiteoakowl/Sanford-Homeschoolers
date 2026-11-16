// Teacher Interest Form - a real request: "Teacher interest form.
// Submissions and edit form button found under teachers/assistants tab.
// Teacher interest form on parent portal homepages under links and forms.
// Edit form request name, days available, age groups, class hours
// available, subject willing to teach added one by one and offered as
// checkboxes. Class idea 1, class idea 2, class idea 3 with large text
// boxes. Log on admin side shows date and time stamp in correct format."
// Co-op Admin edits the form (routes/admin-teacher-interest.js); parents
// fill it in from their portal (routes/parent-teacher-interest.js).
const db = require('../db');
const { easternStamp } = require('./classRegistration');

// Each checkbox list on the form: its key, the label above it, and its
// settings/submission column.
const OPTION_LISTS = [
  { key: 'days', label: 'Days Available', column: 'days_json' },
  { key: 'ageGroups', label: 'Age Groups', column: 'age_groups_json' },
  { key: 'hours', label: 'Class Hours Available', column: 'hours_json' },
  { key: 'subjects', label: 'Subjects Willing to Teach', column: 'subjects_json' },
];

const DEFAULTS = {
  title: 'Teacher Interest Form',
  intro: 'Interested in teaching a class at co-op? Let us know when you are available and what you would like to teach.',
  days: ['Monday', 'Wednesday'],
  ageGroups: ['Preschool', 'Elementary (K-5th)', 'Middle School (6th-8th)', 'High School (9th-12th)'],
  hours: ['Hour 1', 'Hour 2', 'Hour 3', 'Hour 4'],
  subjects: ['Art', 'Music', 'Science', 'History', 'Math', 'Language Arts', 'P.E.'],
};

function parseList(json) {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

async function getSettings() {
  const row = await db.prepare('SELECT * FROM teacher_interest_settings WHERE id = 1').get();
  if (!row) return { ...DEFAULTS };
  const out = { title: row.title || DEFAULTS.title, intro: row.intro != null ? row.intro : DEFAULTS.intro };
  for (const l of OPTION_LISTS) out[l.key] = row[l.column] != null ? parseList(row[l.column]) : DEFAULTS[l.key];
  return out;
}

async function saveSettings(settings) {
  const vals = OPTION_LISTS.map((l) => JSON.stringify(settings[l.key] || []));
  await db
    .prepare(
      `INSERT INTO teacher_interest_settings (id, title, intro, days_json, age_groups_json, hours_json, subjects_json, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, now_text())
       ON CONFLICT (id) DO UPDATE SET title = excluded.title, intro = excluded.intro, days_json = excluded.days_json,
         age_groups_json = excluded.age_groups_json, hours_json = excluded.hours_json, subjects_json = excluded.subjects_json, updated_at = now_text()`
    )
    .run(settings.title, settings.intro, ...vals);
}

// Add one option to a list (blank or duplicate ignored), or remove one.
async function addOption(listKey, value) {
  const settings = await getSettings();
  const v = String(value || '').trim();
  if (!OPTION_LISTS.some((l) => l.key === listKey) || !v) return false;
  if (settings[listKey].some((x) => x.toLowerCase() === v.toLowerCase())) return false;
  settings[listKey] = [...settings[listKey], v];
  await saveSettings(settings);
  return true;
}

async function removeOption(listKey, value) {
  const settings = await getSettings();
  if (!OPTION_LISTS.some((l) => l.key === listKey)) return;
  settings[listKey] = settings[listKey].filter((x) => x !== value);
  await saveSettings(settings);
}

async function saveTitle({ title, intro }) {
  const settings = await getSettings();
  settings.title = String(title || '').trim() || DEFAULTS.title;
  settings.intro = String(intro || '').trim();
  await saveSettings(settings);
}

// A checked box only counts if it's one of the form's current options.
function pickChecked(value, allowed) {
  const arr = Array.isArray(value) ? value : value != null ? [value] : [];
  return arr.map(String).filter((v) => allowed.includes(v));
}

async function submit({ accountId, memberId, body }) {
  const settings = await getSettings();
  const name = String(body.name || '').trim();
  if (!name) return { ok: false, error: 'Please enter your name.' };
  const picked = OPTION_LISTS.map((l) => JSON.stringify(pickChecked(body[l.key], settings[l.key])));
  const idea = (k) => String(body[k] || '').trim() || null;
  await db
    .prepare(
      `INSERT INTO teacher_interest_submissions (account_id, member_id, name, days_json, age_groups_json, hours_json, subjects_json, idea1, idea2, idea3)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(accountId || null, memberId || null, name, ...picked, idea('idea1'), idea('idea2'), idea('idea3'));
  return { ok: true };
}

// Newest first, with the Eastern date and time it was sent.
async function listSubmissions() {
  const rows = await db.prepare('SELECT * FROM teacher_interest_submissions ORDER BY created_at DESC, id DESC').all();
  return rows.map((r) => {
    const stamp = easternStamp(r.created_at);
    const out = { id: r.id, name: r.name, idea1: r.idea1, idea2: r.idea2, idea3: r.idea3, dateLabel: stamp.dateLabel, timeLabel: stamp.timeLabel, createdAt: r.created_at };
    for (const l of OPTION_LISTS) out[l.key] = parseList(r[l.column]);
    return out;
  });
}

async function deleteSubmission(id) {
  await db.prepare('DELETE FROM teacher_interest_submissions WHERE id = ?').run(id);
}

module.exports = { OPTION_LISTS, getSettings, addOption, removeOption, saveTitle, submit, listSubmissions, deleteSubmission };
