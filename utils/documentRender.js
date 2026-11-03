// A real request: "Members should be able to print and download a pdf of
// all documents. Add a print and pdf icons to all document pages."
// Uploaded documents are PDF, .doc or .docx (utils/uploads.js's
// DOCUMENT_MIME_BY_EXT). Each kind needs different handling:
//   - pdf:  already a PDF - shown in an <iframe>, printed through it,
//           downloaded as-is.
//   - docx: browsers can't show one at all (an <iframe> pointed at one
//           just downloads it), so it's converted to HTML with mammoth
//           (pure JS - fine inside the Netlify Function bundle) and that
//           HTML is what's viewed, printed and rendered to a PDF.
//   - doc:  the old binary Word format - nothing pure-JS converts it, so
//           it's only ever offered as a plain download of the original.
// Shared by routes/documents.js (the token-based view/print/PDF routes)
// and both admin document view pages.
const path = require('path');
const fs = require('fs');
const { createStorageClient, downloadFile } = require('./storage');
const { sanitizeDocumentHtml } = require('./sanitizeHtml');

const DOCUMENTS_BUCKET = 'documents';
const DOCUMENT_DIR = path.join(__dirname, '..', 'public', 'uploads', 'documents');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function documentKind(doc) {
  const ext = path.extname(doc.original_name || doc.file_path || '').toLowerCase();
  if (ext === '.pdf' || doc.mime_type === 'application/pdf') return 'pdf';
  if (ext === '.docx' || doc.mime_type === DOCX_MIME) return 'docx';
  if (ext === '.doc' || doc.mime_type === 'application/msword') return 'doc';
  return 'other';
}

// Same Supabase-or-local-disk lookup every document route already does
// (see routes/documents.js's streamKey) - null when the file is missing.
async function loadDocumentBuffer(key) {
  if (!key) return null;
  const client = createStorageClient();
  if (client) {
    try {
      return await downloadFile(client, DOCUMENTS_BUCKET, key);
    } catch {
      return null;
    }
  }
  const filePath = path.join(DOCUMENT_DIR, key);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

// .docx bytes -> sanitized HTML. A corrupt/unreadable .docx returns null
// instead of throwing, so callers can fall back to a plain download.
async function docxToSafeHtml(buffer) {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(buffer) });
    return sanitizeDocumentHtml(result.value);
  } catch {
    return null;
  }
}

// The converted HTML for a .docx document (null for any other kind, or
// when the file is missing/unreadable).
async function docxHtmlFor(doc) {
  if (documentKind(doc) !== 'docx') return null;
  const buffer = await loadDocumentBuffer(doc.file_path);
  if (!buffer) return null;
  return docxToSafeHtml(buffer);
}

// A safe Content-Disposition filename built from the document's title.
function downloadFilename(doc, ext) {
  const base = String(doc.title || 'document').replace(/[^\w .()-]+/g, '').trim() || 'document';
  return `${base}${ext}`;
}

module.exports = { documentKind, loadDocumentBuffer, docxToSafeHtml, docxHtmlFor, downloadFilename, DOCUMENTS_BUCKET, DOCUMENT_DIR };
