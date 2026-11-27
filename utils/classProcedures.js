// A real request: "Add co-op class procedures under settings on co-op
// admin portal. Parent information page policies links to this instead."
// Rich text a Co-op Admin writes (Settings > Co-op Class Procedures);
// parents read it at /parent/classes/procedures. A later real request:
// "Class procedures should have an upload for pdf and documents too" -
// one optional PDF/Word file alongside the text, stored the same way the
// Policy Handbook file is (Supabase Storage 'documents' bucket, or the
// local uploads folder without it).
const fs = require('fs');
const path = require('path');
const { appSetting, setAppSetting } = require('./appSettings');
const { sanitizePostBody } = require('./sanitizeHtml');
const { createStorageClient, uploadFile, deleteFile, generateKey, redirectToSignedUrl } = require('./storage');
const { DOCUMENT_MIME_BY_EXT } = require('./uploads');

const KEY = 'coop_class_procedures_html';
const FILE_KEY = 'coop_class_procedures_file';
const BUCKET = 'documents';
const LOCAL_DIR = path.join(__dirname, '..', 'public', 'uploads', 'documents');

async function getProceduresHtml() {
  return (await appSetting(KEY, '')) || '';
}

async function saveProceduresHtml(html) {
  await setAppSetting(KEY, sanitizePostBody(String(html || '')));
}

async function getProceduresFile() {
  const raw = await appSetting(FILE_KEY, '');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

async function removeStored(file) {
  if (!file) return;
  const client = createStorageClient();
  if (client) await deleteFile(client, BUCKET, file.key).catch(() => {});
  else {
    const p = path.join(LOCAL_DIR, file.key);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

// multerFile: a multer memory-storage file. Replaces any earlier file.
async function saveProceduresFile(multerFile) {
  const existing = await getProceduresFile();
  const ext = path.extname(multerFile.originalname).toLowerCase();
  const mimeType = DOCUMENT_MIME_BY_EXT[ext] || multerFile.mimetype;
  const client = createStorageClient();
  let key;
  if (client) {
    key = await uploadFile(client, BUCKET, multerFile.buffer, multerFile.originalname, mimeType);
  } else {
    key = generateKey(multerFile.originalname);
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOCAL_DIR, key), multerFile.buffer);
  }
  await removeStored(existing);
  await setAppSetting(FILE_KEY, JSON.stringify({ key, originalName: multerFile.originalname, mimeType }));
}

async function removeProceduresFile() {
  await removeStored(await getProceduresFile());
  await setAppSetting(FILE_KEY, '');
}

// Sends the file (a signed link with Supabase Storage). false when there
// isn't one.
async function sendProceduresFile(res) {
  const file = await getProceduresFile();
  if (!file) return false;
  const client = createStorageClient();
  if (client) {
    try {
      await redirectToSignedUrl(res, client, BUCKET, file.key);
      return true;
    } catch (err) {
      return false;
    }
  }
  const p = path.join(LOCAL_DIR, file.key);
  if (!fs.existsSync(p)) return false;
  res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${String(file.originalName).replace(/"/g, '')}"`);
  res.send(fs.readFileSync(p));
  return true;
}

module.exports = { getProceduresHtml, saveProceduresHtml, getProceduresFile, saveProceduresFile, removeProceduresFile, sendProceduresFile };
