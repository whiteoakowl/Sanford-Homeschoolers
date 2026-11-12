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

// approvedOnly: the class QR code page - a teacher's plan isn't shown to
// a substitute until Co-op Admin approves it with its lesson.
async function substitutePlansForClass(classId, { approvedOnly = false } = {}) {
  const rows = await db
    .prepare(`SELECT * FROM class_substitute_plans WHERE class_id = ?${approvedOnly ? " AND approval_status = 'approved'" : ''} ORDER BY position, id`)
    .all(classId);
  return rows.map(withUrls);
}

// A real request: "When teachers submit lessons for approval it will
// send the entire lesson and any substitute lessons together for
// approval." Every draft/rejected plan on the class goes to 'pending',
// attached to the lesson it's being sent with. Returns how many.
async function submitSubstitutePlansForClass(classId, assignmentId, accountId) {
  const info = await db
    .prepare(
      "UPDATE class_substitute_plans SET approval_status = 'pending', submitted_with_assignment_id = ?, submitted_at = now_text(), submitted_by_account_id = ?, reviewed_at = NULL, review_note = NULL WHERE class_id = ? AND approval_status IN ('draft', 'rejected')"
    )
    .run(assignmentId, accountId, classId);
  return Number(info.changes) || 0;
}

async function unsubmittedSubstitutePlanCount(classId) {
  const { n } = await db.prepare("SELECT COUNT(*) AS n FROM class_substitute_plans WHERE class_id = ? AND approval_status IN ('draft', 'rejected')").get(classId);
  return Number(n);
}

// Every plan that was sent with this lesson (any status), for its review page.
async function substitutePlansSubmittedWith(assignmentId) {
  const rows = await db.prepare('SELECT * FROM class_substitute_plans WHERE submitted_with_assignment_id = ? ORDER BY position, id').all(assignmentId);
  return rows.map(withUrls);
}

// Co-op Admin's approve/reject of a lesson decides the pending plans sent
// with it. Returns the plans that changed (with who submitted them).
async function reviewSubstitutePlansWith(assignmentId, { approve, note }) {
  const pending = await db
    .prepare("SELECT * FROM class_substitute_plans WHERE submitted_with_assignment_id = ? AND approval_status = 'pending'")
    .all(assignmentId);
  if (!pending.length) return [];
  await db
    .prepare("UPDATE class_substitute_plans SET approval_status = ?, reviewed_at = now_text(), review_note = ? WHERE submitted_with_assignment_id = ? AND approval_status = 'pending'")
    .run(approve ? 'approved' : 'rejected', approve ? null : note, assignmentId);
  return pending;
}

async function getSubstitutePlan(id) {
  return withUrls(await db.prepare('SELECT * FROM class_substitute_plans WHERE id = ?').get(id));
}

// approvalStatus: 'draft' for a teacher's plan (it goes for approval with
// the lesson plan), 'approved' for Co-op Admin's.
async function createSubstitutePlan({ classId, title, description, mediaUrl, teacherNotes, file, accountId, approvalStatus = 'approved' }) {
  const { next_position: nextPosition } = await db
    .prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM class_substitute_plans WHERE class_id = ?')
    .get(classId);
  const worksheetKey = file ? await saveLessonAttachment(file) : null;
  const info = await db
    .prepare(
      'INSERT INTO class_substitute_plans (class_id, title, description, worksheet_key, worksheet_name, media_url, teacher_notes, position, created_by_account_id, approval_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(classId, title, description, worksheetKey, file ? file.originalname : null, mediaUrl, teacherNotes, nextPosition, accountId || null, approvalStatus);
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
  submitSubstitutePlansForClass,
  unsubmittedSubstitutePlanCount,
  substitutePlansSubmittedWith,
  reviewSubstitutePlansWith,
};
