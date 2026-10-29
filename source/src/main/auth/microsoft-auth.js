const { PublicClientApplication } = require('@azure/msal-node');
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
const { URL } = require('url');
const oauthConfig = require('./oauth-config');

const REDIRECT_PORT = 42814;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;
const SCOPES = ['Mail.ReadWrite', 'User.Read', 'offline_access'];

function getClient() {
  const clientId = oauthConfig.getClientId('microsoft');
  if (!clientId) {
    throw new Error(
      'Microsoft OAuth is not configured. Set MAIL_READER_MICROSOFT_CLIENT_ID in the .env file (see the README).'
    );
  }
  return new PublicClientApplication({
    auth: {
      clientId,
      authority: 'https://login.microsoftonline.com/common',
    },
  });
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
      console.log('Waiting for the Microsoft callback on port', REDIRECT_PORT);
    });

    server.on('error', reject);
  });
}

async function startAuthFlow() {
  const clientApp = getClient();
  const { verifier, challenge } = generatePkce();

  const authCodeUrl = await clientApp.getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: REDIRECT_URI,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    prompt: 'consent',
  });

  const codePromise = startCallbackServer();
  shell.openExternal(authCodeUrl);

  const { code } = await codePromise;

  const tokenResponse = await clientApp.acquireTokenByCode({
    code,
    scopes: SCOPES,
    redirectUri: REDIRECT_URI,
    codeVerifier: verifier,
  });

  return {
    id: `microsoft-${tokenResponse.account.homeAccountId}`,
    provider: 'microsoft',
    email: tokenResponse.account.username,
    name: tokenResponse.account.name || tokenResponse.account.username,
    accessToken: tokenResponse.accessToken,
    refreshToken: undefined,
    expiresAt: tokenResponse.expiresOn.getTime(),
    msalAccount: tokenResponse.account,
  };
}

async function refreshAccessToken(account) {
  const clientApp = getClient();
  const result = await clientApp.acquireTokenSilent({
    account,
    scopes: SCOPES,
  });

  return {
    accessToken: result.accessToken,
    expiresAt: result.expiresOn.getTime(),
    account: result.account,
  };
}

function generatePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function graphRequest(pathOrUrl, accessToken, options = {}) {
  // Later pages come as a full URL in @odata.nextLink; the first
  // call uses a relative path.
  const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `https://graph.microsoft.com/v1.0${pathOrUrl}`;
  // Merges headers instead of letting options.headers replace the whole object
  // (otherwise an Authorization sent by mistake in options would wipe the token).
  const { headers: extraHeaders, ...restOptions } = options;
  const response = await fetch(url, {
    ...restOptions,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Graph API error ${response.status}: ${text}`);
  }
  return response.json();
}

module.exports = {
  startAuthFlow,
  refreshAccessToken,
  graphRequest,
};
