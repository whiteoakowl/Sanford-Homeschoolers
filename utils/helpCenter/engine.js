// Shared Help Center engine: builds one help center (member or admin)
// from a list of category content files. See utils/helpCenter/index.js
// (member Help Center) and utils/helpCenter/admin.js (Admin Help Center)
// for the article format and who each one is for.
function createHelpCenter({ name, contentDir, categoryFiles, faqFile, audiences, viewerFromRequest }) {
  const AUDIENCES = new Set(audiences);

  const CATEGORIES = categoryFiles.map((file) => {
    const cat = require(`${contentDir}/${file}`);
    return { ...cat, articles: cat.articles.map((a) => ({ ...a, category: cat.slug })) };
  });
  const ARTICLES = new Map();
  for (const cat of CATEGORIES) {
    for (const article of cat.articles) {
      if (ARTICLES.has(article.slug)) throw new Error(`${name}: duplicate help article slug: ${article.slug}`);
      for (const a of article.audiences) if (!AUDIENCES.has(a)) throw new Error(`${name}: unknown audience "${a}" on ${article.slug}`);
      ARTICLES.set(article.slug, article);
    }
  }
  const FAQS = require(`${contentDir}/${faqFile}`);

  function canSee(viewer, item) {
    if (!item.audiences.some((a) => viewer.audiences.has(a))) return false;
    if (item.permission && !viewer.allPermissions && !viewer.permissions.has(item.permission)) return false;
    return true;
  }

  function visibleCategories(viewer) {
    return CATEGORIES.map((cat) => ({ ...cat, articles: cat.articles.filter((a) => canSee(viewer, a)) })).filter((cat) => cat.articles.length > 0);
  }

  function findCategory(viewer, slug) {
    return visibleCategories(viewer).find((c) => c.slug === slug) || null;
  }

  // null for both "no such article" and "not for you" - pages never tell
  // the two apart.
  function findArticle(viewer, slug) {
    const article = ARTICLES.get(slug);
    return article && canSee(viewer, article) ? article : null;
  }

  function relatedArticles(viewer, article) {
    return (article.related || []).map((slug) => findArticle(viewer, slug)).filter(Boolean);
  }

  function visibleFaqs(viewer) {
    return FAQS.filter((f) => canSee(viewer, f) && (!f.article || findArticle(viewer, f.article)));
  }

  // Only articles this viewer can see are ever searched, so search can't
  // surface anything the browse pages wouldn't.
  function searchArticles(viewer, query) {
    const words = normalize(query).split(/\s+/).filter((w) => w.length > 1).slice(0, 8);
    if (words.length === 0) return [];
    const results = [];
    for (const cat of visibleCategories(viewer)) {
      for (const article of cat.articles) {
        const title = normalize(article.title);
        const keywords = normalize((article.keywords || []).join(' '));
        const summary = normalize(article.summary);
        const body = normalize(article.body.map(blockText).join(' '));
        const all = `${title} ${keywords} ${summary} ${body}`;
        let score = 0;
        let matchedAll = true;
        for (const word of words) {
          const variants = [word, word.replace(/s$/, ''), ...(SYNONYMS[word] || [])].filter(Boolean);
          const hit = (field) => variants.some((v) => field.includes(v));
          if (!hit(all)) {
            matchedAll = false;
            break;
          }
          if (hit(title)) score += 10;
          if (hit(keywords)) score += 6;
          if (hit(summary)) score += 3;
          if (hit(body)) score += 1;
        }
        if (matchedAll) results.push({ article, category: cat, score });
      }
    }
    return results.sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title)).slice(0, 25);
  }

  return {
    name,
    CATEGORIES,
    ARTICLES,
    FAQS,
    viewerFromRequest,
    canSee,
    visibleCategories,
    findCategory,
    findArticle,
    relatedArticles,
    visibleFaqs,
    searchArticles,
    articleExists: (slug) => ARTICLES.has(slug),
  };
}

function blockText(block) {
  if (block.p) return block.p;
  if (block.h) return block.h;
  if (block.tip) return block.tip;
  if (block.note) return block.note;
  if (block.steps) return block.steps.join(' ');
  if (block.list) return block.list.join(' ');
  if (block.table) return [...block.table.head, ...block.table.rows.flat()].join(' ');
  return '';
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\*\*/g, '')
    .replace(/[^a-z0-9\s/-]/g, ' ');
}

const SYNONYMS = {
  signup: ['register', 'sign up'],
  'sign-up': ['register', 'sign up'],
  enroll: ['register'],
  enrollment: ['register'],
  pay: ['payment'],
  bill: ['invoice', 'accounting'],
  login: ['sign in', 'log in'],
  logout: ['log out', 'sign out'],
  absent: ['absence'],
  sick: ['absence'],
  late: ['absence', 'late'],
  badge: ['name tag'],
  nametag: ['name tag'],
  kid: ['child', 'student'],
  kids: ['child', 'student'],
  child: ['student'],
  children: ['student', 'child'],
  messages: ['chat'],
  message: ['chat'],
  alert: ['notification'],
  alerts: ['notification'],
  permission: ['permissions', 'role'],
  user: ['member', 'account'],
  users: ['members', 'accounts'],
};

module.exports = { createHelpCenter };
