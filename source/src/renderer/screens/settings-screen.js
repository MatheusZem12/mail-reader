import { navigate } from '../app.js';
import { getOAuthConfig, saveOAuthConfig, openExternal } from '../services/email-api.js';

export async function renderSettingsScreen(container) {
  container.innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <h1>Set up OAuth</h1>
        <p>Your credentials, your machine: create the OAuth apps on Google and/or
        Microsoft (tutorial below, done only once), paste the codes here and
        the app saves it all <strong>locally</strong> in the <code>.env</code> file.
        Nothing is sent to third-party servers.</p>

        <div class="form-group">
          <label for="google-client-id">Google Client ID</label>
          <input type="text" id="google-client-id" placeholder="123456789-abc123.apps.googleusercontent.com">
        </div>
        <div class="form-group">
          <label for="google-client-secret">Google Client Secret</label>
          <input type="text" id="google-client-secret" placeholder="GOCSPX-...">
          <div class="field-help">
            <button class="link-btn" data-url="https://console.cloud.google.com/apis/credentials">Create on Google Cloud</button>
            <span>•</span>
            <button class="link-btn" data-url="https://console.cloud.google.com/apis/library/gmail.googleapis.com">Enable the Gmail API</button>
            <span>•</span>
            <button class="link-btn" data-url="https://console.cloud.google.com/auth/audience">Test users</button>
          </div>
        </div>

        <div class="form-group">
          <label for="microsoft-client-id">Microsoft Client ID (optional)</label>
          <input type="text" id="microsoft-client-id" placeholder="12345678-1234-1234-1234-123456789012">
          <div class="field-help">
            <button class="link-btn" data-url="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade">Create on Azure</button>
          </div>
        </div>

        <div class="settings-instructions">
          <details>
            <summary>Tutorial: how to create the OAuth apps (only once)</summary>
            <div class="instructions-content">
              <h4>Google (Gmail)</h4>
              <ol>
                <li>Open the <strong>Google Cloud Console</strong> through the "Create on Google Cloud" link.</li>
                <li>Create a project (any name) if you don't have one yet.</li>
                <li>Enable the <strong>Gmail API</strong> through the link above.</li>
                <li>Set up the <strong>OAuth consent screen</strong> (type <strong>External</strong>).</li>
                <li>Under <strong>Audience → Test users</strong>, add your Gmail (without it the sign-in fails with error 403).</li>
                <li>Still under <strong>Audience</strong>, click <strong>Publish app</strong> (status <strong>In production</strong>). While it stays in <strong>Testing</strong>, Google <strong>expires the authorization every 7 days</strong> and you have to sign in again every week. Once published, the session lasts indefinitely — the sign-in shows an "unverified app" warning; just go to <em>Advanced → Go to (unsafe)</em>, since the app is yours and runs only on your machine.</li>
                <li>Under <strong>Credentials → Create Credentials → OAuth client ID</strong>, type <strong>Desktop app</strong>.</li>
                <li>Copy the <strong>Client ID</strong> (it ends in <code>.apps.googleusercontent.com</code>) and the <strong>Client Secret</strong> (it starts with <code>GOCSPX-</code>) into the fields above.</li>
              </ol>
              <h4>Microsoft (Outlook)</h4>
              <ol>
                <li>Open <strong>Azure</strong> through the "Create on Azure" link.</li>
                <li>Click <strong>New registration</strong> (personal + organizational accounts).</li>
                <li>Under <strong>Authentication → Add a platform → Mobile and desktop applications</strong>, add the redirect URI <code>http://localhost:42814/oauth2callback</code>.</li>
                <li>Copy the <strong>Application (client) ID</strong> into the field above.</li>
              </ol>
              <h4>Another computer?</h4>
              <p>Just paste the same codes there (or copy the <code>.env</code> file). The Google/Azure setup is done only once.</p>
            </div>
          </details>
        </div>

        <button class="btn btn-primary" id="save-btn" style="width: 100%; margin-top: 16px;">Save on this machine</button>
        <button class="btn btn-text" id="back-btn" style="width: 100%; margin-top: 8px;">Back</button>
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

  // Prefills with what's already saved in the local .env
  try {
    const config = await getOAuthConfig();
    googleIdInput.value = config.googleClientId || '';
    googleSecretInput.value = config.googleClientSecret || '';
    microsoftInput.value = config.microsoftClientId || '';
  } catch {
    errorEl.textContent = 'Error loading the saved settings';
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
      errorEl.textContent = 'Set up at least one provider (Google or Microsoft).';
      return;
    }
    if (googleClientId && !googleClientSecret) {
      errorEl.textContent = 'Google requires the Client Secret along with the Client ID.';
      return;
    }

    try {
      saveBtn.disabled = true;
      await saveOAuthConfig({ googleClientId, googleClientSecret, microsoftClientId });
      navigate('login');
    } catch (err) {
      saveBtn.disabled = false;
      errorEl.textContent = err.message || 'Error saving the settings';
    }
  });

  backBtn.addEventListener('click', () => navigate('login'));
}
