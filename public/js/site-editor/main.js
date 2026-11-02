// Wix-style site editor - boot + top bar (site name, page switcher,
// Desktop/Tablet/Mobile, zoom, undo/redo, save status, Preview, Publish,
// Help). A real request: "The website homepage editor was built to mimic
// shopify. I would like to switch that to wix. It should allow you to
// edit the homepage like wix, all the same features, same look etc."
import { h, ICON, api, toast, modal, confirmDialog } from './util.js';
import { S, on, emit, page, undo, redo, save, select } from './state.js';
import { mountCanvas, render as renderCanvas, endTextEdit } from './canvas.js';
import { mountInspector } from './inspector.js';
import { mountPanels, open as openPanel, switchPage, invalidateVersions } from './panels.js';

const root = document.getElementById('wxe-root');

async function boot() {
  const res = await api('GET', '/main-admin/website/api/state');
  if (!res.ok) {
    root.innerHTML = '';
    root.appendChild(h('div.wxe-boot-error', { role: 'alert' }, h('h1', null, 'The editor could not load'), h('p', null, res.error || 'Please reload the page.'), h('a.wxe-btn', { href: '/main-admin/website' }, 'Back')));
    return;
  }
  Object.assign(S, {
    doc: res.draft,
    rev: res.rev,
    media: res.media,
    savedSections: res.savedSections,
    widgetData: res.widgetData,
    reservedSlugs: res.reservedSlugs,
    fonts: res.fonts,
    siteUrl: res.siteUrl,
    publishedAt: res.publishedAt,
    hasUnpublished: res.hasUnpublished,
    pageId: (res.draft.pages.find((p) => p.isHome) || res.draft.pages[0]).id,
  });
  loadEditorFonts();
  root.innerHTML = '';
  const topbar = h('header.wxe-topbar');
  const rail = h('nav.wxe-rail', { 'aria-label': 'Editor tools' });
  const panel = h('aside.wxe-panel', { hidden: true, 'aria-label': 'Tool panel' });
  const workspace = h('main.wxe-workspace', { tabindex: -1, 'aria-label': 'Page canvas' });
  const inspector = h('aside.wxe-inspector', { 'aria-label': 'Inspector' });
  root.append(topbar, h('div.wxe-body', null, rail, panel, workspace, inspector));
  buildTopbar(topbar);
  mountPanels(rail, panel);
  mountCanvas(workspace);
  mountInspector(inspector);
  renderCanvas();
  on((reason, extra) => {
    if (reason === 'save-state') {
      paintSaveState(extra);
      if (extra && extra.fixes && extra.fixes.length) toast(extra.fixes.join(' '), 'info');
    }
    if (['history', 'change', 'page', 'select'].includes(reason)) paintTopbar();
  });
  paintTopbar();
}

// Fonts used by the site, loaded into the editor so the canvas matches.
function loadEditorFonts() {
  const fams = S.fonts.filter((f) => f.google).map((f) => 'family=' + f.google);
  for (let i = 0; i < fams.length; i += 8) {
    document.head.appendChild(h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?' + fams.slice(i, i + 8).join('&') + '&display=swap' }));
  }
}

let els = {};
function buildTopbar(bar) {
  const btn = (cls, label, icon, onclick, text) => {
    const b = h('button.wxe-top-btn' + (cls || ''), { type: 'button', title: label, 'aria-label': label, html: icon || '' });
    if (text) b.appendChild(h('span', null, text));
    b.addEventListener('click', onclick);
    return b;
  };
  els.pageSel = h('select.wxe-page-select', { 'aria-label': 'Page' });
  els.pageSel.addEventListener('change', () => switchPage(els.pageSel.value));
  els.devices = h(
    'div.wxe-devices',
    { role: 'radiogroup', 'aria-label': 'Device view' },
    ['desktop', 'tablet', 'mobile'].map((d) => {
      const b = h('button.wxe-top-btn', { type: 'button', role: 'radio', 'aria-checked': String(d === S.device), title: d[0].toUpperCase() + d.slice(1), 'aria-label': d[0].toUpperCase() + d.slice(1) + ' view', html: ICON[d] });
      b.addEventListener('click', () => setDevice(d));
      return b;
    })
  );
  els.undo = btn('', 'Undo (Ctrl+Z)', ICON.undo, () => undo());
  els.redo = btn('', 'Redo (Ctrl+Y)', ICON.redo, () => redo());
  els.zoom = h('span.wxe-zoom-val', { 'aria-live': 'polite' }, '100%');
  els.grid = btn('', 'Gridlines & snap to grid', ICON.grid, () => {
    S.gridlines = !S.gridlines;
    els.grid.setAttribute('aria-pressed', String(S.gridlines));
    renderCanvas();
  });
  els.grid.setAttribute('aria-pressed', 'false');
  els.status = h('span.wxe-save-status', { role: 'status', 'aria-live': 'polite' });
  els.save = btn('.has-text', 'Save now (Ctrl+S)', '', async () => {
    endTextEdit(true);
    const ok = await save();
    if (ok) toast('Saved.');
  }, 'Save');
  bar.append(
    h('a.wxe-top-btn.wxe-exit', { href: '/main-admin/settings', title: 'Exit to Main Admin settings', 'aria-label': 'Exit editor', html: ICON.exit }),
    h('div.wxe-site-name', null, h('strong', null, S.doc.site.orgName || 'My Site'), h('span.wxe-hint', null, 'Site editor')),
    h('label.wxe-page-label', null, h('span', null, 'Page:'), els.pageSel),
    h('div.wxe-top-sep'),
    els.devices,
    h('div.wxe-top-sep'),
    btn('', 'Zoom out', ICON.minus, () => setZoom(S.zoom - 0.1)),
    els.zoom,
    btn('', 'Zoom in', ICON.plus, () => setZoom(S.zoom + 0.1)),
    btn('.has-text', 'Fit to screen', '', () => fitZoom(), 'Fit'),
    els.grid,
    h('div.wxe-top-sep'),
    els.undo,
    els.redo,
    h('div.wxe-top-spacer'),
    els.status,
    els.save,
    btn('', 'Help & shortcuts (?)', ICON.help, showHelp),
    btn('', 'Site settings', ICON.settings, () => openPanel('settings')),
    btn('.has-text', 'Preview', ICON.eye, () => showPreview(), 'Preview'),
    btn('.has-text.is-primary', 'Publish', '', publish, 'Publish')
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === '?' && !e.target.closest('input, textarea, [contenteditable="true"], dialog')) showHelp();
  });
}
function paintTopbar() {
  els.pageSel.innerHTML = '';
  for (const p of S.doc.pages) els.pageSel.appendChild(h('option', { value: p.id, selected: p.id === S.pageId }, p.title + (p.isHome ? ' (Home)' : '')));
  els.undo.disabled = !S.undo.length;
  els.redo.disabled = !S.redo.length;
  els.zoom.textContent = Math.round(S.zoom * 100) + '%';
  els.devices.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-checked', String(['desktop', 'tablet', 'mobile'][i] === S.device)));
  paintSaveState();
}
function paintSaveState(extra) {
  const map = { saved: 'All changes saved', dirty: 'Unsaved changes', saving: 'Saving…', error: 'Not saved - retrying', conflict: 'Edited elsewhere - reload' };
  els.status.textContent = map[S.saveState] + (S.saveState === 'saved' && S.hasUnpublished ? ' · not published' : '');
  els.status.className = 'wxe-save-status is-' + S.saveState;
  if (extra && extra.error && S.saveState === 'conflict') {
    confirmDialog('Site changed elsewhere', extra.error, 'Reload now').then((ok) => ok && window.location.reload());
  } else if (extra && extra.error) toast(extra.error, 'error');
}
function setDevice(d) {
  endTextEdit(true);
  S.device = d;
  select([]);
  emit('device');
  fitZoom(true);
}
function setZoom(z) {
  S.zoom = Math.round(Math.min(2, Math.max(0.3, z)) * 100) / 100;
  emit('device');
}
function fitZoom(onlyShrink) {
  const ws = document.querySelector('.wxe-workspace');
  const W = { desktop: 980, tablet: 768, mobile: 320 }[S.device];
  const fit = Math.min(1, (ws.clientWidth - 64) / W);
  if (!onlyShrink || fit < S.zoom || S.zoom < 1) setZoom(fit);
  else setZoom(S.zoom);
}

// ---------------------------------------------------------------- preview
async function showPreview() {
  endTextEdit(true);
  await save();
  let device = S.device;
  const frame = h('iframe.wxe-preview-frame', { title: 'Site preview', src: `/main-admin/website/preview/${page().id}` });
  const holder = h('div.wxe-preview-holder.is-' + device, null, frame);
  const devBtns = ['desktop', 'tablet', 'mobile'].map((d) => {
    const b = h('button.wxe-top-btn', { type: 'button', role: 'radio', 'aria-checked': String(d === device), 'aria-label': d + ' preview', title: d, html: ICON[d] });
    b.addEventListener('click', () => {
      device = d;
      holder.className = 'wxe-preview-holder is-' + d;
      devBtns.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    });
    return b;
  });
  const pageSel = h('select.wxe-page-select', { 'aria-label': 'Preview page' }, S.doc.pages.map((p) => h('option', { value: p.id, selected: p.id === S.pageId }, p.title)));
  pageSel.addEventListener('change', () => (frame.src = `/main-admin/website/preview/${pageSel.value}`));
  const dlg = h('dialog.wxe-preview', { 'aria-label': 'Preview' });
  dlg.append(
    h('div.wxe-preview-bar', null, h('strong', null, 'Preview'), pageSel, h('div.wxe-devices', { role: 'radiogroup', 'aria-label': 'Preview device' }, devBtns), h('span.wxe-hint', null, 'Exactly what Publish will put live.'), h('div.wxe-top-spacer'), h('button.wxe-btn', { type: 'button', onclick: () => (dlg.close(), dlg.remove()) }, 'Back to Editor')),
    holder
  );
  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg);
  dlg.showModal();
}

// ---------------------------------------------------------------- publish
async function publish() {
  endTextEdit(true);
  const saved = await save();
  if (!saved && S.saveState !== 'saved') return toast('Fix the save problem before publishing.', 'error');
  const label = h('input.wxe-input', { type: 'text', placeholder: 'e.g. Spring enrollment update', maxlength: 120 });
  const ok = await modal({
    title: 'Publish your site?',
    body: h('div.wxe-form', null, h('p', null, `Your changes on all ${S.doc.pages.length} page(s) go live at ${S.siteUrl}.`), h('label.wxe-field', null, h('span', null, 'Version note (optional)'), label)),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Publish', value: true, primary: true }],
  });
  if (!ok) return;
  els.status.textContent = 'Publishing…';
  const res = await api('POST', '/main-admin/website/api/publish', { label: label.value.trim() });
  if (!res.ok) {
    paintSaveState();
    return toast(res.error || 'Publishing failed - nothing changed on the live site.', 'error');
  }
  S.publishedAt = res.publishedAt;
  S.hasUnpublished = false;
  invalidateVersions();
  paintSaveState();
  const home = S.doc.pages.find((p) => p.isHome);
  const cur = page();
  const link = cur.isHome || cur.id === home.id ? res.url : res.url + cur.slug;
  modal({
    title: 'Your site is published! 🎉',
    body: h('div', null, h('p', null, 'Visitors now see your latest changes.'), h('p', null, h('a.wxe-btn.is-primary', { href: link, target: '_blank', rel: 'noopener' }, 'View live site'))),
    buttons: [{ label: 'Keep editing', value: true }],
  });
}

// ---------------------------------------------------------------- help
function showHelp() {
  const mod = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl';
  const rows = [
    ['Undo / Redo', `${mod}+Z / ${mod}+Y`],
    ['Copy / Cut / Paste', `${mod}+C / ${mod}+X / ${mod}+V`],
    ['Duplicate', `${mod}+D`],
    ['Group / Ungroup', `${mod}+G / ${mod}+Shift+G`],
    ['Lock / Unlock', `${mod}+L`],
    ['Select all in section', `${mod}+A`],
    ['Delete', 'Delete or Backspace'],
    ['Nudge 1px / 10px', 'Arrow keys / Shift+Arrow'],
    ['Edit selected text', 'Enter (or double-click)'],
    ['Stop editing / deselect', 'Esc'],
    ['Save now', `${mod}+S`],
    ['Move without snapping', 'Hold Alt while dragging'],
    ['Resize keeping proportions', 'Hold Shift on a corner handle'],
    ['Add to selection', 'Shift+click'],
  ];
  modal({
    title: 'Help & shortcuts',
    wide: true,
    body: h(
      'div.wxe-help',
      null,
      h('table.wxe-shortcuts', null, h('caption', null, 'Keyboard shortcuts'), h('tbody', null, rows.map(([a, k]) => h('tr', null, h('th', { scope: 'row' }, a), h('td', null, h('kbd', null, k)))))),
      h(
        'div',
        null,
        h('h3', null, 'How it works'),
        h(
          'ul',
          null,
          h('li', null, 'Pages are made of full-width sections (strips). Add one with "+ Add Section" between strips or from the left toolbar.'),
          h('li', null, 'Drag elements anywhere inside a section. Blue guides show when edges or centers line up.'),
          h('li', null, 'Switch to Tablet or Mobile to arrange those layouts separately - desktop stays untouched. Mobile starts as an automatic single column.'),
          h('li', null, 'Your work autosaves as a draft. Nothing changes on the live site until you click Publish. Preview shows exactly what will go live.'),
          h('li', null, 'Every publish is kept in Settings > Version history, so you can roll back.'),
          h('li', null, 'Use Pages & Menu to add pages, set the homepage, make a page members-only, and build dropdown menus.')
        )
      )
    ),
    buttons: [{ label: 'Close', value: true, primary: true }],
  });
}

boot();
