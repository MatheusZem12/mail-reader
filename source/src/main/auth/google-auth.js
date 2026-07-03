const { google } = require('googleapis');
const http = require('http');
const { shell } = require('electron');
const { URL } = require('url');
const oauthConfig = require('./oauth-config');

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
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    include_granted_scopes: true,
  });

  const codePromise = startCallbackServer();
  shell.openExternal(url);

  const code = await codePromise;
  const { tokens } = await oauth2Client.getToken(code);

  oauth2Client.setCredentials(tokens);
  // Identifica a conta pelo próprio Gmail: o escopo https://mail.google.com/
  // não cobre o endpoint de userinfo (exigiria openid/email), mas cobre getProfile.
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const { data: profile } = await gmail.users.getProfile({ userId: 'me' });

  return {
    id: `google-${profile.emailAddress}`,
    provider: 'google',
    email: profile.emailAddress,
    name: profile.emailAddress,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
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
