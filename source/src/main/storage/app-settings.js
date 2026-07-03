const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Preferências locais do app (ex.: aceite dos Termos de Uso).
const SETTINGS_FILE = 'settings.json';

function getSettingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

function getSettings() {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'));
  } catch {
    return {};
  }
}

function saveSettings(patch) {
  const settings = { ...getSettings(), ...patch };
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
  return settings;
}

module.exports = { getSettings, saveSettings };
