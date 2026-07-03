import { navigate } from '../app.js';
import {
  getAccounts,
  removeAccount,
  authGoogle,
  authMicrosoft,
  getOAuthStatus,
} from '../services/email-api.js';

export async function renderLoginScreen(container) {
  container.innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <h1>Mail Reader</h1>
        <p>Conecte suas contas de e-mail</p>

        <div id="setup-notice" class="setup-notice" style="display: none;">
          <strong>Configuração inicial necessária</strong>
          <p>Nenhum provedor configurado ainda. Clique em "Configurar OAuth"
          abaixo e siga o tutorial — é feito uma única vez e fica salvo só na
          sua máquina.</p>
        </div>

        <div class="oauth-buttons">
          <button class="btn oauth-btn google" id="google-btn">
            <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Entrar com Google
          </button>
          <button class="btn oauth-btn microsoft" id="microsoft-btn">
            <svg viewBox="0 0 21 21" width="18" height="18"><path fill="currentColor" d="M1 1h9v9H1z"/><path fill="currentColor" d="M11 1h9v9h-9z"/><path fill="currentColor" d="M1 11h9v9H1z"/><path fill="currentColor" d="M11 11h9v9h-9z"/></svg>
            Entrar com Outlook
          </button>
        </div>

        <div id="accounts-section" style="display: none; margin-top: 24px;">
          <h3 style="font-size: 14px; color: #666; margin-bottom: 12px;">Contas conectadas</h3>
          <div id="accounts-list"></div>
          <button class="btn btn-primary" id="continue-btn" style="width: 100%; margin-top: 16px;">Ver caixa de entrada</button>
        </div>

        <button class="btn btn-text" id="settings-btn" style="width: 100%; margin-top: 12px;">Configurar OAuth</button>
        <div id="error" class="error-message"></div>
      </div>
    </div>
  `;

  const googleBtn = container.querySelector('#google-btn');
  const microsoftBtn = container.querySelector('#microsoft-btn');
  const accountsSection = container.querySelector('#accounts-section');
  const accountsList = container.querySelector('#accounts-list');
  const continueBtn = container.querySelector('#continue-btn');
  const setupNotice = container.querySelector('#setup-notice');
  const settingsBtn = container.querySelector('#settings-btn');
  const errorEl = container.querySelector('#error');

  settingsBtn.addEventListener('click', () => navigate('settings'));

  try {
    const status = await getOAuthStatus();
    if (!status.google && !status.microsoft) {
      setupNotice.style.display = 'block';
    }
    googleBtn.disabled = !status.google;
    microsoftBtn.disabled = !status.microsoft;
  } catch {
    // Se não conseguir checar o status, deixa os botões habilitados.
  }

  async function loadAccounts() {
    try {
      const accounts = await getAccounts();
      renderAccounts(accounts);
    } catch (err) {
      errorEl.textContent = err.message || 'Erro ao carregar contas';
    }
  }

  function renderAccounts(accounts) {
    if (accounts.length === 0) {
      accountsSection.style.display = 'none';
      return;
    }

    accountsSection.style.display = 'block';
    accountsList.innerHTML = accounts.map((account) => `
      <div class="account-item">
        <div class="account-info">
          <strong>${escapeHtml(account.name || account.email)}</strong>
          <span>${escapeHtml(account.email)}</span>
        </div>
        <button class="icon-btn remove-account-btn" data-id="${account.id}" title="Remover conta">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `).join('');

    container.querySelectorAll('.remove-account-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        await removeAccount(id);
        await loadAccounts();
      });
    });
  }

  googleBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    googleBtn.disabled = true;
    googleBtn.textContent = 'Aguardando autorização...';
    try {
      await authGoogle();
      await loadAccounts();
    } catch (err) {
      errorEl.textContent = err.message || 'Erro ao conectar com Google';
    } finally {
      googleBtn.disabled = false;
      googleBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        Entrar com Google
      `;
    }
  });

  microsoftBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    microsoftBtn.disabled = true;
    microsoftBtn.textContent = 'Aguardando autorização...';
    try {
      await authMicrosoft();
      await loadAccounts();
    } catch (err) {
      errorEl.textContent = err.message || 'Erro ao conectar com Outlook';
    } finally {
      microsoftBtn.disabled = false;
      microsoftBtn.innerHTML = `
        <svg viewBox="0 0 21 21" width="18" height="18"><path fill="currentColor" d="M1 1h9v9H1z"/><path fill="currentColor" d="M11 1h9v9h-9z"/><path fill="currentColor" d="M1 11h9v9H1z"/><path fill="currentColor" d="M11 11h9v9h-9z"/></svg>
        Entrar com Outlook
      `;
    }
  });

  continueBtn.addEventListener('click', () => {
    navigate('list');
  });

  await loadAccounts();
}

function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
