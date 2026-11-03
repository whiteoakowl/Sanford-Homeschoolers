// Public, unauthenticated document pages - a real request: "each
// document line should have a copy link button for easy public sharing,"
// confirmed to mean a document should be viewable by anyone with the
// link, no admin login required (e.g. handing a parent handbook to a
// prospective family). Deliberately its OWN router with no auth
// middleware at all, separate from routes/admin-documents.js's
// requireFullAdmin-gated management routes - mounted at /documents
// (server.js), so the link an admin copies is just /documents/<token>.
//
// Looked up by documents.public_token (a random string, not the row's
// own integer id) so this can't be used to enumerate every document on
// the site by incrementing a small number - same reasoning
// utils/portalAuth.js's own session tokens already use.
const express = require('express');
const router = express.Router();
const db = require('../db');
const { documentKind, loadDocumentBuffer, docxHtmlFor, downloadFilename } = require('../utils/documentRender');
const { renderViewToPdf } = require('../utils/pdfRender');

async function loadByToken(token) {
  return db.prepare('SELECT * FROM documents WHERE public_token = ?').get(token);
}

async function streamKey(res, key, mimeType, filename, disposition = 'inline') {
  const buffer = await loadDocumentBuffer(key);
  if (!buffer) return res.status(404).send('Not found');
  res.setHeader('Content-Type', mimeType || 'application/octet-stream');
  if (filename) res.setHeader('Content-Disposition', `${disposition}; filename="${filename.replace(/"/g, '')}"`);
  res.send(buffer);
}

function sendPdf(res, filename, pdfBuffer) {
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdfBuffer);
}

// The original upload's own extension (".doc", ".docx", ...) for a
// download-as-is filename.
function originalExt(doc) {
  const match = /\.[a-z0-9]+$/i.exec(doc.original_name || '');
  return match ? match[0].toLowerCase() : '';
}

router.get('/:token', async (req, res) => {
  const doc = await loadByToken(req.params.token);
  if (!doc) return res.status(404).render('404', { title: 'Not Found' });
  const settings = await db.prepare('SELECT * FROM site_settings WHERE id = 1').get();
  const kind = documentKind(doc);
  const docxHtml = await docxHtmlFor(doc);
  res.render('public-document', { title: doc.title, doc, settings, kind, docxHtml });
});

// A real request: "Members should be able to print and download a pdf of
// all documents." Same token-only access as /:token/file below, so it
// works for exactly the people who can already open the document. A PDF
// downloads as-is; a .docx is converted (utils/documentRender.js) and
// rendered to a real PDF through the same headless-Chromium path every
// other PDF button in the app uses; an old binary .doc can't be
// converted at all, so it downloads the original file instead (the UI
// labels that button "Download", never "PDF").
router.get('/:token/download.pdf', async (req, res) => {
  const doc = await loadByToken(req.params.token);
  if (!doc) return res.status(404).send('Not found');
  const kind = documentKind(doc);
  if (kind === 'docx') {
    const docxHtml = await docxHtmlFor(doc);
    if (docxHtml !== null) {
      const pdf = await renderViewToPdf(req, 'document-print', { title: doc.title, doc, kind, docxHtml });
      return sendPdf(res, downloadFilename(doc, '.pdf'), pdf);
    }
  }
  const ext = kind === 'pdf' ? '.pdf' : originalExt(doc);
  await streamKey(res, doc.file_path, doc.mime_type, downloadFilename(doc, ext), 'attachment');
});

// Print preview: a PDF is embedded full-page (its own iframe's print is
// what the Print button triggers - public/js/document-print.js), a .docx
// is its converted HTML on a letter-size sheet, and a .doc just explains
// it can't be printed from the browser, with a Download link.
router.get('/:token/print', async (req, res) => {
  const doc = await loadByToken(req.params.token);
  if (!doc) return res.status(404).render('404', { title: 'Not Found' });
  const kind = documentKind(doc);
  const docxHtml = await docxHtmlFor(doc);
  res.render('document-print', { title: `Print ${doc.title}`, doc, kind, docxHtml });
});

router.get('/:token/file', async (req, res) => {
  const doc = await loadByToken(req.params.token);
  if (!doc) return res.status(404).send('Not found');
  await streamKey(res, doc.file_path, doc.mime_type, doc.original_name);
});

router.get('/:token/image', async (req, res) => {
  const doc = await loadByToken(req.params.token);
  if (!doc || !doc.image_path) return res.status(404).send('Not found');
  await streamKey(res, doc.image_path, doc.image_mime_type);
});

module.exports = router;
