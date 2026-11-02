// Right-hand inspector: Content / Design / Animation / Layout tabs for the
// selected element, Section / Background tabs for a selected strip.
// Style edits made on Tablet or Mobile are stored as that device's
// override (cascading desktop -> tablet -> mobile), with a Reset link.
import { h, R, ICON, toast } from './util.js';
import { S, on, mutate, findElement, findSection, selectedElements, emit } from './state.js';
import { TYPE_LABEL, rectOf, setRect, effectiveStyle, setStyle, styleOverridden, resetDeviceLayout, setHidden, sectionHeightFor, setSectionHeight, materializeMobile } from './model.js';
import { field, textInput, textArea, numberInput, slider, select, toggle, segmented, group, colorControl, linkControl, listEditor } from './controls.js';
import { openMedia } from './media.js';
import { previewAnimation, alignSelection, arrangeSelection, groupSelection, ungroup, toggleLock } from './canvas.js';

let host;
let tab = 'content';
let sectionTab = 'section';

export function mountInspector(el) {
  host = el;
  on((reason, extra) => {
    if (reason === 'inspector') {
      if (['content', 'design', 'animation', 'layout'].includes(extra.tab)) tab = extra.tab;
      if (['section', 'background'].includes(extra.tab)) sectionTab = extra.tab;
      return render(true);
    }
    if (extra && extra.fromInspector) return; // keep focus in the field being typed in
    if (['select', 'history', 'device', 'page', 'media'].includes(reason) || reason === 'change' || reason === 'retag') render();
  });
  render();
}

function upd(id, fn, key) {
  mutate(() => fn(findElement(id).el), { merge: key ? id + key : undefined, fromInspector: true });
}
function updSection(id, fn, key) {
  mutate(() => fn(findSection(id).section), { merge: key ? id + key : undefined, fromInspector: true });
}

function render(focus) {
  if (!host) return;
  const sel = selectedElements();
  host.innerHTML = '';
  host.classList.toggle('is-empty', !sel.length && !S.sectionId);
  if (sel.length > 1) return renderMulti(sel);
  if (sel.length === 1) renderElement(sel[0]);
  else if (S.sectionId && findSection(S.sectionId)) renderSection(findSection(S.sectionId).section);
  else {
    host.appendChild(
      h('div.wxe-insp-empty', null, h('span', { html: ICON.arrange }), h('p', null, 'Select an element or a section on the canvas to edit it.'), h('p.wxe-hint', null, 'Tip: double-click text to type, right-click for more actions, press ? for shortcuts.'))
    );
  }
  if (focus) {
    const f = host.querySelector('[role="tab"][aria-selected="true"]');
    if (f) f.focus();
  }
}
function tabs(list, current, onPick) {
  const bar = h('div.wxe-tabs', { role: 'tablist' });
  for (const [k, label] of list) {
    const b = h('button.wxe-tab', { type: 'button', role: 'tab', 'aria-selected': String(k === current) }, label);
    b.addEventListener('click', () => onPick(k));
    bar.appendChild(b);
  }
  return bar;
}
function deviceNote() {
  if (S.device === 'desktop') return null;
  return h('p.wxe-device-note', null, h('span', { html: ICON[S.device] }), `Editing ${S.device}: changes here only affect ${S.device}${S.device === 'tablet' ? ' (and mobile, unless it has its own)' : ''}.`);
}

// ---------------------------------------------------------------- element
function renderElement(f) {
  const el = f.el;
  host.appendChild(h('div.wxe-insp-head', null, h('strong', null, el.name || TYPE_LABEL[el.type]), h('span.wxe-hint', null, TYPE_LABEL[el.type])));
  host.appendChild(tabs([['content', 'Settings'], ['design', 'Design'], ['animation', 'Animation'], ['layout', 'Layout']], tab, (k) => ((tab = k), render(true))));
  const body = h('div.wxe-insp-body', { role: 'tabpanel' });
  host.appendChild(body);
  if (tab === 'content') body.append(...contentFields(el));
  else if (tab === 'design') body.append(...designFields(el));
  else if (tab === 'animation') body.append(...animationFields(el));
  else body.append(...layoutFields(f));
}

function contentFields(el) {
  const id = el.id;
  const p = el.props;
  const set = (k, key) => (v) => upd(id, (e) => (v === undefined || v === '' ? delete e.props[k] : (e.props[k] = v)), key || k);
  const out = [field('Element name (shown in Layers)', textInput(el.name, (v) => upd(id, (e) => (e.name = v.slice(0, 60)), 'name')))];
  const pickMedia = (kind) => () => openMedia({ pick: kind || 'image' });
  switch (el.type) {
    case 'text':
      out.push(
        field('Heading level (for search engines & screen readers)', select([['h1', 'Heading 1 (page title)'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['h4', 'Heading 4'], ['h5', 'Heading 5'], ['h6', 'Heading 6'], ['p', 'Paragraph']], p.tag, set('tag'))),
        field('Text style', select([['', 'Match the heading level'], ...R.TEXT_STYLE_KEYS.map((k) => [k, k.toUpperCase()])], p.textStyle || '', set('textStyle'))),
        h('p.wxe-hint', null, 'Double-click the text on the canvas to type and format it.')
      );
      break;
    case 'image': {
      const m = S.media.find((x) => x.id === p.mediaId);
      out.push(
        h('div.wxe-media-pick', null, m ? h('img', { src: m.url, alt: '' }) : h('span.wxe-hint', null, 'No image chosen'), h('button.wxe-btn.is-small', { type: 'button', onclick: async () => {
          const mid = await openMedia({ pick: 'image' });
          if (mid) upd(id, (e) => (e.props.mediaId = mid));
          render();
        } }, m ? 'Change image' : 'Choose image')),
        field('Alt text', textInput(p.alt, set('alt'), { placeholder: m && m.alt ? `Default: ${m.alt}` : 'Describe the image' }), { hint: 'Leave empty to use the alt text saved in the Media Manager. Decorative images can stay empty.' }),
        field('Fit', segmented([['cover', 'Fill (crop)'], ['contain', 'Fit (whole image)']], p.fit || 'cover', set('fit'), 'Image fit')),
        field('Caption', textInput(p.caption, set('caption'))),
        field('Link', linkControl(p.link, set('link')))
      );
      break;
    }
    case 'button':
      out.push(
        field('Button text', textInput(p.label, set('label'))),
        field('Link', linkControl(p.link, set('link'))),
        field('Icon', select([['', 'None'], ...Object.keys(R.ICONS).map((k) => [k, k])], p.icon || '', set('icon')))
      );
      break;
    case 'icon':
      out.push(field('Icon', iconGrid(p.icon, set('icon'))), field('Label for screen readers', textInput(p.label, set('label'))), field('Link', linkControl(p.link, set('link'))));
      break;
    case 'shape':
      out.push(field('Shape', segmented([['rect', 'Rectangle'], ['circle', 'Circle']], effectiveStyle(el).shape || 'rect', (v) => upd(id, (e) => setStyle(e, 'shape', v)), 'Shape')));
      break;
    case 'line':
      out.push(field('Direction', segmented([['horizontal', 'Horizontal'], ['vertical', 'Vertical']], effectiveStyle(el).orientation || 'horizontal', (v) => upd(id, (e) => setStyle(e, 'orientation', v)), 'Direction')));
      break;
    case 'video':
      out.push(field('Source', segmented([['embed', 'YouTube / Vimeo'], ['upload', 'Uploaded video']], p.source || 'embed', (v) => (set('source')(v), render()), 'Video source')));
      if ((p.source || 'embed') === 'embed') {
        const url = textInput(p.url, (v) => {
          url.setAttribute('aria-invalid', String(!!v && !R.videoEmbedUrl(v)));
          if (!v || R.videoEmbedUrl(v)) set('url')(v);
        }, { placeholder: 'https://www.youtube.com/watch?v=…' });
        out.push(field('Video link', url, { hint: 'Paste a YouTube or Vimeo address.' }));
      } else {
        const m = S.media.find((x) => x.id === p.mediaId);
        out.push(
          h('div.wxe-media-pick', null, m ? h('video', { src: m.url, muted: true }) : h('span.wxe-hint', null, 'No video chosen'), h('button.wxe-btn.is-small', { type: 'button', onclick: async () => {
            const mid = await openMedia({ pick: 'video' });
            if (mid) upd(id, (e) => (e.props.mediaId = mid));
            render();
          } }, 'Choose video')),
          toggle('Show controls', p.controls !== false, (v) => upd(id, (e) => (v ? delete e.props.controls : (e.props.controls = false)))),
          toggle('Autoplay (muted)', !!p.autoplay, set('autoplay')),
          toggle('Loop', !!p.loop, set('loop'))
        );
      }
      out.push(field('Title (for screen readers)', textInput(p.title, set('title'))));
      break;
    case 'gallery':
      out.push(
        field('Columns', slider(p.columns || 3, set('columns', 'cols'), { min: 1, max: 6 })),
        field('Spacing', slider(p.gap == null ? 8 : p.gap, set('gap', 'gap'), { min: 0, max: 60, suffix: 'px' })),
        group(
          'Images',
          listEditor(p.items || [], [{ key: 'mediaId', label: 'Image', type: 'media' }, { key: 'alt', label: 'Alt text' }, { key: 'caption', label: 'Caption' }], (items) => upd(id, (e) => (e.props.items = items), 'items'), {
            pickMedia: pickMedia('image'),
            addLabel: 'Add images',
            itemLabel: (it, i) => `Image ${i + 1}`,
            newItem: async () => {
              const ids = await openMedia({ pick: 'image', multiple: true });
              return ids && ids.length ? ids.map((mid) => ({ mediaId: mid, alt: '' })) : null;
            },
          })
        )
      );
      break;
    case 'slideshow':
      out.push(
        field('Name (for screen readers)', textInput(p.label, set('label'))),
        toggle('Autoplay', !!p.autoplay, set('autoplay')),
        field('Seconds per slide', slider(p.interval || 5, set('interval', 'interval'), { min: 2, max: 30, suffix: 's' })),
        group(
          'Slides',
          listEditor(p.slides || [], [{ key: 'mediaId', label: 'Image', type: 'media' }, { key: 'alt', label: 'Alt text' }, { key: 'title', label: 'Title' }, { key: 'text', label: 'Text', type: 'textarea' }], (slides) => upd(id, (e) => (e.props.slides = slides), 'slides'), {
            pickMedia: pickMedia('image'),
            addLabel: 'Add slide',
            itemLabel: (it, i) => it.title || `Slide ${i + 1}`,
            newItem: async () => {
              const mid = await openMedia({ pick: 'image' });
              return mid ? { mediaId: mid, title: '', text: '' } : null;
            },
          })
        )
      );
      break;
    case 'accordion':
      out.push(
        toggle('First item starts open', !!p.openFirst, set('openFirst')),
        listEditor(p.items || [], [{ key: 'title', label: 'Title' }, { key: 'body', label: 'Text', type: 'textarea' }], (items) => upd(id, (e) => (e.props.items = items.filter((x) => x.title)), 'items'), { addLabel: 'Add item', itemLabel: (it, i) => it.title || `Item ${i + 1}`, newItem: () => ({ title: 'New question', body: '' }) })
      );
      break;
    case 'tabs':
      out.push(listEditor(p.tabs || [], [{ key: 'title', label: 'Tab title' }, { key: 'body', label: 'Content', type: 'textarea' }], (tabsList) => upd(id, (e) => (e.props.tabs = tabsList.filter((x) => x.title)), 'tabs'), { addLabel: 'Add tab', itemLabel: (it, i) => it.title || `Tab ${i + 1}`, newItem: () => ({ title: 'New tab', body: '' }) }));
      break;
    case 'social':
      out.push(
        field('Spacing', slider(p.gap == null ? 12 : p.gap, set('gap', 'gap'), { min: 0, max: 60, suffix: 'px' })),
        listEditor(p.links || [], [{ key: 'network', label: 'Network', type: 'select', options: R.SOCIAL_NETWORKS.map((n) => [n, R.SOCIAL_LABEL[n]]) }, { key: 'url', label: 'Profile link' }], (links) => upd(id, (e) => (e.props.links = links), 'links'), { addLabel: 'Add profile', itemLabel: (it) => R.SOCIAL_LABEL[it.network] || 'Link', newItem: () => ({ network: 'facebook', url: 'https://' }) })
      );
      break;
    case 'map':
      out.push(field('Address or place', textInput(p.address, set('address'))), field('Zoom', slider(p.zoom || 14, set('zoom', 'zoom'), { min: 1, max: 20 })));
      break;
    case 'embed':
      out.push(
        field('Title (for screen readers)', textInput(p.title, set('title'))),
        field('HTML / embed code', textArea(p.html, set('html'), { rows: 10, spellcheck: 'false', class: 'wxe-input is-code' }), { hint: 'Runs in a sandboxed frame on the live site - it cannot read your visitors\' sessions or the rest of the page. Scripts are paused in the editor.' })
      );
      break;
    case 'form': {
      const forms = (S.widgetData.forms || []).map((x) => [String(x.id), x.title]);
      out.push(
        forms.length
          ? field('Custom Form', select([['', 'Choose a form'], ...forms], p.formId ? String(p.formId) : '', (v) => set('formId')(v ? Number(v) : undefined)), { hint: 'Submissions go through Custom Forms (members sign in to fill out forms).' })
          : h('p.wxe-hint', null, 'You have no published Custom Forms yet. Create one in Main Admin > Forms, then pick it here.'),
        field('Title (optional)', textInput(p.title, set('title'), { placeholder: 'Uses the form title' })),
        field('Description (optional)', textArea(p.description, set('description'), { rows: 3 })),
        field('Button text', textInput(p.buttonLabel, set('buttonLabel'), { placeholder: 'Fill out form' }))
      );
      break;
    }
    case 'login':
      out.push(field('Signed-out text', textInput(p.loginLabel, set('loginLabel'), { placeholder: 'Log in' })), field('Signed-in text', textInput(p.portalLabel, set('portalLabel'), { placeholder: 'My Portals' })), h('p.wxe-hint', null, 'Links to the app\'s existing member login (/login) and portals.'));
      break;
    case 'menu':
      out.push(field('Name (for screen readers)', textInput(p.label, set('label'))), h('p.wxe-hint', null, 'Shows your site menu - edit it in Pages & Menu.'), h('button.wxe-btn.is-small', { type: 'button', onclick: () => emit('panel', { name: 'pages' }) }, 'Edit menu'));
      break;
    case 'classes':
      out.push(toggle('Show "Member Registration to Enroll" button', p.showButton !== false, set('showButton')), h('p.wxe-hint', null, 'Lists classes from Schedule Grids marked "visible to public" (Co-op Admin > Classes).'));
      break;
    case 'announcements':
    case 'events':
      out.push(field('How many to show', slider(p.limit || (el.type === 'events' ? 4 : 3), set('limit', 'limit'), { min: 1, max: 12 })), h('p.wxe-hint', null, el.type === 'events' ? 'Upcoming, public, published events.' : 'Announcements marked public.'));
      break;
    case 'faq':
      out.push(h('p.wxe-hint', null, 'Lists FAQs marked public (Main Admin > FAQ).'));
      break;
    default:
      break;
  }
  return out;
}

function iconGrid(current, onPick) {
  const g = h('div.wxe-icon-grid', { role: 'radiogroup', 'aria-label': 'Icon' });
  for (const name of Object.keys(R.ICONS)) {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(name === current), title: name, 'aria-label': name, html: R.iconSvg(name) });
    b.addEventListener('click', () => {
      g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', 'false'));
      b.setAttribute('aria-checked', 'true');
      onPick(name);
    });
    g.appendChild(b);
  }
  return g;
}

function designFields(el) {
  const id = el.id;
  const s = effectiveStyle(el);
  const out = [];
  const note = deviceNote();
  if (note) out.push(note);
  const sf = (key, label, control) =>
    field(label, control, { overridden: styleOverridden(el, key), onReset: () => (upd(id, (e) => delete e.styleBy[S.device][key]), render()) });
  const set = (key) => (v) => upd(id, (e) => setStyle(e, key, v), 'st' + key);
  const presets = S.doc.design.presets || [];
  if (presets.length) out.push(field('Design preset', select([['', 'None'], ...presets.map((p) => [p.id, p.name])], el.style.presetId || '', (v) => (upd(id, (e) => (v ? (e.style.presetId = v) : delete e.style.presetId)), render())), { hint: 'Presets are shared looks from Site Design > Presets.' }));
  const isTextual = !['image', 'icon', 'shape', 'line'].includes(el.type);
  if (el.type === 'line') {
    out.push(group('Line', sf('color', 'Color', colorControl(s.color, set('color'), { allowNone: false })), sf('thickness', 'Thickness', slider(s.thickness || 2, set('thickness'), { min: 1, max: 40, suffix: 'px' })), sf('borderStyle', 'Style', select([['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']], s.borderStyle || 'solid', set('borderStyle')))));
  } else {
    const fill = group('Fill');
    const gradOn = !!s.gradient;
    fill.append(
      toggle('Gradient', gradOn, (v) => (upd(id, (e) => setStyle(e, 'gradient', v ? { from: 'theme:primary', to: 'theme:accent', angle: 135 } : undefined)), render())),
      gradOn
        ? h('div', null, sf('gradient', 'From', colorControl(s.gradient.from, (v) => set('gradient')({ ...effectiveStyle(findElement(id).el).gradient, from: v || '#FFFFFF' }), { allowNone: false })), field('To', colorControl(s.gradient.to, (v) => set('gradient')({ ...effectiveStyle(findElement(id).el).gradient, to: v || '#000000' }), { allowNone: false })), field('Angle', slider(s.gradient.angle || 0, (v) => set('gradient')({ ...effectiveStyle(findElement(id).el).gradient, angle: v }), { min: 0, max: 360, suffix: '°' })))
        : sf('bg', 'Background color', colorControl(s.bg, set('bg'))),
      sf('opacity', 'Opacity', slider(s.opacity == null ? 100 : s.opacity, set('opacity'), { min: 0, max: 100, suffix: '%' }))
    );
    out.push(fill);
    out.push(
      group(
        'Border & corners',
        sf('borderWidth', 'Border width', slider(s.borderWidth || 0, set('borderWidth'), { min: 0, max: 20, suffix: 'px' })),
        sf('borderColor', 'Border color', colorControl(s.borderColor, set('borderColor'))),
        sf('borderStyle', 'Border style', select([['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['double', 'Double']], s.borderStyle || 'solid', set('borderStyle'))),
        sf('radius', 'Corner radius', slider(s.radius || 0, set('radius'), { min: 0, max: 200, suffix: 'px' })),
        sf('shadow', 'Shadow', select([['none', 'None'], ['sm', 'Subtle'], ['md', 'Medium'], ['lg', 'Strong']], s.shadow || 'none', set('shadow'))),
        sf('padding', 'Inner spacing (padding)', slider(s.padding || 0, set('padding'), { min: 0, max: 120, suffix: 'px' }))
      )
    );
  }
  if (el.type === 'icon') out.push(group('Icon', sf('color', 'Icon color', colorControl(s.color, set('color')))));
  if (isTextual) {
    out.push(
      group(
        'Text',
        sf('fontFamily', 'Font', select([['', 'Theme font'], ...S.fonts.map((f) => [f.key, f.label])], s.fontFamily || '', set('fontFamily'))),
        sf('fontSize', 'Size', slider(s.fontSize || '', set('fontSize'), { min: 8, max: 160, suffix: 'px' })),
        sf('fontWeight', 'Weight', select([['', 'Default'], ['300', 'Light'], ['400', 'Regular'], ['600', 'Semi-bold'], ['700', 'Bold'], ['800', 'Extra-bold']], s.fontWeight ? String(s.fontWeight) : '', (v) => set('fontWeight')(v ? Number(v) : undefined))),
        sf('color', 'Color', colorControl(s.color, set('color'), { noneLabel: 'Default' })),
        sf('align', 'Alignment', segmented([['left', 'Left', ICON.tl], ['center', 'Center', ICON.tc], ['right', 'Right', ICON.tr], ['justify', 'Justify', ICON.tj]], s.align || 'left', set('align'), 'Alignment')),
        sf('lineHeight', 'Line spacing', slider(s.lineHeight || 1.5, set('lineHeight'), { min: 0.8, max: 3, step: 0.05 })),
        sf('letterSpacing', 'Letter spacing', slider(s.letterSpacing || 0, set('letterSpacing'), { min: -5, max: 20, step: 0.5, suffix: 'px' })),
        sf('textTransform', 'Transform', select([['none', 'None'], ['uppercase', 'UPPERCASE'], ['lowercase', 'lowercase'], ['capitalize', 'Capitalize']], s.textTransform || 'none', set('textTransform'))),
        toggle('Italic', !!s.italic, set('italic')),
        toggle('Underline', !!s.underline, set('underline'))
      )
    );
  }
  out.push(
    group(
      'Hover effect',
      select([['none', 'None'], ['lift', 'Lift'], ['grow', 'Grow'], ['dim', 'Dim'], ['glow', 'Glow']], el.hover || 'none', (v) => upd(id, (e) => (v === 'none' ? delete e.hover : (e.hover = v)))),
      h('p.wxe-hint', null, 'Shows when visitors point at the element on the live site.')
    )
  );
  return out;
}

function animationFields(el) {
  const id = el.id;
  const a = el.anim || { type: 'none' };
  const LABELS = { none: 'None', fade: 'Fade in', 'slide-up': 'Slide up', 'slide-down': 'Slide down', 'slide-left': 'Slide in from right', 'slide-right': 'Slide in from left', zoom: 'Zoom in', flip: 'Flip in' };
  const grid = h('div.wxe-anim-grid', { role: 'radiogroup', 'aria-label': 'Entrance animation' });
  for (const t of R.ANIMATIONS) {
    const b = h('button.wxe-anim-card', { type: 'button', role: 'radio', 'aria-checked': String(a.type === t) }, h('span.wxe-anim-demo.is-' + t), LABELS[t]);
    b.addEventListener('click', () => {
      upd(id, (e) => (t === 'none' ? delete e.anim : (e.anim = { duration: 700, delay: 0, trigger: 'scroll', ...(e.anim || {}), type: t })));
      render();
      if (t !== 'none') setTimeout(() => previewAnimation(id), 50);
    });
    grid.appendChild(b);
  }
  const out = [group('Entrance animation', grid)];
  if (a.type !== 'none') {
    const set = (k) => (v) => upd(id, (e) => (e.anim[k] = v), 'anim' + k);
    out.push(
      group(
        'Animation settings',
        field('Duration', slider(a.duration || 700, set('duration'), { min: 100, max: 3000, step: 50, suffix: 'ms' })),
        field('Delay', slider(a.delay || 0, set('delay'), { min: 0, max: 3000, step: 50, suffix: 'ms' })),
        field('Starts', segmented([['scroll', 'When scrolled into view'], ['load', 'When the page loads']], a.trigger || 'scroll', set('trigger'), 'Animation trigger')),
        h('button.wxe-btn.is-small', { type: 'button', onclick: () => previewAnimation(id) }, h('span', { html: ICON.play }), 'Preview')
      )
    );
  }
  out.push(
    group('Scroll behavior', toggle('Sticky while scrolling its section', !!el.sticky, (v) => upd(id, (e) => (v ? (e.sticky = true) : delete e.sticky)))),
    h('p.wxe-hint', null, 'Visitors who turn on "reduce motion" in their device settings see elements without animation.')
  );
  return out;
}

function layoutFields(f) {
  const { el, section } = f;
  const id = el.id;
  const r = rectOf(el, section);
  const setR = (k) => (v) => {
    if (v === undefined) return;
    mutate(() => {
      const g = findElement(id);
      setRect(g.el, g.section, { ...rectOf(g.el, g.section), [k]: v });
    }, { merge: id + 'rect' + k, fromInspector: true });
  };
  const out = [];
  const note = deviceNote();
  if (note) out.push(note);
  out.push(
    group(
      `Position & size (${S.device})`,
      h(
        'div.wxe-grid-2',
        null,
        field('X', numberInput(r.x, setR('x'), { min: 0 })),
        field('Y', numberInput(r.y, setR('y'), { min: 0 })),
        field('Width', numberInput(r.w, setR('w'), { min: 4 })),
        field('Height', numberInput(r.h, setR('h'), { min: 2 }))
      ),
      S.device !== 'desktop' && el.layout[S.device]
        ? h('button.wxe-btn.is-small', { type: 'button', onclick: () => (mutate(() => resetDeviceLayout(findElement(id).el, S.device)), toast(`Back to the automatic ${S.device} layout.`)) }, `Reset ${S.device} position`)
        : null
    ),
    group(
      'Align in section',
      h(
        'div.wxe-btn-row',
        null,
        [
          ['left', 'Align left', ICON.alignL],
          ['centerH', 'Center horizontally', ICON.alignCH],
          ['right', 'Align right', ICON.alignR],
          ['top', 'Align top', ICON.alignT],
          ['middle', 'Center vertically', ICON.alignCV],
          ['bottom', 'Align bottom', ICON.alignB],
        ].map(([k, label, icon]) => h('button.wxe-icon-btn', { type: 'button', title: label, 'aria-label': label, html: icon, onclick: () => alignSelection(k) }))
      )
    ),
    group(
      'Arrange',
      h(
        'div.wxe-btn-row',
        null,
        [['front', 'Bring to front'], ['forward', 'Forward'], ['backward', 'Backward'], ['back', 'Send to back']].map(([k, label]) => h('button.wxe-btn.is-small', { type: 'button', onclick: () => arrangeSelection(k) }, label))
      )
    ),
    group(
      'Visibility',
      toggle(`Hide on ${S.device}`, R.isHidden(el, S.device), (v) => mutate(() => setHidden(findElement(id).el, v), { fromInspector: false })),
      toggle('Lock (prevent moving & deleting)', !!el.locked, () => toggleLock())
    )
  );
  return out;
}

function renderMulti(sel) {
  host.appendChild(h('div.wxe-insp-head', null, h('strong', null, `${sel.length} elements selected`)));
  const grouped = sel[0].el.groupId && sel.every((f) => f.el.groupId === sel[0].el.groupId);
  host.appendChild(
    h(
      'div.wxe-insp-body',
      null,
      group(
        'Align',
        h(
          'div.wxe-btn-row',
          null,
          [
            ['left', 'Align left', ICON.alignL],
            ['centerH', 'Align centers', ICON.alignCH],
            ['right', 'Align right', ICON.alignR],
            ['top', 'Align top', ICON.alignT],
            ['middle', 'Align middles', ICON.alignCV],
            ['bottom', 'Align bottom', ICON.alignB],
            ['distH', 'Distribute horizontally', ICON.distH],
            ['distV', 'Distribute vertically', ICON.distV],
          ].map(([k, label, icon]) => h('button.wxe-icon-btn', { type: 'button', title: label, 'aria-label': label, html: icon, onclick: () => alignSelection(k) }))
        ),
        h('div.wxe-btn-row', null, h('button.wxe-btn.is-small', { type: 'button', onclick: () => alignSelection('matchW') }, 'Match width'), h('button.wxe-btn.is-small', { type: 'button', onclick: () => alignSelection('matchH') }, 'Match height'))
      ),
      group('Group', h('button.wxe-btn.is-small', { type: 'button', onclick: () => (grouped ? ungroup() : groupSelection()) }, grouped ? 'Ungroup' : 'Group elements')),
      group('Visibility', toggle(`Hide on ${S.device}`, sel.every((f) => R.isHidden(f.el, S.device)), (v) => mutate(() => sel.forEach((x) => setHidden(findElement(x.el.id).el, v)))))
    )
  );
}

// ---------------------------------------------------------------- section
function renderSection(section) {
  host.appendChild(h('div.wxe-insp-head', null, h('strong', null, section.name || 'Section'), h('span.wxe-hint', null, 'Section')));
  host.appendChild(tabs([['section', 'Settings'], ['background', 'Background']], sectionTab, (k) => ((sectionTab = k), render(true))));
  const body = h('div.wxe-insp-body', { role: 'tabpanel' });
  host.appendChild(body);
  const sid = section.id;
  if (sectionTab === 'section') {
    const note = deviceNote();
    if (note) body.appendChild(note);
    const anchorInput = textInput(section.anchor, (v) => {
      const val = v.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '').slice(0, 40);
      updSection(sid, (s) => (val ? (s.anchor = val) : delete s.anchor), 'anchor');
    }, { placeholder: 'e.g. about' });
    body.append(
      field('Section name', textInput(section.name, (v) => updSection(sid, (s) => (s.name = v.slice(0, 60)), 'name'))),
      field('Anchor (for "scroll to section" links)', anchorInput, { hint: 'Buttons and menu items can link to #anchor to scroll here smoothly.' }),
      field(`Height on ${S.device}`, slider(sectionHeightFor(section), (v) => updSection(sid, (s) => setSectionHeight(s, v), 'height'), { min: 40, max: 2000, suffix: 'px' }), { hint: 'The strip also grows automatically to fit its content.' }),
      toggle(`Hide on ${S.device}`, R.isHidden(section, S.device), (v) => updSection(sid, (s) => setHidden(s, v))),
      toggle('Hide this strip while its live list is empty', !!section.autoHide, (v) => updSection(sid, (s) => (v ? (s.autoHide = true) : delete s.autoHide)), 'For strips with Classes, Events, Announcements or FAQ lists.'),
      S.device === 'mobile'
        ? h(
            'div.wxe-btn-row',
            null,
            R.sectionMobileAuto(section)
              ? h('button.wxe-btn.is-small', { type: 'button', onclick: () => mutate(() => materializeMobile(findSection(sid).section)) }, 'Arrange mobile manually')
              : h('button.wxe-btn.is-small', { type: 'button', onclick: () => mutate(() => {
                  const s = findSection(sid).section;
                  s.elements.forEach((e) => delete e.layout.mobile);
                  delete s.height.mobile;
                }) }, 'Reset to automatic mobile layout')
          )
        : null
    );
  } else {
    const bg = section.bg || {};
    const setBg = (k, key) => (v) => updSection(sid, (s) => (v === undefined || v === '' ? delete s.bg[k] : (s.bg[k] = v)), key || 'bg' + k);
    body.append(
      field('Background type', segmented([['color', 'Color'], ['gradient', 'Gradient'], ['image', 'Image'], ['video', 'Video']], bg.type || 'color', (v) => (updSection(sid, (s) => {
        s.bg.type = v;
        if (v === 'gradient' && !s.bg.gradient) s.bg.gradient = { from: 'theme:primary', to: 'theme:accent', angle: 135 };
      }), render()), 'Background type')),
      field('Color', colorControl(bg.color, setBg('color'), { noneLabel: 'Site background' }))
    );
    if (bg.type === 'gradient' && bg.gradient) {
      const g = (k) => (v) => updSection(sid, (s) => (s.bg.gradient = { ...s.bg.gradient, [k]: v }), 'grad' + k);
      body.append(field('Gradient from', colorControl(bg.gradient.from, g('from'), { allowNone: false })), field('Gradient to', colorControl(bg.gradient.to, g('to'), { allowNone: false })), field('Angle', slider(bg.gradient.angle || 0, g('angle'), { min: 0, max: 360, suffix: '°' })));
    }
    if (bg.type === 'image' || bg.type === 'video') {
      const key = bg.type === 'image' ? 'mediaId' : 'videoId';
      const m = S.media.find((x) => x.id === bg[key]);
      body.append(
        h('div.wxe-media-pick', null, m ? (bg.type === 'image' ? h('img', { src: m.url, alt: '' }) : h('video', { src: m.url, muted: true })) : h('span.wxe-hint', null, `No ${bg.type} chosen`), h('button.wxe-btn.is-small', { type: 'button', onclick: async () => {
          const mid = await openMedia({ pick: bg.type });
          if (mid) updSection(sid, (s) => (s.bg[key] = mid));
          render();
        } }, m ? 'Change' : 'Choose'))
      );
      body.append(field('Overlay color (darken/tint so text stays readable)', colorControl(bg.overlay && bg.overlay.color, (v) => updSection(sid, (s) => (v ? (s.bg.overlay = { color: v }) : delete s.bg.overlay), 'overlay'))));
      if (bg.type === 'image') {
        body.append(
          field('Scaling', select([['cover', 'Fill (cover)'], ['contain', 'Fit (contain)'], ['auto', 'Original size']], bg.size || 'cover', setBg('size'))),
          h('div.wxe-grid-2', null, field('Focus X', slider(bg.posX == null ? (m ? m.focalX : 50) : bg.posX, setBg('posX'), { min: 0, max: 100, suffix: '%' })), field('Focus Y', slider(bg.posY == null ? (m ? m.focalY : 50) : bg.posY, setBg('posY'), { min: 0, max: 100, suffix: '%' }))),
          toggle('Tile (repeat)', !!bg.repeat, setBg('repeat')),
          toggle('Parallax scrolling', !!bg.parallax, setBg('parallax'), 'The image stays put while the page scrolls (desktop only).')
        );
      }
    }
    body.append(field('Default text color in this section', colorControl(section.textColor, (v) => updSection(sid, (s) => (v ? (s.textColor = v) : delete s.textColor), 'tc'), { noneLabel: 'Site text color' })));
  }
}
