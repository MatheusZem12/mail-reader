// Our own confirmation modal, instead of the native window.confirm — it follows
// the app theme and lets the confirm button be labeled (e.g. "Delete").
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-action="cancel">Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const keyController = new AbortController();
    const close = (result) => {
      keyController.abort();
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
    overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    }, { signal: keyController.signal });

    overlay.querySelector('[data-action="confirm"]').focus();
  });
}

// The automation form in a centered modal (it used to sit in the reading
// pane, on the right, which pushed the list into a corner and got lost).
// Resolves with { name, query } or null if cancelled.
// `validate` gets the values and returns an error message or null.
export function automationFormDialog({ rule = null, validate = () => null } = {}) {
  const isEdit = !!rule;
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-form">
        <h3>${isEdit ? 'Edit automation' : 'New automation'}</h3>
        <div class="form-group">
          <label for="dlg-rule-name">Name</label>
          <input type="text" id="dlg-rule-name" placeholder="E.g. Banks" value="${escapeHtml(rule?.name || '')}" autocomplete="off">
        </div>
        <div class="form-group">
          <label for="dlg-rule-query">Senders</label>
          <input type="text" id="dlg-rule-query" placeholder="E.g. acmebank;shopco;newsletter" value="${escapeHtml(rule?.query || '')}" autocomplete="off">
          <div class="field-hint">
            Separate several with <strong>;</strong> — the automation cleans the e-mails
            <strong>received from</strong> each of them. The sender's address is split on
            <strong>@ . _ -</strong> and some piece has to be <strong>equal</strong> to
            what you type: <em>acmebank</em> catches <em>@e.acmebank.com</em> and
            <em>acmebank@gmail.com</em>, but <em>acme</em> catches nothing. Case
            and spaces are ignored (ACME BANK → acmebank).
          </div>
        </div>
        <div class="rule-terms-preview" id="dlg-rule-preview" hidden></div>
        <div class="error-message" id="dlg-rule-error" hidden></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-action="cancel">Cancel</button>
          <button class="btn btn-primary" data-action="confirm">${isEdit ? 'Save' : 'Create automation'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const nameInput = overlay.querySelector('#dlg-rule-name');
    const queryInput = overlay.querySelector('#dlg-rule-query');
    const errorEl = overlay.querySelector('#dlg-rule-error');
    const previewEl = overlay.querySelector('#dlg-rule-preview');

    const keyController = new AbortController();
    const close = (result) => {
      keyController.abort();
      overlay.remove();
      resolve(result);
    };

    // Shows how the ";" was read before saving — avoids finding out only when
    // running it that "acme ;" became a term with a stray space.
    const updatePreview = () => {
      const terms = queryInput.value
        .split(';')
        .map((t) => t.toLowerCase().replace(/\s+/g, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter(Boolean);
      previewEl.hidden = terms.length < 2;
      if (terms.length < 2) return;
      previewEl.innerHTML = `It will clean e-mails from ${terms.length} senders: ` +
        terms.map((t) => `<span class="rule-term-chip">${escapeHtml(t)}</span>`).join('');
    };
    queryInput.addEventListener('input', updatePreview);
    updatePreview();

    const submit = () => {
      const values = { name: nameInput.value.trim(), query: queryInput.value.trim() };
      const error = validate(values);
      if (error) {
        errorEl.hidden = false;
        errorEl.textContent = error;
        return;
      }
      close(values);
    };

    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(null));
    overlay.querySelector('[data-action="confirm"]').addEventListener('click', submit);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(null);
      // Enter only confirms if focus is on one of the fields — avoids firing by accident.
      if (e.key === 'Enter' && (e.target === nameInput || e.target === queryInput)) submit();
    }, { signal: keyController.signal });

    nameInput.focus();
    nameInput.select();
  });
}

function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
