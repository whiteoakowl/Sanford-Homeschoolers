// Editor state: the site document, selection, device, undo/redo history
// and the autosave loop. Every edit goes through mutate() so it lands on
// the undo stack and schedules an autosave; listeners re-render.
import { api, clone, debounce } from './util.js';

const HISTORY_MAX = 120;
const listeners = new Set();

export const S = {
  doc: null,
  rev: 0,
  device: 'desktop',
  pageId: null,
  selection: [], // element ids
  sectionId: null, // selected section (when no element is selected)
  zoom: 1,
  gridlines: false,
  clipboard: null,
  media: [],
  savedSections: [],
  widgetData: {},
  fonts: [],
  reservedSlugs: [],
  siteUrl: '/',
  publishedAt: null,
  hasUnpublished: false,
  saveState: 'saved', // saved | dirty | saving | error | conflict
  savedAt: null,
  undo: [],
  redo: [],
  editingText: null, // element id while inline-editing
};

export function on(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emit(reason, extra) {
  for (const fn of listeners) fn(reason || 'change', extra || {});
}

export function page() {
  return S.doc.pages.find((p) => p.id === S.pageId) || S.doc.pages[0];
}
export function findElement(id) {
  for (const p of S.doc.pages) {
    for (const s of p.sections) {
      const el = s.elements.find((e) => e.id === id);
      if (el) return { page: p, section: s, el };
    }
  }
  return null;
}
export function findSection(id) {
  for (const p of S.doc.pages) {
    const s = p.sections.find((x) => x.id === id);
    if (s) return { page: p, section: s };
  }
  return null;
}
export function selectedElements() {
  return S.selection.map((id) => findElement(id)).filter(Boolean);
}

let lastMergeKey = null;
let lastMergeAt = 0;
// mutate(fn, { merge: 'key', silent }) - `merge` folds a burst of edits
// to the same control (typing in a field, dragging a slider) into one
// undo step.
export function mutate(fn, opts) {
  const o = opts || {};
  const now = Date.now();
  const merging = o.merge && o.merge === lastMergeKey && now - lastMergeAt < 1200;
  if (!merging) {
    S.undo.push(JSON.stringify(S.doc));
    if (S.undo.length > HISTORY_MAX) S.undo.shift();
  }
  lastMergeKey = o.merge || null;
  lastMergeAt = now;
  S.redo = [];
  fn(S.doc);
  markDirty();
  emit(o.reason || 'change', o);
}
export function undo() {
  if (!S.undo.length) return false;
  S.redo.push(JSON.stringify(S.doc));
  S.doc = JSON.parse(S.undo.pop());
  lastMergeKey = null;
  fixSelection();
  markDirty();
  emit('history');
  return true;
}
export function redo() {
  if (!S.redo.length) return false;
  S.undo.push(JSON.stringify(S.doc));
  S.doc = JSON.parse(S.redo.pop());
  lastMergeKey = null;
  fixSelection();
  markDirty();
  emit('history');
  return true;
}
function fixSelection() {
  if (!S.doc.pages.some((p) => p.id === S.pageId)) S.pageId = S.doc.pages[0].id;
  S.selection = S.selection.filter((id) => findElement(id));
  if (S.sectionId && !findSection(S.sectionId)) S.sectionId = null;
}

export function select(ids, sectionId) {
  S.selection = ids;
  S.sectionId = ids.length ? null : sectionId || null;
  emit('select');
}

// ---------- autosave ----------
const scheduleSave = debounce(() => save(), 1500);
function markDirty() {
  S.hasUnpublished = true;
  if (S.saveState !== 'conflict') S.saveState = 'dirty';
  emit('save-state');
  scheduleSave();
}
let saving = null;
let again = false;
export async function save() {
  if (S.saveState === 'conflict') return false;
  if (saving) {
    again = true;
    return saving;
  }
  if (S.saveState === 'saved') return true;
  S.saveState = 'saving';
  emit('save-state');
  const body = { doc: S.doc, rev: S.rev };
  saving = api('PUT', '/main-admin/website/api/draft', body);
  const res = await saving;
  saving = null;
  if (res.ok) {
    S.rev = res.rev;
    S.savedAt = new Date();
    if (res.doc) {
      // The server had to fix something (e.g. a duplicate page URL) -
      // adopt its copy so the editor shows what will actually publish.
      S.doc = res.doc;
      fixSelection();
      emit('history');
    }
    S.saveState = S.saveState === 'saving' ? 'saved' : S.saveState;
    emit('save-state', { fixes: res.fixes });
  } else if (res.conflict) {
    S.saveState = 'conflict';
    emit('save-state', { error: res.error });
  } else {
    S.saveState = 'error';
    emit('save-state', { error: res.error });
    setTimeout(() => {
      if (S.saveState === 'error') {
        S.saveState = 'dirty';
        save();
      }
    }, 8000);
  }
  if (again) {
    again = false;
    if (S.saveState === 'dirty') return save();
  }
  return res.ok;
}
export function snapshot() {
  return clone(S.doc);
}
window.addEventListener('beforeunload', (e) => {
  if (S.saveState === 'dirty' || S.saveState === 'saving' || S.saveState === 'error') {
    e.preventDefault();
    e.returnValue = '';
  }
});
