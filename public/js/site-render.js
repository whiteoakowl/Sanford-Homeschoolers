// Shared site renderer + layout model for the Wix-style site editor.
// Loaded two ways from this ONE file, so the editor canvas and the live
// public site can never drift apart: `require('../public/js/site-render')`
// on the server (utils/siteBuilder.js, views/public-home.ejs), and a plain
// <script> in the editor (window.SiteRender). No build step, no deps.
//
// Model (see utils/siteBuilder.js's own normalizeDoc for the validated
// shape): doc.pages[].sections[] are full-width strips stacked vertically;
// each section's elements[] are freely positioned inside a fixed-width
// canvas per device (DEVICE_WIDTH). x/w are stored in canvas px and
// rendered as % of the section's content width; y/h stay px.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SiteRender = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEVICES = ['desktop', 'tablet', 'mobile'];
  const DEVICE_WIDTH = { desktop: 980, tablet: 768, mobile: 320 };
  // Public-site media queries. Desktop is everything above TABLET_MAX.
  const TABLET_MAX = 1024;
  const MOBILE_MAX = 767;

  // Element types that grow with their content: rendered with min-height
  // so long text/live data pushes the section taller instead of clipping.
  const FLOW_TYPES = new Set(['text', 'accordion', 'tabs', 'classes', 'announcements', 'faq', 'events', 'form', 'menu']);

  const WIDGET_TYPES = new Set(['classes', 'announcements', 'faq', 'events']);

  const FONTS = [
    { key: 'system', label: 'System Default', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
    { key: 'open_sans', label: 'Open Sans', stack: "'Open Sans', Arial, sans-serif", google: 'Open+Sans:ital,wght@0,400;0,600;0,700;0,800;1,400' },
    { key: 'montserrat', label: 'Montserrat', stack: "'Montserrat', Arial, sans-serif", google: 'Montserrat:ital,wght@0,400;0,600;0,700;0,800;1,400' },
    { key: 'roboto', label: 'Roboto', stack: "'Roboto', Arial, sans-serif", google: 'Roboto:ital,wght@0,300;0,400;0,500;0,700;1,400' },
    { key: 'lato', label: 'Lato', stack: "'Lato', Arial, sans-serif", google: 'Lato:ital,wght@0,300;0,400;0,700;0,900;1,400' },
    { key: 'poppins', label: 'Poppins', stack: "'Poppins', Arial, sans-serif", google: 'Poppins:ital,wght@0,300;0,400;0,600;0,700;1,400' },
    { key: 'inter', label: 'Inter', stack: "'Inter', Arial, sans-serif", google: 'Inter:wght@300;400;600;700;800' },
    { key: 'nunito', label: 'Nunito', stack: "'Nunito', Arial, sans-serif", google: 'Nunito:ital,wght@0,400;0,600;0,700;0,800;1,400' },
    { key: 'raleway', label: 'Raleway', stack: "'Raleway', Arial, sans-serif", google: 'Raleway:ital,wght@0,400;0,600;0,700;1,400' },
    { key: 'quicksand', label: 'Quicksand', stack: "'Quicksand', Arial, sans-serif", google: 'Quicksand:wght@400;500;700' },
    { key: 'work_sans', label: 'Work Sans', stack: "'Work Sans', Arial, sans-serif", google: 'Work+Sans:ital,wght@0,400;0,600;0,700;1,400' },
    { key: 'oswald', label: 'Oswald', stack: "'Oswald', 'Arial Narrow', sans-serif", google: 'Oswald:wght@400;500;700' },
    { key: 'bebas_neue', label: 'Bebas Neue', stack: "'Bebas Neue', 'Arial Narrow', sans-serif", google: 'Bebas+Neue' },
    { key: 'playfair_display', label: 'Playfair Display', stack: "'Playfair Display', Georgia, serif", google: 'Playfair+Display:ital,wght@0,400;0,700;0,800;1,400' },
    { key: 'merriweather', label: 'Merriweather', stack: "'Merriweather', Georgia, serif", google: 'Merriweather:ital,wght@0,300;0,400;0,700;1,400' },
    { key: 'lora', label: 'Lora', stack: "'Lora', Georgia, serif", google: 'Lora:ital,wght@0,400;0,600;0,700;1,400' },
    { key: 'pt_serif', label: 'PT Serif', stack: "'PT Serif', Georgia, serif", google: 'PT+Serif:ital,wght@0,400;0,700;1,400' },
    { key: 'dancing_script', label: 'Dancing Script', stack: "'Dancing Script', cursive", google: 'Dancing+Script:wght@400;700' },
    { key: 'georgia', label: 'Georgia (Serif)', stack: "Georgia, 'Times New Roman', serif" },
    { key: 'times', label: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
    { key: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  ];
  const FONT_BY_KEY = Object.fromEntries(FONTS.map((f) => [f.key, f]));

  const PALETTE_KEYS = ['primary', 'accent', 'background', 'cards', 'text', 'muted', 'dark', 'light'];
  const TEXT_STYLE_KEYS = ['h1', 'h2', 'h3', 'h4', 'p', 'small'];
  const ANIMATIONS = ['none', 'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom', 'flip'];
  const HOVER_EFFECTS = ['none', 'lift', 'grow', 'dim', 'glow'];
  const SHADOWS = { none: 'none', sm: '0 1px 3px rgba(0,0,0,.12)', md: '0 6px 18px rgba(0,0,0,.14)', lg: '0 18px 40px rgba(0,0,0,.18)' };

  // Feather-style 24x24 stroke icons (inline SVG, no icon font request).
  const ICONS = {
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
    star: '<polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    mail: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22 6 12 13 2 6"/>',
    'map-pin': '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    'check-circle': '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><polyline points="22 4 12 14 9 11"/>',
    sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    gift: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    pencil: '<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    award: '<circle cx="12" cy="8" r="7"/><polyline points="8.2 13.9 7 23 12 20 17 23 15.8 13.9"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.4 5.1-6"/>',
    'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
    instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.4A4 4 0 1 1 12.6 8 4 4 0 0 1 16 11.4z"/><line x1="17.5" y1="6.5" x2="17.5" y2="6.5"/>',
    youtube: '<path d="M22.5 6.4a2.8 2.8 0 0 0-1.9-2C18.9 4 12 4 12 4s-6.9 0-8.6.4a2.8 2.8 0 0 0-1.9 2A29 29 0 0 0 1 12a29 29 0 0 0 .5 5.6 2.8 2.8 0 0 0 1.9 2c1.7.4 8.6.4 8.6.4s6.9 0 8.6-.4a2.8 2.8 0 0 0 1.9-2A29 29 0 0 0 23 12a29 29 0 0 0-.5-5.6z"/><polygon points="9.8 15.5 15.5 12 9.8 8.5 9.8 15.5"/>',
    x: '<path d="M4 4l16 16"/><path d="M20 4L4 20"/>',
    linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>',
    pinterest: '<circle cx="12" cy="12" r="10"/><path d="M9 21l2.5-10"/><path d="M8.5 13.5c-1-3 1-6.5 4-6.5 2.5 0 4 1.7 4 4 0 3-1.7 5-3.7 5-1.2 0-1.9-.8-1.6-2"/>',
    tiktok: '<path d="M16 3c.4 2.4 2 4 4.5 4.3v3.2c-1.7 0-3.2-.5-4.5-1.4V15a6 6 0 1 1-6-6v3.3a2.8 2.8 0 1 0 2.8 2.8V3z"/>',
  };
  const SOCIAL_NETWORKS = ['facebook', 'instagram', 'youtube', 'x', 'linkedin', 'pinterest', 'tiktok', 'mail', 'globe'];
  const SOCIAL_LABEL = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', x: 'X (Twitter)', linkedin: 'LinkedIn', pinterest: 'Pinterest', tiktok: 'TikTok', mail: 'Email', globe: 'Website' };

  // ---------- small helpers ----------
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function num(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }
  function round2(n) {
    return Math.round(n * 1000) / 1000;
  }
  const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|transparent)$/;
  // A color value is a literal hex/rgb(a), or "theme:<palette key>" so a
  // Site Design palette change restyles every element that uses it.
  function cssColor(value) {
    if (typeof value !== 'string' || !value) return '';
    if (value.startsWith('theme:')) {
      const key = value.slice(6);
      return PALETTE_KEYS.includes(key) ? `var(--hp-${key})` : '';
    }
    return COLOR_RE.test(value.trim()) ? value.trim() : '';
  }
  function isColor(value) {
    return cssColor(value) !== '';
  }
  function fontStack(key) {
    return (FONT_BY_KEY[key] || FONT_BY_KEY.system).stack;
  }
  function safeUrl(url) {
    if (typeof url !== 'string') return '';
    const u = url.trim();
    if (!u) return '';
    if (/^(https?:\/\/|mailto:|tel:)/i.test(u)) return u;
    if (/^\/(?!\/)/.test(u) || /^#[A-Za-z0-9_-]*$/.test(u)) return u;
    return '';
  }
  // href forms: "page:<pageId>", "page:<pageId>#anchor", "#anchor", or a URL.
  function resolveHref(href, ctx) {
    if (typeof href !== 'string' || !href) return '';
    const m = /^page:([A-Za-z0-9_-]+)(#[A-Za-z0-9_-]+)?$/.exec(href);
    if (m) {
      const page = (ctx.pages || []).find((p) => p.id === m[1]);
      if (!page) return '';
      return (page.isHome ? '/' : '/' + page.slug) + (m[2] || '');
    }
    return safeUrl(href);
  }
  function linkAttrs(link, ctx) {
    if (!link || !link.href) return null;
    const href = resolveHref(link.href, ctx);
    if (!href) return null;
    return ` href="${esc(href)}"${link.newTab ? ' target="_blank" rel="noopener"' : ''}`;
  }
  function mediaInfo(ctx, id) {
    if (!id || !ctx.media) return null;
    return ctx.media[id] || null;
  }
  function textToHtml(text) {
    return esc(text).replace(/\r?\n/g, '<br>');
  }

  // ---------- responsive layout ----------
  function deviceCascade(device) {
    return device === 'desktop' ? ['desktop'] : device === 'tablet' ? ['desktop', 'tablet'] : ['desktop', 'tablet', 'mobile'];
  }
  // hidden/visibility flags cascade desktop -> tablet -> mobile unless a
  // later device sets its own value (null/undefined = inherit).
  function isHidden(item, device) {
    const h = (item && item.hidden) || {};
    let v = false;
    for (const d of deviceCascade(device)) if (typeof h[d] === 'boolean') v = h[d];
    return v;
  }
  function sortedElements(section) {
    return (section.elements || []).slice().sort((a, b) => a.layout.desktop.y - b.layout.desktop.y || a.layout.desktop.x - b.layout.desktop.x);
  }
  // Wix's own default when nothing was arranged for mobile: stack the
  // desktop elements top-to-bottom in reading order, single column.
  function autoStack(section) {
    const out = {};
    const W = DEVICE_WIDTH.mobile;
    let y = 24;
    for (const el of sortedElements(section)) {
      if (isHidden(el, 'mobile')) continue;
      const d = el.layout.desktop;
      const full = el.type === 'text' || el.type === 'line' || FLOW_TYPES.has(el.type) || d.w > 280;
      const w = full ? W - 32 : Math.max(24, Math.min(W - 32, d.w));
      let h = d.h;
      if (el.type === 'image' || el.type === 'video' || el.type === 'gallery' || el.type === 'slideshow' || el.type === 'map' || el.type === 'shape' || el.type === 'embed') h = Math.max(20, Math.round((d.h * w) / Math.max(1, d.w)));
      else if (el.type === 'text') h = Math.round(d.h * Math.min(3, Math.max(1, d.w / w) * 0.85 + 0.15));
      out[el.id] = { x: Math.round((W - w) / 2), y, w, h };
      y += h + 16;
    }
    return { positions: out, height: Math.max(80, y + 8) };
  }
  function sectionMobileAuto(section) {
    return !(section.elements || []).some((el) => el.layout.mobile);
  }
  function layoutFor(el, device, section, autoCache) {
    const d = el.layout.desktop;
    if (device === 'desktop') return d;
    if (device === 'tablet') {
      if (el.layout.tablet) return el.layout.tablet;
      const k = DEVICE_WIDTH.tablet / DEVICE_WIDTH.desktop;
      return { x: Math.round(d.x * k), y: d.y, w: Math.round(d.w * k), h: d.h };
    }
    if (el.layout.mobile) return el.layout.mobile;
    const auto = autoCache || autoStack(section);
    return auto.positions[el.id] || { x: 16, y: d.y, w: DEVICE_WIDTH.mobile - 32, h: d.h };
  }
  function sectionHeight(section, device) {
    const h = section.height || {};
    if (device === 'desktop') return h.desktop || 400;
    if (device === 'tablet') return h.tablet || h.desktop || 400;
    if (h.mobile) return h.mobile;
    if (sectionMobileAuto(section)) return autoStack(section).height;
    let bottom = 0;
    const auto = autoStack(section);
    for (const el of section.elements || []) {
      if (isHidden(el, 'mobile')) continue;
      const l = layoutFor(el, 'mobile', section, auto);
      bottom = Math.max(bottom, l.y + l.h);
    }
    return Math.max(80, bottom + 24);
  }
  // Effective style on a device: preset (global design preset) < element
  // style < tablet override < mobile override.
  function styleFor(el, device, doc) {
    let s = {};
    const presetId = el.style && el.style.presetId;
    if (presetId && doc && doc.design && Array.isArray(doc.design.presets)) {
      const p = doc.design.presets.find((x) => x.id === presetId);
      if (p) s = { ...p.style };
    }
    s = { ...s, ...(el.style || {}) };
    if (device !== 'desktop' && el.styleBy && el.styleBy.tablet) s = { ...s, ...el.styleBy.tablet };
    if (device === 'mobile' && el.styleBy && el.styleBy.mobile) s = { ...s, ...el.styleBy.mobile };
    return s;
  }

  // ---------- CSS generation ----------
  function bgCss(bg) {
    const parts = [];
    if (!bg) return parts;
    if (bg.color && cssColor(bg.color)) parts.push(`background-color:${cssColor(bg.color)}`);
    if (bg.gradient && cssColor(bg.gradient.from) && cssColor(bg.gradient.to)) {
      parts.push(`background-image:linear-gradient(${num(bg.gradient.angle, 0, 360, 180)}deg, ${cssColor(bg.gradient.from)}, ${cssColor(bg.gradient.to)})`);
    }
    return parts;
  }
  function boxCss(s) {
    const out = bgCss({ color: s.bg, gradient: s.gradient });
    if (s.borderWidth) out.push(`border:${num(s.borderWidth, 0, 40, 0)}px ${['solid', 'dashed', 'dotted', 'double'].includes(s.borderStyle) ? s.borderStyle : 'solid'} ${cssColor(s.borderColor) || 'currentColor'}`);
    if (s.radius) out.push(`border-radius:${num(s.radius, 0, 999, 0)}px`);
    if (s.shadow && SHADOWS[s.shadow]) out.push(`box-shadow:${SHADOWS[s.shadow]}`);
    if (s.padding) out.push(`padding:${num(s.padding, 0, 200, 0)}px`);
    return out;
  }
  function textCss(s) {
    const out = [];
    if (s.fontFamily && FONT_BY_KEY[s.fontFamily]) out.push(`font-family:${fontStack(s.fontFamily)}`);
    if (s.fontSize) out.push(`font-size:${num(s.fontSize, 6, 240, 16)}px`);
    if (s.fontWeight) out.push(`font-weight:${num(s.fontWeight, 100, 900, 400)}`);
    if (s.lineHeight) out.push(`line-height:${num(s.lineHeight, 0.6, 4, 1.4)}`);
    if (s.letterSpacing != null && s.letterSpacing !== 0) out.push(`letter-spacing:${num(s.letterSpacing, -10, 40, 0)}px`);
    if (s.textTransform && ['none', 'uppercase', 'lowercase', 'capitalize'].includes(s.textTransform)) out.push(`text-transform:${s.textTransform}`);
    if (cssColor(s.color)) out.push(`color:${cssColor(s.color)}`);
    if (s.align && ['left', 'center', 'right', 'justify'].includes(s.align)) out.push(`text-align:${s.align}`);
    if (s.italic) out.push('font-style:italic');
    if (s.underline) out.push('text-decoration:underline');
    return out;
  }
  // The inner visual box (.wx-box) carries the look; the outer element
  // wrapper only carries position, so hover/entrance transforms on the
  // inner box never fight with layout.
  function elementBoxCss(el, s) {
    const out = [];
    if (el.type === 'line') {
      const c = cssColor(s.color) || 'currentColor';
      const t = num(s.thickness, 1, 40, 2);
      if (s.orientation === 'vertical') out.push(`border-left:${t}px ${s.borderStyle === 'dashed' || s.borderStyle === 'dotted' ? s.borderStyle : 'solid'} ${c}`, 'width:0', 'height:100%', 'margin:0 auto');
      else out.push(`border-top:${t}px ${s.borderStyle === 'dashed' || s.borderStyle === 'dotted' ? s.borderStyle : 'solid'} ${c}`, 'height:0', 'width:100%', 'margin:0');
      return out;
    }
    out.push(...boxCss(s));
    if (el.type === 'shape' && s.shape === 'circle') out.push('border-radius:50%');
    // Text elements put their typography on the heading/paragraph itself
    // (textInnerCss) so it beats the global .wx-ts-* text style.
    if (el.type !== 'image' && el.type !== 'icon' && el.type !== 'text') out.push(...textCss(s));
    if (el.type === 'icon' && cssColor(s.color)) out.push(`color:${cssColor(s.color)}`);
    if (el.type === 'button') {
      if (!s.bg && !s.gradient) out.push('background-color:var(--hp-primary)');
      if (!cssColor(s.color)) out.push('color:#fff');
      if (s.radius == null) out.push('border-radius:6px');
    }
    return out;
  }
  function animDuration(el) {
    return el.anim && el.anim.type && el.anim.type !== 'none' ? num(el.anim.duration, 100, 5000, 700) : 0;
  }
  function deviceRules(page, doc, device) {
    const rules = [];
    const W = DEVICE_WIDTH[device];
    for (const section of page.sections || []) {
      const hid = isHidden(section, device);
      const auto = device === 'mobile' ? autoStack(section) : null;
      const flowMobile = device === 'mobile' && sectionMobileAuto(section);
      // Auto-stacked mobile strips size to their real content (estimated
      // text heights would leave gaps) unless a mobile height was set.
      const minH = flowMobile && !(section.height && section.height.mobile) ? 0 : sectionHeight(section, device);
      rules.push(`#s-${section.id}{min-height:${minH}px;${hid ? 'display:none;' : 'display:block;'}}`);
      for (const el of section.elements || []) {
        const l = layoutFor(el, device, section, auto);
        const s = styleFor(el, device, doc);
        const pos = [];
        if (isHidden(el, device)) pos.push('display:none');
        else pos.push('display:block');
        // Opacity sits on the outer wrapper so it never fights the
        // entrance animation's own opacity on the inner .wx-box.
        if (s.opacity != null && s.opacity !== 100) pos.push(`opacity:${num(s.opacity, 0, 100, 100) / 100}`);
        if (flowMobile) pos.push('margin:0 auto', `width:${round2((l.w / W) * 100)}%`);
        else pos.push(`margin:${l.y}px 0 0 ${round2((l.x / W) * 100)}%`, `width:${round2((l.w / W) * 100)}%`);
        if (flowMobile && el.type === 'text') pos.push('min-height:0', 'height:auto');
        else pos.push(`${FLOW_TYPES.has(el.type) ? 'min-height' : 'height'}:${l.h}px`);
        if (FLOW_TYPES.has(el.type)) pos.push('height:auto');
        rules.push(`#e-${el.id}{${pos.join(';')}}`);
        rules.push(`#e-${el.id}>.wx-box{${elementBoxCss(el, s).join(';')}}`);
        if (el.type === 'text') rules.push(`#e-${el.id} .wx-text{${textCss(s).join(';')}}`);
      }
    }
    return rules.join('\n');
  }
  function sectionBgCss(section) {
    const bg = section.bg || {};
    const parts = bgCss({ color: bg.color, gradient: bg.type === 'gradient' ? bg.gradient : null });
    if (bg.type === 'image' && bg.imageUrl) {
      parts.push(`background-image:${bg.overlay && cssColor(bg.overlay.color) ? `linear-gradient(${cssColor(bg.overlay.color)}, ${cssColor(bg.overlay.color)}), ` : ''}url("${String(bg.imageUrl).replace(/["\\()]/g, '')}")`);
      parts.push(`background-size:${['cover', 'contain', 'auto'].includes(bg.size) ? bg.size : 'cover'}`);
      parts.push(`background-position:${num(bg.posX, 0, 100, 50)}% ${num(bg.posY, 0, 100, 50)}%`);
      parts.push(`background-repeat:${bg.repeat ? 'repeat' : 'no-repeat'}`);
      if (bg.parallax) parts.push('background-attachment:fixed');
    }
    if (cssColor(section.textColor)) parts.push(`color:${cssColor(section.textColor)}`);
    return parts;
  }
  function pageCss(page, doc) {
    const desktop = [];
    for (const section of page.sections || []) {
      const parts = sectionBgCss(section);
      desktop.push(`#s-${section.id}{${parts.join(';')}}`);
      for (const el of section.elements || []) {
        const extra = [`z-index:${num(el.z, 0, 9999, 1)}`];
        if (el.sticky) extra.push('position:sticky', 'top:0', 'align-self:start');
        desktop.push(`#e-${el.id}{${extra.join(';')}}`);
        const d = animDuration(el);
        if (d) desktop.push(`#e-${el.id}>.wx-box{transition-duration:${d}ms;transition-delay:${num(el.anim.delay, 0, 5000, 0)}ms}`);
      }
    }
    return [
      desktop.join('\n'),
      deviceRules(page, doc, 'desktop'),
      `@media (max-width:${TABLET_MAX}px){\n${deviceRules(page, doc, 'tablet')}\n}`,
      `@media (max-width:${MOBILE_MAX}px){\n${deviceRules(page, doc, 'mobile')}\n.wx-sec-flowm>.wx-sec-inner{display:flex;flex-direction:column;gap:16px;padding:24px 0}\n#wx-site [id^="s-"]{background-attachment:scroll !important}\n}`,
    ].join('\n');
  }
  // Site-wide design tokens + text styles, scoped to #wx-site.
  function designCss(doc, opts) {
    const d = doc.design || {};
    const p = d.palette || {};
    const vars = [];
    for (const k of PALETTE_KEYS) if (cssColor(p[k])) vars.push(`--hp-${k}:${p[k]}`);
    vars.push(`--hp-font-heading:${fontStack(d.fontHeading)}`);
    vars.push(`--hp-font-body:${fontStack(d.fontBody)}`);
    const out = [`#wx-site{${vars.join(';')};background:var(--hp-background);color:var(--hp-text);font-family:var(--hp-font-body)}`];
    const ts = d.textStyles || {};
    for (const key of TEXT_STYLE_KEYS) {
      const s = ts[key] || {};
      const css = textCss({ ...s, align: undefined });
      if (!s.fontFamily) css.unshift(`font-family:${key.startsWith('h') ? 'var(--hp-font-heading)' : 'var(--hp-font-body)'}`);
      out.push(`#wx-site .wx-ts-${key}{${css.join(';')}}`);
    }
    // Like Wix, big headings shrink on phones unless an element sets its
    // own mobile font size (that rule is more specific and wins).
    const scaled = [];
    for (const key of ['h1', 'h2', 'h3']) {
      const size = (ts[key] && ts[key].fontSize) || { h1: 48, h2: 36, h3: 26 }[key];
      scaled.push(`#wx-site .wx-ts-${key}{font-size:${Math.max(18, Math.round(size * (key === 'h3' ? 0.85 : 0.68)))}px}`);
    }
    // The editor canvas passes its current device instead of relying on
    // a media query (its viewport is never phone-sized).
    if (opts && opts.device) {
      if (opts.device === 'mobile') out.push(scaled.join(''));
    } else out.push(`@media (max-width:${MOBILE_MAX}px){${scaled.join('')}}`);
    const h = doc.header || {};
    const hv = [];
    if (cssColor(h.bg)) hv.push(`--wx-header-bg:${cssColor(h.bg)}`);
    if (cssColor(h.textColor)) hv.push(`--wx-header-text:${cssColor(h.textColor)}`);
    if (cssColor(h.navColor)) hv.push(`--wx-nav-color:${cssColor(h.navColor)}`);
    if (cssColor(h.navHover)) hv.push(`--wx-nav-hover:${cssColor(h.navHover)}`);
    if (cssColor(h.navActive)) hv.push(`--wx-nav-active:${cssColor(h.navActive)}`);
    hv.push(`--wx-header-height:${num(h.height, 48, 240, 84)}px`);
    hv.push(`--wx-nav-size:${num(h.navSize, 10, 32, 16)}px`);
    hv.push(`--wx-nav-weight:${num(h.navWeight, 100, 900, 600)}`);
    hv.push(`--wx-nav-gap:${num(h.navSpacing, 0, 80, 24)}px`);
    hv.push(`--wx-nav-font:${h.navFont && FONT_BY_KEY[h.navFont] ? fontStack(h.navFont) : 'var(--hp-font-heading)'}`);
    out.push(`#wx-site .wx-header{${hv.join(';')}}`);
    if (h.imageUrl) out.push(`#wx-site .wx-header{background-image:url("${String(h.imageUrl).replace(/["\\()]/g, '')}")}`);
    return out.join('\n');
  }
  function googleFontsHref(doc) {
    const used = new Set();
    const d = doc.design || {};
    used.add(d.fontHeading);
    used.add(d.fontBody);
    if (doc.header && doc.header.navFont) used.add(doc.header.navFont);
    for (const s of Object.values(d.textStyles || {})) if (s && s.fontFamily) used.add(s.fontFamily);
    for (const page of doc.pages || []) {
      for (const sec of page.sections || []) {
        for (const el of sec.elements || []) {
          if (el.style && el.style.fontFamily) used.add(el.style.fontFamily);
          for (const dev of ['tablet', 'mobile']) if (el.styleBy && el.styleBy[dev] && el.styleBy[dev].fontFamily) used.add(el.styleBy[dev].fontFamily);
        }
      }
    }
    const fams = [...used].map((k) => FONT_BY_KEY[k]).filter((f) => f && f.google).map((f) => 'family=' + f.google);
    if (!fams.length) return '';
    return 'https://fonts.googleapis.com/css2?' + fams.join('&') + '&display=swap';
  }

  // ---------- element inner HTML ----------
  function videoEmbedUrl(url) {
    if (typeof url !== 'string') return '';
    let m = /^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/.exec(url.trim());
    if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
    m = /^https?:\/\/(?:www\.)?(?:player\.)?vimeo\.com\/(?:video\/)?(\d{4,15})/.exec(url.trim());
    if (m) return `https://player.vimeo.com/video/${m[1]}`;
    return '';
  }
  function iconSvg(name, label) {
    const body = ICONS[name] || ICONS.star;
    const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true" focusable="false"';
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`;
  }
  function imgTag(info, alt, fit, extraClass) {
    if (!info) return '';
    const pos = `${num(info.focalX, 0, 100, 50)}% ${num(info.focalY, 0, 100, 50)}%`;
    return `<img class="${extraClass || 'wx-img'}" src="${esc(info.url)}" alt="${esc(alt != null && alt !== '' ? alt : info.alt || '')}" loading="lazy" style="object-fit:${fit === 'contain' ? 'contain' : 'cover'};object-position:${pos}" />`;
  }
  function placeholder(ctx, label) {
    return ctx.editor ? `<div class="wx-placeholder">${esc(label)}</div>` : '';
  }

  function renderInner(el, ctx) {
    const p = el.props || {};
    const data = ctx.data || {};
    switch (el.type) {
      case 'text': {
        const tag = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'].includes(p.tag) ? p.tag : 'p';
        const ts = TEXT_STYLE_KEYS.includes(p.textStyle) ? p.textStyle : tag === 'p' ? 'p' : TEXT_STYLE_KEYS.includes(tag) ? tag : 'h4';
        return `<${tag} class="wx-text wx-ts-${ts}">${p.html || ''}</${tag}>`;
      }
      case 'image': {
        const info = mediaInfo(ctx, p.mediaId);
        if (!info) return placeholder(ctx, 'Image - choose a picture');
        const img = imgTag(info, p.alt, p.fit);
        const la = linkAttrs(p.link, ctx);
        const cap = p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : '';
        return `<figure class="wx-figure">${la ? `<a${la}>${img}</a>` : img}${cap}</figure>`;
      }
      case 'button': {
        const la = linkAttrs(p.link, ctx);
        const label = esc(p.label || 'Button');
        const icon = p.icon && ICONS[p.icon] ? iconSvg(p.icon) : '';
        return la ? `<a class="wx-btn"${la}>${icon}<span>${label}</span></a>` : `<span class="wx-btn">${icon}<span>${label}</span></span>`;
      }
      case 'icon': {
        const la = linkAttrs(p.link, ctx);
        const svg = iconSvg(p.icon, la ? null : p.label);
        return la ? `<a class="wx-icon"${la} aria-label="${esc(p.label || p.icon || 'Link')}">${svg}</a>` : `<span class="wx-icon">${svg}</span>`;
      }
      case 'shape':
        return '';
      case 'line':
        return '';
      case 'video': {
        if (p.source === 'upload') {
          const info = mediaInfo(ctx, p.mediaId);
          if (!info) return placeholder(ctx, 'Video - choose a video file');
          return `<video class="wx-video" src="${esc(info.url)}"${p.controls !== false ? ' controls' : ''}${p.autoplay ? ' autoplay muted playsinline' : ''}${p.loop ? ' loop' : ''} preload="metadata"></video>`;
        }
        const src = videoEmbedUrl(p.url);
        if (!src) return placeholder(ctx, 'Video - paste a YouTube or Vimeo link');
        if (ctx.editor) return `<div class="wx-video-thumb">${iconSvg('youtube')}<span>${esc(p.title || 'Video')}</span></div>`;
        return `<iframe class="wx-video" src="${esc(src)}" title="${esc(p.title || 'Video')}" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
      }
      case 'gallery': {
        const items = (p.items || []).map((it) => ({ it, info: mediaInfo(ctx, it.mediaId) })).filter((x) => x.info);
        if (!items.length) return placeholder(ctx, 'Gallery - add pictures');
        const cols = num(p.columns, 1, 6, 3);
        return `<ul class="wx-gallery" style="grid-template-columns:repeat(${cols},1fr);gap:${num(p.gap, 0, 60, 8)}px">${items
          .map(({ it, info }) => `<li>${imgTag(info, it.alt, 'cover')}${it.caption ? `<span class="wx-gallery-cap">${esc(it.caption)}</span>` : ''}</li>`)
          .join('')}</ul>`;
      }
      case 'slideshow': {
        const slides = (p.slides || []).map((sl) => ({ sl, info: mediaInfo(ctx, sl.mediaId) })).filter((x) => x.info || x.sl.title);
        if (!slides.length) return placeholder(ctx, 'Slideshow - add slides');
        return `<div class="wx-slideshow" data-autoplay="${p.autoplay ? num(p.interval, 2, 30, 5) : 0}" role="region" aria-roledescription="carousel" aria-label="${esc(p.label || 'Slideshow')}"><div class="wx-slides">${slides
          .map(
            ({ sl, info }, i) =>
              `<div class="wx-slide${i === 0 ? ' is-active' : ''}" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}"${i === 0 ? '' : ' hidden'}>${info ? imgTag(info, sl.alt, 'cover', 'wx-slide-img') : ''}${
                sl.title || sl.text ? `<div class="wx-slide-caption">${sl.title ? `<strong>${esc(sl.title)}</strong>` : ''}${sl.text ? `<span>${esc(sl.text)}</span>` : ''}</div>` : ''
              }</div>`
          )
          .join('')}</div>${slides.length > 1 ? '<button type="button" class="wx-slide-prev" aria-label="Previous slide">&#8249;</button><button type="button" class="wx-slide-next" aria-label="Next slide">&#8250;</button>' : ''}</div>`;
      }
      case 'accordion': {
        const items = p.items || [];
        if (!items.length) return placeholder(ctx, 'Accordion - add items');
        return `<div class="wx-accordion">${items.map((it, i) => `<details${i === 0 && p.openFirst ? ' open' : ''}><summary>${esc(it.title)}</summary><div class="wx-acc-body">${textToHtml(it.body)}</div></details>`).join('')}</div>`;
      }
      case 'tabs': {
        const tabs = p.tabs || [];
        if (!tabs.length) return placeholder(ctx, 'Tabs - add tabs');
        const base = `t-${el.id}`;
        return `<div class="wx-tabs"><div class="wx-tablist" role="tablist">${tabs
          .map((t, i) => `<button type="button" role="tab" id="${base}-tab-${i}" aria-controls="${base}-panel-${i}" aria-selected="${i === 0}"${i === 0 ? '' : ' tabindex="-1"'}>${esc(t.title)}</button>`)
          .join('')}</div>${tabs.map((t, i) => `<div class="wx-tabpanel" role="tabpanel" id="${base}-panel-${i}" aria-labelledby="${base}-tab-${i}"${i === 0 ? '' : ' data-wx-hidden'}>${textToHtml(t.body)}</div>`).join('')}</div>`;
      }
      case 'social': {
        const links = (p.links || []).filter((l) => SOCIAL_NETWORKS.includes(l.network) && safeUrl(l.url));
        if (!links.length) return placeholder(ctx, 'Social links - add profiles');
        return `<ul class="wx-social" style="gap:${num(p.gap, 0, 60, 12)}px">${links
          .map((l) => `<li><a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener" aria-label="${esc(SOCIAL_LABEL[l.network])}">${iconSvg(l.network)}</a></li>`)
          .join('')}</ul>`;
      }
      case 'map': {
        if (!p.address) return placeholder(ctx, 'Map - enter an address');
        if (ctx.editor) return `<div class="wx-map-thumb">${iconSvg('map-pin')}<span>${esc(p.address)}</span></div>`;
        return `<iframe class="wx-map" title="Map: ${esc(p.address)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${encodeURIComponent(p.address)}&z=${num(p.zoom, 1, 20, 14)}&output=embed"></iframe>`;
      }
      case 'embed': {
        if (!p.html) return placeholder(ctx, 'Custom embed - paste HTML');
        // Security boundary: custom HTML only ever runs inside a sandboxed
        // srcdoc iframe with NO allow-same-origin, so it can't read this
        // site's cookies/session/DOM.
        if (ctx.editor) return `<iframe class="wx-embed" sandbox="" srcdoc="${esc(p.html)}" title="${esc(p.title || 'Embedded content')}" tabindex="-1"></iframe>`;
        return `<iframe class="wx-embed" sandbox="allow-scripts allow-popups" srcdoc="${esc(p.html)}" title="${esc(p.title || 'Embedded content')}" loading="lazy"></iframe>`;
      }
      case 'form': {
        const form = (data.forms || []).find((f) => String(f.id) === String(p.formId));
        if (!form) return placeholder(ctx, 'Form - choose one of your Custom Forms');
        const href = ctx.portalAccount ? `/forms/${form.id}` : `/login?next=${encodeURIComponent('/forms/' + form.id)}`;
        return `<div class="wx-form-card"><h3>${esc(p.title || form.title)}</h3>${p.description || form.description ? `<p>${esc(p.description || form.description)}</p>` : ''}<a class="wx-btn" href="${esc(href)}">${esc(p.buttonLabel || 'Fill out form')}</a>${ctx.portalAccount ? '' : '<p class="wx-form-note">Members sign in to fill this out.</p>'}</div>`;
      }
      case 'login':
        return ctx.portalAccount ? `<a class="wx-btn" href="/portal">${esc(p.portalLabel || 'My Portals')}</a>` : `<a class="wx-btn" href="/login">${esc(p.loginLabel || 'Log in')}</a>`;
      case 'menu':
        return `<nav class="wx-inline-menu" aria-label="${esc(p.label || 'Page menu')}">${renderMenuList(ctx.menu || [], ctx, false)}</nav>`;
      case 'classes': {
        const list = data.classes || [];
        if (!list.length) return placeholder(ctx, 'Classes showcase - no public classes yet (hidden on the live site)');
        return `<div class="wx-widget"><ul class="wx-card-list">${list
          .map((c) => `<li class="wx-card" style="border-left:4px solid ${cssColor(c.color) || 'var(--hp-primary)'}"><span class="wx-card-kicker">${esc(c.dayLabel)}</span><h3>${esc(c.className)}</h3>${c.timeLabel ? `<p>${esc(c.timeLabel)}</p>` : ''}</li>`)
          .join('')}</ul>${p.showButton !== false ? '<a class="wx-btn" href="/register">Member Registration to Enroll</a>' : ''}</div>`;
      }
      case 'announcements': {
        const list = (data.announcements || []).slice(0, num(p.limit, 1, 10, 3));
        if (!list.length) return placeholder(ctx, 'Announcements - none public right now (hidden on the live site)');
        return `<ul class="wx-card-list wx-widget">${list.map((a) => `<li class="wx-card"><span class="wx-card-kicker">${esc(a.publishedLabel)}</span><h3>${esc(a.title)}</h3><div class="wx-rich">${a.body || ''}</div></li>`).join('')}</ul>`;
      }
      case 'faq': {
        const list = data.faqs || [];
        if (!list.length) return placeholder(ctx, 'FAQ - no public questions yet (hidden on the live site)');
        return `<div class="wx-accordion wx-widget">${list.map((f) => `<details><summary>${esc(f.question)}</summary><div class="wx-acc-body">${textToHtml(f.answer)}</div></details>`).join('')}</div>`;
      }
      case 'events': {
        const list = (data.events || []).slice(0, num(p.limit, 1, 12, 4));
        if (!list.length) return placeholder(ctx, 'Upcoming events - none public right now (hidden on the live site)');
        return `<ul class="wx-card-list wx-widget">${list.map((e) => `<li class="wx-card"><span class="wx-card-kicker">${esc(e.dateLabel)}</span><h3><a href="/events/${esc(e.id)}">${esc(e.title)}</a></h3>${e.locationName ? `<p>${esc(e.locationName)}</p>` : ''}</li>`).join('')}</ul>`;
      }
      default:
        return '';
    }
  }
  // A live-data widget with nothing to show renders nothing publicly; a
  // section made only of those disappears entirely (old fixed sections
  // like "Classes We Offer" only ever showed up once they had data).
  function elementIsEmpty(el, ctx) {
    return renderInner(el, { ...ctx, editor: false }) === '' && el.type !== 'shape' && el.type !== 'line';
  }

  function elementClasses(el) {
    const c = ['wx-el', `wx-el-${el.type}`];
    if (el.anim && el.anim.type && el.anim.type !== 'none' && ANIMATIONS.includes(el.anim.type)) c.push('wx-anim', `wx-anim-${el.anim.type}`);
    if (el.hover && HOVER_EFFECTS.includes(el.hover) && el.hover !== 'none') c.push(`wx-hover-${el.hover}`);
    return c.join(' ');
  }
  function renderElement(el, ctx) {
    const inner = renderInner(el, ctx);
    if (!inner && el.type !== 'shape' && el.type !== 'line') return '';
    const scroll = el.anim && el.anim.trigger === 'load' ? ' data-anim-trigger="load"' : '';
    return `<div class="${elementClasses(el)}" id="e-${esc(el.id)}"${scroll}><div class="wx-box">${inner}</div></div>`;
  }
  function renderSection(section, ctx) {
    const els = sortedElements(section);
    const html = els.map((el) => renderElement(el, ctx)).filter(Boolean);
    if (!html.length && els.length) return ''; // only empty live-data widgets
    if (!ctx.editor && section.autoHide) {
      const widgets = els.filter((el) => WIDGET_TYPES.has(el.type));
      if (widgets.length && widgets.every((el) => renderInner(el, ctx) === '')) return '';
    }
    let video = '';
    const bg = section.bg || {};
    if (bg.type === 'video' && bg.videoUrl) {
      video = `<video class="wx-sec-video" src="${esc(bg.videoUrl)}" autoplay muted loop playsinline aria-hidden="true"></video>${bg.overlay && cssColor(bg.overlay.color) ? `<div class="wx-sec-overlay" style="background:${cssColor(bg.overlay.color)}"></div>` : ''}`;
    }
    const cls = ['wx-section'];
    if (sectionMobileAuto(section)) cls.push('wx-sec-flowm');
    const label = section.name ? ` aria-label="${esc(section.name)}"` : '';
    const anchor = section.anchor ? `<span class="wx-anchor" id="${esc(section.anchor)}"></span>` : '';
    return `<section class="${cls.join(' ')}" id="s-${esc(section.id)}"${label}>${anchor}${video}<div class="wx-sec-inner">${html.join('')}</div></section>`;
  }

  // ---------- header / nav / footer ----------
  function menuItemHref(item, ctx) {
    if (item.type === 'page') return resolveHref('page:' + item.pageId, ctx);
    if (item.type === 'link') return resolveHref(item.href, ctx);
    return '';
  }
  function menuItemLabel(item, ctx) {
    if (item.type === 'page') {
      const page = (ctx.pages || []).find((p) => p.id === item.pageId);
      return item.label || (page ? page.title : '');
    }
    return item.label || '';
  }
  function visibleMenuItems(items, ctx) {
    return (items || []).filter((item) => {
      if (item.type !== 'page') return true;
      const page = (ctx.pages || []).find((p) => p.id === item.pageId);
      return page && !page.hidden;
    });
  }
  function renderMenuList(items, ctx, nested) {
    const vis = visibleMenuItems(items, ctx);
    if (!vis.length) return '';
    return `<ul class="${nested ? 'wx-submenu' : 'wx-menu'}">${vis
      .map((item) => {
        const label = esc(menuItemLabel(item, ctx));
        const href = menuItemHref(item, ctx);
        const current = item.type === 'page' && item.pageId === ctx.currentPageId ? ' aria-current="page"' : '';
        const kids = renderMenuList(item.children, ctx, true);
        const link = href ? `<a href="${esc(href)}"${current}${item.newTab ? ' target="_blank" rel="noopener"' : ''}>${label}</a>` : `<span class="wx-menu-folder" tabindex="0">${label}</span>`;
        return `<li${kids ? ' class="has-sub"' : ''}>${link}${kids}</li>`;
      })
      .join('')}</ul>`;
  }
  function renderHeader(doc, ctx) {
    const h = doc.header || {};
    if (h.show === false) return '';
    const a = h.announcement || {};
    const bar = a.enabled && a.text ? `<div class="wx-announcement" style="${cssColor(a.bg) ? `background:${cssColor(a.bg)};` : ''}${cssColor(a.color) ? `color:${cssColor(a.color)}` : ''}">${esc(a.text)}</div>` : '';
    const util =
      h.showLogin !== false
        ? `<div class="wx-utility">${ctx.portalAccount ? '<a class="wx-btn" href="/portal">My Portals</a>' : '<a class="wx-btn wx-btn-outline" href="/login">Log in</a>'}</div>`
        : '';
    const homeHref = '/';
    const logo = h.showLogo !== false ? `<img src="${esc(h.logoUrl || '/img/logo.png')}" alt="" class="wx-logo" />` : '';
    const name = h.showSiteName !== false ? `<span>${esc((doc.site && doc.site.orgName) || '')}</span>` : '';
    const menu = renderMenuList(doc.menu || [], ctx, false);
    const cls = ['wx-header'];
    if (h.sticky) cls.push('is-sticky');
    if (h.transparent) cls.push('is-transparent');
    if (h.burgerAt === 'tablet') cls.push('burger-tablet');
    const nav = menu
      ? `<nav class="wx-nav" aria-label="Site menu"><button type="button" class="wx-burger" aria-expanded="false" aria-controls="wx-menu-list"><span class="wx-burger-bars" aria-hidden="true"></span><span class="wx-sr">Menu</span></button><div id="wx-menu-list" class="wx-menu-wrap">${menu}</div></nav>`
      : '';
    return `${bar}${util}<header class="${cls.join(' ')}"><a class="wx-brand" href="${homeHref}">${logo}${name}</a>${nav}</header>`;
  }
  function renderFooter(doc, ctx) {
    const f = doc.footer || {};
    if (f.show === false) return '';
    const site = doc.site || {};
    const parts = [];
    if (f.imageUrl) parts.push(`<img src="${esc(f.imageUrl)}" alt="" class="wx-footer-image" />`);
    if (f.text) parts.push(`<p class="wx-footer-text">${textToHtml(f.text)}</p>`);
    const contact = [];
    if (site.contactEmail) contact.push(`<a href="mailto:${esc(site.contactEmail)}">${esc(site.contactEmail)}</a>`);
    if (site.contactPhone) contact.push(esc(site.contactPhone));
    if (contact.length) parts.push(`<p>${contact.join(' &middot; ')}</p>`);
    parts.push(`<p>&copy; ${ctx.year || new Date().getFullYear()} ${esc(site.orgName || '')}. All rights reserved.</p>`);
    return `<footer class="wx-footer"${cssColor(f.bg) ? ` style="background:${cssColor(f.bg)}${cssColor(f.color) ? `;color:${cssColor(f.color)}` : ''}"` : ''}>${parts.join('')}</footer>`;
  }
  function renderPageBody(doc, page, ctx) {
    const c = { ...ctx, pages: doc.pages, menu: doc.menu, currentPageId: page.id };
    const landing = page.type === 'landing';
    return `${landing ? '' : renderHeader(doc, c)}<main id="main-content" tabindex="-1">${(page.sections || []).map((s) => renderSection(s, c)).join('')}</main>${landing ? '' : renderFooter(doc, c)}`;
  }

  // Resolves every media id the doc references into a URL (media map:
  // { [id]: { url, alt, focalX, focalY, kind } }) - section backgrounds,
  // header logo/image, footer image. Element media resolve at render time
  // through ctx.media instead.
  function hydrate(doc, media) {
    const url = (id) => (id && media[id] ? media[id].url : null);
    for (const page of doc.pages || []) {
      for (const s of page.sections || []) {
        if (!s.bg) continue;
        s.bg.imageUrl = url(s.bg.mediaId);
        s.bg.videoUrl = url(s.bg.videoId);
        if (s.bg.imageUrl && media[s.bg.mediaId] && s.bg.posX == null) {
          s.bg.posX = media[s.bg.mediaId].focalX;
          s.bg.posY = media[s.bg.mediaId].focalY;
        }
      }
    }
    if (doc.header) {
      doc.header.logoUrl = url(doc.header.logoId);
      doc.header.imageUrl = url(doc.header.imageId);
    }
    if (doc.footer) doc.footer.imageUrl = url(doc.footer.imageId);
    return doc;
  }

  return {
    hydrate,
    DEVICES,
    DEVICE_WIDTH,
    TABLET_MAX,
    MOBILE_MAX,
    FLOW_TYPES,
    WIDGET_TYPES,
    FONTS,
    FONT_BY_KEY,
    PALETTE_KEYS,
    TEXT_STYLE_KEYS,
    ANIMATIONS,
    HOVER_EFFECTS,
    SHADOWS,
    ICONS,
    SOCIAL_NETWORKS,
    SOCIAL_LABEL,
    esc,
    num,
    cssColor,
    isColor,
    fontStack,
    safeUrl,
    resolveHref,
    videoEmbedUrl,
    iconSvg,
    isHidden,
    autoStack,
    sectionMobileAuto,
    layoutFor,
    sectionHeight,
    styleFor,
    elementBoxCss,
    textCss,
    boxCss,
    bgCss,
    pageCss,
    sectionBgCss,
    designCss,
    googleFontsHref,
    renderInner,
    renderElement,
    renderSection,
    renderHeader,
    renderFooter,
    renderMenuList,
    renderPageBody,
    elementIsEmpty,
    sortedElements,
  };
});
