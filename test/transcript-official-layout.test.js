// A real request: "Transcripts should print like this. Make sure the
// Transcript creations features and settings account for what is on this
// Transcript image." (an Official High School Transcript sample)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `transcript-official-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `transcript-official-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { createTranscriptEntry, transcriptBuilderForStudent } = require('../utils/academics');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

const csrfOf = (html) => /name="csrf-token" content="([^"]*)"/.exec(html)[1];

test('Transcript Details save and the print shows every section of the sample transcript', async () => {
  const login = await request(app).post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const cookie = login.headers['set-cookie'];
  const fam = (await db.prepare("INSERT INTO families (name) VALUES ('Wilson') RETURNING id").get()).id;
  await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, is_primary_parent, active, address, phone, email) VALUES ('Karen Wilson','kw','parent',?,1,1,'1234 Main St','123 456 7890','parent@example.com')").run(fam);
  const st = await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, active, birthday) VALUES ('Janet Wilson','jw','student',?,1,'2007-01-01') RETURNING *").get(fam);
  await createTranscriptEntry({ studentId: st.id, schoolYear: '2023-2024', className: 'Biology AP', creditHours: 1, gradeLetter: 'A', courseLevel: 'honors' });
  await createTranscriptEntry({ studentId: st.id, schoolYear: '2023-2024', className: 'American History', creditHours: 1, gradeLetter: 'B', courseLevel: 'college' });
  await createTranscriptEntry({ studentId: st.id, schoolYear: '2023-2024', className: 'Computer Science', creditHours: 0.5, gradeLetter: 'S' });

  const page = await request(app).get(`/main-admin/family-school?studentId=${st.id}`).set('Cookie', cookie);
  assert.match(page.text, /Transcript Details<\/button>/);
  assert.match(page.text, /<option value="honors"[^>]*>Honors<\/option>/);
  const save = await request(app)
    .post(`/main-admin/family-school/transcripts/${st.id}/details`)
    .set('Cookie', cookie)
    .type('form')
    .send({ _csrf: csrfOf(page.text), 'gradeLevel[2023-2024]': '12th', graduationDate: '2024-06-01', attendance: '180 days', testScores: 'SAT: 1400\nACT: 32', activities: 'Volunteer: Animal Shelter', schoolName: 'Wilson Homeschool Academy', schoolEmail: 'school@example.edu' });
  assert.equal(save.status, 302);

  const builder = await transcriptBuilderForStudent(st.id);
  assert.equal(builder.schoolYears[0].gradeLevel, '12th');
  assert.equal(builder.cumulativeCreditsEarned, 2.5, 'an S earns credit');
  assert.equal(builder.cumulativeGpa, 3.5, 'an S is left out of the GPA');

  const print = await request(app).get(`/main-admin/family-school/transcripts/${st.id}/print`).set('Cookie', cookie);
  const t = print.text;
  for (const re of [
    /Official High School Transcript/,
    /Student Information/, /<strong>Student Name:<\/strong> Janet Wilson/, /<strong>Address:<\/strong> 1234 Main St/, /<strong>DOB:<\/strong> 01\/01\/2007/, /<strong>Graduation Date:<\/strong> 06\/01\/2024/,
    /School Information/, /<strong>School Name:<\/strong> Wilson Homeschool Academy/, /<strong>Email:<\/strong> school@example\.edu/,
    /Academic Record/, /School Year: 2023-2024/, /Grade Level: 12th/, /Biology AP\*</, /American History\*\*</,
    /Cumulative GPA: 3\.50/, /Credits: 2\.5/,
    /Academic Summary/, /Total Credits Earned/, /180 days/,
    /Grading Scale/, /S = Satisfactory/, /\* = Honors/, /\*\* = College Course/,
    /Test Scores/, /<li>SAT: 1400<\/li>/, /<li>Volunteer: Animal Shelter<\/li>/,
    /I hereby certify and affirm that this is the official transcript of Janet Wilson in the academic studies of High School Diploma\./,
    /Signature<\/div>/, /Title<\/div>/, /Date<\/div>/,
  ]) assert.match(t, re);
});
