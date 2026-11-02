// Main Admin's Wix-style site editor - mounted at /main-admin/website
// (server.js). A real request: "The website homepage editor was built to
// mimic shopify. I would like to switch that to wix. It should allow you
// to edit the homepage like wix, all the same features, same look etc."
//   GET  /            site dashboard card (thumbnail, Edit Site, View Site)
//   GET  /editor      the full-screen editor (views/main-admin-site-editor.ejs)
//   GET  /preview/:id the DRAFT rendered exactly like the public site
//   /api/*            JSON API the editor talks to (autosave, publish,
//                     media, saved sections, versions)
// Everything is gated on the same manage_website permission the old
// homepage editor used; CSRF is enforced by the global middleware
// (fetch calls send X-CSRF-Token).
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { requirePortalPermission } = require('../middleware/portalAuth');
const site = require('../utils/siteBuilder');
const R = require('../public/js/site-render');
const { renderSitePage } = require('./public-site');

router.use(requirePortalPermission('manage_website'));

// Images (jpeg/png/gif/webp) and short videos (mp4/webm). 5MB matches
// every other upload in this app and stays under Netlify's request cap.
const MAX_BYTES = 5 * 1024 * 1024;
const MEDIA_TYPES = { '.jpg': /^image\/jpeg$/, '.jpeg': /^image\/jpeg$/, '.png': /^image\/png$/, '.gif': /^image\/gif$/, '.webp': /^image\/webp$/, '.mp4': /^video\/mp4$/, '.webm': /^video\/webm$/ };
function mediaFilter(req, file, cb) {
  const re = MEDIA_TYPES[path.extname(file.originalname || '').toLowerCase()];
  cb(null, !!(re && re.test(file.mimetype)));
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 20 }, fileFilter: mediaFilter });
function uploadMw(field, many) {
  const mw = many ? upload.array(field, 20) : upload.single(field);
  return (req, res, next) =>
    mw(req, res, (err) => {
      if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, error: `Files are limited to ${MAX_BYTES / (1024 * 1024)}MB each.` });
      if (err) return res.status(400).json({ ok: false, error: err.message });
      next();
    });
}

function siteUrl(req) {
  return `${req.protocol}://${req.get('host')}/`;
}

router.get('/', async (req, res) => {
  const state = await site.getState();
  const home = site.findPage(state.draft, null);
  res.render('main-admin-website', {
    title: 'Public Homepage',
    siteName: state.draft.site.orgName || 'My Site',
    siteUrl: siteUrl(req),
    homeId: home.id,
    pageCount: state.draft.pages.length,
    publishedAt: state.publishedAt,
    draftUpdatedAt: state.draftUpdatedAt,
    hasUnpublished: JSON.stringify(state.draft) !== JSON.stringify(state.published),
  });
});

router.get('/editor', async (req, res) => {
  res.render('main-admin-site-editor', { title: 'Site Editor', siteUrl: siteUrl(req) });
});

router.get('/preview/:pageId', async (req, res) => {
  const state = await site.getState();
  const page = state.draft.pages.find((p) => p.id === req.params.pageId) || site.findPage(state.draft, null);
  res.set('X-Robots-Tag', 'noindex');
  await renderSitePage(req, res, { doc: state.draft, page, preview: true });
});

// ---------------------------------------------------------------- API
router.get('/api/state', async (req, res) => {
  const state = await site.getState();
  const placeholders = await site.ensurePlaceholderMedia();
  res.json({
    ok: true,
    draft: state.draft,
    rev: state.rev,
    publishedAt: state.publishedAt,
    draftUpdatedAt: state.draftUpdatedAt,
    hasUnpublished: JSON.stringify(state.draft) !== JSON.stringify(state.published),
    media: await site.listMedia(),
    savedSections: await site.listSavedSections(),
    placeholders,
    widgetData: await site.loadWidgetData(),
    reservedSlugs: [...site.RESERVED_SLUGS],
    fonts: R.FONTS.map((f) => ({ key: f.key, label: f.label, stack: f.stack, google: f.google || null })),
    siteUrl: siteUrl(req),
  });
});

router.put('/api/draft', async (req, res) => {
  const rev = parseInt(req.body && req.body.rev, 10);
  if (!req.body || !req.body.doc || !Number.isInteger(rev)) return res.status(400).json({ ok: false, error: 'Missing site document.' });
  const result = await site.saveDraft(req.body.doc, rev);
  if (result.conflict) return res.status(409).json({ ok: false, conflict: true, error: 'This site was changed in another tab or by another admin. Reload to get the latest version.' });
  // The normalized doc only goes back when the server had to change
  // something (a slug, the homepage) so the editor adopts it.
  res.json({ ok: true, rev: result.rev, savedAt: result.savedAt, fixes: result.fixes, doc: result.fixes.length ? result.doc : undefined });
});

router.post('/api/publish', async (req, res) => {
  const result = await site.publish(req.portalAccount && req.portalAccount.id, req.body && req.body.label);
  res.json({ ok: true, publishedAt: result.publishedAt, url: siteUrl(req) });
});

router.get('/api/versions', async (req, res) => {
  res.json({ ok: true, versions: await site.listVersions() });
});

// Restore copies an old publish into the editor (the client then
// autosaves it as the draft) - never straight to the live site.
router.get('/api/versions/:id', async (req, res) => {
  const doc = await site.getVersionDoc(req.params.id);
  if (!doc) return res.status(404).json({ ok: false, error: 'Version not found.' });
  res.json({ ok: true, doc });
});

router.post('/api/media', uploadMw('files', true), async (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ ok: false, error: 'Choose a JPG, PNG, GIF, WebP, MP4 or WebM file.' });
  const sizes = Array.isArray(req.body.sizes) ? req.body.sizes : req.body.sizes ? [req.body.sizes] : [];
  const added = [];
  for (let i = 0; i < req.files.length; i++) {
    const [width, height] = String(sizes[i] || '').split('x');
    added.push(await site.addMedia(req.files[i], { folder: req.body.folder, width, height, name: req.files.length === 1 ? req.body.name : null }));
  }
  res.json({ ok: true, media: added });
});

router.post('/api/media/:id/replace', uploadMw('file', false), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'Choose an image or video file.' });
  const [width, height] = String(req.body.size || '').split('x');
  const media = await site.replaceMediaFile(req.params.id, req.file, { width, height });
  if (!media) return res.status(404).json({ ok: false, error: 'Not found.' });
  // The editor repoints its draft from replacedId to media.id; the live
  // site keeps the old file until the next Publish.
  res.json({ ok: true, media, replacedId: Number(req.params.id) });
});

router.post('/api/media/:id', async (req, res) => {
  const media = await site.updateMedia(req.params.id, req.body || {});
  if (!media) return res.status(404).json({ ok: false, error: 'Not found.' });
  res.json({ ok: true, media });
});

router.post('/api/media/:id/delete', async (req, res) => {
  const result = await site.deleteMedia(req.params.id);
  res.status(result.ok ? 200 : 409).json(result);
});

router.post('/api/saved-sections', async (req, res) => {
  const id = await site.saveSection(req.body && req.body.name, req.body && req.body.section);
  if (!id) return res.status(400).json({ ok: false, error: 'Nothing to save.' });
  res.json({ ok: true, savedSections: await site.listSavedSections() });
});

router.post('/api/saved-sections/:id/delete', async (req, res) => {
  await site.deleteSavedSection(req.params.id);
  res.json({ ok: true, savedSections: await site.listSavedSections() });
});

module.exports = router;
