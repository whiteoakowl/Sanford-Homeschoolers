// Small DOM/color/network helpers shared by every site-editor module.

export const R = window.SiteRender;

// h('div.cls#id', { attrs/props/on* }, children...) - tiny hyperscript.
export function h(tag, attrs, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  appendChildren(el, children);
  return el;
}
function appendChildren(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export const esc = R.esc;
export const clone = (o) => JSON.parse(JSON.stringify(o));
export function uid(prefix) {
  const a = new Uint8Array(5);
  crypto.getRandomValues(a);
  return (prefix || 'x') + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// ---------- network ----------
export async function api(method, url, body, isForm) {
  const opts = { method, headers: { 'X-CSRF-Token': window.CSRF_TOKEN || '', Accept: 'application/json' } };
  if (body !== undefined) {
    if (isForm) opts.body = body;
    else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    return { ok: false, status: 0, error: 'Could not reach the server - check your connection.' };
  }
  let data;
  try {
    data = await res.json();
  } catch (err) {
    data = { ok: false, error: res.status === 403 ? 'Your session expired - reload the page and sign in again.' : `Server error (${res.status}).` };
  }
  return { status: res.status, ...data, ok: res.ok && data.ok !== false };
}

// ---------- feedback ----------
export function toast(message, kind) {
  const host = document.getElementById('wxe-toasts');
  const t = h('div.wxe-toast' + (kind ? '.is-' + kind : ''), { role: kind === 'error' ? 'alert' : 'status' }, message);
  host.appendChild(t);
  setTimeout(() => t.classList.add('is-leaving'), kind === 'error' ? 6000 : 3200);
  setTimeout(() => t.remove(), kind === 'error' ? 6500 : 3700);
}

// Accessible modal built on <dialog>. Resolves with the clicked button's
// value (or null on Escape/backdrop).
export function modal({ title, body, buttons, wide, className }) {
  return new Promise((resolve) => {
    const dlg = h('dialog.wxe-modal' + (wide ? '.is-wide' : '') + (className ? '.' + className : ''), { 'aria-labelledby': 'wxe-modal-title' });
    const close = (v) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    dlg.appendChild(
      h(
        'form.wxe-modal-inner',
        { method: 'dialog', onsubmit: (e) => e.preventDefault() },
        h('div.wxe-modal-head', null, h('h2#wxe-modal-title', null, title), h('button.wxe-icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => close(null), html: ICON.close })),
        h('div.wxe-modal-body', null, body),
        buttons && buttons.length
          ? h(
              'div.wxe-modal-foot',
              null,
              buttons.map((b) => h('button.wxe-btn' + (b.primary ? '.is-primary' : '') + (b.danger ? '.is-danger' : ''), { type: b.primary ? 'submit' : 'button', onclick: () => close(b.value) }, b.label))
            )
          : null
      )
    );
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    const first = dlg.querySelector('input, textarea, select, .wxe-modal-foot .is-primary');
    if (first) first.focus();
  });
}
export async function confirmDialog(title, message, okLabel, danger) {
  const v = await modal({ title, body: h('p', null, message), buttons: [{ label: 'Cancel', value: false }, { label: okLabel || 'OK', value: true, primary: !danger, danger }] });
  return v === true;
}
export async function promptDialog(title, label, value) {
  const input = h('input.wxe-input', { type: 'text', value: value || '', 'aria-label': label });
  const body = h('label.wxe-field', null, h('span', null, label), input);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      body.closest('dialog').querySelector('.is-primary').click();
    }
  });
  const v = await modal({ title, body, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', value: 'ok', primary: true }] });
  return v === 'ok' ? input.value.trim() : null;
}

// ---------- colors (HEX / RGB / HSL) ----------
export function parseColor(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: hex.length === 8 ? Math.round((parseInt(hex.slice(6, 8), 16) / 255) * 100) / 100 : 1 };
  }
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) return { r: clamp(+m[1], 0, 255), g: clamp(+m[2], 0, 255), b: clamp(+m[3], 0, 255), a: m[4] != null ? clamp(+m[4], 0, 1) : 1 };
  m = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) return { ...hslToRgb(+m[1], +m[2], +m[3]), a: m[4] != null ? clamp(+m[4], 0, 1) : 1 };
  return null;
}
export function hslToRgb(hh, ss, ll) {
  const s = ss / 100;
  const l = ll / 100;
  const k = (n) => (n + hh / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}
export function rgbToHsl({ r, g, b }) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hh = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hh = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh *= 60;
  }
  return { h: Math.round(hh), s: Math.round(s * 100), l: Math.round(l * 100) };
}
export function toHex({ r, g, b }) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}
// Stored form: #RRGGBB when opaque, rgba() otherwise (both pass the
// server's color validator).
export function colorToStored(c) {
  if (!c) return '';
  return c.a < 1 ? `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 100) / 100})` : toHex(c);
}
// Resolves "theme:primary" to the palette hex for swatches/inputs.
export function resolveColor(value, doc) {
  if (typeof value === 'string' && value.startsWith('theme:')) return (doc.design.palette || {})[value.slice(6)] || '#000000';
  return value || '';
}

// ---------- UI icons (inline SVG strings) ----------
const sv = (d, extra) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra || ''}>${d}</svg>`;
export const ICON = {
  add: sv('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
  sections: sv('<rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/>'),
  pages: sv('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>'),
  design: sv('<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7h2A5.5 5.5 0 0 0 22 11 10 10 0 0 0 12 2z"/>'),
  media: sv('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
  layers: sv('<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>'),
  settings: sv('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  help: sv('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
  desktop: sv('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  tablet: sv('<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>'),
  mobile: sv('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18h.01"/>'),
  undo: sv('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>'),
  redo: sv('<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/>'),
  close: sv('<path d="M18 6L6 18M6 6l12 12"/>'),
  back: sv('<path d="M15 18l-6-6 6-6"/>'),
  up: sv('<path d="M18 15l-6-6-6 6"/>'),
  down: sv('<path d="M6 9l6 6 6-6"/>'),
  copy: sv('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  trash: sv('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
  lock: sv('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  unlock: sv('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.9-1"/>'),
  eye: sv('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: sv('<path d="M17.9 17.9A10 10 0 0 1 12 20C5 20 1 12 1 12a18 18 0 0 1 5.1-5.9M9.9 4.2A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2M1 1l22 22"/>'),
  brush: sv('<path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>'),
  gear: sv('<circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  spark: sv('<path d="M12 3l1.9 5.8L20 10l-5 3.6L16.5 20 12 16.4 7.5 20 9 13.6 4 10l6.1-1.2z"/>'),
  arrange: sv('<rect x="3" y="3" width="12" height="12" rx="1"/><rect x="9" y="9" width="12" height="12" rx="1"/>'),
  more: sv('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  edit: sv('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  image: sv('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
  link: sv('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  home: sv('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  plus: sv('<path d="M12 5v14M5 12h14"/>'),
  minus: sv('<path d="M5 12h14"/>'),
  grid: sv('<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/>'),
  exit: sv('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>'),
  play: sv('<polygon points="6 4 20 12 6 20 6 4"/>'),
  group: sv('<rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="14" width="8" height="8" rx="1"/><path d="M10 6h4v4M14 18h-4v-4" stroke-dasharray="2 2"/>'),
  alignL: sv('<path d="M4 3v18M8 7h12v4H8zM8 14h7v4H8z"/>'),
  alignCH: sv('<path d="M12 3v18M6 7h12v4H6zM8 14h8v4H8z"/>'),
  alignR: sv('<path d="M20 3v18M4 7h12v4H4zM9 14h7v4H9z"/>'),
  alignT: sv('<path d="M3 4h18M7 8v12h4V8zM14 8v7h4V8z"/>'),
  alignCV: sv('<path d="M3 12h18M7 6v12h4V6zM14 8v8h4V8z"/>'),
  alignB: sv('<path d="M3 20h18M7 4v12h4V4zM14 9v7h4V9z"/>'),
  distH: sv('<path d="M3 3v18M21 3v18M9 8h6v8H9z"/>'),
  distV: sv('<path d="M3 3h18M3 21h18M8 9h8v6H8z"/>'),
  bold: sv('<path d="M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z"/>', 'stroke-width="2.4"'),
  italic: sv('<path d="M19 4h-9M14 20H5M15 4L9 20"/>'),
  underline: sv('<path d="M6 3v7a6 6 0 0 0 12 0V3M4 21h16"/>'),
  strike: sv('<path d="M16 4H9a3 3 0 0 0-2.8 4M14 12a4 4 0 0 1 0 8H6M4 12h16"/>'),
  tl: sv('<path d="M3 6h18M3 12h12M3 18h16"/>'),
  tc: sv('<path d="M3 6h18M6 12h12M4 18h16"/>'),
  tr: sv('<path d="M3 6h18M9 12h12M5 18h16"/>'),
  tj: sv('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  crop: sv('<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2"/>'),
  upload: sv('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>'),
  folder: sv('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
  save: sv('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>'),
  history: sv('<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>'),
};
