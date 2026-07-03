// Configuração OAuth — totalmente definida pelo USUÁRIO, nada embutido no código.
//
// No primeiro acesso o app abre a tela "Configurar OAuth" com um tutorial;
// o usuário cria os apps OAuth no Google/Azure, cola os códigos nos campos e o
// app grava tudo no .env local da máquina (src/main/storage/env-store.js).
//
// Lemos process.env a cada chamada (e não uma vez no boot) para que salvar a
// configuração pela tela valha imediatamente, sem reiniciar o app.

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
    // O Google exige ID + secret na troca do token para apps Desktop
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
