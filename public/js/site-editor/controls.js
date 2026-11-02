// Reusable inspector/panel controls: labeled fields, numbers, sliders,
// selects, toggles, the HEX/RGB/HSL color picker, the link picker and a
// small repeatable-list editor.
import { h, ICON, parseColor, colorToStored, rgbToHsl, toHex, resolveColor, R } from './util.js';
import { S, page } from './state.js';

let fieldSeq = 0;
export function field(label, control, opts) {
  const o = opts || {};
  const id = control.id || (control.id = 'wxf' + ++fieldSeq);
  const lab = h('label', { for: id }, label);
  return h('div.wxe-field' + (o.inline ? '.is-inline' : '') + (o.overridden ? '.is-overridden' : ''), null, h('div.wxe-field-label', null, lab, o.overridden ? h('button.wxe-reset-link', { type: 'button', title: 'Use the inherited value', onclick: o.onReset }, 'Reset') : null), control, o.hint ? h('p.wxe-hint', null, o.hint) : null);
}
export function textInput(value, onInput, attrs) {
  const i = h('input.wxe-input', { type: 'text', value: value == null ? '' : value, ...(attrs || {}) });
  i.addEventListener('input', () => onInput(i.value));
  return i;
}
export function textArea(value, onInput, attrs) {
  const t = h('textarea.wxe-input', { rows: 4, ...(attrs || {}) });
  t.value = value == null ? '' : value;
  t.addEventListener('input', () => onInput(t.value));
  return t;
}
export function numberInput(value, onInput, attrs) {
  const a = attrs || {};
  const i = h('input.wxe-input.is-num', { type: 'number', value: value == null ? '' : value, step: a.step || 1, min: a.min, max: a.max, placeholder: a.placeholder });
  i.addEventListener('input', () => {
    if (i.value === '') return onInput(undefined);
    const n = Number(i.value);
    if (Number.isFinite(n)) onInput(n);
  });
  return i;
}
export function slider(value, onInput, { min, max, step, suffix }) {
  const range = h('input.wxe-range', { type: 'range', min, max, step: step || 1, value: value == null ? min : value, 'aria-label': 'value' });
  const out = h('input.wxe-input.is-num.is-small', { type: 'number', min, max, step: step || 1, value: value == null ? '' : value, 'aria-label': 'value' });
  range.addEventListener('input', () => {
    out.value = range.value;
    onInput(Number(range.value));
  });
  out.addEventListener('input', () => {
    if (out.value === '') return;
    range.value = out.value;
    onInput(Number(out.value));
  });
  const wrap = h('div.wxe-slider', null, range, out, suffix ? h('span.wxe-suffix', null, suffix) : null);
  wrap.id = range.id = 'wxf' + ++fieldSeq;
  return wrap;
}
export function select(options, value, onChange) {
  const s = h('select.wxe-input', null, options.map((o) => (Array.isArray(o) ? h('option', { value: o[0], selected: String(o[0]) === String(value) }, o[1]) : h('option', { value: o, selected: o === value }, o))));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
export function toggle(label, checked, onChange, hint) {
  const input = h('input', { type: 'checkbox', checked: !!checked, role: 'switch' });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label.wxe-toggle', null, input, h('span.wxe-toggle-track', { 'aria-hidden': 'true' }), h('span.wxe-toggle-label', null, label, hint ? h('small', null, hint) : null));
}
export function segmented(options, value, onChange, label) {
  const g = h('div.wxe-seg', { role: 'radiogroup', 'aria-label': label || '' });
  for (const [v, text, icon] of options) {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), title: text, 'aria-label': text, html: icon || '' });
    if (!icon) b.textContent = text;
    b.addEventListener('click', () => {
      g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', 'false'));
      b.setAttribute('aria-checked', 'true');
      onChange(v);
    });
    g.appendChild(b);
  }
  return g;
}
export function group(title, ...children) {
  return h('section.wxe-group', null, title ? h('h3.wxe-group-title', null, title) : null, ...children);
}

// ---------- color picker ----------
// Swatch button -> popover with the site palette, saved swatches, a
// native picker, HEX/RGB/HSL entry and an opacity slider.
export function colorControl(value, onChange, opts) {
  const o = opts || {};
  let current = value || '';
  const sw = h('span.wxe-swatch-fill');
  const label = h('span.wxe-color-label');
  const btn = h('button.wxe-color-btn', { type: 'button', 'aria-haspopup': 'dialog' }, h('span.wxe-swatch', null, sw), label);
  function paint() {
    const resolved = resolveColor(current, S.doc);
    sw.style.background = resolved || 'transparent';
    sw.classList.toggle('is-none', !current);
    label.textContent = !current ? o.noneLabel || 'None' : current.startsWith('theme:') ? 'Site ' + current.slice(6) : current;
  }
  paint();
  btn.addEventListener('click', () => openColorPopover(btn, current, (v) => {
    current = v;
    paint();
    onChange(v);
  }, o));
  btn.id = 'wxf' + ++fieldSeq;
  return btn;
}
let openPop = null;
export function closePopover() {
  if (openPop) {
    openPop.remove();
    openPop = null;
  }
}
export function openColorPopover(anchor, value, onPick, o) {
  closePopover();
  const opts = o || {};
  const pal = S.doc.design.palette;
  const parsed = parseColor(resolveColor(value, S.doc)) || { r: 0, g: 0, b: 0, a: 1 };
  let c = { ...parsed };
  const pop = h('div.wxe-popover.wxe-color-pop', { role: 'dialog', 'aria-label': 'Choose color' });
  const native = h('input', { type: 'color', value: toHex(c), 'aria-label': 'Color picker' });
  const mode = { v: 'hex' };
  const txt = h('input.wxe-input', { type: 'text', 'aria-label': 'Color value' });
  const alpha = h('input.wxe-range', { type: 'range', min: 0, max: 100, value: Math.round(c.a * 100), 'aria-label': 'Opacity' });
  function fmt() {
    if (mode.v === 'hex') return toHex(c);
    if (mode.v === 'rgb') return c.a < 1 ? `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})` : `rgb(${c.r}, ${c.g}, ${c.b})`;
    const hs = rgbToHsl(c);
    return c.a < 1 ? `hsla(${hs.h}, ${hs.s}%, ${hs.l}%, ${c.a})` : `hsl(${hs.h}, ${hs.s}%, ${hs.l}%)`;
  }
  const sync = () => {
    txt.value = fmt();
    native.value = toHex(c);
  };
  sync();
  const pick = () => onPick(colorToStored(c));
  native.addEventListener('input', () => {
    const p = parseColor(native.value);
    c = { ...p, a: c.a };
    sync();
    pick();
  });
  txt.addEventListener('change', () => {
    const p = parseColor(txt.value);
    if (!p) {
      txt.setAttribute('aria-invalid', 'true');
      return;
    }
    txt.removeAttribute('aria-invalid');
    c = p;
    alpha.value = Math.round(c.a * 100);
    sync();
    pick();
  });
  alpha.addEventListener('input', () => {
    c.a = Number(alpha.value) / 100;
    sync();
    pick();
  });
  const modes = segmented([['hex', 'HEX'], ['rgb', 'RGB'], ['hsl', 'HSL']], 'hex', (v) => {
    mode.v = v;
    sync();
  }, 'Color format');
  const swatchBtn = (val, title) =>
    h('button.wxe-swatch-pick', {
      type: 'button',
      title,
      'aria-label': title,
      style: { background: resolveColor(val, S.doc) },
      onclick: () => {
        onPick(val);
        closePopover();
      },
    });
  pop.append(
    h('div.wxe-pop-title', null, 'Site colors'),
    h('div.wxe-swatches', null, R.PALETTE_KEYS.map((k) => swatchBtn('theme:' + k, `Site ${k} (${pal[k]})`))),
    (S.doc.design.swatches || []).length ? h('div.wxe-pop-title', null, 'My colors') : null,
    h('div.wxe-swatches', null, (S.doc.design.swatches || []).map((v) => swatchBtn(v, v))),
    h('div.wxe-pop-title', null, 'Custom'),
    h('div.wxe-color-row', null, native, txt),
    modes,
    h('label.wxe-field', null, h('span', null, 'Opacity'), alpha),
    h(
      'div.wxe-pop-actions',
      null,
      opts.allowNone !== false ? h('button.wxe-btn.is-small', { type: 'button', onclick: () => (onPick(''), closePopover()) }, opts.noneLabel || 'None') : null,
      h('button.wxe-btn.is-small.is-primary', { type: 'button', onclick: closePopover }, 'Done')
    )
  );
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6) + 'px';
  pop.style.left = Math.min(window.innerWidth - pop.offsetWidth - 8, Math.max(8, r.left)) + 'px';
  openPop = pop;
  setTimeout(() => native.focus(), 0);
  const away = (e) => {
    if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) {
      closePopover();
      document.removeEventListener('pointerdown', away, true);
    }
  };
  document.addEventListener('pointerdown', away, true);
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePopover();
      anchor.focus();
    }
  });
}

// ---------- link picker ----------
// href forms understood by site-render: page:<id>, page:<id>#anchor,
// #anchor, https://..., mailto:, tel:, /path.
export function linkControl(link, onChange) {
  const cur = (link && link.href) || '';
  let type = 'none';
  if (cur.startsWith('page:')) type = 'page';
  else if (cur.startsWith('#')) type = 'anchor';
  else if (cur.startsWith('mailto:')) type = 'email';
  else if (cur.startsWith('tel:')) type = 'phone';
  else if (cur) type = 'url';
  const wrap = h('div.wxe-link');
  const state = { type, href: cur, newTab: !!(link && link.newTab) };
  const emitChange = () => onChange(state.href ? { href: state.href, newTab: state.newTab } : null);
  function render() {
    wrap.innerHTML = '';
    const typeSel = select(
      [
        ['none', 'No link'],
        ['page', 'A page on this site'],
        ['anchor', 'A section on this page'],
        ['url', 'Web address (URL)'],
        ['email', 'Email'],
        ['phone', 'Phone number'],
      ],
      state.type,
      (v) => {
        state.type = v;
        state.href = v === 'page' ? 'page:' + S.doc.pages[0].id : '';
        render();
        emitChange();
      }
    );
    typeSel.setAttribute('aria-label', 'Link type');
    wrap.appendChild(typeSel);
    if (state.type === 'page') {
      const [pid, anchor] = state.href.slice(5).split('#');
      const pageSel = select(S.doc.pages.map((p) => [p.id, p.title + (p.isHome ? ' (Home)' : '')]), pid, (v) => {
        state.href = 'page:' + v;
        render();
        emitChange();
      });
      pageSel.setAttribute('aria-label', 'Page');
      wrap.appendChild(pageSel);
      const target = S.doc.pages.find((p) => p.id === pid);
      const anchors = target ? target.sections.filter((s) => s.anchor) : [];
      if (anchors.length) {
        const aSel = select([['', 'Top of page'], ...anchors.map((s) => [s.anchor, `Section: ${s.name || s.anchor}`])], anchor || '', (v) => {
          state.href = 'page:' + pid + (v ? '#' + v : '');
          emitChange();
        });
        aSel.setAttribute('aria-label', 'Section on that page');
        wrap.appendChild(aSel);
      }
    } else if (state.type === 'anchor') {
      const anchors = page().sections.filter((s) => s.anchor);
      if (!anchors.length) wrap.appendChild(h('p.wxe-hint', null, 'Give a section an anchor name (Section settings) to link to it.'));
      else {
        const aSel = select([['', 'Choose a section'], ...anchors.map((s) => ['#' + s.anchor, s.name || s.anchor])], state.href, (v) => {
          state.href = v;
          emitChange();
        });
        aSel.setAttribute('aria-label', 'Section');
        wrap.appendChild(aSel);
      }
    } else if (state.type !== 'none') {
      const prefix = { email: 'mailto:', phone: 'tel:', url: '' }[state.type];
      const placeholder = { email: 'name@example.com', phone: '(555) 555-0100', url: 'https://example.com or /register' }[state.type];
      const input = textInput(state.href.slice(prefix.length), (v) => {
        let val = v.trim();
        if (state.type === 'url' && val && !/^(https?:\/\/|\/)/i.test(val)) val = 'https://' + val;
        if (state.type === 'phone') val = val.replace(/[^\d+]/g, '');
        state.href = val ? prefix + val : '';
        emitChange();
      }, { placeholder, 'aria-label': 'Link address' });
      wrap.appendChild(input);
    }
    if (state.type === 'url' || state.type === 'page') {
      wrap.appendChild(toggle('Open in a new tab', state.newTab, (v) => {
        state.newTab = v;
        emitChange();
      }));
    }
  }
  render();
  wrap.id = 'wxf' + ++fieldSeq;
  return wrap;
}

// ---------- repeatable list editor ----------
// fields: [{ key, label, type: 'text'|'textarea'|'select'|'media', options }]
export function listEditor(items, fields, onChange, opts) {
  const o = opts || {};
  const list = items.map((x) => ({ ...x }));
  const wrap = h('div.wxe-list');
  const commit = () => onChange(list.map((x) => ({ ...x })));
  function render() {
    wrap.innerHTML = '';
    list.forEach((item, i) => {
      const row = h('div.wxe-list-item');
      const head = h(
        'div.wxe-list-head',
        null,
        h('strong', null, o.itemLabel ? o.itemLabel(item, i) : `Item ${i + 1}`),
        h(
          'span.wxe-list-actions',
          null,
          h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': 'Move up', disabled: i === 0, html: ICON.up, onclick: () => (([list[i - 1], list[i]] = [list[i], list[i - 1]]), render(), commit()) }),
          h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': 'Move down', disabled: i === list.length - 1, html: ICON.down, onclick: () => (([list[i + 1], list[i]] = [list[i], list[i + 1]]), render(), commit()) }),
          h('button.wxe-icon-btn.is-small', { type: 'button', 'aria-label': 'Remove', html: ICON.trash, onclick: () => (list.splice(i, 1), render(), commit()) })
        )
      );
      row.appendChild(head);
      for (const f of fields) {
        let control;
        if (f.type === 'textarea') control = textArea(item[f.key], (v) => ((item[f.key] = v), commit()), { rows: 3 });
        else if (f.type === 'select') control = select(f.options, item[f.key], (v) => ((item[f.key] = v), commit()));
        else if (f.type === 'media') {
          const m = S.media.find((x) => x.id === item[f.key]);
          control = h(
            'div.wxe-media-mini',
            null,
            m ? h('img', { src: m.url, alt: '' }) : h('span.wxe-hint', null, 'No image'),
            h('button.wxe-btn.is-small', { type: 'button', onclick: async () => {
              const id = await o.pickMedia();
              if (id) {
                item[f.key] = id;
                render();
                commit();
              }
            } }, m ? 'Change' : 'Choose')
          );
        } else control = textInput(item[f.key], (v) => ((item[f.key] = v), commit()));
        row.appendChild(field(f.label, control));
      }
      wrap.appendChild(row);
    });
    wrap.appendChild(
      h('button.wxe-btn.is-small', { type: 'button', onclick: async () => {
        const fresh = o.newItem ? await o.newItem() : {};
        if (!fresh) return;
        [].concat(fresh).forEach((x) => list.push(x));
        render();
        commit();
      } }, h('span', { html: ICON.plus }), o.addLabel || 'Add item')
    );
  }
  render();
  return wrap;
}
