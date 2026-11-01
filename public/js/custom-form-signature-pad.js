// Custom Forms - the "Signature" field type's drawing pad (views/
// partials/custom-form-field.ejs's own cf-signature-pad-wrap). Plain
// canvas + Pointer Events, no library (same no-dependency rule every
// other public/js/*.js file in this app already follows). Every stroke
// writes the canvas's current PNG data URL into the field's own hidden-
// by-CSS text input (never type="hidden" - see that partial's own
// comment on why), so it submits/validates exactly like a plain text
// field with no special-casing needed anywhere else.
(function () {
  if (window.__customFormSignaturePadInstalled) return;
  window.__customFormSignaturePadInstalled = true;

  function setupPad(wrap) {
    var canvas = wrap.querySelector('[data-cf-signature-canvas]');
    var input = wrap.parentElement.querySelector('[data-cf-signature-input]');
    var clearBtn = wrap.querySelector('[data-cf-signature-clear]');
    if (!canvas || !input) return;
    var ctx = canvas.getContext('2d');

    // Backing-store scaling for crisp lines on a high-DPI screen - the
    // canvas's own CSS size stays whatever the layout gives it
    // (width:100% - see public/css/styles.css), only its drawing-buffer
    // resolution is bumped to match.
    function sizeCanvas() {
      var rect = canvas.getBoundingClientRect();
      var ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1c2530';
    }
    sizeCanvas();

    if (wrap.hasAttribute('data-cf-signature-disabled')) return; // builder live-preview - draw-only display, never interactive

    var drawing = false;
    var lastX = 0;
    var lastY = 0;
    var hasInk = false;

    function pointFromEvent(e) {
      var rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function writeValue() {
      input.value = canvas.toDataURL('image/png');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    canvas.addEventListener('pointerdown', function (e) {
      drawing = true;
      hasInk = true;
      canvas.setPointerCapture(e.pointerId);
      var p = pointFromEvent(e);
      lastX = p.x;
      lastY = p.y;
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var p = pointFromEvent(e);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastX = p.x;
      lastY = p.y;
      e.preventDefault();
    });
    function endStroke() {
      if (!drawing) return;
      drawing = false;
      if (hasInk) writeValue();
    }
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointerleave', endStroke);
    canvas.addEventListener('pointercancel', endStroke);

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasInk = false;
        input.value = '';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    // A resize (e.g. rotating a phone, or the builder's own Desktop/
    // Mobile preview toggle resizing its frame) would otherwise stretch
    // the existing bitmap - simplest correct behavior is to just start
    // over, same as Jotform's own signature widget does on a real
    // resize.
    window.addEventListener('resize', function () {
      sizeCanvas();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasInk = false;
      input.value = '';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-cf-signature-wrap]').forEach(setupPad);
  });
})();
