// A real bug report: "I added a photo for the parent and each of the three
// kids. I clicked save and it said error and did not save any of the
// photos." The app runs as one Netlify Function, which rejects any request
// body over ~6MB before Express ever sees it - four full-size phone photos
// in one form blow straight past that, so the whole save failed. Every
// large JPEG/PNG/WebP picked in any file input is shrunk here (longest side
// 1600px, JPEG ~0.85) before the form is sent, and a submit that would
// still be too big is stopped with a clear message instead.
(function () {
  if (window.__imageDownscaleInstalled) return;
  window.__imageDownscaleInstalled = true;

  const MAX_SIDE = 1600;
  const SHRINK_OVER_BYTES = 900 * 1024;
  const MAX_SUBMIT_BYTES = 5.5 * 1024 * 1024;
  const SHRINKABLE = ['image/jpeg', 'image/png', 'image/webp'];
  const pending = new WeakMap();

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
      img.src = url;
    });
  }

  async function shrink(file) {
    if (!SHRINKABLE.includes(file.type)) return file;
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size <= SHRINK_OVER_BYTES) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    // PNGs keep transparency (logos etc.); everything else becomes JPEG.
    const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    if (outType === 'image/jpeg') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outType, 0.85));
    if (!blob || blob.size >= file.size) return file;
    const name = outType === 'image/jpeg' ? file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg' : file.name;
    return new File([blob], name, { type: outType, lastModified: file.lastModified });
  }

  // Also used directly by fetch()-based uploaders that read input.files
  // themselves before this file's own change listener runs (the site
  // editor's Media Manager - public/js/site-editor/media.js).
  window.shrinkImageForUpload = (file) => shrink(file).catch(() => file);

  async function processInput(input) {
    const files = Array.from(input.files || []);
    if (!files.some((f) => SHRINKABLE.includes(f.type))) return;
    const out = [];
    for (const f of files) {
      try {
        out.push(await shrink(f));
      } catch (err) {
        out.push(f);
      }
    }
    try {
      const dt = new DataTransfer();
      out.forEach((f) => dt.items.add(f));
      input.files = dt.files;
    } catch (err) {
      // Very old browsers can't replace input.files - the original files
      // still upload, and the size check below still applies.
    }
  }

  document.addEventListener('change', (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files || !input.files.length) return;
    const job = processInput(input);
    const form = input.form;
    if (form) {
      const jobs = pending.get(form) || new Set();
      jobs.add(job);
      pending.set(form, jobs);
      job.finally(() => jobs.delete(job));
    }
  });

  function totalFileBytes(form) {
    let total = 0;
    form.querySelectorAll('input[type="file"]').forEach((input) => {
      Array.from(input.files || []).forEach((f) => { total += f.size; });
    });
    return total;
  }

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const jobs = pending.get(form);
    if (jobs && jobs.size > 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const submitter = e.submitter || null;
      Promise.allSettled(Array.from(jobs)).then(() => {
        if (typeof form.requestSubmit === 'function') form.requestSubmit(submitter && submitter.form === form ? submitter : undefined);
        else form.submit();
      });
      return;
    }
    if (totalFileBytes(form) > MAX_SUBMIT_BYTES) {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.alert('These files are too large to save together (over about 5MB in total). Please save a few at a time, or use smaller files.');
    }
  }, true);
})();
