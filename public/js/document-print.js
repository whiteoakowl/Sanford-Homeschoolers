// Print button on a document's print preview (views/document-print.ejs).
// For an uploaded PDF the page embeds the file itself in a full-page
// iframe (same origin - /documents/<token>/file), and printing the
// outer page would just print a screenshot of the browser's PDF viewer
// chrome, so the iframe's own window is printed instead: that's the real
// PDF, every page. Falls back to printing the outer page if the browser
// won't let the embedded viewer print (or for a .docx sheet, which has no
// iframe at all and prints as a normal page).
(function () {
  function printDocument() {
    var frame = document.getElementById('document-print-frame');
    if (frame && frame.contentWindow) {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        return;
      } catch {
        // fall through to the outer page
      }
    }
    window.print();
  }

  document.querySelectorAll('[data-document-print]').forEach(function (btn) {
    btn.addEventListener('click', printDocument);
  });
})();
