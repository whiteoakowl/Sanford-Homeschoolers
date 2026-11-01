// Main Admin Forms builder - small bits of dialog interactivity that
// don't need a full page reload: picking a field type from the Add
// Field dialog's own flat dropdown (views/admin-custom-forms-
// builder.ejs's own select[name="fieldType"] - a real request: "Add
// element should be a dropdown menu of options... one grand list of
// options") and showing/hiding the right detail rows for it (options
// list only for a choice field (or Input Table/Matrix's own rows), no
// required/placeholder/default for a display-only heading/paragraph/
// divider/image, no placeholder/default either for a composite type
// whose answer is several combined sub-inputs - see utils/
// customForms.js's own COMPOSITE_TYPES - an Image upload only for
// Image, Matrix Columns only for Input Table, and a "how to write this"
// hint only for Fill in the Blank), and the conditional-logic rule
// builder's own "only show the operator/value once a controlling field
// is picked" behavior. Reordering itself is handled entirely by
// public/js/homepage-block-reorder.js (reused as-is, not duplicated
// here) and live preview by public/js/custom-form-runtime.js (also
// reused as-is in this same page) - this file is only the dialog-field
// plumbing those two don't cover.
//
// These lists mirror utils/customForms.js's own DISPLAY_ONLY_TYPES/
// COMPOSITE_TYPES exactly (no shared build step between server and
// browser code in this app, same reason public/js/custom-form-
// runtime.js's own evaluateCondition is a deliberate hand-kept mirror
// of the server copy) - change one, change the other.
(function () {
  if (window.__customFormBuilderInstalled) return;
  window.__customFormBuilderInstalled = true;

  var CHOICE_TYPES = ['single_choice', 'multiple_choice', 'dropdown'];
  var DISPLAY_ONLY_TYPES = ['heading', 'paragraph', 'divider', 'image', 'video'];
  var COMPOSITE_TYPES = ['full_name', 'address', 'appointment', 'signature', 'fill_blank', 'input_table'];

  function fieldTypeOf(dialog) {
    var select = dialog.querySelector('select[name="fieldType"]');
    return select ? select.value : null;
  }

  // Shows/hides a dialog's own options-list, required toggle,
  // placeholder/default-value rows, Image upload, Matrix Columns, and
  // the Fill in the Blank hint to match the currently selected (or, on
  // the edit dialog, already-saved) field type - same shape the
  // original builder's inline onchange already used for the options
  // textarea, just generalized over every row a type can hide.
  function syncDialogForType(dialog, type) {
    var isChoice = CHOICE_TYPES.indexOf(type) !== -1 || type === 'input_table';
    var isDisplayOnly = DISPLAY_ONLY_TYPES.indexOf(type) !== -1;
    var isComposite = COMPOSITE_TYPES.indexOf(type) !== -1;
    dialog.querySelectorAll('[data-cf-row="options"]').forEach(function (el) { el.style.display = isChoice ? '' : 'none'; });
    dialog.querySelectorAll('[data-cf-row="required"]').forEach(function (el) { el.style.display = isDisplayOnly ? 'none' : ''; });
    // Placeholder stays visible for Video even though it's otherwise
    // display-only - that's where its own embed URL is entered (views/
    // partials/custom-form-field.ejs reads it back from `placeholder`).
    dialog.querySelectorAll('[data-cf-row="placeholder"]').forEach(function (el) {
      el.style.display = (isDisplayOnly && type !== 'video') || isComposite ? 'none' : '';
    });
    dialog.querySelectorAll('[data-cf-row="default"]').forEach(function (el) { el.style.display = isDisplayOnly || isComposite ? 'none' : ''; });
    dialog.querySelectorAll('[data-cf-placeholder-label]').forEach(function (el) {
      if (el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE) {
        el.firstChild.textContent = type === 'video' ? 'Video URL (YouTube or Vimeo link)' : 'Placeholder';
      }
    });
    dialog.querySelectorAll('[data-cf-row="fillblank-hint"]').forEach(function (el) { el.style.display = type === 'fill_blank' ? '' : 'none'; });
    dialog.querySelectorAll('[data-cf-row="image"]').forEach(function (el) { el.style.display = type === 'image' ? '' : 'none'; });
    dialog.querySelectorAll('[data-cf-row="matrix-columns"], [data-cf-row="matrix-columns-hint"]').forEach(function (el) { el.style.display = type === 'input_table' ? '' : 'none'; });
  }

  document.addEventListener('change', function (e) {
    if (!e.target.matches('[data-cf-field-type-select]')) return;
    var dialog = e.target.closest('dialog');
    if (dialog) syncDialogForType(dialog, e.target.value);
  });

  // "Fun Theme" preset picker (views/admin-custom-forms-builder.ejs's
  // own Settings & Theme panel) - picking one just pre-fills the
  // existing Primary Color field with that preset's own color, still
  // freely editable after; "None (custom)" leaves Primary Color exactly
  // as it already was (no color baked into that option).
  document.addEventListener('change', function (e) {
    if (!e.target.matches('[data-cf-theme-preset-select]')) return;
    var option = e.target.options[e.target.selectedIndex];
    var color = option && option.getAttribute('data-primary-color');
    var colorInput = e.target.closest('form').querySelector('[data-cf-primary-color-input]');
    if (color && colorInput) colorInput.value = color;
  });

  // Conditional-logic rule builder: the operator/value rows only matter
  // once a "depends on this field" target is actually chosen - "no
  // target" is exactly how a field/page with no conditional_logic row
  // at all (always visible) gets represented in both dialogs.
  function syncConditionRows(dialog) {
    var select = dialog.querySelector('[data-cf-condition-field]');
    if (!select) return;
    var hasTarget = !!select.value;
    dialog.querySelectorAll('[data-cf-condition-row]').forEach(function (el) { el.style.display = hasTarget ? '' : 'none'; });
  }

  // Parsed once from the builder page's own #cf-field-meta JSON blob
  // (admin-custom-forms-builder.ejs) - {fieldId: {type, options:
  // [label,...]}} for every field in the form, so the rule-builder can
  // swap the free-text "value" input for a real <select> of that
  // field's own choices the moment a choice-type (or checkbox) field is
  // picked as the condition's target. Both inputs share the same
  // `name="conditionValue"`; only the visible one is ever enabled, so
  // only it is ever actually submitted.
  var fieldMeta = {};
  try {
    var metaEl = document.getElementById('cf-field-meta');
    if (metaEl) fieldMeta = JSON.parse(metaEl.textContent);
  } catch (err) {
    fieldMeta = {};
  }

  function syncConditionValueInput(dialog) {
    var select = dialog.querySelector('[data-cf-condition-field]');
    var textInput = dialog.querySelector('[data-cf-condition-value-text]');
    var optionSelect = dialog.querySelector('[data-cf-condition-value-select]');
    if (!select || !textInput || !optionSelect) return;
    var meta = fieldMeta[select.value];
    var currentValue = textInput.value || optionSelect.value;

    if (meta && meta.type === 'checkbox') {
      optionSelect.innerHTML = '<option value="1">Yes (checked)</option><option value="0">No (unchecked)</option>';
    } else if (meta && meta.options && meta.options.length) {
      optionSelect.innerHTML = meta.options.map(function (label) { return '<option value="' + label.replace(/"/g, '&quot;') + '">' + label + '</option>'; }).join('');
    }

    var useSelect = !!(meta && (meta.type === 'checkbox' || (meta.options && meta.options.length)));
    optionSelect.disabled = !useSelect;
    optionSelect.style.display = useSelect ? '' : 'none';
    textInput.disabled = useSelect;
    textInput.style.display = useSelect ? 'none' : '';
    if (useSelect && currentValue) optionSelect.value = currentValue;
    else if (!useSelect) textInput.value = currentValue;
  }

  document.addEventListener('change', function (e) {
    if (e.target.matches('[data-cf-condition-field]')) {
      syncConditionRows(e.target.closest('dialog'));
      syncConditionValueInput(e.target.closest('dialog'));
    }
  });

  // Run once for every already-open-in-the-DOM dialog on load (each
  // <dialog> exists in the page from the start, just not shown yet) so
  // an edit dialog for an existing heading/paragraph field, or one that
  // already has a condition set, opens already in the right state
  // rather than flashing the wrong rows for a moment.
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('dialog').forEach(function (dialog) {
      var type = fieldTypeOf(dialog) || dialog.getAttribute('data-cf-field-type');
      if (type) syncDialogForType(dialog, type);
      syncConditionRows(dialog);
      syncConditionValueInput(dialog);
    });
  });
})();
