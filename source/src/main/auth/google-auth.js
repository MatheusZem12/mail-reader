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
      'Google OAuth is not configured. Set MAIL_READER_GOOGLE_CLIENT_ID in the .env file (see the README).'
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
        res.end('<h1>Authorization complete!</h1><p>You can close this window.</p>');
        server.close(() => resolve(code));
      } else {
        res.end(`<h1>Authorization error</h1><p>${error || 'Unknown'}</p>`);
        server.close(() => reject(new Error(error || 'Authorization denied')));
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log('Waiting for the OAuth callback on port', REDIRECT_PORT);
    });

    server.on('error', reject);
  });
}

async function startAuthFlow() {
  const oauth2Client = getClient();

  // Only forces full consent if we don't have a refresh token yet.
  // Asking for consent every time generates a new refresh token and can invalidate
  // the previous one, besides being unnecessary to reconnect an already authorized account.
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
  // Identifies the account through Gmail itself: the https://mail.google.com/ scope
  // doesn't cover the userinfo endpoint (it would need openid/email), but it covers getProfile.
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const { data: profile } = await gmail.users.getProfile({ userId: 'me' });

  const accountId = `google-${profile.emailAddress}`;
  const existingAccount = accountStore.getAccountWithToken(accountId);

  // If no refresh token came and we have none saved, we must force consent.
  if (!tokens.refresh_token && !existingAccount?.refreshToken) {
    throw new Error(
      'Google returned no refresh token. Remove the account and connect it again with full consent.'
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
