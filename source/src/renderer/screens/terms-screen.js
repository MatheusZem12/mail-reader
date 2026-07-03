import { routeAfterTerms } from '../app.js';
import { acceptTerms, declineTerms } from '../services/email-api.js';

export function renderTermsScreen(container, terms) {
  container.innerHTML = `
    <div class="login-container">
      <div class="login-card terms-card">
        <h1>Termos de Uso</h1>
        <p>Leia e aceite os termos para usar o Mail Reader.</p>

        <div class="terms-scroll">${escapeHtml(terms?.text || '')}</div>

        <div class="terms-actions">
          <button class="btn btn-primary" id="accept-btn">Li e aceito os termos</button>
          <button class="btn btn-text terms-decline" id="decline-btn">Recusar e fechar o aplicativo</button>
        </div>
        <div id="error" class="error-message"></div>
      </div>
    </div>
  `;

  const acceptBtn = container.querySelector('#accept-btn');
  const declineBtn = container.querySelector('#decline-btn');
  const errorEl = container.querySelector('#error');

  acceptBtn.addEventListener('click', async () => {
    try {
      acceptBtn.disabled = true;
      await acceptTerms();
      await routeAfterTerms();
    } catch (err) {
      acceptBtn.disabled = false;
      errorEl.textContent = err.message || 'Erro ao registrar o aceite';
    }
  });

  declineBtn.addEventListener('click', () => {
    // Recusou: o app é encerrado pelo processo principal.
    declineTerms();
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
