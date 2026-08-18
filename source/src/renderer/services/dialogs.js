// Modal de confirmação próprio, no lugar do window.confirm nativo — segue o
// tema do app e permite rotular o botão de confirmar (ex.: "Excluir").
export function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-action="cancel">Cancelar</button>
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

// Formulário de automação em modal centralizado (antes ficava no painel de
// leitura, à direita, o que empurrava a lista pro canto e ficava perdido).
// Resolve com { name, query } ou null se cancelar.
// `validate` recebe os valores e devolve uma mensagem de erro ou null.
export function automationFormDialog({ rule = null, validate = () => null } = {}) {
  const isEdit = !!rule;
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-form">
        <h3>${isEdit ? 'Editar automação' : 'Nova automação'}</h3>
        <div class="form-group">
          <label for="dlg-rule-name">Nome</label>
          <input type="text" id="dlg-rule-name" placeholder="Ex.: Bancos" value="${escapeHtml(rule?.name || '')}" autocomplete="off">
        </div>
        <div class="form-group">
          <label for="dlg-rule-query">Remetentes</label>
          <input type="text" id="dlg-rule-query" placeholder="Ex.: santander;btgpactual;kabum" value="${escapeHtml(rule?.query || '')}" autocomplete="off">
          <div class="field-hint">
            Separe vários com <strong>;</strong> — a automação limpa os e-mails
            <strong>recebidos de</strong> cada um deles. O endereço de quem enviou é
            quebrado em <strong>@ . _ -</strong> e algum pedaço tem que ser
            <strong>igual</strong> ao que você digitar: <em>btgpactual</em> pega
            <em>@e.btgpactual.com.br</em> e <em>btgpactual@gmail.com</em>, mas
            <em>btg</em> não pega nada. Maiúsculas e espaços são ignorados
            (BTG PACTUAL → btgpactual).
          </div>
        </div>
        <div class="rule-terms-preview" id="dlg-rule-preview" hidden></div>
        <div class="error-message" id="dlg-rule-error" hidden></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-action="cancel">Cancelar</button>
          <button class="btn btn-primary" data-action="confirm">${isEdit ? 'Salvar' : 'Criar automação'}</button>
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

    // Mostra como o ";" foi interpretado antes de salvar — evita descobrir só
    // na hora de executar que "itau ;" virou um termo com espaço sobrando.
    const updatePreview = () => {
      const terms = queryInput.value
        .split(';')
        .map((t) => t.toLowerCase().replace(/\s+/g, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter(Boolean);
      previewEl.hidden = terms.length < 2;
      if (terms.length < 2) return;
      previewEl.innerHTML = `Vai limpar e-mails de ${terms.length} remetentes: ` +
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
      // Enter só confirma se o foco está num dos campos — evita disparar sem querer.
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
