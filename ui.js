// ================================================================
// Log It — in-app dialogs for the read pages.
//
// Replaces window.prompt/confirm/alert. The native ones render in the
// browser's own chrome — grey, wrong typeface, and on a phone they read like
// a security warning rather than part of the app. A test asserts the pages
// never call them.
//
// All three return a Promise, so callers await instead of blocking.
// ================================================================

function uiClose(wrap, resolve, value) {
  wrap.remove();
  document.removeEventListener('keydown', wrap._onKey);
  resolve(value);
}

function uiOpen({ title, body, input, placeholder, value, okLabel, danger }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'dlg-wrap';
    wrap.innerHTML =
      '<div class="dlg" role="dialog" aria-modal="true" aria-label="' + escapeHtml(title) + '">'
      + '<div class="dlg-t">' + escapeHtml(title) + '</div>'
      + (body ? '<div class="dlg-b">' + escapeHtml(body) + '</div>' : '')
      + (input ? '<input class="dlg-i" type="text" enterkeyhint="done">' : '')
      + '<div class="dlg-row">'
      + '<button class="dlg-c">Cancel</button>'
      + '<button class="dlg-ok' + (danger ? ' danger-btn' : '') + '">'
      + escapeHtml(okLabel || 'OK') + '</button>'
      + '</div></div>';

    document.body.appendChild(wrap);
    const field = wrap.querySelector('.dlg-i');
    if (field) {
      field.value = value == null ? '' : String(value);
      if (placeholder) field.placeholder = placeholder;
      // Delay one frame or iOS sometimes ignores the focus and never raises
      // the keyboard.
      requestAnimationFrame(() => { field.focus(); field.select(); });
    }

    const ok = () => uiClose(wrap, resolve, input ? (field ? field.value : '') : true);
    const cancel = () => uiClose(wrap, resolve, input ? null : false);

    wrap.querySelector('.dlg-ok').onclick = ok;
    wrap.querySelector('.dlg-c').onclick = cancel;
    // Tapping the backdrop cancels; tapping the card itself must not.
    wrap.onclick = (e) => { if (e.target === wrap) cancel(); };

    wrap._onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      if (e.key === 'Enter' && input) { e.preventDefault(); ok(); }
    };
    document.addEventListener('keydown', wrap._onKey);
  });
}

// Resolves to the typed string, or null if cancelled — same contract the
// callers already had with window.prompt.
function uiPrompt(title, value, opts) {
  return uiOpen(Object.assign({ title, value, input: true, okLabel: 'Save' }, opts || {}));
}

function uiConfirm(title, body, opts) {
  return uiOpen(Object.assign({ title, body, okLabel: 'Confirm' }, opts || {}));
}

// One button. Still a promise so callers can await it before re-rendering.
function uiAlert(title, body) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'dlg-wrap';
    wrap.innerHTML =
      '<div class="dlg" role="alertdialog" aria-label="' + escapeHtml(title) + '">'
      + '<div class="dlg-t">' + escapeHtml(title) + '</div>'
      + (body ? '<div class="dlg-b">' + escapeHtml(body) + '</div>' : '')
      + '<div class="dlg-row"><button class="dlg-ok">Got it</button></div></div>';
    document.body.appendChild(wrap);

    const done = () => uiClose(wrap, resolve, undefined);
    wrap.querySelector('.dlg-ok').onclick = done;
    wrap.onclick = (e) => { if (e.target === wrap) done(); };
    wrap._onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); done(); } };
    document.addEventListener('keydown', wrap._onKey);
    requestAnimationFrame(() => wrap.querySelector('.dlg-ok').focus());
  });
}
