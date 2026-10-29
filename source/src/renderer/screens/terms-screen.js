import { routeAfterTerms } from '../app.js';
import { acceptTerms, declineTerms } from '../services/email-api.js';

export function renderTermsScreen(container, terms) {
  container.innerHTML = `
    <div class="login-container">
      <div class="login-card terms-card">
        <h1>Terms of Use</h1>
        <p>Read and accept the terms to use Mail Reader.</p>

        <div class="terms-scroll">${escapeHtml(terms?.text || '')}</div>

        <div class="terms-actions">
          <button class="btn btn-primary" id="accept-btn">I have read and accept the terms</button>
          <button class="btn btn-text terms-decline" id="decline-btn">Decline and close the app</button>
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
      errorEl.textContent = err.message || 'Error recording the acceptance';
    }
  });

  declineBtn.addEventListener('click', () => {
    // Declined: the main process closes the app.
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
