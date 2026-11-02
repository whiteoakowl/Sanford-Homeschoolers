// The editing canvas: renders the current page with the shared renderer
// (public/js/site-render.js) at the current device width, and handles
// Wix-style direct manipulation - click to select (blue frame + name
// tag), drag anywhere inside a strip, resize handles, snap/alignment
// guides, gridlines, marquee select, inline text editing, the floating
// element toolbar, section toolbars, "+ Add Section", the right-click
// menu and keyboard shortcuts.
import { h, R, ICON, clamp, toast, confirmDialog, promptDialog, api, esc } from './util.js';
import { S, on, emit, mutate, page, findElement, findSection, select, selectedElements, undo, redo, save } from './state.js';
import {
  TYPE_LABEL, rectOf, setRect, sectionHeightFor, setSectionHeight, effectiveStyle, setStyle, cloneElement, cloneSection, arrange, expandGroups,
  boundsOf, alignElements, placeNew, maxZ, mediaMap, setHidden, newSection,
} from './model.js';
import { uid } from './util.js';
import { openMedia } from './media.js';

let workspace;
let wrap;
let stage;
let overlay;
let designStyle;
const SNAP = 6;

export function mountCanvas(host) {
  workspace = host;
  wrap = h('div.wxe-stage-wrap');
  stage = h('div#wx-site.wxe-stage');
  overlay = h('div.wxe-overlay');
  designStyle = h('style#wxe-design-css');
  document.head.appendChild(designStyle);
  wrap.append(stage, overlay);
  workspace.appendChild(wrap);
  stage.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('dblclick', onDblClick);
  overlay.addEventListener('dblclick', onDblClick);
  stage.addEventListener('contextmenu', onContextMenu);
  overlay.addEventListener('contextmenu', onContextMenu);
  stage.addEventListener('click', (e) => {
    if (e.target.closest('a') && !S.editingText) e.preventDefault();
  });
  document.addEventListener('keydown', onKeyDown);
  on((reason, extra) => {
    if (reason === 'select') return renderOverlay();
    if (reason === 'save-state' || reason === 'panel' || reason === 'inspector') return;
    if (S.editingText && reason === 'text-style') return refreshEditingStyles();
    if (extra && extra.noCanvas) return;
    render();
  });
  new ResizeObserver(() => positionWrap()).observe(workspace);
}

function ctx() {
  return { media: mediaMap(), data: S.widgetData, portalAccount: false, editor: true, pages: S.doc.pages, menu: S.doc.menu, currentPageId: S.pageId };
}

// ---------------------------------------------------------------- render
export function render() {
  if (!stage) return;
  const p = page();
  const W = R.DEVICE_WIDTH[S.device];
  const hydrated = R.hydrate(JSON.parse(JSON.stringify({ pages: [], header: S.doc.header, footer: S.doc.footer, design: S.doc.design, site: S.doc.site })), mediaMap());
  designStyle.textContent = R.designCss(hydrated, { device: S.device });
  stage.className = `wxe-stage wxe-dev-${S.device}${S.gridlines ? ' has-grid' : ''}`;
  stage.style.width = W + 'px';
  stage.innerHTML = '';
  const c = ctx();
  const landing = p.type === 'landing';
  if (!landing && S.doc.header.show !== false) {
    const hd = h('div.wxe-chrome.wxe-chrome-header', { html: R.renderHeader(hydrated, c), title: 'Site header - edit it in Site Design > Header' });
    hd.appendChild(h('button.wxe-chrome-edit', { type: 'button', onclick: () => emit('panel', { name: 'design', tab: 'header' }) }, 'Edit header'));
    stage.appendChild(hd);
  }
  if (!p.sections.length) {
    stage.appendChild(
      h('div.wxe-empty-page', null, h('h2', null, 'This page is empty'), h('p', null, 'Start with a designed section or a blank strip.'), h('button.wxe-btn.is-primary', { type: 'button', onclick: () => emit('panel', { name: 'sections', insertAt: 0 }) }, '+ Add Section'))
    );
  }
  p.sections.forEach((section, index) => stage.appendChild(renderSection(section, index, c)));
  if (!landing && S.doc.footer.show !== false) {
    const ft = h('div.wxe-chrome.wxe-chrome-footer', { html: R.renderFooter(hydrated, c) });
    ft.appendChild(h('button.wxe-chrome-edit', { type: 'button', onclick: () => emit('panel', { name: 'design', tab: 'footer' }) }, 'Edit footer'));
    stage.appendChild(ft);
  }
  fitFlowContent();
  positionWrap();
  renderOverlay();
}

function renderSection(section, index, c) {
  const hidden = R.isHidden(section, S.device);
  const bg = { ...section, bg: { ...(section.bg || {}) } };
  const media = mediaMap();
  if (bg.bg.mediaId && media[bg.bg.mediaId]) bg.bg.imageUrl = media[bg.bg.mediaId].url;
  const sEl = h('div.wxe-section' + (hidden ? '.is-hidden-device' : ''), { 'data-sid': section.id, style: `min-height:${sectionHeightFor(section)}px;${R.sectionBgCss(bg).filter((x) => !x.startsWith('background-attachment')).join(';')}` });
  if (section.bg && section.bg.type === 'video' && section.bg.videoId && media[section.bg.videoId]) {
    sEl.appendChild(h('video.wx-sec-video', { src: media[section.bg.videoId].url, muted: true, loop: true, autoplay: true, playsinline: true }));
  }
  const inner = h('div.wxe-sec-inner');
  const auto = S.device === 'mobile' ? R.autoStack(section) : null;
  for (const el of section.elements) {
    const elHidden = R.isHidden(el, S.device);
    const r = R.layoutFor(el, S.device, section, auto);
    const s = R.styleFor(el, S.device, S.doc);
    const flow = R.FLOW_TYPES.has(el.type);
    const node = h('div.wxe-el.wx-el.wx-el-' + el.type + (elHidden ? '.is-hidden-device' : '') + (el.locked ? '.is-locked' : ''), {
      'data-eid': el.id,
      style: `left:${r.x}px;top:${r.y}px;width:${r.w}px;${flow ? 'min-height' : 'height'}:${r.h}px;z-index:${el.z || 1};${s.opacity != null && s.opacity !== 100 ? `opacity:${s.opacity / 100};` : ''}`,
    });
    const box = h('div.wx-box', { style: R.elementBoxCss(el, s).join(';') });
    box.innerHTML = R.renderInner(el, c) || '';
    if (el.type === 'text') {
      const t = box.querySelector('.wx-text');
      if (t) t.setAttribute('style', R.textCss(s).join(';'));
    }
    node.appendChild(box);
    if (elHidden) node.appendChild(h('span.wxe-hidden-badge', null, `Hidden on ${S.device}`));
    inner.appendChild(node);
  }
  sEl.appendChild(inner);
  return sEl;
}

// Text and live lists can be taller than their saved box; grow the
// strip on the canvas to match what the public page will do.
function fitFlowContent() {
  stage.querySelectorAll('.wxe-section').forEach((sEl) => {
    let bottom = 0;
    sEl.querySelectorAll('.wxe-el').forEach((n) => {
      bottom = Math.max(bottom, n.offsetTop + n.offsetHeight);
    });
    if (bottom + 8 > sEl.offsetHeight) sEl.style.minHeight = bottom + 16 + 'px';
  });
}

function positionWrap() {
  if (!stage) return;
  const W = R.DEVICE_WIDTH[S.device];
  stage.style.transform = `scale(${S.zoom})`;
  wrap.style.width = W * S.zoom + 'px';
  wrap.style.height = stage.offsetHeight * S.zoom + 'px';
  overlay.style.width = W + 'px';
  overlay.style.height = stage.offsetHeight + 'px';
  overlay.style.transform = `scale(${S.zoom})`;
  overlay.style.setProperty('--inv', String(1 / S.zoom));
}

// ---------------------------------------------------------------- overlay
function sectionEl(id) {
  return stage.querySelector(`.wxe-section[data-sid="${id}"]`);
}
function elNode(id) {
  return stage.querySelector(`.wxe-el[data-eid="${id}"]`);
}
function nodeBox(n) {
  return { x: n.offsetLeft, y: n.offsetTop + n.parentElement.parentElement.offsetTop, w: n.offsetWidth, h: n.offsetHeight };
}
export function renderOverlay() {
  if (!overlay) return;
  overlay.innerHTML = '';
  positionWrap();
  const p = page();
  // Section chrome: label + "+ Add Section" on every strip, full toolbar
  // on the selected one.
  p.sections.forEach((section, index) => {
    const sEl = sectionEl(section.id);
    if (!sEl) return;
    const top = sEl.offsetTop;
    const hh = sEl.offsetHeight;
    const selected = S.sectionId === section.id;
    const holder = h('div.wxe-sec-chrome' + (selected ? '.is-selected' : ''), { style: { top: top + 'px', height: hh + 'px' }, 'data-sid': section.id });
    holder.appendChild(h('span.wxe-sec-label', null, (section.name || 'Section') + (R.isHidden(section, S.device) ? ` (hidden on ${S.device})` : '')));
    holder.appendChild(h('button.wxe-add-sec.is-bottom', { type: 'button', onclick: () => emit('panel', { name: 'sections', insertAt: index + 1 }) }, '+ Add Section'));
    if (index === 0) holder.appendChild(h('button.wxe-add-sec.is-top', { type: 'button', onclick: () => emit('panel', { name: 'sections', insertAt: 0 }) }, '+ Add Section'));
    if (selected) {
      holder.appendChild(sectionToolbar(section, index));
      holder.appendChild(h('div.wxe-sec-resize', { 'data-sec-resize': section.id, title: 'Drag to change the section height', role: 'separator', 'aria-label': 'Section height' }, h('span', null, '⇕')));
    }
    overlay.appendChild(holder);
  });
  // Element selection frame(s).
  const sel = selectedElements().filter((f) => f.page.id === p.id);
  if (!sel.length) return;
  const frames = [];
  for (const f of sel) {
    const n = elNode(f.el.id);
    if (!n) continue;
    const b = nodeBox(n);
    frames.push(b);
    overlay.appendChild(h('div.wxe-frame' + (f.el.locked ? '.is-locked' : ''), { style: { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' } }));
  }
  if (!frames.length) return;
  const x1 = Math.min(...frames.map((b) => b.x));
  const y1 = Math.min(...frames.map((b) => b.y));
  const x2 = Math.max(...frames.map((b) => b.x + b.w));
  const y2 = Math.max(...frames.map((b) => b.y + b.h));
  const box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  const first = sel[0].el;
  const grouped = sel.length > 1 && first.groupId && sel.every((f) => f.el.groupId === first.groupId);
  const tagText = sel.length === 1 ? first.name || TYPE_LABEL[first.type] : grouped ? 'Group' : `${sel.length} elements`;
  const bounds = h('div.wxe-bounds' + (sel.length > 1 ? '.is-multi' : ''), { style: { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' } });
  bounds.appendChild(h('span.wxe-name-tag', null, tagText + (first.locked ? ' 🔒' : '')));
  const sameSection = sel.every((f) => f.section.id === sel[0].section.id);
  if (!sel.some((f) => f.el.locked) && sameSection && !S.editingText) {
    for (const hd of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) bounds.appendChild(h('span.wxe-handle.is-' + hd, { 'data-handle': hd }));
  }
  const size = rectOf(first, sel[0].section);
  if (sel.length === 1) bounds.appendChild(h('span.wxe-size-tag', null, `${Math.round(size.w)} × ${Math.round(size.h)}`));
  overlay.appendChild(bounds);
  if (S.editingText) overlay.appendChild(textToolbar(first, box));
  else overlay.appendChild(elementToolbar(sel, box, grouped));
}

function tb(label, icon, onclick, opts) {
  const o = opts || {};
  const b = h('button.wxe-tb-btn' + (o.text ? '.has-text' : '') + (o.active ? '.is-active' : ''), { type: 'button', title: label, 'aria-label': label, 'aria-pressed': o.active != null ? String(!!o.active) : null, disabled: o.disabled });
  b.innerHTML = icon || '';
  if (o.text) b.appendChild(h('span', null, o.text));
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onclick(e, b);
  });
  return b;
}
function placeToolbar(bar, box) {
  // Above the frame, or below when there's no room at the top.
  const above = box.y > 56;
  bar.style.left = box.x + 'px';
  bar.style.top = (above ? box.y : box.y + box.h) + 'px';
  bar.classList.add(above ? 'is-above' : 'is-below');
  return bar;
}
const PRIMARY = {
  text: ['Edit Text', ICON.edit, (el) => startTextEdit(el.id)],
  image: ['Change Image', ICON.image, (el) => pickImageFor(el)],
  video: ['Change Video', ICON.play, () => emit('inspector', { tab: 'content' })],
  gallery: ['Manage Images', ICON.media, () => emit('inspector', { tab: 'content' })],
  slideshow: ['Manage Slides', ICON.media, () => emit('inspector', { tab: 'content' })],
  button: ['Change Text & Link', ICON.link, () => emit('inspector', { tab: 'content' })],
};
function elementToolbar(sel, box, grouped) {
  const bar = h('div.wxe-toolbar', { role: 'toolbar', 'aria-label': 'Element actions' });
  const els = sel.map((f) => f.el);
  if (sel.length === 1) {
    const el = els[0];
    const pr = PRIMARY[el.type] || ['Settings', ICON.gear, () => emit('inspector', { tab: 'content' })];
    bar.append(
      tb(pr[0], pr[1], () => pr[2](el), { text: pr[0] }),
      tb('Design', ICON.brush, () => emit('inspector', { tab: 'design' })),
      tb('Animation', ICON.spark, () => emit('inspector', { tab: 'animation' })),
      tb('Layout & responsive', ICON.desktop, () => emit('inspector', { tab: 'layout' }))
    );
  } else {
    bar.append(tb('Align', ICON.alignL, (e, b) => alignMenu(b), { text: 'Align' }), tb(grouped ? 'Ungroup' : 'Group', ICON.group, () => (grouped ? ungroup() : groupSelection()), { text: grouped ? 'Ungroup' : 'Group' }));
  }
  bar.append(
    tb('Arrange', ICON.arrange, (e, b) => arrangeMenu(b)),
    tb('Duplicate (Ctrl+D)', ICON.copy, duplicateSelection),
    tb(els.some((x) => x.locked) ? 'Unlock' : 'Lock', els.some((x) => x.locked) ? ICON.lock : ICON.unlock, toggleLock, { active: els.some((x) => x.locked) }),
    tb('Delete', ICON.trash, deleteSelection, { disabled: els.some((x) => x.locked) }),
    tb('More actions', ICON.more, (e, b) => {
      const r = b.getBoundingClientRect();
      showContextMenu(r.left, r.bottom + 4, elementMenuItems(sel));
    })
  );
  return placeToolbar(bar, box);
}

function sectionToolbar(section, index) {
  const count = page().sections.length;
  const bar = h('div.wxe-sec-toolbar', { role: 'toolbar', 'aria-label': 'Section actions' });
  bar.append(
    tb('Move section up', ICON.up, () => moveSection(section.id, -1), { disabled: index === 0 }),
    tb('Move section down', ICON.down, () => moveSection(section.id, 1), { disabled: index === count - 1 }),
    tb('Background', ICON.brush, () => emit('inspector', { tab: 'background' }), { text: 'Background' }),
    tb('Section settings', ICON.gear, () => emit('inspector', { tab: 'section' })),
    tb('Duplicate section', ICON.copy, () => duplicateSection(section.id)),
    tb('Save as my section', ICON.save, () => saveSectionAsMine(section.id)),
    tb('Delete section', ICON.trash, () => deleteSection(section.id))
  );
  return bar;
}

// ---------------------------------------------------------------- text editing
const TEXT_STYLE_OPTIONS = [
  ['h1', 'Heading 1', 'h1'],
  ['h2', 'Heading 2', 'h2'],
  ['h3', 'Heading 3', 'h3'],
  ['h4', 'Heading 4', 'h4'],
  ['p', 'Paragraph', 'p'],
  ['small', 'Small text', 'p'],
];
function textToolbar(el, box) {
  const bar = h('div.wxe-toolbar.wxe-text-toolbar', { role: 'toolbar', 'aria-label': 'Text formatting' });
  const s = effectiveStyle(el);
  const tsSel = h('select.wxe-tb-select', { 'aria-label': 'Text style' }, TEXT_STYLE_OPTIONS.map(([v, l]) => h('option', { value: v, selected: (el.props.textStyle || el.props.tag) === v }, l)));
  tsSel.addEventListener('change', () => {
    const opt = TEXT_STYLE_OPTIONS.find((o) => o[0] === tsSel.value);
    const html = currentEditHtml();
    mutate(() => {
      const f = findElement(el.id);
      f.el.props.textStyle = opt[0];
      f.el.props.tag = opt[2];
      f.el.props.html = html;
    }, { reason: 'retag' });
    endTextEdit(false);
    startTextEdit(el.id);
  });
  const fontSel = h('select.wxe-tb-select', { 'aria-label': 'Font' }, h('option', { value: '' }, 'Theme font'), S.fonts.map((f) => h('option', { value: f.key, selected: s.fontFamily === f.key }, f.label)));
  fontSel.addEventListener('change', () => styleWhileEditing(el.id, 'fontFamily', fontSel.value || undefined));
  const size = h('input.wxe-tb-num', { type: 'number', min: 6, max: 240, value: s.fontSize || '', placeholder: 'Size', 'aria-label': 'Font size' });
  size.addEventListener('change', () => styleWhileEditing(el.id, 'fontSize', size.value ? Number(size.value) : undefined));
  const color = h('input.wxe-tb-color', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : '#1c2530', 'aria-label': 'Text color', title: 'Text color (selected words, or the whole text when nothing is selected)' });
  color.addEventListener('input', () => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && editingNode() && editingNode().contains(sel.anchorNode)) {
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('foreColor', false, color.value);
    } else styleWhileEditing(el.id, 'color', color.value.toUpperCase());
  });
  const exec = (cmd) => () => {
    document.execCommand(cmd, false, null);
    editingNode() && editingNode().focus();
  };
  const keep = (b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    return b;
  };
  bar.append(
    tsSel,
    fontSel,
    size,
    keep(tb('Bold (Ctrl+B)', ICON.bold, exec('bold'))),
    keep(tb('Italic (Ctrl+I)', ICON.italic, exec('italic'))),
    keep(tb('Underline (Ctrl+U)', ICON.underline, exec('underline'))),
    keep(tb('Strikethrough', ICON.strike, exec('strikeThrough'))),
    color,
    ...[
      ['left', 'Align left', ICON.tl],
      ['center', 'Align center', ICON.tc],
      ['right', 'Align right', ICON.tr],
      ['justify', 'Justify', ICON.tj],
    ].map(([v, l, i]) => keep(tb(l, i, () => styleWhileEditing(el.id, 'align', v), { active: (s.align || 'left') === v }))),
    keep(
      tb('Link', ICON.link, async () => {
        const sel = window.getSelection();
        const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        const url = await promptDialog('Add link', 'Web address, email (mailto:) or page path (/about)', 'https://');
        if (url == null) return;
        const node = editingNode();
        node.focus();
        if (range) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
        if (!url) document.execCommand('unlink');
        else if (R.safeUrl(url)) document.execCommand('createLink', false, url);
        else toast('Links must start with https://, mailto:, tel: or /', 'error');
      })
    ),
    keep(tb('Clear formatting', ICON.close, exec('removeFormat'))),
    tb('Done', '', () => endTextEdit(true), { text: 'Done' })
  );
  return placeToolbar(bar, box);
}
function editingNode() {
  if (!S.editingText) return null;
  const n = elNode(S.editingText);
  return n && n.querySelector('.wx-text');
}
function currentEditHtml() {
  const n = editingNode();
  if (!n) return '';
  return n.innerHTML
    .replace(/<div>(.*?)<\/div>/gi, '<br>$1')
    .replace(/^<br>/, '')
    .replace(/&nbsp;/g, ' ');
}
export function startTextEdit(id) {
  const f = findElement(id);
  if (!f || f.el.type !== 'text' || f.el.locked) return;
  if (S.editingText) endTextEdit(true);
  select([id]);
  S.editingText = id;
  const n = editingNode();
  if (!n) return;
  n.contentEditable = 'true';
  n.spellcheck = true;
  n.focus();
  const range = document.createRange();
  range.selectNodeContents(n);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  n.addEventListener('keydown', textKeys);
  n.addEventListener('paste', textPaste);
  n.addEventListener('input', growWhileTyping);
  renderOverlay();
}
function textKeys(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (!document.execCommand('insertLineBreak')) document.execCommand('insertHTML', false, '<br><br>');
  } else if (e.key === 'Escape') {
    e.preventDefault();
    endTextEdit(true);
  }
  e.stopPropagation();
}
function textPaste(e) {
  e.preventDefault();
  const t = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, t);
}
function growWhileTyping() {
  const n = elNode(S.editingText);
  if (n) renderOverlayFrameOnly(n);
}
function renderOverlayFrameOnly() {
  const b = overlay.querySelector('.wxe-bounds');
  const n = elNode(S.editingText);
  if (!b || !n) return;
  const box = nodeBox(n);
  b.style.height = box.h + 'px';
}
function styleWhileEditing(id, key, value) {
  mutate(() => setStyle(findElement(id).el, key, value), { reason: 'text-style', merge: 'ts-' + id + key });
}
function refreshEditingStyles() {
  const f = findElement(S.editingText);
  const n = elNode(S.editingText);
  if (!f || !n) return;
  const s = effectiveStyle(f.el);
  n.querySelector('.wx-box').setAttribute('style', R.elementBoxCss(f.el, s).join(';'));
  n.querySelector('.wx-text').setAttribute('style', R.textCss(s).join(';'));
  renderOverlayFrameOnly();
}
export function endTextEdit(commit) {
  if (!S.editingText) return;
  const id = S.editingText;
  const n = editingNode();
  const html = currentEditHtml();
  const outer = elNode(id);
  const measured = outer ? outer.offsetHeight : 0;
  if (n) {
    n.contentEditable = 'false';
    n.removeEventListener('keydown', textKeys);
    n.removeEventListener('paste', textPaste);
    n.removeEventListener('input', growWhileTyping);
  }
  S.editingText = null;
  const f = findElement(id);
  if (commit && f && (html !== f.el.props.html || measured > rectOf(f.el, f.section).h)) {
    mutate(() => {
      const g = findElement(id);
      g.el.props.html = html;
      const r = rectOf(g.el, g.section);
      // Wix grows a text box to fit its text.
      if (measured > r.h) setRect(g.el, g.section, { ...r, h: measured });
    });
  } else render();
}

// ---------------------------------------------------------------- pointer
function stagePoint(e) {
  const r = stage.getBoundingClientRect();
  return { x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom };
}
function sectionAtY(y) {
  for (const sEl of stage.querySelectorAll('.wxe-section')) {
    if (y >= sEl.offsetTop && y < sEl.offsetTop + sEl.offsetHeight) return sEl;
  }
  return null;
}
let drag = null;
function onPointerDown(e) {
  if (e.button !== 0) return;
  hideContextMenu();
  if (e.target.closest('.wxe-toolbar, .wxe-sec-toolbar, .wxe-add-sec, .wxe-chrome-edit, button, select, input')) return;
  const p = stagePoint(e);
  if (S.editingText) {
    const n = editingNode();
    if (n && n.contains(e.target)) return;
    endTextEdit(true);
  }
  const handle = e.target.closest('[data-handle]');
  if (handle) return startResize(e, handle.getAttribute('data-handle'), p);
  const secResize = e.target.closest('[data-sec-resize]');
  if (secResize) return startSectionResize(e, secResize.getAttribute('data-sec-resize'), p);
  // Clicking inside the current selection frame drags the selection
  // (even where the frame covers another element).
  const bounds = e.target.closest('.wxe-bounds');
  let node;
  if (bounds && S.selection.length) node = elNode(S.selection[0]);
  else {
    // The overlay sits above the stage; find the element under the pointer.
    const hit = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.closest && x.closest('.wxe-el'));
    node = hit ? hit.closest('.wxe-el') : null;
  }
  if (node) {
    const id = node.getAttribute('data-eid');
    if (!bounds) {
      let ids = expandGroups([id]);
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        const cur = new Set(S.selection);
        const has = ids.every((x) => cur.has(x));
        ids.forEach((x) => (has ? cur.delete(x) : cur.add(x)));
        ids = [...cur];
      }
      if (ids.join() !== S.selection.join()) select(ids);
    }
    const sel = selectedElements();
    if (!sel.length || sel.some((f) => f.el.locked)) return;
    e.preventDefault();
    drag = {
      mode: 'move',
      start: p,
      moved: false,
      items: sel.map((f) => ({ id: f.el.id, section: f.section, rect: { ...rectOf(f.el, f.section) }, node: elNode(f.el.id) })),
      sectionId: sel[0].section.id,
    };
  } else {
    const sEl = sectionAtY(p.y);
    if (!sEl) {
      select([]);
      return;
    }
    e.preventDefault();
    drag = { mode: 'marquee', start: p, sectionId: sEl.getAttribute('data-sid'), moved: false };
  }
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
}

function guideLines(sectionId, excludeIds) {
  const f = findSection(sectionId);
  const W = R.DEVICE_WIDTH[S.device];
  const H = sectionHeightFor(f.section);
  const xs = [0, W / 2, W];
  const ys = [0, H / 2, H];
  for (const el of f.section.elements) {
    if (excludeIds.includes(el.id) || R.isHidden(el, S.device)) continue;
    const r = rectOf(el, f.section);
    xs.push(r.x, r.x + r.w / 2, r.x + r.w);
    ys.push(r.y, r.y + r.h / 2, r.y + r.h);
  }
  return { xs, ys, W, H };
}
function snapAxis(edges, lines, tol) {
  let best = null;
  for (const e of edges) {
    for (const l of lines) {
      const d = l - e;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: l };
    }
  }
  return best;
}
function drawGuides(sectionTop, xs, ys) {
  overlay.querySelectorAll('.wxe-guide').forEach((g) => g.remove());
  for (const x of xs) overlay.appendChild(h('div.wxe-guide.is-v', { style: { left: x + 'px' } }));
  for (const y of ys) overlay.appendChild(h('div.wxe-guide.is-h', { style: { top: sectionTop + y + 'px' } }));
}

function onPointerMove(e) {
  if (!drag) return;
  const p = stagePoint(e);
  const dx = p.x - drag.start.x;
  const dy = p.y - drag.start.y;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
  drag.moved = true;
  const tol = SNAP / S.zoom;
  if (drag.mode === 'move') {
    const ids = drag.items.map((i) => i.id);
    const sTop = sectionEl(drag.sectionId).offsetTop;
    const b = boundsOfRects(drag.items.map((i) => i.rect));
    let mx = dx;
    let my = dy;
    const g = guideLines(drag.sectionId, ids);
    const gx = [];
    const gy = [];
    if (!e.altKey) {
      const sx = snapAxis([b.x + dx, b.x + dx + b.w / 2, b.x + dx + b.w], g.xs, tol);
      const sy = snapAxis([b.y + dy, b.y + dy + b.h / 2, b.y + dy + b.h], g.ys, tol);
      if (sx) {
        mx += sx.d;
        gx.push(sx.line);
      } else if (S.gridlines) mx = Math.round((b.x + dx) / 10) * 10 - b.x;
      if (sy) {
        my += sy.d;
        gy.push(sy.line);
      } else if (S.gridlines) my = Math.round((b.y + dy) / 10) * 10 - b.y;
    }
    for (const it of drag.items) {
      it.node.style.left = clamp(it.rect.x + mx, -it.rect.w + 10, g.W - 10) + 'px';
      it.node.style.top = it.rect.y + my + 'px';
    }
    drag.delta = { x: mx, y: my };
    drawGuides(sTop, gx, gy);
    moveFrames(mx, my);
  } else if (drag.mode === 'resize') {
    doResize(dx, dy, e.shiftKey, tol, e.altKey);
  } else if (drag.mode === 'section') {
    const hh = Math.max(40, drag.startH + dy);
    drag.newH = hh;
    sectionEl(drag.sectionId).style.minHeight = hh + 'px';
    positionWrap();
    const chrome = overlay.querySelector(`.wxe-sec-chrome[data-sid="${drag.sectionId}"]`);
    if (chrome) chrome.style.height = hh + 'px';
  } else if (drag.mode === 'marquee') {
    const x = Math.min(p.x, drag.start.x);
    const y = Math.min(p.y, drag.start.y);
    let m = overlay.querySelector('.wxe-marquee');
    if (!m) overlay.appendChild((m = h('div.wxe-marquee')));
    Object.assign(m.style, { left: x + 'px', top: y + 'px', width: Math.abs(dx) + 'px', height: Math.abs(dy) + 'px' });
    drag.rect = { x, y, w: Math.abs(dx), h: Math.abs(dy) };
  }
}
function boundsOfRects(rs) {
  const x1 = Math.min(...rs.map((r) => r.x));
  const y1 = Math.min(...rs.map((r) => r.y));
  return { x: x1, y: y1, w: Math.max(...rs.map((r) => r.x + r.w)) - x1, h: Math.max(...rs.map((r) => r.y + r.h)) - y1 };
}
function moveFrames(dx, dy) {
  overlay.querySelectorAll('.wxe-frame, .wxe-bounds, .wxe-toolbar').forEach((f) => {
    if (!f.dataset.ox) {
      f.dataset.ox = parseFloat(f.style.left);
      f.dataset.oy = parseFloat(f.style.top);
    }
    f.style.left = Number(f.dataset.ox) + dx + 'px';
    f.style.top = Number(f.dataset.oy) + dy + 'px';
  });
}

function onPointerUp(e) {
  window.removeEventListener('pointermove', onPointerMove);
  const d = drag;
  drag = null;
  overlay.querySelectorAll('.wxe-guide, .wxe-marquee').forEach((g) => g.remove());
  if (!d) return;
  if (d.mode === 'move') {
    // A plain click must not rebuild the overlay - that would swallow the
    // second click of a double-click (inline text editing).
    if (!d.moved || !d.delta) return;
    const p = stagePoint(e);
    const target = sectionAtY(p.y);
    const targetId = target && target.getAttribute('data-sid');
    mutate(() => {
      const fromTop = sectionEl(d.sectionId).offsetTop;
      for (const it of d.items) {
        const f = findElement(it.id);
        let rect = { ...it.rect, x: it.rect.x + d.delta.x, y: it.rect.y + d.delta.y };
        // Dropped on another strip: the element moves into it (Wix).
        if (targetId && targetId !== d.sectionId && d.items.length === d.items.filter((x) => x.section.id === d.sectionId).length) {
          const to = findSection(targetId).section;
          const offset = fromTop - target.offsetTop;
          f.section.elements = f.section.elements.filter((x) => x.id !== it.id);
          delete f.el.layout.tablet;
          delete f.el.layout.mobile;
          rect = { ...rect, y: Math.max(0, rect.y + offset) };
          to.elements.push(f.el);
          f.el.z = maxZ(to) + 1;
          setRect(f.el, to, rect);
          if (S.device === 'desktop' && rect.y + rect.h + 20 > to.height.desktop) to.height.desktop = rect.y + rect.h + 20;
        } else {
          rect.y = Math.max(0, rect.y);
          setRect(f.el, f.section, rect);
          growSectionToFit(f.section, rect);
        }
      }
    });
  } else if (d.mode === 'resize') {
    if (!d.moved || !d.result) return renderOverlay();
    mutate(() => {
      for (const it of d.items) {
        const f = findElement(it.id);
        const r = d.result[it.id];
        setRect(f.el, f.section, r);
        growSectionToFit(f.section, r);
      }
    });
  } else if (d.mode === 'section') {
    if (!d.moved) return;
    mutate(() => setSectionHeight(findSection(d.sectionId).section, d.newH));
  } else if (d.mode === 'marquee') {
    if (!d.moved || !d.rect) return select([], d.sectionId);
    const sTop = sectionEl(d.sectionId).offsetTop;
    const f = findSection(d.sectionId);
    const hits = f.section.elements.filter((el) => {
      if (R.isHidden(el, S.device)) return false;
      const r = rectOf(el, f.section);
      return r.x < d.rect.x + d.rect.w && r.x + r.w > d.rect.x && r.y + sTop < d.rect.y + d.rect.h && r.y + r.h + sTop > d.rect.y;
    });
    select(expandGroups(hits.map((x) => x.id)), d.sectionId);
  }
}
function growSectionToFit(section, rect) {
  const need = rect.y + rect.h + 10;
  if (need > sectionHeightFor(section)) setSectionHeight(section, need);
}

function startResize(e, handle, p) {
  const sel = selectedElements();
  if (!sel.length) return;
  e.preventDefault();
  drag = { mode: 'resize', handle, start: p, moved: false, items: sel.map((f) => ({ id: f.el.id, section: f.section, rect: { ...rectOf(f.el, f.section) }, node: elNode(f.el.id), type: f.el.type })), sectionId: sel[0].section.id };
  drag.bounds = boundsOfRects(drag.items.map((i) => i.rect));
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
}
function doResize(dx, dy, keepRatio, tol, noSnap) {
  const b = drag.bounds;
  const hd = drag.handle;
  let { x, y, w, h: hh } = b;
  if (hd.includes('e')) w = b.w + dx;
  if (hd.includes('s')) hh = b.h + dy;
  if (hd.includes('w')) {
    w = b.w - dx;
    x = b.x + dx;
  }
  if (hd.includes('n')) {
    hh = b.h - dy;
    y = b.y + dy;
  }
  const ids = drag.items.map((i) => i.id);
  const g = guideLines(drag.sectionId, ids);
  const gx = [];
  const gy = [];
  if (!noSnap) {
    if (hd.includes('e')) {
      const s = snapAxis([x + w], g.xs, tol);
      if (s) (w += s.d), gx.push(s.line);
    }
    if (hd.includes('w')) {
      const s = snapAxis([x], g.xs, tol);
      if (s) (x += s.d), (w -= s.d), gx.push(s.line);
    }
    if (hd.includes('s')) {
      const s = snapAxis([y + hh], g.ys, tol);
      if (s) (hh += s.d), gy.push(s.line);
    }
    if (hd.includes('n')) {
      const s = snapAxis([y], g.ys, tol);
      if (s) (y += s.d), (hh -= s.d), gy.push(s.line);
    }
  }
  if (keepRatio && hd.length === 2) {
    const ratio = b.w / b.h;
    if (w / hh > ratio) w = hh * ratio;
    else hh = w / ratio;
    if (hd.includes('w')) x = b.x + b.w - w;
    if (hd.includes('n')) y = b.y + b.h - hh;
  }
  w = Math.max(10, w);
  hh = Math.max(4, hh);
  const sx = w / b.w;
  const sy = hh / b.h;
  drag.result = {};
  for (const it of drag.items) {
    const r = { x: x + (it.rect.x - b.x) * sx, y: y + (it.rect.y - b.y) * sy, w: it.rect.w * sx, h: it.rect.h * sy };
    drag.result[it.id] = r;
    Object.assign(it.node.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', [R.FLOW_TYPES.has(it.type) ? 'minHeight' : 'height']: r.h + 'px' });
  }
  const sTop = sectionEl(drag.sectionId).offsetTop;
  drawGuides(sTop, gx, gy);
  const bounds = overlay.querySelector('.wxe-bounds');
  if (bounds) Object.assign(bounds.style, { left: x + 'px', top: sTop + y + 'px', width: w + 'px', height: hh + 'px' });
  const tag = overlay.querySelector('.wxe-size-tag');
  if (tag) tag.textContent = `${Math.round(w)} × ${Math.round(hh)}`;
  overlay.querySelectorAll('.wxe-frame, .wxe-toolbar').forEach((f) => (f.style.display = 'none'));
}
function startSectionResize(e, sid, p) {
  e.preventDefault();
  drag = { mode: 'section', sectionId: sid, start: p, startH: sectionEl(sid).offsetHeight, moved: false };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
}

function onDblClick(e) {
  if (e.target.closest('.wxe-toolbar, .wxe-sec-toolbar, button')) return;
  const hit = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.closest && x.closest('.wxe-el'));
  const node = hit && hit.closest('.wxe-el');
  if (!node) return;
  const f = findElement(node.getAttribute('data-eid'));
  if (!f) return;
  if (f.el.type === 'text') startTextEdit(f.el.id);
  else if (f.el.type === 'image') pickImageFor(f.el);
  else emit('inspector', { tab: 'content' });
}
export async function pickImageFor(el) {
  const id = await openMedia({ pick: 'image' });
  if (!id) return;
  mutate(() => {
    const f = findElement(el.id);
    f.el.props.mediaId = id;
  });
}

// ---------------------------------------------------------------- operations
export function duplicateSelection() {
  const sel = selectedElements();
  if (!sel.length) return;
  const newIds = [];
  const groupMap = {};
  mutate(() => {
    for (const f of sel) {
      const c = cloneElement(f.el, 20);
      if (f.el.groupId) c.groupId = groupMap[f.el.groupId] || (groupMap[f.el.groupId] = uid('g'));
      c.z = maxZ(f.section) + 1;
      f.section.elements.push(c);
      newIds.push(c.id);
    }
  });
  select(newIds);
}
export function deleteSelection() {
  const sel = selectedElements().filter((f) => !f.el.locked);
  if (!sel.length) return;
  mutate(() => {
    for (const f of sel) f.section.elements = f.section.elements.filter((x) => x.id !== f.el.id);
  });
  select([]);
}
export function copySelection(cut) {
  const sel = selectedElements();
  if (!sel.length) return;
  S.clipboard = { kind: 'elements', items: JSON.parse(JSON.stringify(sel.map((f) => f.el))) };
  try {
    localStorage.setItem('wxe-clipboard', JSON.stringify(S.clipboard));
  } catch (err) {
    // Clipboard still works within this tab.
  }
  if (cut) deleteSelection();
  else toast(`Copied ${sel.length} element${sel.length === 1 ? '' : 's'}.`);
}
export function paste(targetSectionId) {
  let clip = S.clipboard;
  try {
    clip = JSON.parse(localStorage.getItem('wxe-clipboard')) || clip;
  } catch (err) {
    // Fall back to the in-memory clipboard.
  }
  if (!clip || !clip.items || !clip.items.length) return toast('Nothing to paste yet - copy an element first.');
  const sid = targetSectionId || (selectedElements()[0] && selectedElements()[0].section.id) || S.sectionId || (page().sections[0] && page().sections[0].id);
  if (!sid) return toast('Add a section first.');
  const newIds = [];
  const groupMap = {};
  mutate(() => {
    const section = findSection(sid).section;
    for (const it of clip.items) {
      const c = cloneElement(it, 20);
      if (it.groupId) c.groupId = groupMap[it.groupId] || (groupMap[it.groupId] = uid('g'));
      c.z = maxZ(section) + 1;
      section.elements.push(c);
      newIds.push(c.id);
    }
  });
  select(newIds);
}
export function toggleLock() {
  const sel = selectedElements();
  const lock = !sel.some((f) => f.el.locked);
  mutate(() => sel.forEach((f) => (lock ? (f.el.locked = true) : delete f.el.locked)));
  renderOverlay();
}
export function groupSelection() {
  const sel = selectedElements();
  if (sel.length < 2) return;
  if (!sel.every((f) => f.section.id === sel[0].section.id)) return toast('Only elements in the same section can be grouped.', 'error');
  const gid = uid('g');
  mutate(() => sel.forEach((f) => (f.el.groupId = gid)));
  toast('Grouped. Click any member to select the whole group.');
}
export function ungroup() {
  const sel = selectedElements();
  mutate(() => sel.forEach((f) => delete f.el.groupId));
}
export function arrangeSelection(how) {
  const sel = selectedElements();
  if (!sel.length) return;
  mutate(() => arrange(sel[0].section, sel.map((f) => f.el.id), how));
}
export function alignSelection(how) {
  const sel = selectedElements();
  if (!sel.length) return;
  if (!sel.every((f) => f.section.id === sel[0].section.id)) return toast('Select elements in one section to align them.', 'error');
  mutate(() => alignElements(sel[0].section, sel.map((f) => f.el), how));
}
export function hideSelectionOnDevice() {
  const sel = selectedElements();
  mutate(() => sel.forEach((f) => setHidden(f.el, !R.isHidden(f.el, S.device))));
}
function nudge(dx, dy) {
  const sel = selectedElements().filter((f) => !f.el.locked);
  if (!sel.length) return;
  mutate(
    () => {
      for (const f of sel) {
        const r = rectOf(f.el, f.section);
        setRect(f.el, f.section, { ...r, x: r.x + dx, y: Math.max(0, r.y + dy) });
      }
    },
    { merge: 'nudge' }
  );
}
export function moveSection(id, dir) {
  mutate(() => {
    const secs = page().sections;
    const i = secs.findIndex((s) => s.id === id);
    const j = i + dir;
    if (j < 0 || j >= secs.length) return;
    [secs[i], secs[j]] = [secs[j], secs[i]];
  });
  scrollToSection(id);
}
export function duplicateSection(id) {
  let copyId;
  mutate(() => {
    const secs = page().sections;
    const i = secs.findIndex((s) => s.id === id);
    const c = cloneSection(secs[i]);
    c.name = (secs[i].name || 'Section') + ' copy';
    copyId = c.id;
    secs.splice(i + 1, 0, c);
  });
  select([], copyId);
  scrollToSection(copyId);
}
export async function deleteSection(id) {
  const f = findSection(id);
  if (!f) return;
  if (f.section.elements.length && !(await confirmDialog('Delete section?', `"${f.section.name || 'Section'}" and its ${f.section.elements.length} element(s) will be removed. You can undo this.`, 'Delete', true))) return;
  mutate(() => {
    const p = page();
    p.sections = p.sections.filter((s) => s.id !== id);
  });
  select([]);
}
export async function saveSectionAsMine(id) {
  const f = findSection(id);
  const name = await promptDialog('Save as my section', 'Name', f.section.name || 'My section');
  if (!name) return;
  const res = await api('POST', '/main-admin/website/api/saved-sections', { name, section: f.section });
  if (!res.ok) return toast(res.error || 'Could not save.', 'error');
  S.savedSections = res.savedSections;
  emit('saved-sections', { noCanvas: true });
  toast('Saved to My Sections (Add Section panel).', 'success');
}
export function insertSection(section, index) {
  mutate(() => {
    const secs = page().sections;
    secs.splice(index == null ? secs.length : index, 0, section);
  });
  select([], section.id);
  scrollToSection(section.id);
}
export function scrollToSection(id) {
  requestAnimationFrame(() => {
    const sEl = sectionEl(id);
    if (sEl) workspace.scrollTo({ top: Math.max(0, sEl.offsetTop * S.zoom - 60), behavior: 'smooth' });
  });
}
// The section in the middle of the visible canvas - where click-to-add
// drops a new element.
export function visibleSectionId() {
  const secs = [...stage.querySelectorAll('.wxe-section')];
  if (!secs.length) return null;
  if (S.sectionId) return S.sectionId;
  const sel = selectedElements()[0];
  if (sel) return sel.section.id;
  const mid = (workspace.scrollTop + workspace.clientHeight / 2) / S.zoom;
  const hit = secs.find((s) => mid >= s.offsetTop && mid < s.offsetTop + s.offsetHeight) || secs[0];
  return hit.getAttribute('data-sid');
}
export function addElement(el, at) {
  let sid = at ? at.sectionId : visibleSectionId();
  mutate(() => {
    if (!sid) {
      const s = newSection('Section', 500);
      page().sections.push(s);
      sid = s.id;
    }
    const section = findSection(sid).section;
    placeNew(el, section, at && S.device === 'desktop' ? at : null);
    if (at && S.device !== 'desktop') {
      const r = rectOf(el, section);
      setRect(el, section, { ...r, x: at.x - r.w / 2, y: Math.max(0, at.y - r.h / 2) });
    }
  });
  select([el.id]);
  if (!at) scrollToSection(sid);
  if (el.type === 'image' && !el.props.mediaId) pickImageFor(el);
}
// Drag an item from the Add panel onto the canvas.
export function startExternalDrag(e, make, label) {
  const ghost = h('div.wxe-drag-ghost', null, label);
  document.body.appendChild(ghost);
  let moved = false;
  const move = (ev) => {
    moved = true;
    ghost.style.left = ev.clientX + 8 + 'px';
    ghost.style.top = ev.clientY + 8 + 'px';
    const r = workspace.getBoundingClientRect();
    workspace.classList.toggle('is-drop-target', ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom);
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    ghost.remove();
    workspace.classList.remove('is-drop-target');
    const r = stage.getBoundingClientRect();
    const inside = ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom;
    if (!moved) return addElement(make());
    if (!inside) return;
    const p = stagePoint(ev);
    const sEl = sectionAtY(p.y);
    if (!sEl) return addElement(make());
    addElement(make(), { sectionId: sEl.getAttribute('data-sid'), x: p.x, y: p.y - sEl.offsetTop });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
  e.preventDefault();
}

// ---------------------------------------------------------------- menus
let menuEl = null;
export function hideContextMenu() {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
}
export function showContextMenu(x, y, items) {
  hideContextMenu();
  menuEl = h('div.wxe-menu', { role: 'menu' });
  for (const it of items) {
    if (it === '-') {
      menuEl.appendChild(h('div.wxe-menu-sep', { role: 'separator' }));
      continue;
    }
    const b = h('button.wxe-menu-item', { type: 'button', role: 'menuitem', disabled: it.disabled }, h('span', null, it.label), it.key ? h('kbd', null, it.key) : null);
    b.addEventListener('click', () => {
      hideContextMenu();
      it.run();
    });
    menuEl.appendChild(b);
  }
  document.body.appendChild(menuEl);
  menuEl.style.left = Math.min(x, window.innerWidth - menuEl.offsetWidth - 8) + 'px';
  menuEl.style.top = Math.min(y, window.innerHeight - menuEl.offsetHeight - 8) + 'px';
  const btns = [...menuEl.querySelectorAll('button:not([disabled])')];
  if (btns[0]) btns[0].focus();
  menuEl.addEventListener('keydown', (e) => {
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') (e.preventDefault(), btns[(i + 1) % btns.length].focus());
    if (e.key === 'ArrowUp') (e.preventDefault(), btns[(i - 1 + btns.length) % btns.length].focus());
    if (e.key === 'Escape') hideContextMenu();
    e.stopPropagation();
  });
  setTimeout(() => document.addEventListener('pointerdown', (ev) => menuEl && !menuEl.contains(ev.target) && hideContextMenu(), { once: true }), 0);
}
const MOD = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';
function elementMenuItems(sel) {
  const locked = sel.some((f) => f.el.locked);
  const grouped = sel.length > 1 && sel[0].el.groupId && sel.every((f) => f.el.groupId === sel[0].el.groupId);
  return [
    { label: 'Copy', key: MOD + 'C', run: () => copySelection() },
    { label: 'Cut', key: MOD + 'X', run: () => copySelection(true), disabled: locked },
    { label: 'Paste', key: MOD + 'V', run: () => paste(sel[0].section.id) },
    { label: 'Duplicate', key: MOD + 'D', run: duplicateSelection },
    { label: 'Delete', key: 'Del', run: deleteSelection, disabled: locked },
    '-',
    { label: 'Bring to front', run: () => arrangeSelection('front') },
    { label: 'Bring forward', run: () => arrangeSelection('forward') },
    { label: 'Send backward', run: () => arrangeSelection('backward') },
    { label: 'Send to back', run: () => arrangeSelection('back') },
    '-',
    sel.length > 1 ? { label: grouped ? 'Ungroup' : 'Group', key: MOD + 'G', run: grouped ? ungroup : groupSelection } : null,
    { label: locked ? 'Unlock' : 'Lock', key: MOD + 'L', run: toggleLock },
    { label: R.isHidden(sel[0].el, S.device) ? `Show on ${S.device}` : `Hide on ${S.device}`, run: hideSelectionOnDevice },
    sel.length === 1 ? { label: 'Rename…', run: renameSelected } : null,
    sel.length === 1 && S.doc.design.presets.length ? { label: 'Design settings…', run: () => emit('inspector', { tab: 'design' }) } : null,
  ].filter(Boolean);
}
async function renameSelected() {
  const f = selectedElements()[0];
  const name = await promptDialog('Rename element', 'Name (shown in Layers)', f.el.name || TYPE_LABEL[f.el.type]);
  if (name != null) mutate(() => (findElement(f.el.id).el.name = name.slice(0, 60)));
}
function arrangeMenu(btn) {
  const r = btn.getBoundingClientRect();
  showContextMenu(r.left, r.bottom + 4, [
    { label: 'Bring to front', run: () => arrangeSelection('front') },
    { label: 'Bring forward', run: () => arrangeSelection('forward') },
    { label: 'Send backward', run: () => arrangeSelection('backward') },
    { label: 'Send to back', run: () => arrangeSelection('back') },
  ]);
}
function alignMenu(btn) {
  const r = btn.getBoundingClientRect();
  showContextMenu(r.left, r.bottom + 4, [
    { label: 'Align left', run: () => alignSelection('left') },
    { label: 'Align center', run: () => alignSelection('centerH') },
    { label: 'Align right', run: () => alignSelection('right') },
    { label: 'Align top', run: () => alignSelection('top') },
    { label: 'Align middle', run: () => alignSelection('middle') },
    { label: 'Align bottom', run: () => alignSelection('bottom') },
    '-',
    { label: 'Distribute horizontally', run: () => alignSelection('distH') },
    { label: 'Distribute vertically', run: () => alignSelection('distV') },
    { label: 'Match width', run: () => alignSelection('matchW') },
    { label: 'Match height', run: () => alignSelection('matchH') },
  ]);
}
function onContextMenu(e) {
  e.preventDefault();
  if (S.editingText) return;
  const hit = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.closest && x.closest('.wxe-el'));
  const node = hit && hit.closest('.wxe-el');
  if (node) {
    const id = node.getAttribute('data-eid');
    if (!S.selection.includes(id)) select(expandGroups([id]));
    return showContextMenu(e.clientX, e.clientY, elementMenuItems(selectedElements()));
  }
  const sEl = sectionAtY(stagePoint(e).y);
  if (!sEl) return;
  const sid = sEl.getAttribute('data-sid');
  select([], sid);
  const idx = page().sections.findIndex((s) => s.id === sid);
  showContextMenu(e.clientX, e.clientY, [
    { label: 'Paste here', key: MOD + 'V', run: () => paste(sid) },
    '-',
    { label: 'Move section up', run: () => moveSection(sid, -1), disabled: idx === 0 },
    { label: 'Move section down', run: () => moveSection(sid, 1), disabled: idx === page().sections.length - 1 },
    { label: 'Add section below', run: () => emit('panel', { name: 'sections', insertAt: idx + 1 }) },
    { label: 'Duplicate section', run: () => duplicateSection(sid) },
    { label: 'Save as my section…', run: () => saveSectionAsMine(sid) },
    { label: 'Background…', run: () => emit('inspector', { tab: 'background' }) },
    { label: 'Delete section', run: () => deleteSection(sid) },
  ]);
}

// ---------------------------------------------------------------- keyboard
function typingTarget(t) {
  return t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('dialog'));
}
function onKeyDown(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save().then((ok) => ok && toast('Saved.'));
    return;
  }
  if (typingTarget(e.target) || S.editingText) return;
  const k = e.key.toLowerCase();
  if (mod && k === 'z' && !e.shiftKey) (e.preventDefault(), undo());
  else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) (e.preventDefault(), redo());
  else if (mod && k === 'c') (e.preventDefault(), copySelection());
  else if (mod && k === 'x') (e.preventDefault(), copySelection(true));
  else if (mod && k === 'v') (e.preventDefault(), paste());
  else if (mod && k === 'd') (e.preventDefault(), duplicateSelection());
  else if (mod && k === 'g') (e.preventDefault(), e.shiftKey ? ungroup() : groupSelection());
  else if (mod && k === 'l') (e.preventDefault(), toggleLock());
  else if (mod && k === 'a') {
    const sid = visibleSectionId();
    if (!sid) return;
    e.preventDefault();
    select(findSection(sid).section.elements.map((x) => x.id));
  } else if (k === 'delete' || k === 'backspace') {
    if (S.selection.length) (e.preventDefault(), deleteSelection());
    else if (S.sectionId) (e.preventDefault(), deleteSection(S.sectionId));
  } else if (k === 'escape') {
    hideContextMenu();
    select([]);
  } else if (k === 'enter' && S.selection.length === 1) {
    const f = selectedElements()[0];
    if (f.el.type === 'text') (e.preventDefault(), startTextEdit(f.el.id));
  } else if (k.startsWith('arrow') && S.selection.length) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    nudge(k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0);
  }
}

// Replays an element's entrance animation on the canvas (Animation tab).
export function previewAnimation(id) {
  const f = findElement(id);
  const n = elNode(id);
  if (!f || !n || !f.el.anim) return;
  n.classList.remove('wx-in');
  stage.classList.add('wx-js');
  n.classList.add('wx-anim', 'wx-anim-' + f.el.anim.type, 'wxe-anim-preview');
  const box = n.querySelector('.wx-box');
  box.style.transitionDuration = (f.el.anim.duration || 700) + 'ms';
  box.style.transitionDelay = (f.el.anim.delay || 0) + 'ms';
  requestAnimationFrame(() => requestAnimationFrame(() => n.classList.add('wx-in')));
  setTimeout(() => {
    n.classList.remove('wxe-anim-preview', 'wx-anim', 'wx-in', 'wx-anim-' + f.el.anim.type);
    stage.classList.remove('wx-js');
  }, (f.el.anim.duration || 700) + (f.el.anim.delay || 0) + 400);
}
export { esc, boundsOf };
