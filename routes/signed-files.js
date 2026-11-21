// Serves files from the private member-photos and lesson-attachments
// buckets behind the server-signed links utils/signedFileUrl.js puts in
// pages. A bad or expired signature gets the same 404 as a missing file.
const express = require('express');
const router = express.Router();
const { createStorageClient } = require('../utils/storage');
const { verifySignedFile } = require('../utils/signedFileUrl');

// A warm server instance reuses each Supabase signed link for most of
// its hour, so a roster page with 100 photos doesn't cost 100 Storage
// calls every time it's opened.
const SUPABASE_LINK_SECONDS = 60 * 60;
const REUSE_FOR_MS = 50 * 60 * 1000;
const cache = new Map();

async function supabaseLink(client, bucket, key) {
  const cacheKey = `${bucket}/${key}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await client.storage.from(bucket).createSignedUrl(key, SUPABASE_LINK_SECONDS);
  if (error || !data || !data.signedUrl) return null;
  if (cache.size > 5000) cache.clear();
  cache.set(cacheKey, { url: data.signedUrl, until: Date.now() + REUSE_FOR_MS });
  return data.signedUrl;
}

router.get('/files/:bucket/:key', async (req, res) => {
  const { bucket, key } = req.params;
  if (!verifySignedFile(bucket, key, req.query.exp, req.query.sig)) return res.status(404).send('Not found');
  const client = createStorageClient();
  if (!client) return res.status(404).send('Not found');
  let url;
  try {
    url = await supabaseLink(client, bucket, key);
  } catch (err) {
    console.error(err);
  }
  if (!url) return res.status(404).send('Not found');
  res.set('Cache-Control', 'private, max-age=1800');
  res.set('Referrer-Policy', 'no-referrer');
  res.redirect(302, url);
});

module.exports = router;
