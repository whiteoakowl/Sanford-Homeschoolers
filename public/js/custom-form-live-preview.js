// Main Admin Forms builder - a real request: "Custom forms should have
// a live preview as you design like the website design page (public
// homepage)." The Settings & Theme panel's own Title/Description/
// Primary Color/Button Style/Fun Theme fields (views/admin-custom-
// forms-builder.ejs's own [data-cf-settings-form]) now update the Live
// Preview panel on every keystroke/pick, with no Save needed first -
// same "no page reload to see it" feel as the Public Homepage theme
// editor's own color/font pickers (public/js/homepage-theme-editor.js's
// scheduleReload), just via direct DOM updates here instead of that
// editor's iframe+query-string round trip: this preview already renders
// inline on the same page (views/partials/custom-form-field.ejs, same
// partial the public fill-out page itself uses), not through a separate
// /preview route, so there's nothing to re-fetch.
//
// Pages/fields themselves still need a real Save to show up here - same
// as the Homepage editor's own content blocks, which aren't instant
// there either (only its theme fields are). Conditional logic/multi-
// page navigation on whatever's already in the preview stays driven by
// public/js/custom-form-runtime.js, untouched by this file.
(function () {
  if (window.__customFormLivePreviewInstalled) return;
  window.__customFormLivePreviewInstalled = true;

  var BUTTON_RADIUS = { rounded: '10px', square: '4px', pill: '999px' };

  function syncPreview(settingsForm) {
    var previewForm = document.querySelector('[data-cf-form]');
    if (!previewForm) return;

    var titleInput = settingsForm.querySelector('[name="title"]');
    var titleEl = previewForm.querySelector('[data-cf-preview-title-text]');
    if (titleInput && titleEl) titleEl.textContent = titleInput.value || '';

    var descInput = settingsForm.querySelector('[name="description"]');
    var descEl = previewForm.querySelector('[data-cf-preview-description]');
    if (descInput && descEl) {
      var text = descInput.value.trim();
      descEl.textContent = text;
      descEl.style.display = text ? '' : 'none';
    }

    var colorInput = settingsForm.querySelector('[data-cf-primary-color-input]');
    if (colorInput) previewForm.style.setProperty('--cf-primary', colorInput.value);

    var buttonStyleSelect = settingsForm.querySelector('[name="themeButtonStyle"]');
    if (buttonStyleSelect) previewForm.style.setProperty('--cf-radius', BUTTON_RADIUS[buttonStyleSelect.value] || BUTTON_RADIUS.rounded);

    var presetSelect = settingsForm.querySelector('[data-cf-theme-preset-select]');
    var emojiEl = previewForm.querySelector('[data-cf-preview-emoji]');
    var emojiSpaceEl = previewForm.querySelector('[data-cf-preview-emoji-space]');
    if (presetSelect && emojiEl && emojiSpaceEl) {
      var option = presetSelect.options[presetSelect.selectedIndex];
      var emoji = (option && option.getAttribute('data-emoji')) || '';
      emojiEl.textContent = emoji;
      emojiEl.style.display = emoji ? '' : 'none';
      emojiSpaceEl.textContent = emoji ? ' ' : '';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var settingsForm = document.querySelector('[data-cf-settings-form]');
    if (!settingsForm) return;
    settingsForm.querySelectorAll('[data-cf-theme-field]').forEach(function (field) {
      field.addEventListener('input', function () { syncPreview(settingsForm); });
      field.addEventListener('change', function () { syncPreview(settingsForm); });
    });
  });
})();
