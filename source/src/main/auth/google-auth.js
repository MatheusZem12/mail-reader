const { google } = require('googleapis');
const http = require('http');
const { shell } = require('electron');
const { URL } = require('url');
const oauthConfig = require('./oauth-config');
const accountStore = require('../storage/account-store');

const SCOPES = ['https://mail.google.com/'];
const REDIRECT_PORT = 42813;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

function getClient() {
  const clientId = oauthConfig.getClientId('google');
  if (!clientId) {
    throw new Error(
      'Google OAuth não configurado. Defina MAIL_READER_GOOGLE_CLIENT_ID no arquivo .env (veja o README).'
    );
  }
  return new google.auth.OAuth2(clientId, oauthConfig.getClientSecret('google'), REDIRECT_URI);
}

function startCallbackServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (code) {
        res.end('<h1>Autorização concluída!</h1><p>Você pode fechar esta janela.</p>');
        server.close(() => resolve(code));
      } else {
        res.end(`<h1>Erro na autorização</h1><p>${error || 'Desconhecido'}</p>`);
        server.close(() => reject(new Error(error || 'Autorização negada')));
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log('Aguardando callback OAuth na porta', REDIRECT_PORT);
    });

    server.on('error', reject);
  });
}

async function startAuthFlow() {
  const oauth2Client = getClient();

  // Só força o consentimento completo se ainda não temos um refresh token.
  // Pedir consentimento toda vez gera um novo refresh token e pode invalidar
  // o anterior, além de ser desnecessário para reconectar uma conta já autorizada.
  const existingAccounts = accountStore.getAccounts();
  const hasExistingGoogleAccount = existingAccounts.some((a) => a.provider === 'google');

  const authUrlOptions = {
    access_type: 'offline',
    scope: SCOPES,
    include_granted_scopes: true,
  };
  if (!hasExistingGoogleAccount) {
    authUrlOptions.prompt = 'consent';
  }

  const url = oauth2Client.generateAuthUrl(authUrlOptions);

  const codePromise = startCallbackServer();
  shell.openExternal(url);

  const code = await codePromise;
  const { tokens } = await oauth2Client.getToken(code);

  oauth2Client.setCredentials(tokens);
  // Identifica a conta pelo próprio Gmail: o escopo https://mail.google.com/
  // não cobre o endpoint de userinfo (exigiria openid/email), mas cobre getProfile.
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const { data: profile } = await gmail.users.getProfile({ userId: 'me' });

  const accountId = `google-${profile.emailAddress}`;
  const existingAccount = accountStore.getAccountWithToken(accountId);

  // Se não veio refresh token e não temos um salvo, precisamos forçar consentimento.
  if (!tokens.refresh_token && !existingAccount?.refreshToken) {
    throw new Error(
      'O Google não devolveu um token de atualização. Remova a conta e conecte novamente com consentimento completo.'
    );
  }

  return {
    id: accountId,
    provider: 'google',
    email: profile.emailAddress,
    name: profile.emailAddress,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || existingAccount?.refreshToken,
    expiresAt: tokens.expiry_date,
  };
}

async function refreshAccessToken(refreshToken) {
  const oauth2Client = getClient();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2Client.refreshAccessToken();
  return {
    accessToken: credentials.access_token,
    expiresAt: credentials.expiry_date,
  };
}

function getGmailClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: 'v1', auth });
}

module.exports = {
  startAuthFlow,
  refreshAccessToken,
  getGmailClient,
};
