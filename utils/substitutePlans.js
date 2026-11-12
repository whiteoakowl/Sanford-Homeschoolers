// Substitute plans (a real request): a class can have several, each with
// a title, description, a worksheet to print, a video or song link and
// special notes from the teacher. Managed from Co-op Teacher Portal and
// Co-op Admin class pages (routes/teacher-portal.js, routes/admin-class-
// schedule.js - same shared view, views/partials/substitute-plan-
// manage.ejs) and shown read-only from the class QR code's View
// Substitute Plan page (routes/kiosk-class-checkin.js).
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { lessonAttachmentUrl, saveLessonAttachment } = require('./academics');
const { createStorageClient, deleteFile } = require('./storage');

const LESSON_ATTACHMENTS_BUCKET = 'lesson-attachments';
const LESSON_ATTACHMENT_DIR = path.join(__dirname, '..', 'public', 'uploads', 'lesson-attachments');

function withUrls(row) {
  if (!row) return row;
  return { ...row, worksheetUrl: lessonAttachmentUrl(row.worksheet_key) };
}

// Only http(s) links are kept - a typed "javascript:" or other scheme is
// dropped rather than rendered as a clickable link on the kiosk page.
function cleanMediaUrl(value) {
  const url = String(value || '').trim();
  if (!url) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function fieldsFromBody(body) {
  return {
    title: String(body.title || '').trim(),
    description: String(body.description || '').trim() || null,
    mediaUrl: cleanMediaUrl(body.mediaUrl),
    teacherNotes: String(body.teacherNotes || '').trim() || null,
  };
}

async function substitutePlansForClass(classId) {
  const rows = await db.prepare('SELECT * FROM class_substitute_plans WHERE class_id = ? ORDER BY position, id').all(classId);
  return rows.map(withUrls);
}

async function getSubstitutePlan(id) {
  return withUrls(await db.prepare('SELECT * FROM class_substitute_plans WHERE id = ?').get(id));
}

async function createSubstitutePlan({ classId, title, description, mediaUrl, teacherNotes, file, accountId }) {
  const { next_position: nextPosition } = await db
    .prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM class_substitute_plans WHERE class_id = ?')
    .get(classId);
  const worksheetKey = file ? await saveLessonAttachment(file) : null;
  const info = await db
    .prepare(
      'INSERT INTO class_substitute_plans (class_id, title, description, worksheet_key, worksheet_name, media_url, teacher_notes, position, created_by_account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(classId, title, description, worksheetKey, file ? file.originalname : null, mediaUrl, teacherNotes, nextPosition, accountId || null);
  return info.lastInsertRowid;
}

async function removeWorksheetFile(key) {
  if (!key) return;
  const client = createStorageClient();
  if (client) {
    await deleteFile(client, LESSON_ATTACHMENTS_BUCKET, key);
  } else {
    const filePath = path.join(LESSON_ATTACHMENT_DIR, key);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

// A new file replaces the old worksheet; removeWorksheet (the edit form's
// checkbox) clears it without uploading a new one.
async function updateSubstitutePlan(plan, { title, description, mediaUrl, teacherNotes, file, removeWorksheet }) {
  let worksheetKey = plan.worksheet_key;
  let worksheetName = plan.worksheet_name;
  if (file) {
    worksheetKey = await saveLessonAttachment(file, plan.worksheet_key);
    worksheetName = file.originalname;
  } else if (removeWorksheet && worksheetKey) {
    await removeWorksheetFile(worksheetKey);
    worksheetKey = null;
    worksheetName = null;
  }
  await db
    .prepare(
      'UPDATE class_substitute_plans SET title = ?, description = ?, worksheet_key = ?, worksheet_name = ?, media_url = ?, teacher_notes = ?, updated_at = now_text() WHERE id = ?'
    )
    .run(title, description, worksheetKey, worksheetName, mediaUrl, teacherNotes, plan.id);
}

async function deleteSubstitutePlan(plan) {
  await db.prepare('DELETE FROM class_substitute_plans WHERE id = ?').run(plan.id);
  await removeWorksheetFile(plan.worksheet_key);
}

module.exports = {
  cleanMediaUrl,
  fieldsFromBody,
  substitutePlansForClass,
  getSubstitutePlan,
  createSubstitutePlan,
  updateSubstitutePlan,
  deleteSubstitutePlan,
};
