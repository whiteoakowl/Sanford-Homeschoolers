// Media Manager (Wix-style big modal): upload, folders, search, rename,
// alt text, focal point, replace, crop/resize (client-side canvas, then
// uploaded as a new file or as a replacement), delete. Also the picker
// every "Choose image" button opens.
import { h, api, toast, ICON, confirmDialog, promptDialog, modal } from './util.js';
import { S, emit } from './state.js';

function fmtSize(n) {
  if (!n) return '';
  return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
}
function readDims(file) {
  return new Promise((resolve) => {
    if (!/^image\//.test(file.type)) return resolve('');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve(`${img.naturalWidth}x${img.naturalHeight}`);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => resolve('');
    img.src = url;
  });
}
export async function uploadFiles(files, folder) {
  const fd = new FormData();
  for (const f of files) {
    fd.append('files', f);
    fd.append('sizes', await readDims(f));
  }
  fd.append('folder', folder || '');
  const res = await api('POST', '/main-admin/website/api/media', fd, true);
  if (!res.ok) {
    toast(res.error || 'Upload failed.', 'error');
    return [];
  }
  S.media = [...res.media, ...S.media];
  emit('media');
  toast(`Uploaded ${res.media.length} file${res.media.length === 1 ? '' : 's'}.`, 'success');
  return res.media;
}

// openMedia({ pick: 'image'|'video'|null, multiple }) -> Promise<id|id[]|null>
export function openMedia(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    let folder = '__all';
    let query = '';
    let selected = null;
    const picked = new Set();
    const extraFolders = new Set();
    const dlg = h('dialog.wxe-modal.is-media', { 'aria-label': o.pick ? 'Choose media' : 'Media Manager' });
    const done = (v) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    const fileInput = h('input', { type: 'file', multiple: true, accept: o.pick === 'video' ? 'video/mp4,video/webm' : o.pick === 'image' ? 'image/*' : 'image/*,video/mp4,video/webm', hidden: true });
    const search = h('input.wxe-input', { type: 'search', placeholder: 'Search media', 'aria-label': 'Search media' });
    const status = h('span.wxe-hint', { role: 'status' });
    const side = h('nav.wxe-media-folders', { 'aria-label': 'Folders' });
    const grid = h('div.wxe-media-grid', { role: 'listbox', 'aria-label': 'Media files', 'aria-multiselectable': o.multiple ? 'true' : 'false' });
    const detail = h('aside.wxe-media-detail');
    const footBtn = h('button.wxe-btn.is-primary', { type: 'button', disabled: true }, o.multiple ? 'Add selected' : 'Choose');
    footBtn.addEventListener('click', () => done(o.multiple ? [...picked] : selected && selected.id));

    fileInput.addEventListener('change', async () => {
      if (!fileInput.files.length) return;
      status.textContent = `Uploading ${fileInput.files.length} file(s)…`;
      const added = await uploadFiles([...fileInput.files], folder === '__all' ? '' : folder);
      status.textContent = '';
      fileInput.value = '';
      if (added.length) selected = added[0];
      render();
    });
    search.addEventListener('input', () => {
      query = search.value.toLowerCase();
      renderGrid();
    });

    function items() {
      return S.media.filter((m) => (!o.pick || m.kind === o.pick) && (folder === '__all' || m.folder === folder) && (!query || (m.name || '').toLowerCase().includes(query) || (m.alt || '').toLowerCase().includes(query)));
    }
    function renderFolders() {
      const folders = [...new Set([...S.media.map((m) => m.folder).filter(Boolean), ...extraFolders])].sort();
      side.innerHTML = '';
      const btn = (key, label) => h('button.wxe-folder' + (folder === key ? '.is-active' : ''), { type: 'button', 'aria-current': folder === key ? 'true' : null, onclick: () => ((folder = key), render()) }, h('span', { html: ICON.folder }), label);
      side.append(btn('__all', 'All media'), btn('', 'Unsorted'), ...folders.map((f) => btn(f, f)));
      side.appendChild(
        h('button.wxe-btn.is-small.is-ghost', { type: 'button', onclick: async () => {
          const name = await promptDialog('New folder', 'Folder name');
          if (name) {
            extraFolders.add(name.slice(0, 60));
            folder = name.slice(0, 60);
            render();
          }
        } }, '+ New folder')
      );
    }
    function renderGrid() {
      grid.innerHTML = '';
      const list = items();
      if (!list.length) {
        grid.appendChild(h('div.wxe-empty', null, h('span', { html: ICON.media }), h('p', null, query ? 'No files match your search.' : 'No files here yet.'), h('button.wxe-btn.is-primary', { type: 'button', onclick: () => fileInput.click() }, 'Upload files')));
        return;
      }
      for (const m of list) {
        const isSel = o.multiple ? picked.has(m.id) : selected && selected.id === m.id;
        const tile = h(
          'button.wxe-media-tile' + (isSel ? '.is-selected' : ''),
          { type: 'button', role: 'option', 'aria-selected': String(!!isSel), title: m.name },
          m.kind === 'video' ? h('video', { src: m.url, muted: true, preload: 'metadata' }) : h('img', { src: m.url, alt: m.alt || '', loading: 'lazy' }),
          h('span.wxe-media-name', null, m.name || 'Untitled')
        );
        tile.addEventListener('click', () => {
          selected = m;
          if (o.multiple) {
            if (picked.has(m.id)) picked.delete(m.id);
            else picked.add(m.id);
          }
          render();
        });
        tile.addEventListener('dblclick', () => {
          if (o.pick && !o.multiple) done(m.id);
        });
        grid.appendChild(tile);
      }
    }
    function renderDetail() {
      detail.innerHTML = '';
      footBtn.disabled = o.multiple ? !picked.size : !selected;
      if (!selected) {
        detail.appendChild(h('p.wxe-hint', null, 'Select a file to see its details.'));
        return;
      }
      const m = selected;
      const preview = h('div.wxe-focal', { title: 'Click to set the focal point - the part of the photo that always stays visible when it is cropped.' });
      if (m.kind === 'video') preview.appendChild(h('video', { src: m.url, controls: true }));
      else {
        preview.appendChild(h('img', { src: m.url, alt: m.alt || '' }));
        const dot = h('span.wxe-focal-dot', { style: { left: m.focalX + '%', top: m.focalY + '%' } });
        preview.appendChild(dot);
        preview.addEventListener('click', async (e) => {
          const r = preview.getBoundingClientRect();
          const fx = Math.round(((e.clientX - r.left) / r.width) * 100);
          const fy = Math.round(((e.clientY - r.top) / r.height) * 100);
          dot.style.left = fx + '%';
          dot.style.top = fy + '%';
          await update(m, { focalX: fx, focalY: fy });
        });
      }
      const name = h('input.wxe-input', { type: 'text', value: m.name || '', 'aria-label': 'File name' });
      name.addEventListener('change', () => update(m, { name: name.value }));
      const alt = h('textarea.wxe-input', { rows: 2, 'aria-label': 'Alt text' });
      alt.value = m.alt || '';
      alt.addEventListener('change', () => update(m, { alt: alt.value }));
      const folders = [...new Set([...S.media.map((x) => x.folder).filter(Boolean), ...extraFolders])].sort();
      const fsel = h('select.wxe-input', { 'aria-label': 'Folder' }, h('option', { value: '' }, 'Unsorted'), folders.map((f) => h('option', { value: f, selected: f === m.folder }, f)));
      fsel.addEventListener('change', () => update(m, { folder: fsel.value }));
      const replaceInput = h('input', { type: 'file', hidden: true, accept: m.kind === 'video' ? 'video/mp4,video/webm' : 'image/*' });
      replaceInput.addEventListener('change', async () => {
        const f = replaceInput.files[0];
        if (!f) return;
        const fd = new FormData();
        fd.append('file', f);
        fd.append('size', await readDims(f));
        status.textContent = 'Replacing…';
        const res = await api('POST', `/main-admin/website/api/media/${m.id}/replace`, fd, true);
        status.textContent = '';
        if (!res.ok) return toast(res.error || 'Could not replace the file.', 'error');
        Object.assign(m, res.media);
        selected = m;
        emit('media');
        toast('File replaced everywhere it is used.', 'success');
        render();
      });
      detail.append(
        preview,
        h('label.wxe-field', null, h('span', null, 'Name'), name),
        h('label.wxe-field', null, h('span', null, 'Alt text (describe the image for screen readers)'), alt),
        h('label.wxe-field', null, h('span', null, 'Folder'), fsel),
        h('p.wxe-hint', null, [m.width && m.height ? `${m.width} × ${m.height}px` : '', fmtSize(m.size), m.kind].filter(Boolean).join(' · ')),
        replaceInput,
        h(
          'div.wxe-btn-row',
          null,
          h('button.wxe-btn.is-small', { type: 'button', onclick: () => replaceInput.click() }, h('span', { html: ICON.upload }), 'Replace'),
          m.kind === 'image' ? h('button.wxe-btn.is-small', { type: 'button', onclick: () => cropImage(m).then((r) => r && ((selected = r), render())) }, h('span', { html: ICON.crop }), 'Crop / resize') : null,
          h('button.wxe-btn.is-small.is-danger', { type: 'button', onclick: async () => {
            if (!(await confirmDialog('Delete file?', `"${m.name}" will be removed from the media library.`, 'Delete', true))) return;
            const res = await api('POST', `/main-admin/website/api/media/${m.id}/delete`, {});
            if (!res.ok) return toast(res.error || 'Could not delete.', 'error');
            S.media = S.media.filter((x) => x.id !== m.id);
            picked.delete(m.id);
            selected = null;
            emit('media');
            render();
          } }, h('span', { html: ICON.trash }), 'Delete')
        )
      );
    }
    async function update(m, data) {
      const res = await api('POST', `/main-admin/website/api/media/${m.id}`, data);
      if (!res.ok) return toast(res.error || 'Could not save.', 'error');
      Object.assign(m, res.media);
      emit('media');
      if (data.folder !== undefined) render();
    }
    function render() {
      renderFolders();
      renderGrid();
      renderDetail();
    }

    dlg.append(
      h(
        'div.wxe-modal-inner',
        null,
        h(
          'div.wxe-modal-head',
          null,
          h('h2', null, o.pick ? (o.pick === 'video' ? 'Choose a video' : o.multiple ? 'Choose images' : 'Choose an image') : 'Media Manager'),
          h('button.wxe-icon-btn', { type: 'button', 'aria-label': 'Close', html: ICON.close, onclick: () => done(null) })
        ),
        h('div.wxe-media-toolbar', null, search, status, h('button.wxe-btn.is-primary', { type: 'button', onclick: () => fileInput.click() }, h('span', { html: ICON.upload }), 'Upload'), fileInput),
        h('div.wxe-media-body', null, side, grid, detail),
        o.pick ? h('div.wxe-modal-foot', null, h('button.wxe-btn', { type: 'button', onclick: () => done(null) }, 'Cancel'), footBtn) : null
      )
    );
    // Drag files from the desktop straight into the manager.
    dlg.addEventListener('dragover', (e) => {
      e.preventDefault();
      dlg.classList.add('is-dropping');
    });
    dlg.addEventListener('dragleave', () => dlg.classList.remove('is-dropping'));
    dlg.addEventListener('drop', async (e) => {
      e.preventDefault();
      dlg.classList.remove('is-dropping');
      const files = [...e.dataTransfer.files];
      if (files.length) {
        const added = await uploadFiles(files, folder === '__all' ? '' : folder);
        if (added.length) selected = added[0];
        render();
      }
    });
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(null);
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    render();
    search.focus();
  });
}

// Crop / resize on a canvas, then upload the result.
export async function cropImage(m) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = m.url + (m.url.includes('?') ? '&' : '?') + 'crop=' + Date.now();
  try {
    await img.decode();
  } catch (err) {
    toast('Could not load that image for cropping.', 'error');
    return null;
  }
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const crop = { x: 0, y: 0, w: W, h: H };
  let aspect = 0;
  const maxView = 560;
  const scale = Math.min(maxView / W, 380 / H, 1);
  const stage = h('div.wxe-crop-stage', { style: { width: W * scale + 'px', height: H * scale + 'px' } });
  stage.appendChild(h('img', { src: img.src, alt: '', style: { width: '100%', height: '100%' } }));
  const box = h('div.wxe-crop-box', { tabindex: 0, 'aria-label': 'Crop area - drag to move' });
  const handle = h('span.wxe-crop-handle', { 'aria-hidden': 'true' });
  box.appendChild(handle);
  stage.appendChild(box);
  const outW = h('input.wxe-input.is-num', { type: 'number', min: 16, max: 6000, value: W, 'aria-label': 'Output width in pixels' });
  function paint() {
    box.style.left = crop.x * scale + 'px';
    box.style.top = crop.y * scale + 'px';
    box.style.width = crop.w * scale + 'px';
    box.style.height = crop.h * scale + 'px';
    outW.max = Math.round(crop.w);
    if (Number(outW.value) > crop.w) outW.value = Math.round(crop.w);
  }
  function applyAspect() {
    if (!aspect) return;
    if (crop.w / crop.h > aspect) crop.w = crop.h * aspect;
    else crop.h = crop.w / aspect;
    crop.x = Math.min(crop.x, W - crop.w);
    crop.y = Math.min(crop.y, H - crop.h);
  }
  let drag = null;
  box.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    box.setPointerCapture(e.pointerId);
    drag = { mode: e.target === handle ? 'resize' : 'move', sx: e.clientX, sy: e.clientY, start: { ...crop } };
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / scale;
    const dy = (e.clientY - drag.sy) / scale;
    if (drag.mode === 'move') {
      crop.x = Math.max(0, Math.min(W - crop.w, drag.start.x + dx));
      crop.y = Math.max(0, Math.min(H - crop.h, drag.start.y + dy));
    } else {
      crop.w = Math.max(16, Math.min(W - crop.x, drag.start.w + dx));
      crop.h = aspect ? crop.w / aspect : Math.max(16, Math.min(H - crop.y, drag.start.h + dy));
      if (crop.y + crop.h > H) {
        crop.h = H - crop.y;
        if (aspect) crop.w = crop.h * aspect;
      }
    }
    paint();
  });
  box.addEventListener('pointerup', () => (drag = null));
  box.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 20 : 4;
    const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!k) return;
    e.preventDefault();
    crop.x = Math.max(0, Math.min(W - crop.w, crop.x + k[0]));
    crop.y = Math.max(0, Math.min(H - crop.h, crop.y + k[1]));
    paint();
  });
  const aspects = h(
    'div.wxe-seg',
    { role: 'radiogroup', 'aria-label': 'Aspect ratio' },
    [
      [0, 'Free'],
      [1, '1:1'],
      [4 / 3, '4:3'],
      [16 / 9, '16:9'],
      [3 / 4, '3:4'],
    ].map(([a, label]) => {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(a === 0) }, label);
      b.addEventListener('click', () => {
        aspects.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', 'false'));
        b.setAttribute('aria-checked', 'true');
        aspect = a;
        applyAspect();
        paint();
      });
      return b;
    })
  );
  paint();
  const choice = await modal({
    title: 'Crop & resize',
    wide: true,
    body: h('div.wxe-crop', null, stage, h('div.wxe-crop-side', null, h('div.wxe-field', null, h('span', null, 'Aspect ratio'), aspects), h('label.wxe-field', null, h('span', null, 'Output width (px)'), outW), h('p.wxe-hint', null, 'Drag the box to move it, drag its corner to resize. Arrow keys nudge it.'))),
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Replace original', value: 'replace' },
      { label: 'Save as new copy', value: 'new', primary: true },
    ],
  });
  if (!choice) return null;
  const ow = Math.max(16, Math.min(Math.round(crop.w), Number(outW.value) || crop.w));
  const oh = Math.round((ow * crop.h) / crop.w);
  const canvas = document.createElement('canvas');
  canvas.width = ow;
  canvas.height = oh;
  canvas.getContext('2d').drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, ow, oh);
  const type = /png|gif/.test(m.mime || '') ? 'image/png' : 'image/jpeg';
  let blob;
  try {
    blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('empty'))), type, 0.9));
  } catch (err) {
    toast('This image is hosted somewhere that blocks cropping in the browser.', 'error');
    return null;
  }
  const base = (m.name || 'image').replace(/\.[a-z0-9]+$/i, '');
  const file = new File([blob], `${base}-cropped.${type === 'image/png' ? 'png' : 'jpg'}`, { type });
  if (choice === 'new') {
    const added = await uploadFiles([file], m.folder);
    return added[0] || null;
  }
  const fd = new FormData();
  fd.append('file', file);
  fd.append('size', `${ow}x${oh}`);
  const res = await api('POST', `/main-admin/website/api/media/${m.id}/replace`, fd, true);
  if (!res.ok) {
    toast(res.error || 'Could not save the crop.', 'error');
    return null;
  }
  Object.assign(m, res.media);
  emit('media');
  toast('Image cropped.', 'success');
  return m;
}
