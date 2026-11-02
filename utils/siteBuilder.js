// Wix-style site builder - data model, validation, draft/publish, media,
// and the one-time conversion from the old Shopify-style homepage editor.
// A real request: "The website homepage editor was built to mimic
// shopify. I would like to switch that to wix. It should allow you to
// edit the homepage like wix, all the same features, same look etc."
//
// The whole public site is ONE JSON document (site_builder_state,
// supabase/migrations/20261229010000_site_builder.sql): a draft the
// editor autosaves and a published snapshot the public routes render.
// Rendering itself lives in public/js/site-render.js, shared verbatim
// with the editor canvas. Everything coming from the editor goes through
// normalizeDoc() below - the client is a convenience, never trusted.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');
const db = require('../db');
const R = require('../public/js/site-render');
const { createStorageClient, publicUrl, uploadFile, deleteFile, generateKey } = require('./storage');
const { formatFriendlyTimestamp, formatFriendlyDateAndTime } = require('./dates');
const { publicShowcaseClasses } = require('./classSchedule');

const MEDIA_BUCKET = 'homepage-images';
const LOCAL_MEDIA_DIR = path.join(__dirname, '..', 'public', 'uploads', 'homepage');

function mediaUrlForKey(key) {
  if (!key) return null;
  return createStorageClient() ? publicUrl(MEDIA_BUCKET, key) : `/uploads/homepage/${key}`;
}

// ---------------------------------------------------------------- limits
const LIMITS = { pages: 40, sections: 60, elements: 150, menu: 80, presets: 30, swatches: 24, listItems: 40 };
const ELEMENT_TYPES = [
  'text', 'image', 'button', 'icon', 'shape', 'line', 'video', 'gallery', 'slideshow', 'accordion', 'tabs',
  'social', 'map', 'embed', 'form', 'login', 'menu', 'classes', 'announcements', 'faq', 'events',
];

// Top-level paths the app itself already serves - a page slug can never
// take one over. Static folders under public/ are added at boot below so
// a future /public/<dir> is covered automatically.
const RESERVED_SLUGS = new Set([
  'welcome', 'kiosk', 'login', 'logout', 'portal', 'register', 'membership', 'admin', 'main-admin', 'parent',
  'student', 'teacher', 'committees', 'documents', 'events', 'directory', 'classifieds', 'member-directory',
  'forums', 'forms', 'accounting', 'store', 'newsletter', 'notifications', 'photos', 'babysitters', 'nature-news',
  'publications', 'search', 'absence', 'name-tag', 'volunteers', 'volunteer-lists', 'signup-lists', 'setup',
  'contact-admins', 'training', 'family-school', 'handbook-file', 'privacy-policy', 'terms-and-conditions',
  'uploads', 'api', 'sitemap.xml', 'robots.txt', 'manifest.json', 'sw.js', 'favicon.ico', 'home', 'preview',
]);
try {
  for (const name of fs.readdirSync(path.join(__dirname, '..', 'public'))) RESERVED_SLUGS.add(name.toLowerCase());
} catch (err) {
  // public/ always exists in a real checkout - nothing to add otherwise.
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
function slugError(slug) {
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug)) return 'Use lowercase letters, numbers, and dashes.';
  if (RESERVED_SLUGS.has(slug)) return `"/${slug}" is already used by another part of the app.`;
  return null;
}

// ------------------------------------------------------------- validators
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
function newId(prefix) {
  return (prefix || 'x') + crypto.randomBytes(5).toString('hex');
}
function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function bool(v) {
  return v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
}
function int(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function color(v) {
  return typeof v === 'string' && R.isColor(v) ? v.trim() : undefined;
}
function oneOf(v, list, fallback) {
  return list.includes(v) ? v : fallback;
}
function mediaId(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function href(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim().slice(0, 500);
  if (/^page:[A-Za-z0-9_-]{1,40}(#[A-Za-z0-9_-]{1,40})?$/.test(s)) return s;
  return R.safeUrl(s);
}
function link(v) {
  if (!v || typeof v !== 'object') return null;
  const h = href(v.href);
  return h ? { href: h, newTab: bool(v.newTab) } : null;
}
function clean(obj) {
  for (const k of Object.keys(obj)) if (obj[k] === undefined || obj[k] === null || obj[k] === '') delete obj[k];
  return obj;
}

// Inline-only rich text (the editor's own text toolbar: bold/italic/
// underline/strike/link/color/line breaks) - same sanitize-html library
// and no-javascript:-URL rule as utils/sanitizeHtml.js, just a narrower
// tag list since a text element is a single heading/paragraph.
function sanitizeInline(html) {
  return sanitizeHtml(String(html || '').slice(0, 20000), {
    allowedTags: ['strong', 'b', 'em', 'i', 'u', 's', 'a', 'br', 'span'],
    allowedAttributes: { a: ['href', 'target', 'rel'], span: ['style'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesAppliedToAttributes: ['href'],
    allowProtocolRelative: false,
    allowedStyles: { span: { color: [/^#(?:[0-9a-fA-F]{3}){1,2}$/, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/], 'font-weight': [/^(bold|[1-9]00)$/], 'font-style': [/^italic$/], 'text-decoration': [/^(underline|line-through)$/] } },
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { href: attribs.href || '#', ...(attribs.target === '_blank' ? { target: '_blank', rel: 'noopener' } : {}) } }),
      b: 'strong',
      i: 'em',
    },
  });
}

const STYLE_TEXT_TRANSFORMS = ['none', 'uppercase', 'lowercase', 'capitalize'];
function normStyle(s) {
  if (!s || typeof s !== 'object') return {};
  const out = {
    bg: color(s.bg),
    borderColor: color(s.borderColor),
    color: color(s.color),
    borderWidth: s.borderWidth != null ? int(s.borderWidth, 0, 40, 0) : undefined,
    borderStyle: s.borderStyle ? oneOf(s.borderStyle, ['solid', 'dashed', 'dotted', 'double'], 'solid') : undefined,
    radius: s.radius != null && s.radius !== '' ? int(s.radius, 0, 999, 0) : undefined,
    shadow: s.shadow ? oneOf(s.shadow, Object.keys(R.SHADOWS), 'none') : undefined,
    opacity: s.opacity != null && s.opacity !== '' ? int(s.opacity, 0, 100, 100) : undefined,
    padding: s.padding != null && s.padding !== '' ? int(s.padding, 0, 200, 0) : undefined,
    fontFamily: s.fontFamily && R.FONT_BY_KEY[s.fontFamily] ? s.fontFamily : undefined,
    fontSize: s.fontSize ? int(s.fontSize, 6, 240, 16) : undefined,
    fontWeight: s.fontWeight ? int(s.fontWeight, 100, 900, 400) : undefined,
    lineHeight: s.lineHeight ? Math.min(4, Math.max(0.6, Number(s.lineHeight) || 1.4)) : undefined,
    letterSpacing: s.letterSpacing != null && s.letterSpacing !== '' ? Math.min(40, Math.max(-10, Number(s.letterSpacing) || 0)) : undefined,
    textTransform: s.textTransform ? oneOf(s.textTransform, STYLE_TEXT_TRANSFORMS, 'none') : undefined,
    align: s.align ? oneOf(s.align, ['left', 'center', 'right', 'justify'], 'left') : undefined,
    italic: s.italic ? true : undefined,
    underline: s.underline ? true : undefined,
    shape: s.shape ? oneOf(s.shape, ['rect', 'circle'], 'rect') : undefined,
    thickness: s.thickness ? int(s.thickness, 1, 40, 2) : undefined,
    orientation: s.orientation ? oneOf(s.orientation, ['horizontal', 'vertical'], 'horizontal') : undefined,
    presetId: typeof s.presetId === 'string' && ID_RE.test(s.presetId) ? s.presetId : undefined,
  };
  if (s.gradient && color(s.gradient.from) && color(s.gradient.to)) out.gradient = { from: color(s.gradient.from), to: color(s.gradient.to), angle: int(s.gradient.angle, 0, 360, 180) };
  return clean(out);
}

function normRect(l, device) {
  const W = R.DEVICE_WIDTH[device];
  if (!l || typeof l !== 'object') return null;
  const w = int(l.w, 4, W, Math.min(200, W));
  const x = int(l.x, 0, W - Math.min(w, 4), 0);
  return { x, y: int(l.y, 0, 20000, 0), w: Math.min(w, W - x) || 4, h: int(l.h, 2, 6000, 40) };
}
function normHidden(h) {
  const out = {};
  if (h && typeof h === 'object') for (const d of R.DEVICES) if (typeof h[d] === 'boolean') out[d] = h[d];
  return out;
}
function listOf(v, max, fn) {
  return (Array.isArray(v) ? v.slice(0, max) : []).map(fn).filter(Boolean);
}
const TEXT_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'];
function normProps(type, p) {
  p = p && typeof p === 'object' ? p : {};
  switch (type) {
    case 'text':
      return { tag: oneOf(p.tag, TEXT_TAGS, 'p'), textStyle: oneOf(p.textStyle, R.TEXT_STYLE_KEYS, undefined), html: sanitizeInline(p.html) };
    case 'image':
      return clean({ mediaId: mediaId(p.mediaId), alt: str(p.alt, 300), fit: oneOf(p.fit, ['cover', 'contain'], 'cover'), caption: str(p.caption, 300), link: link(p.link) });
    case 'button':
      return clean({ label: str(p.label, 120) || 'Button', link: link(p.link), icon: R.ICONS[p.icon] ? p.icon : undefined });
    case 'icon':
      return clean({ icon: R.ICONS[p.icon] ? p.icon : 'star', label: str(p.label, 120), link: link(p.link) });
    case 'video':
      return clean({
        source: oneOf(p.source, ['embed', 'upload'], 'embed'),
        url: R.videoEmbedUrl(p.url) ? str(p.url, 300) : '',
        mediaId: mediaId(p.mediaId),
        title: str(p.title, 200),
        controls: p.controls === false ? false : undefined,
        autoplay: bool(p.autoplay) || undefined,
        loop: bool(p.loop) || undefined,
      });
    case 'gallery':
      return { items: listOf(p.items, LIMITS.listItems, (it) => (mediaId(it && it.mediaId) ? clean({ mediaId: mediaId(it.mediaId), alt: str(it.alt, 300), caption: str(it.caption, 200) }) : null)), columns: int(p.columns, 1, 6, 3), gap: int(p.gap, 0, 60, 8) };
    case 'slideshow':
      return {
        slides: listOf(p.slides, 20, (sl) => (sl && (mediaId(sl.mediaId) || sl.title) ? clean({ mediaId: mediaId(sl.mediaId), alt: str(sl.alt, 300), title: str(sl.title, 200), text: str(sl.text, 500) }) : null)),
        autoplay: bool(p.autoplay),
        interval: int(p.interval, 2, 30, 5),
        label: str(p.label, 120),
      };
    case 'accordion':
      return { items: listOf(p.items, LIMITS.listItems, (it) => (it && it.title ? { title: str(it.title, 200), body: str(it.body, 4000) } : null)), openFirst: bool(p.openFirst) };
    case 'tabs':
      return { tabs: listOf(p.tabs, 10, (t) => (t && t.title ? { title: str(t.title, 80), body: str(t.body, 4000) } : null)) };
    case 'social':
      return { links: listOf(p.links, 12, (l) => (l && R.SOCIAL_NETWORKS.includes(l.network) && R.safeUrl(l.url) ? { network: l.network, url: str(l.url, 300) } : null)), gap: int(p.gap, 0, 60, 12) };
    case 'map':
      return { address: str(p.address, 300), zoom: int(p.zoom, 1, 20, 14) };
    case 'embed':
      // Raw HTML is allowed here ONLY because site-render.js always puts
      // it in a sandboxed srcdoc iframe without allow-same-origin.
      return { html: str(p.html, 20000), title: str(p.title, 120) };
    case 'form':
      return clean({ formId: mediaId(p.formId), title: str(p.title, 200), description: str(p.description, 500), buttonLabel: str(p.buttonLabel, 60) });
    case 'login':
      return clean({ loginLabel: str(p.loginLabel, 40), portalLabel: str(p.portalLabel, 40) });
    case 'menu':
      return clean({ label: str(p.label, 60) });
    case 'classes':
      return { showButton: p.showButton !== false };
    case 'announcements':
    case 'events':
      return { limit: int(p.limit, 1, 12, type === 'events' ? 4 : 3) };
    default:
      return {};
  }
}

function normElement(el) {
  if (!el || typeof el !== 'object' || !ELEMENT_TYPES.includes(el.type)) return null;
  const layout = el.layout || {};
  const desktop = normRect(layout.desktop, 'desktop');
  if (!desktop) return null;
  const out = {
    id: ID_RE.test(el.id || '') ? el.id : newId('e'),
    type: el.type,
    name: str(el.name, 60),
    layout: { desktop },
    props: normProps(el.type, el.props),
    style: normStyle(el.style),
    z: int(el.z, 0, 9999, 1),
  };
  for (const d of ['tablet', 'mobile']) if (layout[d]) out.layout[d] = normRect(layout[d], d);
  const hidden = normHidden(el.hidden);
  if (Object.keys(hidden).length) out.hidden = hidden;
  if (el.styleBy && typeof el.styleBy === 'object') {
    const sb = {};
    for (const d of ['tablet', 'mobile']) {
      const s = normStyle(el.styleBy[d]);
      if (Object.keys(s).length) sb[d] = s;
    }
    if (Object.keys(sb).length) out.styleBy = sb;
  }
  if (el.anim && R.ANIMATIONS.includes(el.anim.type) && el.anim.type !== 'none') {
    out.anim = { type: el.anim.type, duration: int(el.anim.duration, 100, 5000, 700), delay: int(el.anim.delay, 0, 5000, 0), trigger: oneOf(el.anim.trigger, ['scroll', 'load'], 'scroll') };
  }
  if (el.hover && R.HOVER_EFFECTS.includes(el.hover) && el.hover !== 'none') out.hover = el.hover;
  if (el.locked) out.locked = true;
  if (el.sticky) out.sticky = true;
  if (typeof el.groupId === 'string' && ID_RE.test(el.groupId)) out.groupId = el.groupId;
  return out;
}

function normSection(s) {
  if (!s || typeof s !== 'object') return null;
  const bg = s.bg || {};
  const outBg = clean({
    type: oneOf(bg.type, ['color', 'gradient', 'image', 'video'], 'color'),
    color: color(bg.color),
    mediaId: mediaId(bg.mediaId),
    videoId: mediaId(bg.videoId),
    size: bg.size ? oneOf(bg.size, ['cover', 'contain', 'auto'], 'cover') : undefined,
    posX: bg.posX != null && bg.posX !== '' ? int(bg.posX, 0, 100, 50) : undefined,
    posY: bg.posY != null && bg.posY !== '' ? int(bg.posY, 0, 100, 50) : undefined,
    repeat: bool(bg.repeat) || undefined,
    parallax: bool(bg.parallax) || undefined,
  });
  if (bg.gradient && color(bg.gradient.from) && color(bg.gradient.to)) outBg.gradient = { from: color(bg.gradient.from), to: color(bg.gradient.to), angle: int(bg.gradient.angle, 0, 360, 180) };
  if (bg.overlay && color(bg.overlay.color)) outBg.overlay = { color: color(bg.overlay.color) };
  const height = { desktop: int(s.height && s.height.desktop, 40, 6000, 400) };
  for (const d of ['tablet', 'mobile']) if (s.height && s.height[d]) height[d] = int(s.height[d], 40, 8000, 400);
  const out = {
    id: ID_RE.test(s.id || '') ? s.id : newId('s'),
    name: str(s.name, 60),
    anchor: /^[a-z0-9][a-z0-9-]{0,39}$/.test(s.anchor || '') ? s.anchor : undefined,
    height,
    bg: outBg,
    textColor: color(s.textColor),
    autoHide: bool(s.autoHide) || undefined,
    elements: listOf(s.elements, LIMITS.elements, normElement),
  };
  const hidden = normHidden(s.hidden);
  if (Object.keys(hidden).length) out.hidden = hidden;
  return clean(out);
}

function normMenu(items, depth, counter) {
  return listOf(items, LIMITS.menu, (it) => {
    if (!it || typeof it !== 'object' || counter.n >= LIMITS.menu) return null;
    counter.n++;
    const type = oneOf(it.type, ['page', 'link', 'folder'], 'link');
    const out = { id: ID_RE.test(it.id || '') ? it.id : newId('m'), type, label: str(it.label, 80) };
    if (type === 'page') {
      if (!ID_RE.test(it.pageId || '')) return null;
      out.pageId = it.pageId;
    } else if (type === 'link') {
      out.href = href(it.href);
      if (!out.href || !out.label) return null;
    } else if (!out.label) return null;
    if (bool(it.newTab)) out.newTab = true;
    if (depth < 2 && Array.isArray(it.children) && it.children.length) out.children = normMenu(it.children, depth + 1, counter);
    return out;
  });
}

const DEFAULT_TEXT_STYLES = {
  h1: { fontSize: 48, fontWeight: 800, lineHeight: 1.15 },
  h2: { fontSize: 36, fontWeight: 800, lineHeight: 1.2 },
  h3: { fontSize: 26, fontWeight: 700, lineHeight: 1.25 },
  h4: { fontSize: 20, fontWeight: 700, lineHeight: 1.3 },
  p: { fontSize: 16, fontWeight: 400, lineHeight: 1.6 },
  small: { fontSize: 13, fontWeight: 400, lineHeight: 1.5 },
};
const DEFAULT_PALETTE = { primary: '#E7AA7B', accent: '#79BAEC', background: '#FFFFFF', cards: '#FFFFFF', text: '#1C2530', muted: '#5B6675', dark: '#1C2530', light: '#F5F7FA' };

function normDesign(d) {
  d = d || {};
  const palette = {};
  for (const k of R.PALETTE_KEYS) palette[k] = (d.palette && /^#[0-9a-fA-F]{3,8}$/.test(d.palette[k] || '') && d.palette[k]) || DEFAULT_PALETTE[k];
  const textStyles = {};
  for (const k of R.TEXT_STYLE_KEYS) {
    const s = normStyle({ ...DEFAULT_TEXT_STYLES[k], ...((d.textStyles && d.textStyles[k]) || {}) });
    textStyles[k] = clean({ fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, textTransform: s.textTransform, color: s.color, italic: s.italic });
  }
  return {
    palette,
    fontHeading: R.FONT_BY_KEY[d.fontHeading] ? d.fontHeading : 'montserrat',
    fontBody: R.FONT_BY_KEY[d.fontBody] ? d.fontBody : 'open_sans',
    textStyles,
    presets: listOf(d.presets, LIMITS.presets, (p) => (p && p.name ? { id: ID_RE.test(p.id || '') ? p.id : newId('p'), name: str(p.name, 60), style: normStyle(p.style) } : null)),
    swatches: listOf(d.swatches, LIMITS.swatches, (c) => color(c) || null),
  };
}

function normHeader(h) {
  h = h || {};
  const a = h.announcement || {};
  return clean({
    show: h.show !== false,
    sticky: bool(h.sticky),
    transparent: bool(h.transparent),
    height: int(h.height, 48, 240, 84),
    bg: color(h.bg),
    textColor: color(h.textColor),
    imageId: mediaId(h.imageId),
    logoId: mediaId(h.logoId),
    showLogo: h.showLogo !== false,
    showSiteName: h.showSiteName !== false,
    showLogin: h.showLogin !== false,
    navFont: R.FONT_BY_KEY[h.navFont] ? h.navFont : undefined,
    navSize: int(h.navSize, 10, 32, 16),
    navWeight: int(h.navWeight, 100, 900, 600),
    navColor: color(h.navColor),
    navHover: color(h.navHover),
    navActive: color(h.navActive),
    navSpacing: int(h.navSpacing, 0, 80, 24),
    burgerAt: oneOf(h.burgerAt, ['mobile', 'tablet'], 'mobile'),
    announcement: { enabled: bool(a.enabled), text: str(a.text, 300), bg: color(a.bg), color: color(a.color) },
  });
}

// The full validated document. `fixes` collects anything the server had
// to change (duplicate/reserved slugs, missing homepage) so the editor
// knows to adopt the server's copy.
function normalizeDoc(input) {
  const doc = input && typeof input === 'object' ? input : {};
  const fixes = [];
  const site = doc.site || {};
  const settings = doc.settings || {};
  const cookie = settings.cookieBanner || {};
  const footer = doc.footer || {};
  const out = {
    version: 1,
    site: { orgName: str(site.orgName, 120), contactEmail: str(site.contactEmail, 200), contactPhone: str(site.contactPhone, 60) },
    settings: {
      seoTitle: str(settings.seoTitle, 120),
      seoDescription: str(settings.seoDescription, 320),
      faviconId: mediaId(settings.faviconId),
      ogImageId: mediaId(settings.ogImageId),
      analyticsId: /^G-[A-Z0-9]{4,20}$/.test(settings.analyticsId || '') ? settings.analyticsId : '',
      cookieBanner: { enabled: bool(cookie.enabled), text: str(cookie.text, 500), buttonLabel: str(cookie.buttonLabel, 40), policyUrl: R.safeUrl(cookie.policyUrl || '') },
      sitemap: settings.sitemap !== false,
      allowIndexing: settings.allowIndexing !== false,
      smoothScroll: settings.smoothScroll !== false,
    },
    design: normDesign(doc.design),
    header: normHeader(doc.header),
    footer: clean({ show: footer.show !== false, text: str(footer.text, 1000), imageId: mediaId(footer.imageId), bg: color(footer.bg), color: color(footer.color) }),
    pages: [],
    menu: [],
  };
  const seenIds = new Set();
  const seenSlugs = new Set();
  for (const p of Array.isArray(doc.pages) ? doc.pages.slice(0, LIMITS.pages) : []) {
    if (!p || typeof p !== 'object') continue;
    let id = ID_RE.test(p.id || '') && !seenIds.has(p.id) ? p.id : newId('p');
    seenIds.add(id);
    const title = str(p.title, 80) || 'Untitled page';
    let slug = str(p.slug, 60).toLowerCase();
    if (slugError(slug)) {
      const base = slugify(slug || title) || 'page';
      slug = slugError(base) ? `${base}-page`.slice(0, 60) : base;
      if (slugError(slug)) slug = 'page';
      fixes.push(`Page "${title}" URL changed to /${slug}.`);
    }
    let n = 2;
    const original = slug;
    while (seenSlugs.has(slug)) slug = `${original}-${n++}`.slice(0, 60);
    if (slug !== original) fixes.push(`Page "${title}" URL changed to /${slug} (duplicate).`);
    seenSlugs.add(slug);
    const seo = p.seo || {};
    out.pages.push({
      id,
      title,
      slug,
      isHome: bool(p.isHome),
      hidden: bool(p.hidden),
      access: oneOf(p.access, ['public', 'members'], 'public'),
      type: oneOf(p.type, ['standard', 'landing'], 'standard'),
      seo: clean({ title: str(seo.title, 120), description: str(seo.description, 320), ogImageId: mediaId(seo.ogImageId), noindex: bool(seo.noindex) || undefined }),
      sections: listOf(p.sections, LIMITS.sections, normSection),
    });
  }
  if (!out.pages.length) {
    out.pages.push(blankPage('Home', 'home'));
    fixes.push('A site needs at least one page - added Home.');
  }
  const homes = out.pages.filter((p) => p.isHome);
  if (homes.length !== 1) {
    out.pages.forEach((p, i) => (p.isHome = homes.length ? p === homes[0] : i === 0));
    if (!homes.length) fixes.push(`"${out.pages[0].title}" is now the homepage.`);
  }
  // A members-only homepage would lock every visitor out of "/".
  const home = out.pages.find((p) => p.isHome);
  if (home.access !== 'public') {
    home.access = 'public';
    fixes.push('The homepage must stay public.');
  }
  const pageIds = new Set(out.pages.map((p) => p.id));
  const prune = (items) =>
    items.filter((it) => {
      if (it.children) it.children = prune(it.children);
      return it.type !== 'page' || pageIds.has(it.pageId);
    });
  out.menu = prune(normMenu(doc.menu, 0, { n: 0 }));
  return { doc: out, fixes };
}

function blankPage(title, slug) {
  return { id: newId('p'), title, slug, isHome: false, hidden: false, access: 'public', type: 'standard', seo: {}, sections: [] };
}

// ---------------------------------------------------------- legacy import
function estimateTextHeight(text, width, fontSize, lineHeight) {
  const cpl = Math.max(8, Math.floor(width / (fontSize * 0.52)));
  const lines = String(text || '')
    .split(/\r?\n/)
    .reduce((n, para) => n + Math.max(1, Math.ceil(para.length / cpl)), 0);
  return Math.ceil(lines * fontSize * lineHeight) + 8;
}
function textHtml(text) {
  return R.esc(text).replace(/\r?\n/g, '<br>');
}

async function ensureMediaForKey(key, name) {
  if (!key) return null;
  const existing = await db.prepare('SELECT id FROM site_media WHERE image_key = ?').get(key);
  if (existing) return existing.id;
  const info = await db.prepare("INSERT INTO site_media (image_key, kind, display_name, folder) VALUES (?, 'image', ?, 'Imported')").run(key, name || key);
  return info.lastInsertRowid;
}

// One-time conversion of the old Shopify-style editor's content into a
// site document: every homepage_blocks row becomes its own strip (so no
// guessed text height can ever make two old blocks overlap), and the old
// fixed Classes/Announcements/FAQ/"Ready to join" sections become strips
// of live-data widgets/real elements so the public page looks the same.
async function buildFromLegacy() {
  const settings = (await db.prepare('SELECT * FROM site_settings WHERE id = 1').get()) || {};
  const theme = (await db.prepare('SELECT * FROM homepage_theme_settings WHERE id = 1').get()) || {};
  const blocks = await db.prepare('SELECT * FROM homepage_blocks ORDER BY position, id').all();
  const menuRows = await db.prepare('SELECT * FROM homepage_menu_items ORDER BY position, id').all();
  const baseSize = { small: 15, medium: 16, large: 18 }[theme.font_size_base] || 16;
  const sections = [];
  let firstHeading = true;
  let z = 1;
  const strip = (name, els, extra) => ({ id: newId('s'), name, height: { desktop: Math.max(60, ...els.map((e) => e.layout.desktop.y + e.layout.desktop.h + 16)) }, bg: { type: 'color' }, elements: els, ...(extra || {}) });
  const xFor = (w, align) => (align === 'center' ? Math.round((980 - w) / 2) : align === 'right' ? 980 - 60 - w : 60);
  for (const b of blocks) {
    const align = b.alignment || 'left';
    if (b.block_type === 'text') {
      if (!b.text_body) continue;
      const big = b.text_size === 'large';
      const tag = big ? (firstHeading ? 'h1' : 'h2') : 'p';
      if (big) firstHeading = false;
      const size = big ? (tag === 'h1' ? 48 : 36) : b.text_size === 'small' ? 13 : baseSize;
      const lh = big ? 1.2 : 1.6;
      const h = estimateTextHeight(b.text_body, 860, size, lh);
      sections.push(strip(big ? 'Heading' : 'Text', [{ id: newId('e'), type: 'text', name: big ? 'Heading' : 'Paragraph', layout: { desktop: { x: 60, y: 16, w: 860, h } }, props: { tag, textStyle: big ? tag : b.text_size === 'small' ? 'small' : 'p', html: textHtml(b.text_body) }, style: { align }, z: z++ }]));
    } else if (b.block_type === 'image' && b.image_key) {
      const w = { small: 240, medium: 480, large: 720, full: 980 }[b.image_size] || 480;
      const id = await ensureMediaForKey(b.image_key, b.image_alt || 'Homepage image');
      if (b.image_alt) await db.prepare("UPDATE site_media SET alt_text = ? WHERE id = ? AND alt_text = ''").run(b.image_alt, id);
      const x = w === 980 ? 0 : xFor(w, align);
      sections.push(strip('Image', [{ id: newId('e'), type: 'image', name: 'Image', layout: { desktop: { x, y: 16, w, h: Math.round(w * 0.5625) } }, props: { mediaId: id, alt: b.image_alt || '', fit: 'contain' }, style: {}, z: z++ }]));
    } else if (b.block_type === 'button' && b.button_label) {
      sections.push(strip('Button', [{ id: newId('e'), type: 'button', name: 'Button', layout: { desktop: { x: xFor(240, align), y: 24, w: 240, h: 52 } }, props: { label: b.button_label, link: link({ href: b.button_url }) }, style: {}, z: z++ }], { height: { desktop: 100 } }));
    }
  }
  const heading = (text, y) => ({ id: newId('e'), type: 'text', name: 'Heading', layout: { desktop: { x: 60, y: y || 48, w: 860, h: 52 } }, props: { tag: 'h2', textStyle: 'h2', html: R.esc(text) }, style: {}, z: z++ });
  const widget = (type, h) => ({ id: newId('e'), type, name: { classes: 'Classes showcase', announcements: 'Announcements', faq: 'FAQ' }[type], layout: { desktop: { x: 60, y: 120, w: 860, h } }, props: normProps(type, {}), style: {}, z: z++ });
  // autoHide: like the old fixed sections, the whole strip disappears
  // while its live list is empty.
  sections.push({ ...strip('Classes We Offer', [heading('Classes We Offer'), widget('classes', 220)]), bg: { type: 'color', color: 'theme:light' }, autoHide: true });
  sections.push({ ...strip('Announcements', [heading('Announcements'), widget('announcements', 200)]), autoHide: true });
  sections.push({ ...strip('Frequently Asked Questions', [heading('Frequently Asked Questions'), widget('faq', 200)]), bg: { type: 'color', color: 'theme:light' }, autoHide: true });
  const org = settings.org_name || 'our co-op';
  sections.push({
    ...strip('Join', [
      { id: newId('e'), type: 'text', name: 'Heading', layout: { desktop: { x: 90, y: 56, w: 800, h: 52 } }, props: { tag: 'h2', textStyle: 'h2', html: R.esc(`Ready to join ${org}?`) }, style: { align: 'center' }, z: z++ },
      { id: newId('e'), type: 'text', name: 'Paragraph', layout: { desktop: { x: 190, y: 124, w: 600, h: 34 } }, props: { tag: 'p', textStyle: 'p', html: "Create your account and we'll take it from there." }, style: { align: 'center' }, z: z++ },
      { id: newId('e'), type: 'button', name: 'Button', layout: { desktop: { x: 370, y: 184, w: 240, h: 52 } }, props: { label: 'Member Registration', link: { href: '/register' } }, style: {}, z: z++ },
    ]),
    bg: { type: 'color', color: 'theme:accent' },
  });
  const home = { ...blankPage('Home', 'home'), isHome: true, sections };
  const doc = {
    site: { orgName: settings.org_name || '', contactEmail: settings.contact_email || '', contactPhone: settings.contact_phone || '' },
    settings: { seoTitle: settings.org_name || '', faviconId: await ensureMediaForKey(theme.favicon_key, 'Favicon'), sitemap: true, allowIndexing: true, smoothScroll: true },
    design: {
      palette: { ...DEFAULT_PALETTE, primary: theme.color_primary, accent: theme.color_accent, background: theme.color_background, cards: theme.color_cards, text: theme.color_text },
      fontHeading: theme.font_heading,
      fontBody: theme.font_body,
      textStyles: { ...DEFAULT_TEXT_STYLES, p: { ...DEFAULT_TEXT_STYLES.p, fontSize: baseSize } },
    },
    header: {
      show: true,
      showLogin: true,
      logoId: await ensureMediaForKey(theme.logo_key, 'Logo'),
      imageId: await ensureMediaForKey(theme.header_image_key, 'Header image'),
      announcement: { enabled: !!theme.announcement_enabled, text: theme.announcement_text || '' },
    },
    footer: { show: true, text: theme.footer_text || '', imageId: await ensureMediaForKey(theme.footer_image_key, 'Footer image') },
    pages: [home],
    menu: menuRows.map((m) => ({ id: newId('m'), type: 'link', label: m.label, href: m.url })),
  };
  return normalizeDoc(doc).doc;
}

// ------------------------------------------------------------------ state
async function ensureState() {
  let row = await db.prepare('SELECT * FROM site_builder_state WHERE id = 1').get();
  if (!row) {
    await db.prepare('INSERT INTO site_builder_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING').run();
    row = await db.prepare('SELECT * FROM site_builder_state WHERE id = 1').get();
  }
  if (!row.draft_json) {
    const json = JSON.stringify(await buildFromLegacy());
    // Guarded on draft_json IS NULL so two first requests racing each
    // other can't both convert - the loser's UPDATE simply matches 0 rows.
    await db
      .prepare('UPDATE site_builder_state SET draft_json = ?, published_json = COALESCE(published_json, ?), draft_rev = 1, draft_updated_at = now_text(), published_at = COALESCE(published_at, now_text()), converted_at = now_text() WHERE id = 1 AND draft_json IS NULL')
      .run(json, json);
    row = await db.prepare('SELECT * FROM site_builder_state WHERE id = 1').get();
  }
  return row;
}

async function getState() {
  const row = await ensureState();
  return {
    draft: JSON.parse(row.draft_json),
    published: row.published_json ? JSON.parse(row.published_json) : null,
    rev: Number(row.draft_rev),
    draftUpdatedAt: row.draft_updated_at,
    publishedAt: row.published_at,
  };
}

async function getPublishedDoc() {
  const row = await ensureState();
  return JSON.parse(row.published_json || row.draft_json);
}

// Optimistic concurrency: two open editor tabs can't silently overwrite
// each other - a save against a stale rev is refused (the editor offers
// to reload).
async function saveDraft(input, rev) {
  const { doc, fixes } = normalizeDoc(input);
  const info = await db.prepare('UPDATE site_builder_state SET draft_json = ?, draft_rev = draft_rev + 1, draft_updated_at = now_text() WHERE id = 1 AND draft_rev = ?').run(JSON.stringify(doc), rev);
  if (!info.changes) return { conflict: true };
  const row = await db.prepare('SELECT draft_rev, draft_updated_at FROM site_builder_state WHERE id = 1').get();
  return { doc, fixes, rev: Number(row.draft_rev), savedAt: row.draft_updated_at };
}

async function publish(accountId, label) {
  const row = await ensureState();
  const { doc } = normalizeDoc(JSON.parse(row.draft_json));
  const json = JSON.stringify(doc);
  await db.withTransaction(async (tx) => {
    await tx.prepare('UPDATE site_builder_state SET published_json = ?, published_at = now_text(), published_by_account_id = ? WHERE id = 1').run(json, accountId || null);
    await tx.prepare('INSERT INTO site_versions (doc_json, label, published_by_account_id) VALUES (?, ?, ?)').run(json, str(label, 120) || null, accountId || null);
    // site_settings.org_name/contact are read app-wide (emails, other
    // public pages), so the published Site Info is written back there.
    await tx
      .prepare('UPDATE site_settings SET org_name = ?, contact_email = ?, contact_phone = ?, updated_at = now_text() WHERE id = 1')
      .run(doc.site.orgName || 'Sanford Homeschoolers', doc.site.contactEmail, doc.site.contactPhone);
  });
  const after = await db.prepare('SELECT published_at FROM site_builder_state WHERE id = 1').get();
  return { publishedAt: after.published_at };
}

async function listVersions() {
  return db
    .prepare(
      `SELECT v.id, v.label, v.published_at, a.email AS "publishedBy" FROM site_versions v
       LEFT JOIN member_accounts a ON a.id = v.published_by_account_id ORDER BY v.id DESC LIMIT 30`
    )
    .all();
}
async function getVersionDoc(id) {
  const row = await db.prepare('SELECT doc_json FROM site_versions WHERE id = ?').get(id);
  return row ? normalizeDoc(JSON.parse(row.doc_json)).doc : null;
}

// ------------------------------------------------------------------ media
function mediaRowToClient(r) {
  return { id: r.id, kind: r.kind, url: mediaUrlForKey(r.image_key), name: r.display_name, folder: r.folder, alt: r.alt_text, focalX: r.focal_x, focalY: r.focal_y, width: r.width, height: r.height, size: r.size_bytes, mime: r.mime_type, createdAt: r.created_at };
}
async function listMedia() {
  const rows = await db.prepare('SELECT * FROM site_media ORDER BY id DESC').all();
  return rows.map(mediaRowToClient);
}
async function mediaMap() {
  const map = {};
  for (const m of await listMedia()) map[m.id] = { url: m.url, alt: m.alt, focalX: m.focalX, focalY: m.focalY, kind: m.kind };
  return map;
}
async function storeFile(file) {
  const client = createStorageClient();
  if (client) return uploadFile(client, MEDIA_BUCKET, file.buffer, file.originalname, file.mimetype);
  if (!fs.existsSync(LOCAL_MEDIA_DIR)) fs.mkdirSync(LOCAL_MEDIA_DIR, { recursive: true });
  const key = generateKey(file.originalname);
  fs.writeFileSync(path.join(LOCAL_MEDIA_DIR, key), file.buffer);
  return key;
}
async function removeFile(key) {
  if (!key) return;
  const client = createStorageClient();
  if (client) return deleteFile(client, MEDIA_BUCKET, key);
  const p = path.join(LOCAL_MEDIA_DIR, path.basename(key));
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
async function addMedia(file, meta) {
  const key = await storeFile(file);
  const kind = /^video\//.test(file.mimetype) ? 'video' : 'image';
  const info = await db
    .prepare('INSERT INTO site_media (image_key, kind, display_name, folder, mime_type, size_bytes, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(key, kind, str(meta.name || file.originalname, 120), str(meta.folder, 60), file.mimetype, file.size || file.buffer.length, meta.width ? int(meta.width, 1, 20000, null) : null, meta.height ? int(meta.height, 1, 20000, null) : null);
  return mediaRowToClient(await db.prepare('SELECT * FROM site_media WHERE id = ?').get(info.lastInsertRowid));
}
async function replaceMediaFile(id, file, meta) {
  const row = await db.prepare('SELECT * FROM site_media WHERE id = ?').get(id);
  if (!row) return null;
  const key = await storeFile(file);
  await db
    .prepare('UPDATE site_media SET image_key = ?, mime_type = ?, size_bytes = ?, width = ?, height = ?, updated_at = now_text() WHERE id = ?')
    .run(key, file.mimetype, file.size || file.buffer.length, meta.width ? int(meta.width, 1, 20000, null) : null, meta.height ? int(meta.height, 1, 20000, null) : null, id);
  await removeFile(row.image_key);
  return mediaRowToClient(await db.prepare('SELECT * FROM site_media WHERE id = ?').get(id));
}
async function updateMedia(id, data) {
  const row = await db.prepare('SELECT * FROM site_media WHERE id = ?').get(id);
  if (!row) return null;
  await db
    .prepare('UPDATE site_media SET display_name = ?, folder = ?, alt_text = ?, focal_x = ?, focal_y = ?, updated_at = now_text() WHERE id = ?')
    .run(
      data.name != null ? str(data.name, 120) : row.display_name,
      data.folder != null ? str(data.folder, 60) : row.folder,
      data.alt != null ? str(data.alt, 300) : row.alt_text,
      data.focalX != null ? int(data.focalX, 0, 100, 50) : row.focal_x,
      data.focalY != null ? int(data.focalY, 0, 100, 50) : row.focal_y,
      id
    );
  return mediaRowToClient(await db.prepare('SELECT * FROM site_media WHERE id = ?').get(id));
}
// Where a media item is still used (draft or live), by page title -
// deleting it would leave a broken image, so the editor refuses.
function mediaUsages(doc, id) {
  const hits = new Set();
  const want = Number(id);
  const walk = (node, where) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, where));
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (/^(mediaId|videoId|logoId|imageId|faviconId|ogImageId)$/.test(k) && Number(v) === want) hits.add(where);
      else if (typeof v === 'object') walk(v, where);
    }
  };
  for (const p of doc.pages || []) walk(p, `page "${p.title}"`);
  walk({ header: doc.header, footer: doc.footer, settings: doc.settings }, 'site header/footer/settings');
  return [...hits];
}
async function deleteMedia(id) {
  const row = await db.prepare('SELECT * FROM site_media WHERE id = ?').get(id);
  if (!row) return { ok: false, error: 'Not found.' };
  const st = await getState();
  const uses = [...new Set([...mediaUsages(st.draft, id), ...(st.published ? mediaUsages(st.published, id).map((u) => `${u} (live site)`) : [])])];
  if (uses.length) return { ok: false, error: `Still used on ${uses.join(', ')}. Remove it there first.` };
  await db.prepare('DELETE FROM site_media WHERE id = ?').run(id);
  await removeFile(row.image_key);
  return { ok: true };
}

// --------------------------------------------------------- saved sections
async function listSavedSections() {
  const rows = await db.prepare('SELECT * FROM site_saved_sections ORDER BY id DESC').all();
  return rows.map((r) => ({ id: r.id, name: r.name, section: JSON.parse(r.section_json), createdAt: r.created_at }));
}
async function saveSection(name, section) {
  const s = normSection(section);
  if (!s) return null;
  const info = await db.prepare('INSERT INTO site_saved_sections (name, section_json) VALUES (?, ?)').run(str(name, 60) || s.name || 'My section', JSON.stringify(s));
  return info.lastInsertRowid;
}
async function deleteSavedSection(id) {
  await db.prepare('DELETE FROM site_saved_sections WHERE id = ?').run(id);
}

// -------------------------------------------------------- live page data
async function loadWidgetData() {
  const announcements = (
    await db.prepare("SELECT * FROM announcements WHERE is_public = 1 AND (expires_at IS NULL OR expires_at > now_text()) ORDER BY published_at DESC LIMIT 10").all()
  ).map((a) => ({ ...a, publishedLabel: formatFriendlyTimestamp(a.published_at) }));
  const faqs = await db.prepare('SELECT * FROM faqs WHERE is_public = 1 ORDER BY position, id').all();
  const classes = (await publicShowcaseClasses()).map((c) => ({ ...c, timeLabel: c.startTime ? c.startTime + (c.endTime ? ` – ${c.endTime}` : '') : null }));
  const events = (
    await db
      .prepare(
        `SELECT e.id, e.title, e.starts_at, el.name AS "locationName" FROM events e LEFT JOIN event_locations el ON el.id = e.location_id
         WHERE e.status = 'published' AND e.approval_status = 'approved' AND e.visibility = 'public' AND e.starts_at >= now_text() ORDER BY e.starts_at LIMIT 12`
      )
      .all()
  ).map((e) => ({ ...e, dateLabel: formatFriendlyDateAndTime(e.starts_at) }));
  const forms = await db.prepare("SELECT id, title, description FROM custom_forms WHERE system_key IS NULL AND status = 'published' ORDER BY title").all();
  return { announcements, faqs, classes, events, forms };
}

function findPage(doc, slug) {
  if (!slug) return doc.pages.find((p) => p.isHome) || doc.pages[0];
  return doc.pages.find((p) => p.slug === slug);
}

module.exports = {
  MEDIA_BUCKET,
  RESERVED_SLUGS,
  ELEMENT_TYPES,
  LIMITS,
  slugify,
  slugError,
  normalizeDoc,
  sanitizeInline,
  getState,
  getPublishedDoc,
  saveDraft,
  publish,
  listVersions,
  getVersionDoc,
  listMedia,
  mediaMap,
  addMedia,
  replaceMediaFile,
  updateMedia,
  deleteMedia,
  listSavedSections,
  saveSection,
  deleteSavedSection,
  loadWidgetData,
  findPage,
  mediaUrlForKey,
};
