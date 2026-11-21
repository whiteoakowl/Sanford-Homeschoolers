// Builds the Express router for a help center (member /help, or admin
// /admin-help). Every page requires a signed-in account; `allow` can add
// a further check (the admin help center only opens for admins). What
// each person sees is filtered by help.viewerFromRequest().
const express = require('express');
const { requirePortalAuth } = require('../../middleware/portalAuth');

// Escapes text, then turns **label** into <strong>label</strong> - the
// only markup help content may contain.
function helpText(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function createHelpRouter({ help, basePath, name, intro, portalTitle, allow, suggestions }) {
  const router = express.Router();
  router.use(requirePortalAuth);

  if (allow) {
    router.use((req, res, next) => {
      if (allow(req)) return next();
      return res.status(403).render('403', {
        title: 'Not Authorized',
        message: 'This help center is for co-op administrators. The member Help Center has guides for everything in your portals.',
        backHref: '/help',
        backLabel: 'Go to the Help Center',
      });
    });
  }

  const navLinks = [
    { href: '/portal', icon: 'home', label: 'My Portals' },
    { href: basePath, icon: 'help-circle', label: name },
    { href: `${basePath}/faq`, icon: 'info-circle', label: 'FAQ' },
    { href: `${basePath}/search`, icon: 'search', label: 'Search Help' },
  ];

  router.use((req, res, next) => {
    req.helpViewer = help.viewerFromRequest(req);
    Object.assign(res.locals, {
      helpText,
      helpNavLinks: navLinks,
      helpQuery: '',
      helpBase: basePath,
      helpName: name,
      helpIntro: intro,
      helpPortalTitle: portalTitle,
    });
    next();
  });

  function notFound(res, message) {
    return res.status(404).render('help-not-found', {
      title: 'Help article not found',
      message: message || 'We couldn\'t find that help page. It may have moved, or it may not apply to your account.',
    });
  }

  router.get('/', (req, res) => {
    res.render('help-home', {
      title: name,
      categories: help.visibleCategories(req.helpViewer),
      faqs: help.visibleFaqs(req.helpViewer).slice(0, 8),
    });
  });

  router.get('/search', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    res.locals.helpQuery = query;
    res.render('help-search', {
      title: query ? `Search: ${query}` : 'Search Help',
      query,
      results: query ? help.searchArticles(req.helpViewer, query) : [],
      suggestions,
    });
  });

  router.get('/faq', (req, res) => {
    res.render('help-faq', { title: 'Frequently Asked Questions', faqs: help.visibleFaqs(req.helpViewer) });
  });

  router.get('/c/:slug', (req, res) => {
    const category = help.findCategory(req.helpViewer, req.params.slug);
    if (!category) return notFound(res, 'That help section doesn\'t exist, or it doesn\'t apply to your account.');
    res.render('help-category', { title: category.title, category });
  });

  router.get('/a/:slug', (req, res) => {
    const article = help.findArticle(req.helpViewer, req.params.slug);
    if (!article) return notFound(res);
    res.render('help-article', {
      title: article.title,
      article,
      category: help.findCategory(req.helpViewer, article.category),
      related: help.relatedArticles(req.helpViewer, article),
    });
  });

  router.use((req, res) => notFound(res));

  // Never show technical details: log the real error, show a plain
  // message.
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('help-not-found', {
      title: 'Help is unavailable',
      message: 'Something went wrong loading this help page. Please reload the page in a moment.',
    });
  });

  return router;
}

module.exports = { createHelpRouter, helpText };
