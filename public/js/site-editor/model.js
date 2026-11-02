// Element factories and document operations (layout per device,
// duplicate, z-order, group, align/distribute, clipboard).
import { R, uid, clone, clamp } from './util.js';
import { S, page, findElement } from './state.js';

export const TYPE_LABEL = {
  text: 'Text', image: 'Image', button: 'Button', icon: 'Icon', shape: 'Shape', line: 'Line', video: 'Video', gallery: 'Gallery',
  slideshow: 'Slideshow', accordion: 'Accordion', tabs: 'Tabs', social: 'Social Bar', map: 'Map', embed: 'Custom Embed', form: 'Form',
  login: 'Log In Button', menu: 'Menu', logo: 'Logo', sitename: 'Site Name', classes: 'Classes Showcase', announcements: 'Announcements', faq: 'FAQ', events: 'Upcoming Events',
};

// Add Elements presets: [type, preset key] -> element skeleton.
export function createElement(type, preset) {
  const base = { id: uid('e'), type, name: TYPE_LABEL[type], layout: { desktop: { x: 0, y: 0, w: 300, h: 60 } }, props: {}, style: {}, z: 1 };
  const L = (w, hh) => (base.layout.desktop = { x: 0, y: 0, w, h: hh });
  switch (type) {
    case 'text': {
      const map = {
        title: ['h1', 'h1', 'Add a Title', 620, 64, 'Title'],
        heading: ['h2', 'h2', 'Add a Heading', 520, 50, 'Heading'],
        subheading: ['h3', 'h3', 'Add a Subheading', 420, 38, 'Subheading'],
        paragraph: ['p', 'p', "I'm a paragraph. Double-click to edit me and add your own text - tell visitors about your co-op.", 420, 80, 'Paragraph'],
        small: ['p', 'small', 'Small text for captions and details.', 320, 24, 'Small text'],
      };
      const [tag, ts, text, w, hh, name] = map[preset] || map.paragraph;
      base.props = { tag, textStyle: ts, html: text };
      base.name = name;
      L(w, hh);
      break;
    }
    case 'image':
      base.props = { fit: 'cover', alt: '' };
      L(360, 240);
      break;
    case 'button':
      base.props = { label: 'Learn More', link: { href: '/register' } };
      if (preset === 'outline') base.style = { bg: 'transparent', color: 'theme:primary', borderWidth: 2, borderColor: 'theme:primary', radius: 6 };
      else if (preset === 'pill') base.style = { bg: 'theme:accent', color: '#FFFFFF', radius: 999 };
      else if (preset === 'dark') base.style = { bg: 'theme:dark', color: '#FFFFFF', radius: 0 };
      L(180, 48);
      break;
    case 'icon':
      base.props = { icon: preset || 'star' };
      base.style = { color: 'theme:primary' };
      L(48, 48);
      break;
    case 'shape':
      if (preset === 'circle') base.style = { bg: 'theme:accent', shape: 'circle' };
      else if (preset === 'card') base.style = { bg: 'theme:cards', radius: 12, shadow: 'md' };
      else if (preset === 'outline') base.style = { bg: 'transparent', borderWidth: 2, borderColor: 'theme:text', radius: 0 };
      else base.style = { bg: 'theme:primary' };
      L(preset === 'circle' ? 160 : 240, 160);
      break;
    case 'line':
      base.style = { color: 'theme:text', thickness: 2, orientation: preset === 'vertical' ? 'vertical' : 'horizontal', borderStyle: preset === 'dashed' ? 'dashed' : 'solid' };
      if (preset === 'vertical') L(20, 160);
      else L(400, 20);
      break;
    case 'video':
      base.props = { source: 'embed', url: '', title: 'Video' };
      L(480, 270);
      break;
    case 'gallery':
      base.props = { items: [], columns: 3, gap: 8 };
      L(600, 300);
      break;
    case 'slideshow':
      base.props = { slides: [], autoplay: true, interval: 5, label: 'Slideshow' };
      L(700, 380);
      break;
    case 'accordion':
      base.props = { items: [{ title: 'Question one', body: 'Answer one.' }, { title: 'Question two', body: 'Answer two.' }], openFirst: true };
      L(600, 160);
      break;
    case 'tabs':
      base.props = { tabs: [{ title: 'Tab 1', body: 'Content for the first tab.' }, { title: 'Tab 2', body: 'Content for the second tab.' }] };
      L(600, 200);
      break;
    case 'social':
      base.props = { links: [{ network: 'facebook', url: 'https://facebook.com/' }, { network: 'instagram', url: 'https://instagram.com/' }], gap: 12 };
      base.style = { color: 'theme:text' };
      L(200, 40);
      break;
    case 'map':
      base.props = { address: 'Sanford, NC', zoom: 13 };
      L(480, 320);
      break;
    case 'embed':
      base.props = { html: '<p style="font-family:sans-serif">Paste your embed code in Settings.</p>', title: 'Embedded content' };
      L(400, 240);
      break;
    case 'form':
      base.props = {};
      L(420, 200);
      break;
    case 'login':
      base.props = {};
      L(150, 44);
      break;
    case 'menu':
      base.props = { label: 'Page menu', burgerAt: 'mobile' };
      L(600, 48);
      break;
    case 'logo':
      L(56, 56);
      break;
    case 'sitename':
      base.style = { fontSize: 22 };
      L(320, 40);
      break;
    case 'classes':
      base.props = { showButton: true };
      L(860, 240);
      break;
    case 'announcements':
      base.props = { limit: 3 };
      L(860, 220);
      break;
    case 'faq':
      L(860, 220);
      break;
    case 'events':
      base.props = { limit: 4 };
      L(860, 200);
      break;
    default:
      break;
  }
  return base;
}

export function newSection(name, height) {
  return { id: uid('s'), name: name || 'Section', height: { desktop: height || 500 }, bg: { type: 'color' }, elements: [] };
}

// ---------- layout per device ----------
export function rectOf(el, section, device) {
  return R.layoutFor(el, device || S.device, section);
}
// Wix keeps an independent mobile layout: the first time anything in an
// auto-stacked section is moved on mobile, the whole section's current
// auto-stack positions become real mobile positions, so the rest of the
// section doesn't jump.
export function materializeMobile(section) {
  if (!R.sectionMobileAuto(section)) return;
  const auto = R.autoStack(section);
  for (const el of section.elements) {
    el.layout.mobile = { ...(auto.positions[el.id] || { x: 16, y: el.layout.desktop.y, w: R.DEVICE_WIDTH.mobile - 32, h: el.layout.desktop.h }) };
  }
  if (!section.height.mobile) section.height.mobile = auto.height;
}
export function setRect(el, section, rect, device) {
  const d = device || S.device;
  const W = R.DEVICE_WIDTH[d];
  const r = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
  if (rect.r) {
    let deg = Math.round(rect.r) % 360;
    if (deg > 180) deg -= 360;
    if (deg < -180) deg += 360;
    if (deg) r.r = deg;
  }
  r.w = clamp(r.w, 4, W);
  r.x = clamp(r.x, 0, W - Math.min(r.w, 4));
  if (r.x + r.w > W) r.w = W - r.x;
  r.y = Math.max(0, r.y);
  r.h = Math.max(2, r.h);
  if (d === 'mobile') materializeMobile(section);
  el.layout[d] = r;
}
export function resetDeviceLayout(el, device) {
  if (device !== 'desktop') delete el.layout[device];
}
export function sectionHeightFor(section, device) {
  return R.sectionHeight(section, device || S.device);
}
export function setSectionHeight(section, hh, device) {
  const d = device || S.device;
  if (d === 'mobile') materializeMobile(section);
  section.height[d] = clamp(Math.round(hh), 40, 8000);
}

// ---------- device-aware style ----------
export function effectiveStyle(el) {
  return R.styleFor(el, S.device, S.doc);
}
export function setStyle(el, key, value) {
  if (S.device === 'desktop') {
    if (value === undefined || value === '' || value === null) delete el.style[key];
    else el.style[key] = value;
  } else {
    el.styleBy = el.styleBy || {};
    const o = (el.styleBy[S.device] = el.styleBy[S.device] || {});
    if (value === undefined || value === '' || value === null) delete o[key];
    else o[key] = value;
  }
}
export function styleOverridden(el, key) {
  return S.device !== 'desktop' && el.styleBy && el.styleBy[S.device] && el.styleBy[S.device][key] !== undefined;
}
export function setHidden(item, hidden) {
  item.hidden = item.hidden || {};
  item.hidden[S.device] = hidden;
}

// ---------- structure ops ----------
export function cloneElement(el, offset) {
  const c = clone(el);
  c.id = uid('e');
  delete c.groupId;
  const o = offset == null ? 20 : offset;
  for (const d of ['desktop', 'tablet', 'mobile']) if (c.layout[d]) c.layout[d].y += o;
  for (const d of ['desktop', 'tablet', 'mobile']) if (c.layout[d]) c.layout[d].x = clamp(c.layout[d].x + o, 0, R.DEVICE_WIDTH[d] - 20);
  return c;
}
export function cloneSection(section) {
  const c = clone(section);
  c.id = uid('s');
  const groups = {};
  for (const el of c.elements) {
    el.id = uid('e');
    if (el.groupId) el.groupId = groups[el.groupId] || (groups[el.groupId] = uid('g'));
  }
  if (c.anchor) c.anchor = undefined;
  return c;
}
export function maxZ(section) {
  return section.elements.reduce((m, e) => Math.max(m, e.z || 1), 0);
}
export function arrange(section, ids, how) {
  const els = section.elements.slice().sort((a, b) => (a.z || 1) - (b.z || 1));
  const moving = els.filter((e) => ids.includes(e.id));
  const rest = els.filter((e) => !ids.includes(e.id));
  let order;
  if (how === 'front') order = [...rest, ...moving];
  else if (how === 'back') order = [...moving, ...rest];
  else {
    order = els.slice();
    if (how === 'forward') {
      for (let k = moving.length - 1; k >= 0; k--) {
        const i = order.indexOf(moving[k]);
        if (i < order.length - 1 && !ids.includes(order[i + 1].id)) [order[i], order[i + 1]] = [order[i + 1], order[i]];
      }
    } else {
      for (let k = 0; k < moving.length; k++) {
        const i = order.indexOf(moving[k]);
        if (i > 0 && !ids.includes(order[i - 1].id)) [order[i], order[i - 1]] = [order[i - 1], order[i]];
      }
    }
  }
  order.forEach((e, i) => (e.z = i + 1));
}
// Selecting one member of a group selects the whole group (Wix).
export function expandGroups(ids) {
  const out = new Set(ids);
  for (const id of ids) {
    const f = findElement(id);
    if (f && f.el.groupId) for (const e of f.section.elements) if (e.groupId === f.el.groupId) out.add(e.id);
  }
  return [...out];
}
export function boundsOf(els, section) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const el of els) {
    const r = rectOf(el, section);
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
export function alignElements(section, els, how) {
  if (!els.length) return;
  const W = R.DEVICE_WIDTH[S.device];
  // A single element aligns to its section, several to their bounds.
  const b = els.length === 1 ? { x: 0, y: 0, w: W, h: sectionHeightFor(section) } : boundsOf(els, section);
  const rects = els.map((el) => ({ el, r: { ...rectOf(el, section) } }));
  if (how === 'distH' || how === 'distV') {
    const horiz = how === 'distH';
    rects.sort((a, c) => (horiz ? a.r.x - c.r.x : a.r.y - c.r.y));
    const total = rects.reduce((s, x) => s + (horiz ? x.r.w : x.r.h), 0);
    const gap = ((horiz ? b.w : b.h) - total) / Math.max(1, rects.length - 1);
    let pos = horiz ? b.x : b.y;
    for (const x of rects) {
      if (horiz) x.r.x = pos;
      else x.r.y = pos;
      pos += (horiz ? x.r.w : x.r.h) + gap;
    }
  } else {
    for (const x of rects) {
      if (how === 'left') x.r.x = b.x;
      if (how === 'centerH') x.r.x = b.x + (b.w - x.r.w) / 2;
      if (how === 'right') x.r.x = b.x + b.w - x.r.w;
      if (how === 'top') x.r.y = b.y;
      if (how === 'middle') x.r.y = b.y + (b.h - x.r.h) / 2;
      if (how === 'bottom') x.r.y = b.y + b.h - x.r.h;
      if (how === 'matchW') x.r.w = rects[0].r.w;
      if (how === 'matchH') x.r.h = rects[0].r.h;
    }
  }
  for (const x of rects) setRect(x.el, section, x.r);
}

// Finds a free spot for a newly added element: centered horizontally,
// below the lowest element in the section's visible part.
export function placeNew(el, section, at) {
  const W = R.DEVICE_WIDTH.desktop;
  const d = el.layout.desktop;
  d.w = Math.min(d.w, W);
  if (at) {
    d.x = clamp(Math.round(at.x - d.w / 2), 0, W - d.w);
    d.y = Math.max(0, Math.round(at.y - d.h / 2));
  } else {
    const bottom = section.elements.reduce((m, e) => Math.max(m, e.layout.desktop.y + e.layout.desktop.h), 0);
    d.x = Math.round((W - d.w) / 2);
    d.y = section.elements.length ? bottom + 24 : 60;
  }
  if (d.y + d.h + 40 > section.height.desktop) section.height.desktop = d.y + d.h + 40;
  el.z = maxZ(section) + 1;
  if (S.device !== 'desktop' && !R.sectionMobileAuto(section) && S.device === 'mobile') {
    const auto = R.autoStack({ ...section, elements: [el] });
    const bottom = section.elements.reduce((m, e) => (e.layout.mobile ? Math.max(m, e.layout.mobile.y + e.layout.mobile.h) : m), 0);
    el.layout.mobile = { ...auto.positions[el.id], y: bottom + 16 };
    section.height.mobile = Math.max(section.height.mobile || 0, el.layout.mobile.y + el.layout.mobile.h + 24);
  }
  section.elements.push(el);
}

export function pageSectionIndex(sectionId) {
  return page().sections.findIndex((s) => s.id === sectionId);
}

export function slugify(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
export function slugProblem(slug, pageId) {
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug)) return 'Use lowercase letters, numbers and dashes only.';
  if (S.reservedSlugs.includes(slug)) return `"/${slug}" is already used by another part of the app.`;
  if (S.doc.pages.some((p) => p.slug === slug && p.id !== pageId)) return 'Another page already uses this URL.';
  return null;
}
export function uniqueSlug(base, pageId) {
  let s = slugify(base) || 'page';
  if (S.reservedSlugs.includes(s)) s = `${s}-page`;
  let n = 2;
  const orig = s;
  while (slugProblem(s, pageId)) s = `${orig}-${n++}`;
  return s;
}

// Media lookup map for the shared renderer.
export function mediaMap() {
  const m = {};
  for (const x of S.media) m[x.id] = { url: x.url, alt: x.alt, focalX: x.focalX, focalY: x.focalY, kind: x.kind };
  return m;
}
