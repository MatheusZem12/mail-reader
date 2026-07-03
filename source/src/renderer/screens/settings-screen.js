import { navigate } from '../app.js';
import { getOAuthConfig, saveOAuthConfig, openExternal } from '../services/email-api.js';

export async function renderSettingsScreen(container) {
  container.innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <h1>Configurar OAuth</h1>
        <p>Suas credenciais, sua máquina: crie os apps OAuth no Google e/ou
        Microsoft (tutorial abaixo, feito uma única vez), cole os códigos aqui e
        o app salva tudo <strong>localmente</strong> no arquivo <code>.env</code>.
        Nada é enviado a servidores de terceiros.</p>

        <div class="form-group">
          <label for="google-client-id">Google Client ID</label>
          <input type="text" id="google-client-id" placeholder="123456789-abc123.apps.googleusercontent.com">
        </div>
        <div class="form-group">
          <label for="google-client-secret">Google Client Secret</label>
          <input type="text" id="google-client-secret" placeholder="GOCSPX-...">
          <div class="field-help">
            <button class="link-btn" data-url="https://console.cloud.google.com/apis/credentials">Criar no Google Cloud</button>
            <span>•</span>
            <button class="link-btn" data-url="https://console.cloud.google.com/apis/library/gmail.googleapis.com">Ativar Gmail API</button>
            <span>•</span>
            <button class="link-btn" data-url="https://console.cloud.google.com/auth/audience">Usuários de teste</button>
          </div>
        </div>

        <div class="form-group">
          <label for="microsoft-client-id">Microsoft Client ID (opcional)</label>
          <input type="text" id="microsoft-client-id" placeholder="12345678-1234-1234-1234-123456789012">
          <div class="field-help">
            <button class="link-btn" data-url="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade">Criar no Azure</button>
          </div>
        </div>

        <div class="settings-instructions">
          <details>
            <summary>Tutorial: como criar os apps OAuth (uma única vez)</summary>
            <div class="instructions-content">
              <h4>Google (Gmail)</h4>
              <ol>
                <li>Acesse o <strong>Google Cloud Console</strong> pelo link "Criar no Google Cloud".</li>
                <li>Crie um projeto (qualquer nome) se ainda não tiver.</li>
                <li>Ative a <strong>Gmail API</strong> pelo link acima.</li>
                <li>Configure a <strong>OAuth consent screen</strong> (tipo <strong>External</strong>).</li>
                <li>Em <strong>Audience → Test users</strong>, adicione o seu Gmail (sem isso o login dá erro 403).</li>
                <li>Em <strong>Credentials → Create Credentials → OAuth client ID</strong>, tipo <strong>Desktop app</strong>.</li>
                <li>Copie o <strong>Client ID</strong> (termina em <code>.apps.googleusercontent.com</code>) e o <strong>Client Secret</strong> (começa com <code>GOCSPX-</code>) para os campos acima.</li>
              </ol>
              <h4>Microsoft (Outlook)</h4>
              <ol>
                <li>Acesse o <strong>Azure</strong> pelo link "Criar no Azure".</li>
                <li>Clique em <strong>New registration</strong> (contas pessoais + organizacionais).</li>
                <li>Em <strong>Authentication → Add a platform → Mobile and desktop applications</strong>, adicione o redirect URI <code>http://localhost:42814/oauth2callback</code>.</li>
                <li>Copie o <strong>Application (client) ID</strong> para o campo acima.</li>
              </ol>
              <h4>Outro computador?</h4>
              <p>É só colar os mesmos códigos lá (ou copiar o arquivo <code>.env</code>). A configuração no Google/Azure é feita uma vez só.</p>
            </div>
          </details>
        </div>

        <button class="btn btn-primary" id="save-btn" style="width: 100%; margin-top: 16px;">Salvar nesta máquina</button>
        <button class="btn btn-text" id="back-btn" style="width: 100%; margin-top: 8px;">Voltar</button>
        <div id="error" class="error-message"></div>
      </div>
    </div>
  `;

  const googleIdInput = container.querySelector('#google-client-id');
  const googleSecretInput = container.querySelector('#google-client-secret');
  const microsoftInput = container.querySelector('#microsoft-client-id');
  const saveBtn = container.querySelector('#save-btn');
  const backBtn = container.querySelector('#back-btn');
  const errorEl = container.querySelector('#error');

  // Pré-preenche com o que já está salvo no .env local
  try {
    const config = await getOAuthConfig();
    googleIdInput.value = config.googleClientId || '';
    googleSecretInput.value = config.googleClientSecret || '';
    microsoftInput.value = config.microsoftClientId || '';
  } catch {
    errorEl.textContent = 'Erro ao carregar configurações salvas';
  }

  container.querySelectorAll('.link-btn').forEach((btn) => {
    btn.addEventListener('click', () => openExternal(btn.dataset.url));
  });

  saveBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    const googleClientId = googleIdInput.value.trim();
    const googleClientSecret = googleSecretInput.value.trim();
    const microsoftClientId = microsoftInput.value.trim();

    if (!googleClientId && !microsoftClientId) {
      errorEl.textContent = 'Configure pelo menos um provedor (Google ou Microsoft).';
      return;
    }
    if (googleClientId && !googleClientSecret) {
      errorEl.textContent = 'O Google exige o Client Secret junto com o Client ID.';
      return;
    }

    try {
      saveBtn.disabled = true;
      await saveOAuthConfig({ googleClientId, googleClientSecret, microsoftClientId });
      navigate('login');
    } catch (err) {
      saveBtn.disabled = false;
      errorEl.textContent = err.message || 'Erro ao salvar configurações';
    }
  });

  backBtn.addEventListener('click', () => navigate('login'));
}
