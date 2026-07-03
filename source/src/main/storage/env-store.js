const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Grava a configuração OAuth do usuário no arquivo .env local da máquina.
// O usuário cola os Client IDs pela tela de configuração do app e este módulo
// persiste tudo localmente — nada é embutido no código nem enviado a servidor.
// Para usar em outro computador, basta copiar o .env (ou colar os códigos de novo).

const KEYS = {
  googleClientId: 'MAIL_READER_GOOGLE_CLIENT_ID',
  googleClientSecret: 'MAIL_READER_GOOGLE_CLIENT_SECRET',
  microsoftClientId: 'MAIL_READER_MICROSOFT_CLIENT_ID',
};

const HEADER = [
  '# Configuração OAuth do Mail Reader — gerado pelo próprio app.',
  '# Este arquivo é local da sua máquina e está no .gitignore (nunca commite).',
  '# Para usar em outro computador, copie este arquivo para lá.',
];

function getEnvPath() {
  return path.join(app.getAppPath(), '.env');
}

function getConfig() {
  const config = {};
  for (const [field, key] of Object.entries(KEYS)) {
    config[field] = (process.env[key] || '').trim();
  }
  return config;
}

function saveConfig(config) {
  const envPath = getEnvPath();
  let lines = [];
  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  } else {
    lines = [...HEADER, ''];
  }

  for (const [field, key] of Object.entries(KEYS)) {
    if (!(field in config)) continue;
    const value = String(config[field] || '').trim();
    process.env[key] = value; // vale imediatamente, sem reiniciar o app

    const newLine = `${key}=${value}`;
    const index = lines.findIndex((line) => line.trim().startsWith(`${key}=`));
    if (index >= 0) {
      lines[index] = newLine;
    } else {
      if (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
      lines.push(newLine, '');
    }
  }

  fs.writeFileSync(envPath, lines.join('\n').replace(/\n*$/, '\n'));
}

module.exports = { getConfig, saveConfig };
