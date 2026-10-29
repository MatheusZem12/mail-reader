// OAuth configuration — fully set by the USER, nothing embedded in the code.
//
// On first use the app opens the "Set up OAuth" screen with a tutorial;
// the user creates the OAuth apps on Google/Azure, pastes the codes into the fields
// and the app writes it all to the machine's local .env (src/main/storage/env-store.js).
//
// We read process.env on every call (not once at boot) so that saving the
// configuration from the screen applies at once, without restarting the app.

const KEYS = {
  google: {
    clientId: 'MAIL_READER_GOOGLE_CLIENT_ID',
    clientSecret: 'MAIL_READER_GOOGLE_CLIENT_SECRET',
  },
  microsoft: {
    clientId: 'MAIL_READER_MICROSOFT_CLIENT_ID',
  },
};

function readEnv(key) {
  return key ? (process.env[key] || '').trim() : '';
}

function getClientId(provider) {
  return readEnv(KEYS[provider]?.clientId);
}

function getClientSecret(provider) {
  return readEnv(KEYS[provider]?.clientSecret);
}

function isConfigured(provider) {
  if (provider === 'google') {
    // Google requires ID + secret in the token exchange for Desktop apps
    return Boolean(getClientId('google') && getClientSecret('google'));
  }
  return Boolean(getClientId(provider));
}

function getStatus() {
  return {
    google: isConfigured('google'),
    microsoft: isConfigured('microsoft'),
  };
}

module.exports = { getClientId, getClientSecret, isConfigured, getStatus };
