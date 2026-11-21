// Proxy-download for students' handed-in co-op class work (the private
// assignment-submissions bucket - see utils/academics.js's
// SUBMISSIONS_BUCKET comment). Anyone signed in can ask, but the file is
// only sent to:
//   - the student who handed it in,
//   - anyone in that student's family (parents),
//   - a teacher/staff member of the class it was handed in for,
//   - a Co-op Admin (or the master account).
// Everyone else gets the same 404 as a key that doesn't exist, so a
// guessed key never confirms anything.
const express = require('express');
const path = require('path');
const router = express.Router();
const db = require('../db');
const { requirePortalAuth } = require('../middleware/portalAuth');
const { hasCoopAdminAccess } = require('../middleware/requireAdmin');
const { memberForAccount } = require('../utils/portalAuth');
const { submissionForFileKey, submissionFileBuffer, submissionBucketForKey } = require('../utils/academics');
const { createStorageClient, redirectToSignedUrl } = require('../utils/storage');

const EXTENSION_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
// Only these are shown inline in the browser; anything else downloads.
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);

function mimeFor(key) {
  return EXTENSION_MIME_TYPES[path.extname(key).toLowerCase()] || 'application/octet-stream';
}

async function canViewSubmission(req, submission) {
  if (hasCoopAdminAccess(req)) return true;
  const viewer = await memberForAccount(req.portalAccount.id);
  if (!viewer) return false;
  if (viewer.id === submission.student_id) return true;
  if (viewer.family_id && viewer.family_id === submission.student_family_id) return true;
  const staff = await db.prepare('SELECT 1 FROM class_staff WHERE class_id = ? AND member_id = ?').get(submission.class_id, viewer.id);
  return !!staff;
}

router.get('/class-submissions/:key', requirePortalAuth, async (req, res) => {
  const key = req.params.key;
  const submission = await submissionForFileKey(key);
  if (!submission || !(await canViewSubmission(req, submission))) return res.status(404).send('Not found');
  const filename = (submission.file_name || path.basename(key)).replace(/["\r\n]/g, '');
  const client = createStorageClient();
  if (client) {
    try {
      const bucket = await submissionBucketForKey(client, key);
      return await redirectToSignedUrl(res, client, bucket, key, { filename, download: !INLINE_TYPES.has(mimeFor(key)) });
    } catch (err) {
      console.error(err);
      return res.status(404).send('Not found');
    }
  }
  let buffer;
  try {
    buffer = await submissionFileBuffer(key);
  } catch (err) {
    console.error(err);
    return res.status(404).send('Not found');
  }
  if (!buffer) return res.status(404).send('Not found');
  const type = mimeFor(key);
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `${INLINE_TYPES.has(type) ? 'inline' : 'attachment'}; filename="${filename}"`);
  res.send(buffer);
});

module.exports = router;
