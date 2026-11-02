// Left vertical toolbar + flyout panels: Add Elements, Add Section,
// Pages & Menu, Site Design, Media, Layers, Site Settings (SEO, analytics,
// cookie notice, domain, version history) and Help.
import { h, R, ICON, uid, toast, api, confirmDialog, promptDialog, modal, clone } from './util.js';
import { S, on, emit, mutate, page, findElement, findSection, select } from './state.js';
import { createElement, TYPE_LABEL, cloneSection, uniqueSlug, slugProblem, newSection } from './model.js';
import { TEMPLATES } from './templates.js';
import { field, textInput, textArea, select as selectCtl, toggle, slider, group, colorControl, segmented } from './controls.js';
import { openMedia } from './media.js';
import { addElement, startExternalDrag, insertSection, scrollToSection } from './canvas.js';

const RAIL = [
  ['add', 'Add Elements', ICON.add],
  ['sections', 'Add Section', ICON.sections],
  ['pages', 'Pages & Menu', ICON.pages],
  ['design', 'Site Design', ICON.design],
  ['media', 'Media', ICON.media],
  ['layers', 'Layers', ICON.layers],
  ['settings', 'Settings', ICON.settings],
];
let rail;
let panel;
let current = null;
let panelOpts = {};

export function mountPanels(railEl, panelEl) {
  rail = railEl;
  panel = panelEl;
  for (const [key, label, icon] of RAIL) {
    const b = h('button.wxe-rail-btn', { type: 'button', 'data-panel': key, 'aria-label': label, 'aria-expanded': 'false', title: label }, h('span', { html: icon }), h('span.wxe-rail-label', null, label));
    b.addEventListener('click', () => (key === 'media' ? openMedia() : toggle_(key)));
    rail.appendChild(b);
  }
  on((reason, extra) => {
    if (reason === 'panel') return open(extra.name, extra);
    if (!current) return;
    if (extra && extra.fromPanel) return;
    if (current === 'layers' && ['change', 'history', 'select', 'page', 'device'].includes(reason)) render();
    if (current === 'pages' && ['history', 'page'].includes(reason)) render();
    if (current === 'sections' && reason === 'saved-sections') render();
    if (current === 'design' && reason === 'history') render();
  });
}
function toggle_(key) {
  if (current === key) close();
  else open(key);
}
export function open(key, opts) {
  current = key;
  panelOpts = opts || {};
  rail.querySelectorAll('.wxe-rail-btn').forEach((b) => {
    const on_ = b.getAttribute('data-panel') === key;
    b.classList.toggle('is-active', on_);
    b.setAttribute('aria-expanded', String(on_));
  });
  panel.hidden = false;
  render();
  const first = panel.querySelector('h2');
  if (first) first.focus();
}
export function close() {
  current = null;
  panel.hidden = true;
  rail.querySelectorAll('.wxe-rail-btn').forEach((b) => (b.classList.remove('is-active'), b.setAttribute('aria-expanded', 'false')));
}
function shell(title, ...body) {
  return [h('div.wxe-panel-head', null, h('h2', { tabindex: -1 }, title), h('button.wxe-icon-btn', { type: 'button', 'aria-label': 'Close panel', html: ICON.close, onclick: close })), h('div.wxe-panel-body', null, ...body)];
}
function render() {
  if (!current) return;
  const scroll = panel.querySelector('.wxe-panel-body');
  const top = scroll ? scroll.scrollTop : 0;
  panel.innerHTML = '';
  const map = { add: addPanel, sections: sectionsPanel, pages: pagesPanel, design: designPanel, layers: layersPanel, settings: settingsPanel };
  panel.append(...map[current]());
  const nb = panel.querySelector('.wxe-panel-body');
  if (nb) nb.scrollTop = top;
}
const mutP = (fn, merge) => mutate(fn, { merge, fromPanel: true });

// ---------------------------------------------------------------- Add
const ADD_GROUPS = [
  ['Text', [['text', 'title', 'Title'], ['text', 'heading', 'Heading'], ['text', 'subheading', 'Subheading'], ['text', 'paragraph', 'Paragraph'], ['text', 'small', 'Small text']]],
  ['Image & media', [['image', null, 'Image'], ['gallery', null, 'Gallery'], ['slideshow', null, 'Slideshow'], ['video', null, 'Video']]],
  ['Button', [['button', null, 'Button'], ['button', 'outline', 'Outline button'], ['button', 'pill', 'Pill button'], ['button', 'dark', 'Dark button'], ['login', null, 'Log In / My Portals']]],
  ['Shape & line', [['shape', null, 'Box'], ['shape', 'card', 'Card'], ['shape', 'circle', 'Circle'], ['shape', 'outline', 'Outline box'], ['line', null, 'Horizontal line'], ['line', 'dashed', 'Dashed line'], ['line', 'vertical', 'Vertical line']]],
  ['Icons & social', [['icon', 'star', 'Icon'], ['icon', 'heart', 'Heart icon'], ['icon', 'calendar', 'Calendar icon'], ['social', null, 'Social bar']]],
  ['Interactive', [['accordion', null, 'Accordion'], ['tabs', null, 'Tabs'], ['menu', null, 'Menu']]],
  ['Embed', [['map', null, 'Google Map'], ['embed', null, 'Custom HTML'], ['form', null, 'Custom Form']]],
  ['Co-op data', [['classes', null, 'Classes showcase'], ['events', null, 'Upcoming events'], ['announcements', null, 'Announcements'], ['faq', null, 'FAQ']]],
];
function addPanel() {
  const query = h('input.wxe-input', { type: 'search', placeholder: 'Search elements', 'aria-label': 'Search elements' });
  const list = h('div.wxe-add-list');
  function draw() {
    const q = query.value.toLowerCase();
    list.innerHTML = '';
    for (const [title, items] of ADD_GROUPS) {
      const shown = items.filter((i) => !q || i[2].toLowerCase().includes(q) || title.toLowerCase().includes(q));
      if (!shown.length) continue;
      list.appendChild(h('h3.wxe-group-title', null, title));
      const grid = h('div.wxe-add-grid');
      for (const [type, preset, label] of shown) {
        const b = h('button.wxe-add-item', { type: 'button', title: `Click to add, or drag onto the page` }, h('span.wxe-add-ico', { html: addIcon(type, preset) }), h('span', null, label));
        b.addEventListener('pointerdown', (e) => {
          if (e.button === 0) startExternalDrag(e, () => createElement(type, preset), label);
        });
        b.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            addElement(createElement(type, preset));
          }
        });
        grid.appendChild(b);
      }
      list.appendChild(grid);
    }
    list.appendChild(h('h3.wxe-group-title', null, 'Strip'));
    list.appendChild(h('button.wxe-btn', { type: 'button', onclick: () => insertSection(newSection('Strip', 400), page().sections.length) }, '+ Add an empty strip'));
  }
  query.addEventListener('input', draw);
  draw();
  return shell('Add Elements', query, h('p.wxe-hint', null, 'Click to add to the section in view, or drag onto the page.'), list);
}
function addIcon(type, preset) {
  if (type === 'text') return `<span class="wxe-add-text is-${preset}">Aa</span>`;
  if (type === 'icon') return R.iconSvg(preset || 'star');
  if (type === 'button' || type === 'login') return `<span class="wxe-add-btn is-${preset || 'solid'}">Button</span>`;
  if (type === 'shape') return `<span class="wxe-add-shape is-${preset || 'box'}"></span>`;
  if (type === 'line') return `<span class="wxe-add-line is-${preset || 'h'}"></span>`;
  const map = { image: ICON.image, gallery: ICON.grid, slideshow: ICON.media, video: ICON.play, social: R.iconSvg('instagram'), accordion: ICON.down, tabs: ICON.sections, menu: ICON.tl, map: R.iconSvg('map-pin'), embed: '<b>&lt;/&gt;</b>', form: ICON.pages, classes: R.iconSvg('book'), events: R.iconSvg('calendar'), announcements: R.iconSvg('chat'), faq: ICON.help };
  return map[type] || ICON.add;
}

// ---------------------------------------------------------------- Sections
function sectionsPanel() {
  const insertAt = panelOpts.insertAt == null ? page().sections.length : panelOpts.insertAt;
  const groups = [...new Set(TEMPLATES.map((t) => t.group))];
  const body = [h('p.wxe-hint', null, `New sections go ${insertAt >= page().sections.length ? 'at the bottom of the page' : `above section ${insertAt + 1}`}.`)];
  for (const g of groups) {
    body.push(h('h3.wxe-group-title', null, g));
    const grid = h('div.wxe-tpl-grid');
    for (const t of TEMPLATES.filter((x) => x.group === g)) {
      grid.appendChild(
        h('button.wxe-tpl', { type: 'button', onclick: () => insertSection(t.make(), insertAt) }, h('span.wxe-tpl-thumb.is-' + t.key, { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('strong', null, t.name), h('span.wxe-hint', null, t.desc))
      );
    }
    body.push(grid);
  }
  body.push(h('h3.wxe-group-title', null, 'My sections'));
  if (!S.savedSections.length) body.push(h('p.wxe-hint', null, 'Select a section and choose "Save as my section" to reuse it here.'));
  for (const s of S.savedSections) {
    body.push(
      h(
        'div.wxe-row-item',
        null,
        h('button.wxe-link-btn', { type: 'button', onclick: () => insertSection(cloneSection(s.section), insertAt) }, s.name),
        h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': `Delete saved section ${s.name}`, html: ICON.trash, onclick: async () => {
          if (!(await confirmDialog('Delete saved section?', `"${s.name}" will be removed from My Sections. Pages that already use it keep their copy.`, 'Delete', true))) return;
          const res = await api('POST', `/main-admin/website/api/saved-sections/${s.id}/delete`, {});
          if (res.ok) {
            S.savedSections = res.savedSections;
            render();
          }
        } })
      )
    );
  }
  return shell('Add Section', ...body);
}

// ---------------------------------------------------------------- Pages & Menu
function pagesPanel() {
  const pagesList = h('ul.wxe-page-list');
  S.doc.pages.forEach((p, i) => {
    const li = h(
      'li.wxe-page-item' + (p.id === S.pageId ? '.is-current' : ''),
      null,
      h('button.wxe-page-open', { type: 'button', 'aria-current': p.id === S.pageId ? 'page' : null, onclick: () => switchPage(p.id) }, p.isHome ? h('span', { html: ICON.home, title: 'Homepage' }) : null, h('span', null, p.title), p.hidden ? h('span.wxe-pill', null, 'Hidden') : null, p.access === 'members' ? h('span.wxe-pill', null, 'Members') : null, p.type === 'landing' ? h('span.wxe-pill', null, 'Landing') : null),
      h('span.wxe-page-url', null, p.isHome ? '/' : '/' + p.slug),
      h(
        'span.wxe-list-actions',
        null,
        h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': `Move ${p.title} up`, html: ICON.up, disabled: i === 0, onclick: () => mutP(() => movePage(i, -1)) || render() }),
        h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': `Move ${p.title} down`, html: ICON.down, disabled: i === S.doc.pages.length - 1, onclick: () => mutP(() => movePage(i, 1)) || render() }),
        h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': `${p.title} settings`, html: ICON.gear, onclick: () => pageSettings(p.id) }),
        h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': `More actions for ${p.title}`, html: ICON.more, onclick: (e) => pageMenu(p.id, e.currentTarget) })
      )
    );
    pagesList.appendChild(li);
  });
  return shell(
    'Pages & Menu',
    h('div.wxe-btn-row', null, h('button.wxe-btn.is-primary.is-small', { type: 'button', onclick: () => addPage('standard') }, '+ Add Page'), h('button.wxe-btn.is-small', { type: 'button', onclick: () => addPage('landing') }, '+ Landing Page')),
    pagesList,
    h('h3.wxe-group-title', null, 'Site menu'),
    h('p.wxe-hint', null, 'Order and nest your header menu. Indent an item to put it in a dropdown under the item above it.'),
    menuEditor(),
    h(
      'div.wxe-btn-row',
      null,
      h('button.wxe-btn.is-small', { type: 'button', onclick: () => addMenuItem('page') }, '+ Page link'),
      h('button.wxe-btn.is-small', { type: 'button', onclick: () => addMenuItem('link') }, '+ Web link'),
      h('button.wxe-btn.is-small', { type: 'button', onclick: () => addMenuItem('folder') }, '+ Dropdown')
    )
  );
}
function movePage(i, dir) {
  const arr = S.doc.pages;
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}
export function switchPage(id) {
  if (id === S.pageId) return;
  S.pageId = id;
  S.selection = [];
  S.sectionId = null;
  emit('page');
}
async function addPage(type) {
  const title = await promptDialog(type === 'landing' ? 'New landing page' : 'New page', 'Page name', type === 'landing' ? 'Landing Page' : 'New Page');
  if (!title) return;
  const p = { id: uid('p'), title: title.slice(0, 80), slug: uniqueSlug(title), isHome: false, hidden: type === 'landing', access: 'public', type, seo: {}, sections: [] };
  mutP(() => {
    S.doc.pages.push(p);
    if (type !== 'landing') S.doc.menu.push({ id: uid('m'), type: 'page', pageId: p.id, label: '' });
  });
  switchPage(p.id);
  render();
  toast(`"${p.title}" added${type === 'landing' ? ' (landing pages hide the site header/footer and the menu)' : ' to the menu'}.`, 'success');
}
async function pageMenu(id, anchor) {
  const { showContextMenu } = await import('./canvas.js');
  const p = S.doc.pages.find((x) => x.id === id);
  const r = anchor.getBoundingClientRect();
  showContextMenu(r.left, r.bottom + 4, [
    { label: 'Open', run: () => switchPage(id) },
    { label: 'Settings & SEO…', run: () => pageSettings(id) },
    { label: 'Rename…', run: async () => {
      const t = await promptDialog('Rename page', 'Page name', p.title);
      if (t) mutP(() => (S.doc.pages.find((x) => x.id === id).title = t.slice(0, 80))) || render();
    } },
    { label: 'Duplicate', run: () => {
      const c = clone(p);
      c.id = uid('p');
      c.title = p.title + ' (copy)';
      c.slug = uniqueSlug(c.title);
      c.isHome = false;
      c.sections = c.sections.map((s) => cloneSection(s));
      mutP(() => S.doc.pages.splice(S.doc.pages.indexOf(S.doc.pages.find((x) => x.id === id)) + 1, 0, c));
      switchPage(c.id);
      render();
    } },
    { label: p.hidden ? 'Show in menu' : 'Hide from menu', run: () => mutP(() => (S.doc.pages.find((x) => x.id === id).hidden = !p.hidden)) || render() },
    { label: 'Set as homepage', disabled: p.isHome, run: () => {
      mutP(() => S.doc.pages.forEach((x) => {
        x.isHome = x.id === id;
        if (x.id === id) x.access = 'public';
      }));
      render();
      toast(`"${p.title}" is now the homepage (/).`);
    } },
    { label: 'Preview', run: () => window.open(`/main-admin/website/preview/${id}`, '_blank', 'noopener') },
    '-',
    { label: 'Delete', disabled: p.isHome || S.doc.pages.length === 1, run: async () => {
      if (!(await confirmDialog('Delete page?', `"${p.title}" (/${p.slug}) and everything on it will be removed when you publish. You can undo this.`, 'Delete', true))) return;
      mutP(() => {
        S.doc.pages = S.doc.pages.filter((x) => x.id !== id);
        S.doc.menu = pruneMenu(S.doc.menu, id);
      });
      if (S.pageId === id) switchPage(S.doc.pages[0].id);
      render();
    } },
  ]);
}
function pruneMenu(items, pageId) {
  const out = [];
  for (const it of items) {
    if (it.type === 'page' && it.pageId === pageId) {
      if (it.children) out.push(...pruneMenu(it.children, pageId));
      continue;
    }
    if (it.children) it.children = pruneMenu(it.children, pageId);
    out.push(it);
  }
  return out;
}
async function pageSettings(id) {
  const p = clone(S.doc.pages.find((x) => x.id === id));
  p.seo = p.seo || {};
  const slugInput = h('input.wxe-input', { type: 'text', value: p.slug, 'aria-describedby': 'wxe-slug-msg', disabled: p.isHome });
  const slugMsg = h('p.wxe-hint#wxe-slug-msg', { role: 'status' }, p.isHome ? 'The homepage always lives at /.' : `${S.siteUrl}${p.slug}`);
  slugInput.addEventListener('input', () => {
    const v = slugInput.value.toLowerCase();
    const err = slugProblem(v, id);
    slugMsg.textContent = err || `${S.siteUrl}${v}`;
    slugMsg.classList.toggle('is-error', !!err);
  });
  const title = h('input.wxe-input', { type: 'text', value: p.title });
  const seoTitle = h('input.wxe-input', { type: 'text', value: p.seo.title || '', maxlength: 120, placeholder: p.isHome ? 'Uses the site title' : `${p.title} | site name` });
  const seoDesc = h('textarea.wxe-input', { rows: 3, maxlength: 320 });
  seoDesc.value = p.seo.description || '';
  let ogId = p.seo.ogImageId || null;
  const ogPreview = h('span.wxe-hint');
  const paintOg = () => {
    const m = S.media.find((x) => x.id === ogId);
    ogPreview.innerHTML = '';
    ogPreview.append(m ? h('img.wxe-og-thumb', { src: m.url, alt: '' }) : 'Uses the site share image');
  };
  paintOg();
  const access = selectCtl([['public', 'Everyone (public)'], ['members', 'Members only (must log in)']], p.access, (v) => (p.access = v));
  if (p.isHome) access.disabled = true;
  const body = h(
    'div.wxe-form',
    null,
    field('Page name', title),
    field('URL slug', slugInput),
    slugMsg,
    field('Who can see this page', access, { hint: p.isHome ? 'The homepage is always public.' : 'Members-only pages send visitors to the member log in first.' }),
    toggle('Hide from the site menu', p.hidden, (v) => (p.hidden = v)),
    field('Page type', selectCtl([['standard', 'Standard (site header & footer)'], ['landing', 'Landing page (no header, footer or menu)']], p.type, (v) => (p.type = v))),
    h('h3.wxe-group-title', null, 'SEO & sharing'),
    field('SEO title', seoTitle, { hint: 'Shown in search results and browser tabs. ~60 characters.' }),
    field('Meta description', seoDesc, { hint: 'A one- or two-sentence summary for search results. ~155 characters.' }),
    h('div.wxe-field', null, h('span.wxe-field-label', null, 'Social share image'), ogPreview, h('div.wxe-btn-row', null, h('button.wxe-btn.is-small', { type: 'button', onclick: async () => {
      const mid = await openMedia({ pick: 'image' });
      if (mid) (ogId = mid), paintOg();
    } }, 'Choose image'), h('button.wxe-btn.is-small', { type: 'button', onclick: () => ((ogId = null), paintOg()) }, 'Remove'))),
    toggle('Hide this page from search engines (noindex)', !!p.seo.noindex, (v) => (p.seo.noindex = v))
  );
  const ok = await modal({ title: `Page settings: ${p.title}`, body, wide: true, buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }] });
  if (!ok) return;
  const slug = slugInput.value.toLowerCase().trim();
  if (!p.isHome) {
    const err = slugProblem(slug, id);
    if (err) {
      toast(`URL not changed: ${err}`, 'error');
    } else p.slug = slug;
  }
  mutP(() => {
    const target = S.doc.pages.find((x) => x.id === id);
    target.title = title.value.trim().slice(0, 80) || target.title;
    target.slug = p.slug;
    target.access = p.isHome ? 'public' : p.access;
    target.hidden = p.hidden;
    target.type = p.type;
    target.seo = { title: seoTitle.value.trim(), description: seoDesc.value.trim(), ogImageId: ogId || undefined, noindex: p.seo.noindex || undefined };
  });
  render();
}

function menuEditor() {
  const wrap = h('ul.wxe-menu-tree', { role: 'tree', 'aria-label': 'Site menu' });
  const draw = (items, depth, parent) => {
    items.forEach((it, i) => {
      const pg = it.type === 'page' ? S.doc.pages.find((p) => p.id === it.pageId) : null;
      const label = it.label || (pg ? pg.title : '');
      const li = h(
        'li.wxe-menu-node',
        { role: 'treeitem', 'aria-level': depth + 1, style: { paddingLeft: depth * 18 + 'px' } },
        h('span.wxe-menu-node-label', null, label, it.type === 'folder' ? ' ▾' : '', pg && pg.hidden ? h('span.wxe-pill', null, 'Hidden page') : null, it.type === 'link' ? h('span.wxe-hint', null, ' ' + it.href) : null),
        h(
          'span.wxe-list-actions',
          null,
          h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': `Move ${label} up`, html: ICON.up, disabled: i === 0, onclick: () => (mutP(() => ([parent[i - 1], parent[i]] = [parent[i], parent[i - 1]])), render()) }),
          h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': `Move ${label} down`, html: ICON.down, disabled: i === parent.length - 1, onclick: () => (mutP(() => ([parent[i + 1], parent[i]] = [parent[i], parent[i + 1]])), render()) }),
          h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': `Indent ${label} (into a dropdown)`, title: 'Move into a dropdown under the item above', disabled: i === 0 || depth >= 2, onclick: () => (mutP(() => {
            const [moved] = parent.splice(i, 1);
            const prev = parent[i - 1];
            prev.children = prev.children || [];
            prev.children.push(moved);
          }), render()), html: '<span aria-hidden="true">→</span>' }),
          h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': `Outdent ${label}`, disabled: depth === 0, onclick: () => (mutP(() => outdent(it.id)), render()), html: '<span aria-hidden="true">←</span>' }),
          h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': `Edit ${label}`, html: ICON.edit, onclick: () => editMenuItem(it.id) }),
          h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': `Remove ${label} from menu`, html: ICON.trash, onclick: () => (mutP(() => {
            parent.splice(i, 1, ...(it.children || []));
          }), render()) })
        )
      );
      wrap.appendChild(li);
      if (it.children && it.children.length) draw(it.children, depth + 1, it.children);
    });
  };
  if (!S.doc.menu.length) wrap.appendChild(h('li.wxe-hint', null, 'The menu is empty - add pages or links below.'));
  draw(S.doc.menu, 0, S.doc.menu);
  return wrap;
}
function findMenu(items, id, parent) {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return { list: items, index: i, parent };
    if (items[i].children) {
      const r = findMenu(items[i].children, id, items[i]);
      if (r) return r;
    }
  }
  return null;
}
function outdent(id) {
  const loc = findMenu(S.doc.menu, id, null);
  if (!loc || !loc.parent) return;
  const [it] = loc.list.splice(loc.index, 1);
  const grand = findMenu(S.doc.menu, loc.parent.id, null);
  grand.list.splice(grand.index + 1, 0, it);
}
async function addMenuItem(type) {
  const item = { id: uid('m'), type, label: '' };
  if (type === 'page') item.pageId = S.pageId;
  if (type === 'link') {
    item.label = 'Link';
    item.href = 'https://';
  }
  if (type === 'folder') item.label = 'More';
  const ok = await editMenuItemModal(item);
  if (!ok) return;
  mutP(() => S.doc.menu.push(item));
  render();
}
async function editMenuItem(id) {
  const loc = findMenu(S.doc.menu, id, null);
  const copy = clone(loc.list[loc.index]);
  if (!(await editMenuItemModal(copy))) return;
  mutP(() => {
    const l = findMenu(S.doc.menu, id, null);
    Object.assign(l.list[l.index], copy);
  });
  render();
}
async function editMenuItemModal(item) {
  const label = h('input.wxe-input', { type: 'text', value: item.label || '', placeholder: item.type === 'page' ? 'Uses the page name' : '' });
  const parts = [field(item.type === 'folder' ? 'Dropdown title' : 'Menu label', label)];
  let pageSel;
  let hrefInput;
  if (item.type === 'page') parts.push(field('Page', (pageSel = selectCtl(S.doc.pages.map((p) => [p.id, p.title]), item.pageId, () => {}))));
  if (item.type === 'link') parts.push(field('Address', (hrefInput = h('input.wxe-input', { type: 'text', value: item.href || '' })), { hint: 'https://…, /path, #section, mailto: or tel:' }));
  if (item.type !== 'folder') parts.push(toggle('Open in a new tab', !!item.newTab, (v) => (item.newTab = v)));
  const ok = await modal({ title: 'Menu item', body: h('div.wxe-form', null, ...parts), buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }] });
  if (!ok) return false;
  item.label = label.value.trim().slice(0, 80);
  if (pageSel) item.pageId = pageSel.value;
  if (hrefInput) {
    const v = hrefInput.value.trim();
    if (!R.safeUrl(v)) {
      toast('Links must start with https://, /, #, mailto: or tel:', 'error');
      return false;
    }
    item.href = v;
    if (!item.label) item.label = v;
  }
  if (item.type === 'folder' && !item.label) item.label = 'More';
  return true;
}

// ---------------------------------------------------------------- Site Design
const PALETTE_PRESETS = [
  ['Co-op Classic', { primary: '#E7AA7B', accent: '#79BAEC', background: '#FFFFFF', cards: '#FFFFFF', text: '#1C2530', muted: '#5B6675', dark: '#1C2530', light: '#F5F7FA' }],
  ['Forest', { primary: '#2F7D4F', accent: '#E3B341', background: '#FFFFFF', cards: '#F7F5EE', text: '#1E2A22', muted: '#5E6B62', dark: '#16261C', light: '#EEF4EE' }],
  ['Ocean', { primary: '#1F6FB2', accent: '#22B5BF', background: '#FFFFFF', cards: '#FFFFFF', text: '#0F2233', muted: '#56697A', dark: '#0B1E30', light: '#EEF6FB' }],
  ['Sunset', { primary: '#E2574C', accent: '#F4A259', background: '#FFFBF7', cards: '#FFFFFF', text: '#2B1D1A', muted: '#7A6560', dark: '#2B1D1A', light: '#FDF0E6' }],
  ['Lavender', { primary: '#7B5EA7', accent: '#E58BB5', background: '#FFFFFF', cards: '#FFFFFF', text: '#241B33', muted: '#6B6280', dark: '#241B33', light: '#F4F0FA' }],
  ['Midnight', { primary: '#F5B942', accent: '#5CC8FF', background: '#11151C', cards: '#1B212C', text: '#F1F4F8', muted: '#A6B0BF', dark: '#05070A', light: '#1B212C' }],
];
let designTab = 'colors';
function designPanel() {
  if (panelOpts.tab) {
    designTab = panelOpts.tab;
    panelOpts.tab = null;
  }
  const d = S.doc.design;
  const tabsBar = segmented([['colors', 'Colors'], ['text', 'Text'], ['header', 'Header'], ['footer', 'Footer'], ['presets', 'Presets']], designTab, (v) => ((designTab = v), render()), 'Design area');
  const body = [tabsBar];
  if (designTab === 'colors') {
    body.push(
      group(
        'Color themes',
        h(
          'div.wxe-palettes',
          null,
          PALETTE_PRESETS.map(([name, pal]) =>
            h('button.wxe-palette', { type: 'button', onclick: () => (mutP(() => (S.doc.design.palette = { ...pal })), render(), toast(`Applied "${name}".`)) }, h('span.wxe-palette-sw', null, ['primary', 'accent', 'background', 'text', 'light'].map((k) => h('i', { style: { background: pal[k] } }))), name)
          )
        )
      ),
      group(
        'Site colors',
        ...R.PALETTE_KEYS.map((k) => field(k[0].toUpperCase() + k.slice(1), colorControl(d.palette[k], (v) => v && /^#/.test(v) && mutP(() => (S.doc.design.palette[k] = v), 'pal' + k), { allowNone: false })))
      ),
      group(
        'My colors',
        h('div.wxe-swatches', null, (d.swatches || []).map((c, i) => h('button.wxe-swatch-pick', { type: 'button', title: `Remove ${c}`, 'aria-label': `Remove color ${c}`, style: { background: c }, onclick: () => (mutP(() => S.doc.design.swatches.splice(i, 1)), render()) }))),
        h('button.wxe-btn.is-small', { type: 'button', onclick: async () => {
          const v = await promptDialog('Add a color', 'HEX, RGB or HSL', '#');
          const { parseColor, colorToStored } = await import('./util.js');
          const c = parseColor(v);
          if (!c) return v && toast('That is not a color I recognize.', 'error');
          mutP(() => (S.doc.design.swatches = [...(S.doc.design.swatches || []), colorToStored(c)]));
          render();
        } }, '+ Add color')
      )
    );
  } else if (designTab === 'text') {
    body.push(
      group(
        'Fonts',
        field('Headings', selectCtl(S.fonts.map((f) => [f.key, f.label]), d.fontHeading, (v) => mutP(() => (S.doc.design.fontHeading = v)))),
        field('Body text', selectCtl(S.fonts.map((f) => [f.key, f.label]), d.fontBody, (v) => mutP(() => (S.doc.design.fontBody = v)))),
        h('p.wxe-hint', null, 'Google Fonts load automatically on the live site.')
      )
    );
    for (const k of R.TEXT_STYLE_KEYS) {
      const st = d.textStyles[k] || {};
      const set = (prop) => (v) => mutP(() => (v === undefined || v === '' ? delete S.doc.design.textStyles[k][prop] : (S.doc.design.textStyles[k][prop] = v)), 'ts' + k + prop);
      body.push(
        h(
          'details.wxe-details',
          null,
          h('summary', null, h('span.wxe-ts-sample.wx-ts-' + k, null, { h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', p: 'Paragraph', small: 'Small text' }[k])),
          field('Font', selectCtl([['', k.startsWith('h') ? 'Heading font' : 'Body font'], ...S.fonts.map((f) => [f.key, f.label])], st.fontFamily || '', set('fontFamily'))),
          field('Size', slider(st.fontSize || 16, set('fontSize'), { min: 8, max: 120, suffix: 'px' })),
          field('Weight', selectCtl([['300', 'Light'], ['400', 'Regular'], ['600', 'Semi-bold'], ['700', 'Bold'], ['800', 'Extra-bold']], String(st.fontWeight || 400), (v) => set('fontWeight')(Number(v)))),
          field('Line spacing', slider(st.lineHeight || 1.4, set('lineHeight'), { min: 0.8, max: 3, step: 0.05 })),
          field('Letter spacing', slider(st.letterSpacing || 0, set('letterSpacing'), { min: -5, max: 20, step: 0.5, suffix: 'px' })),
          field('Transform', selectCtl([['none', 'None'], ['uppercase', 'UPPERCASE'], ['lowercase', 'lowercase'], ['capitalize', 'Capitalize']], st.textTransform || 'none', set('textTransform'))),
          field('Color', colorControl(st.color, set('color'), { noneLabel: 'Site text color' })),
          toggle('Italic', !!st.italic, set('italic'))
        )
      );
    }
  } else if (designTab === 'header') {
    const hd = S.doc.header;
    const set = (k) => (v) => mutP(() => (v === undefined || v === '' ? delete S.doc.header[k] : (S.doc.header[k] = v)), 'hd' + k);
    const mediaBtn = (k, label) => {
      const m = S.media.find((x) => x.id === hd[k]);
      return h('div.wxe-field', null, h('span.wxe-field-label', null, label), h('div.wxe-media-mini', null, m ? h('img', { src: m.url, alt: '' }) : h('span.wxe-hint', null, k === 'logoId' ? 'Default owl logo' : 'None'), h('button.wxe-btn.is-small', { type: 'button', onclick: async () => {
        const id = await openMedia({ pick: 'image' });
        if (id) (mutP(() => (S.doc.header[k] = id)), render());
      } }, 'Choose'), m ? h('button.wxe-btn.is-small', { type: 'button', onclick: () => (mutP(() => delete S.doc.header[k]), render()) }, 'Remove') : null));
    };
    body.push(
      toggle('Show the site header', hd.show !== false, (v) => (set('show')(v), render())),
      group('Logo & name', mediaBtn('logoId', 'Logo'), toggle('Show logo', hd.showLogo !== false, set('showLogo')), toggle('Show site name', hd.showSiteName !== false, set('showSiteName'))),
      group(
        'Layout',
        field('Height', slider(hd.height || 84, set('height'), { min: 48, max: 200, suffix: 'px' })),
        field('Background', colorControl(hd.bg, set('bg'), { noneLabel: 'Site background' })),
        mediaBtn('imageId', 'Background image'),
        field('Text color', colorControl(hd.textColor, set('textColor'), { noneLabel: 'Site text color' })),
        toggle('Sticky (stays at the top while scrolling)', !!hd.sticky, set('sticky')),
        toggle('Transparent over the first section', !!hd.transparent, set('transparent'), 'Turns solid once visitors scroll.')
      ),
      group(
        'Menu style',
        field('Font', selectCtl([['', 'Heading font'], ...S.fonts.map((f) => [f.key, f.label])], hd.navFont || '', set('navFont'))),
        field('Size', slider(hd.navSize || 16, set('navSize'), { min: 10, max: 28, suffix: 'px' })),
        field('Weight', selectCtl([['400', 'Regular'], ['600', 'Semi-bold'], ['700', 'Bold'], ['800', 'Extra-bold']], String(hd.navWeight || 600), (v) => set('navWeight')(Number(v)))),
        field('Spacing between links', slider(hd.navSpacing == null ? 24 : hd.navSpacing, set('navSpacing'), { min: 0, max: 64, suffix: 'px' })),
        field('Link color', colorControl(hd.navColor, set('navColor'), { noneLabel: 'Inherit' })),
        field('Hover color', colorControl(hd.navHover, set('navHover'), { noneLabel: 'Site primary' })),
        field('Current page color', colorControl(hd.navActive, set('navActive'), { noneLabel: 'Site primary' })),
        field('Collapse into a ☰ menu on', selectCtl([['mobile', 'Mobile'], ['tablet', 'Tablet and mobile']], hd.burgerAt || 'mobile', set('burgerAt')))
      ),
      group('Member log in', toggle('Show "Log in" / "My Portals" bar above the header', hd.showLogin !== false, set('showLogin'))),
      group(
        'Announcement bar',
        toggle('Show announcement bar', !!(hd.announcement && hd.announcement.enabled), (v) => mutP(() => (S.doc.header.announcement = { ...(S.doc.header.announcement || {}), enabled: v }))),
        field('Text', textInput(hd.announcement && hd.announcement.text, (v) => mutP(() => (S.doc.header.announcement = { ...(S.doc.header.announcement || {}), text: v }), 'annText'))),
        field('Background', colorControl(hd.announcement && hd.announcement.bg, (v) => mutP(() => (S.doc.header.announcement = { ...(S.doc.header.announcement || {}), bg: v || undefined })), { noneLabel: 'Site dark' })),
        field('Text color', colorControl(hd.announcement && hd.announcement.color, (v) => mutP(() => (S.doc.header.announcement = { ...(S.doc.header.announcement || {}), color: v || undefined })), { noneLabel: 'White' }))
      ),
      h('button.wxe-btn.is-small', { type: 'button', onclick: () => open('pages') }, 'Edit menu items')
    );
  } else if (designTab === 'footer') {
    const ft = S.doc.footer;
    const set = (k) => (v) => mutP(() => (v === undefined || v === '' ? delete S.doc.footer[k] : (S.doc.footer[k] = v)), 'ft' + k);
    const m = S.media.find((x) => x.id === ft.imageId);
    body.push(
      toggle('Show the site footer', ft.show !== false, set('show')),
      field('Footer text', textArea(ft.text, set('text'), { rows: 4 })),
      h('div.wxe-field', null, h('span.wxe-field-label', null, 'Footer image'), h('div.wxe-media-mini', null, m ? h('img', { src: m.url, alt: '' }) : h('span.wxe-hint', null, 'None'), h('button.wxe-btn.is-small', { type: 'button', onclick: async () => {
        const id = await openMedia({ pick: 'image' });
        if (id) (mutP(() => (S.doc.footer.imageId = id)), render());
      } }, 'Choose'), m ? h('button.wxe-btn.is-small', { type: 'button', onclick: () => (mutP(() => delete S.doc.footer.imageId), render()) }, 'Remove') : null)),
      field('Background', colorControl(ft.bg, set('bg'), { noneLabel: 'Site dark' })),
      field('Text color', colorControl(ft.color, set('color'), { noneLabel: 'White' })),
      h('p.wxe-hint', null, 'Contact email/phone and the copyright line come from Settings > Site info.')
    );
  } else {
    const presets = d.presets || [];
    const sel = S.selection.length === 1 ? findElement(S.selection[0]) : null;
    body.push(
      h('p.wxe-hint', null, 'A preset is a reusable look (fill, border, corners, shadow, text). Apply it to any element from its Design tab; editing the preset restyles every element that uses it.'),
      h('button.wxe-btn.is-small.is-primary', { type: 'button', disabled: !sel, onclick: async () => {
        const name = await promptDialog('New design preset', 'Preset name', 'My style');
        if (!name) return;
        const style = { ...sel.el.style };
        delete style.presetId;
        const id = uid('ps');
        mutP(() => {
          S.doc.design.presets = [...(S.doc.design.presets || []), { id, name: name.slice(0, 60), style }];
          findElement(sel.el.id).el.style = { presetId: id };
        });
        render();
      } }, sel ? `Create from "${sel.el.name || TYPE_LABEL[sel.el.type]}"` : 'Select an element to create a preset'),
      ...presets.map((p, i) =>
        h(
          'details.wxe-details',
          null,
          h('summary', null, p.name),
          field('Name', textInput(p.name, (v) => mutP(() => (S.doc.design.presets[i].name = v.slice(0, 60)), 'psn' + p.id))),
          field('Fill', colorControl(p.style.bg, (v) => mutP(() => (v ? (S.doc.design.presets[i].style.bg = v) : delete S.doc.design.presets[i].style.bg), 'psbg' + p.id))),
          field('Text color', colorControl(p.style.color, (v) => mutP(() => (v ? (S.doc.design.presets[i].style.color = v) : delete S.doc.design.presets[i].style.color), 'psc' + p.id))),
          field('Corner radius', slider(p.style.radius || 0, (v) => mutP(() => (S.doc.design.presets[i].style.radius = v), 'psr' + p.id), { min: 0, max: 200, suffix: 'px' })),
          field('Border width', slider(p.style.borderWidth || 0, (v) => mutP(() => (S.doc.design.presets[i].style.borderWidth = v), 'psbw' + p.id), { min: 0, max: 20, suffix: 'px' })),
          field('Border color', colorControl(p.style.borderColor, (v) => mutP(() => (v ? (S.doc.design.presets[i].style.borderColor = v) : delete S.doc.design.presets[i].style.borderColor), 'psbc' + p.id))),
          field('Shadow', selectCtl([['none', 'None'], ['sm', 'Subtle'], ['md', 'Medium'], ['lg', 'Strong']], p.style.shadow || 'none', (v) => mutP(() => (S.doc.design.presets[i].style.shadow = v)))),
          h('button.wxe-btn.is-small.is-danger', { type: 'button', onclick: () => {
            mutP(() => {
              S.doc.design.presets.splice(i, 1);
              for (const pg of S.doc.pages) for (const s of pg.sections) for (const el of s.elements) if (el.style.presetId === p.id) delete el.style.presetId;
            });
            render();
          } }, 'Delete preset')
        )
      )
    );
  }
  return shell('Site Design', ...body);
}

// ---------------------------------------------------------------- Layers
function layersPanel() {
  const p = page();
  const tree = h('ul.wxe-layers', { role: 'tree', 'aria-label': 'Layers' });
  for (const s of p.sections) {
    tree.appendChild(
      h(
        'li.wxe-layer.is-section' + (S.sectionId === s.id ? '.is-selected' : ''),
        { role: 'treeitem', 'aria-level': 1 },
        h('button.wxe-layer-name', { type: 'button', onclick: () => (select([], s.id), scrollToSection(s.id)) }, s.name || 'Section'),
        h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': (R.isHidden(s, S.device) ? 'Show ' : 'Hide ') + (s.name || 'section') + ' on ' + S.device, html: R.isHidden(s, S.device) ? ICON.eyeOff : ICON.eye, onclick: () => mutP(() => {
          const sec = findSection(s.id).section;
          sec.hidden = { ...(sec.hidden || {}), [S.device]: !R.isHidden(sec, S.device) };
        }) || render() })
      )
    );
    const els = s.elements.slice().sort((a, b) => (b.z || 1) - (a.z || 1));
    for (const el of els) {
      const hidden = R.isHidden(el, S.device);
      tree.appendChild(
        h(
          'li.wxe-layer' + (S.selection.includes(el.id) ? '.is-selected' : '') + (hidden ? '.is-hidden' : ''),
          { role: 'treeitem', 'aria-level': 2 },
          h('button.wxe-layer-name', { type: 'button', onclick: () => select([el.id]) }, el.name || TYPE_LABEL[el.type], el.groupId ? h('span.wxe-pill', null, 'Group') : null),
          h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': `${hidden ? 'Show' : 'Hide'} ${el.name || el.type} on ${S.device}`, html: hidden ? ICON.eyeOff : ICON.eye, onclick: () => mutP(() => {
            const e = findElement(el.id).el;
            e.hidden = { ...(e.hidden || {}), [S.device]: !hidden };
          }) || render() }),
          h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': `${el.locked ? 'Unlock' : 'Lock'} ${el.name || el.type}`, html: el.locked ? ICON.lock : ICON.unlock, onclick: () => mutP(() => {
            const e = findElement(el.id).el;
            if (e.locked) delete e.locked;
            else e.locked = true;
          }) || render() })
        )
      );
    }
  }
  if (!p.sections.length) tree.appendChild(h('li.wxe-hint', null, 'This page has no sections yet.'));
  return shell('Layers', h('p.wxe-hint', null, `Top-most first. Showing ${S.device} visibility.`), tree);
}

// ---------------------------------------------------------------- Settings
let settingsVersions = null;
function settingsPanel() {
  const st = S.doc.settings;
  const site = S.doc.site;
  const setSite = (k) => (v) => mutP(() => (S.doc.site[k] = v), 'site' + k);
  const set = (k) => (v) => mutP(() => (S.doc.settings[k] = v), 'set' + k);
  const mediaRow = (k, label, hint) => {
    const m = S.media.find((x) => x.id === st[k]);
    return h('div.wxe-field', null, h('span.wxe-field-label', null, label), h('div.wxe-media-mini', null, m ? h('img', { src: m.url, alt: '' }) : h('span.wxe-hint', null, 'Default'), h('button.wxe-btn.is-small', { type: 'button', onclick: async () => {
      const id = await openMedia({ pick: 'image' });
      if (id) (mutP(() => (S.doc.settings[k] = id)), render());
    } }, 'Choose'), m ? h('button.wxe-btn.is-small', { type: 'button', onclick: () => (mutP(() => delete S.doc.settings[k]), render()) }, 'Remove') : null), hint ? h('p.wxe-hint', null, hint) : null);
  };
  const cb = st.cookieBanner || {};
  const setCb = (k) => (v) => mutP(() => (S.doc.settings.cookieBanner = { ...(S.doc.settings.cookieBanner || {}), [k]: v }), 'cb' + k);
  const ga = h('input.wxe-input', { type: 'text', value: st.analyticsId || '', placeholder: 'G-XXXXXXXXXX' });
  ga.addEventListener('input', () => {
    const v = ga.value.trim().toUpperCase();
    const okv = !v || /^G-[A-Z0-9]{4,20}$/.test(v);
    ga.setAttribute('aria-invalid', String(!okv));
    if (okv) set('analyticsId')(v);
  });
  const versions = h('div.wxe-versions', null, h('p.wxe-hint', null, 'Loading…'));
  loadVersions(versions);
  return shell(
    'Site Settings',
    group('Site info', field('Site name', textInput(site.orgName, setSite('orgName'))), field('Contact email', textInput(site.contactEmail, setSite('contactEmail'), { type: 'email' })), field('Contact phone', textInput(site.contactPhone, setSite('contactPhone'), { type: 'tel' })), h('p.wxe-hint', null, 'The site name is also used across the app (emails, other pages) once you publish.')),
    group(
      'SEO',
      field('Site title (search results & browser tab)', textInput(st.seoTitle, set('seoTitle'), { maxlength: 120 })),
      field('Site description', textArea(st.seoDescription, set('seoDescription'), { rows: 3, maxlength: 320 })),
      mediaRow('faviconId', 'Favicon (browser tab icon)', 'A square PNG works best.'),
      mediaRow('ogImageId', 'Social share image', 'Shown when your site is shared on social media.'),
      toggle('Let search engines index the site', st.allowIndexing !== false, set('allowIndexing')),
      toggle('Publish sitemap.xml', st.sitemap !== false, set('sitemap')),
      h('p.wxe-hint', null, h('a', { href: '/sitemap.xml', target: '_blank', rel: 'noopener' }, 'sitemap.xml'), ' · ', h('a', { href: '/robots.txt', target: '_blank', rel: 'noopener' }, 'robots.txt'), ' (live site)')
    ),
    group('Analytics', field('Google Analytics measurement ID', ga, { hint: 'Only added to the live site when filled in.' })),
    group(
      'Cookie & privacy notice',
      toggle('Show a cookie notice', !!cb.enabled, setCb('enabled')),
      field('Message', textArea(cb.text, setCb('text'), { rows: 2, placeholder: 'We use cookies to understand how our site is used.' })),
      field('Button text', textInput(cb.buttonLabel, setCb('buttonLabel'), { placeholder: 'OK' })),
      field('Privacy policy link', textInput(cb.policyUrl, (v) => R.safeUrl(v) || !v ? setCb('policyUrl')(v) : null, { placeholder: '/privacy-policy' }))
    ),
    group('Scrolling', toggle('Smooth scrolling to section anchors', st.smoothScroll !== false, set('smoothScroll'))),
    group(
      'Domain',
      h('p', null, 'Your site is live at ', h('a', { href: S.siteUrl, target: '_blank', rel: 'noopener' }, S.siteUrl)),
      h(
        'ol.wxe-steps',
        null,
        h('li', null, 'This app is hosted on Netlify. In Netlify, open this site > Domain management.'),
        h('li', null, 'Choose "Add a domain", enter your domain, and follow Netlify\'s DNS steps at your domain registrar.'),
        h('li', null, 'Netlify issues the HTTPS certificate automatically. No change is needed here - every page, sitemap.xml and robots.txt use whatever domain visitors arrive on.')
      )
    ),
    group('Version history', h('p.wxe-hint', null, 'Every Publish is saved. Restoring loads that version into the editor as your draft - publish again to make it live.'), versions)
  );
}
async function loadVersions(host) {
  if (!settingsVersions) {
    const res = await api('GET', '/main-admin/website/api/versions');
    settingsVersions = res.ok ? res.versions : [];
  }
  host.innerHTML = '';
  if (!settingsVersions.length) return host.appendChild(h('p.wxe-hint', null, 'No published versions yet.'));
  for (const v of settingsVersions) {
    host.appendChild(
      h(
        'div.wxe-row-item',
        null,
        h('span', null, h('strong', null, v.label || `Version ${v.id}`), h('span.wxe-hint', null, ` ${v.published_at} UTC${v.publishedBy ? ' · ' + v.publishedBy : ''}`)),
        h('button.wxe-btn.is-small', { type: 'button', onclick: async () => {
          if (!(await confirmDialog('Restore this version?', 'Your current draft is replaced by this version (you can undo). The live site does not change until you publish.', 'Restore'))) return;
          const res = await api('GET', `/main-admin/website/api/versions/${v.id}`);
          if (!res.ok) return toast(res.error || 'Could not load that version.', 'error');
          mutate((doc) => Object.assign(doc, res.doc));
          if (!S.doc.pages.some((p) => p.id === S.pageId)) S.pageId = S.doc.pages[0].id;
          emit('page');
          toast('Version restored into the editor.', 'success');
        } }, 'Restore')
      )
    );
  }
}
export function invalidateVersions() {
  settingsVersions = null;
}
