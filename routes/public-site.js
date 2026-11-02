// The public website - built in Main Admin > Settings > Public Homepage's
// Wix-style editor (routes/admin-website.js, utils/siteBuilder.js). Mounted
// at "/" and "/welcome" (home page, sitemap.xml, robots.txt); the per-page
// /<slug> routes are a separate `pageRouter` server.js mounts after every
// app route so a site page can never shadow one.
const express = require('express');
const router = express.Router();
const pageRouter = express.Router();
const R = require('../public/js/site-render');
const site = require('../utils/siteBuilder');

function absoluteBase(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// Shared by the live routes below and the editor's Preview
// (routes/admin-website.js), so a preview is byte-for-byte what Publish
// will put live.
async function renderSitePage(req, res, { doc, page, preview }) {
  const media = await site.mediaMap();
  const data = await site.loadWidgetData();
  const hydrated = R.hydrate(JSON.parse(JSON.stringify(doc)), media);
  const ctx = { media, data, portalAccount: !!req.portalAccount, editor: false, year: new Date().getFullYear() };
  const s = hydrated.settings || {};
  const orgName = (hydrated.site && hydrated.site.orgName) || 'Sanford Homeschoolers';
  const seo = page.seo || {};
  const title = seo.title || (page.isHome ? s.seoTitle || orgName : `${page.title} | ${orgName}`);
  const ogId = seo.ogImageId || s.ogImageId;
  const og = ogId && media[ogId] ? media[ogId].url : null;
  const pagePath = page.isHome ? '/' : `/${page.slug}`;
  res.render('public-home', {
    title,
    description: seo.description || s.seoDescription || '',
    canonical: absoluteBase(req) + pagePath,
    ogImage: og && /^\//.test(og) ? absoluteBase(req) + og : og,
    faviconUrl: s.faviconId && media[s.faviconId] ? media[s.faviconId].url : '/img/logo.png',
    noindex: preview || seo.noindex || s.allowIndexing === false,
    fontsHref: R.googleFontsHref(hydrated),
    siteCss: R.designCss(hydrated) + '\n' + R.pageCss(page, hydrated),
    bodyHtml: R.renderPageBody(hydrated, page, ctx),
    headerSticky: !!(hydrated.header && hydrated.header.sticky),
    analyticsId: preview ? '' : s.analyticsId,
    cookieBanner: s.cookieBanner && s.cookieBanner.enabled && !preview ? s.cookieBanner : null,
    smoothScroll: s.smoothScroll !== false,
    isPreview: !!preview,
  });
}

router.get('/', async (req, res) => {
  const doc = await site.getPublishedDoc();
  await renderSitePage(req, res, { doc, page: site.findPage(doc, null) });
});

router.get('/sitemap.xml', async (req, res, next) => {
  const doc = await site.getPublishedDoc();
  if (doc.settings && doc.settings.sitemap === false) return next();
  const base = absoluteBase(req);
  const urls = doc.pages
    .filter((p) => p.access === 'public' && !(p.seo && p.seo.noindex))
    .map((p) => `  <url><loc>${R.esc(base + (p.isHome ? '/' : '/' + p.slug))}</loc></url>`);
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
});

router.get('/robots.txt', async (req, res) => {
  const doc = await site.getPublishedDoc();
  const s = doc.settings || {};
  const lines = ['User-agent: *'];
  if (s.allowIndexing === false) lines.push('Disallow: /');
  else {
    // The app behind the public site is all signed-in portals - only the
    // published site pages are meant to be crawled.
    for (const p of ['/admin', '/main-admin', '/portal', '/parent', '/student', '/teacher', '/kiosk', '/login']) lines.push(`Disallow: ${p}`);
    for (const p of doc.pages.filter((x) => x.access === 'members')) lines.push(`Disallow: /${p.slug}`);
  }
  if (s.sitemap !== false && s.allowIndexing !== false) lines.push(`Sitemap: ${absoluteBase(req)}/sitemap.xml`);
  res.type('text/plain').send(lines.join('\n') + '\n');
});

pageRouter.get('/:slug', async (req, res, next) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug)) return next();
  const doc = await site.getPublishedDoc();
  const page = site.findPage(doc, slug);
  if (!page) return next();
  if (page.isHome) return res.redirect(301, '/');
  if (page.access === 'members' && !req.portalAccount) return res.redirect('/login?next=' + encodeURIComponent('/' + slug));
  await renderSitePage(req, res, { doc, page });
});

module.exports = router;
module.exports.pageRouter = pageRouter;
module.exports.renderSitePage = renderSitePage;
