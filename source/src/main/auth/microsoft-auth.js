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
      'Microsoft OAuth não configurado. Defina MAIL_READER_MICROSOFT_CLIENT_ID no arquivo .env (veja o README).'
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
        res.end('<h1>Autorização concluída!</h1><p>Você pode fechar esta janela.</p>');
        server.close(() => resolve(code));
      } else {
        res.end(`<h1>Erro na autorização</h1><p>${error || 'Desconhecido'}</p>`);
        server.close(() => reject(new Error(error || 'Autorização negada')));
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log('Aguardando callback Microsoft na porta', REDIRECT_PORT);
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
  // Páginas seguintes vêm como URL completa em @odata.nextLink; a primeira
  // chamada usa um path relativo.
  const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `https://graph.microsoft.com/v1.0${pathOrUrl}`;
  // Mescla headers em vez de deixar options.headers substituir o objeto todo
  // (senão um Authorization mandado por engano em options apagaria o token).
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
