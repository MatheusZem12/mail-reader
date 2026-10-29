const { app, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const googleAuth = require('./auth/google-auth');
const microsoftAuth = require('./auth/microsoft-auth');
const accountStore = require('./storage/account-store');
const oauthConfig = require('./auth/oauth-config');
const envStore = require('./storage/env-store');
const appSettings = require('./storage/app-settings');
const automationStore = require('./storage/automation-store');
const emailService = require('./email-service');

// Bump when TERMS-OF-USE.md changes: it forces a new acceptance.
const TERMS_VERSION = 2;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_DEFAULT = 1;

function clampZoom(value) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

function registerIpcHandlers() {
  ipcMain.handle('get-body-zoom', () => {
    const settings = appSettings.getSettings();
    return clampZoom(settings.bodyZoom ?? ZOOM_DEFAULT);
  });

  ipcMain.handle('set-body-zoom', (_event, value) => {
    const zoom = clampZoom(Number(value) || ZOOM_DEFAULT);
    appSettings.saveSettings({ bodyZoom: zoom });
    return zoom;
  });
  ipcMain.handle('get-terms', () => {
    const settings = appSettings.getSettings();
    let text = 'Terms of Use not found (TERMS-OF-USE.md).';
    try {
      // TERMS-OF-USE.md lives at the project root; app.getAppPath() points to
      // source/ (where package.json is), one level below the root.
      text = fs.readFileSync(path.join(app.getAppPath(), '..', 'TERMS-OF-USE.md'), 'utf-8');
    } catch {}
    return {
      accepted: (settings.termsAcceptedVersion || 0) >= TERMS_VERSION,
      version: TERMS_VERSION,
      text,
    };
  });

  ipcMain.handle('accept-terms', () => {
    appSettings.saveSettings({
      termsAcceptedVersion: TERMS_VERSION,
      termsAcceptedAt: new Date().toISOString(),
    });
  });

  ipcMain.handle('decline-terms', () => {
    // Declined the terms: the app can't be used.
    app.quit();
  });

  ipcMain.handle('get-oauth-status', () => {
    return oauthConfig.getStatus();
  });

  ipcMain.handle('get-oauth-config', () => {
    return envStore.getConfig();
  });

  ipcMain.handle('save-oauth-config', (_event, config) => {
    envStore.saveConfig(config || {});
    return oauthConfig.getStatus();
  });

  ipcMain.handle('open-external', (_event, url) => {
    // Only opens http(s) links — avoids opening arbitrary schemes (file:, etc).
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      return shell.openExternal(url);
    }
  });

  ipcMain.handle('get-accounts', () => {
    return accountStore.getAccounts();
  });

  ipcMain.handle('remove-account', (_event, id) => {
    accountStore.removeAccount(id);
  });

  ipcMain.handle('auth-google', async () => {
    try {
      const account = await googleAuth.startAuthFlow();
      accountStore.addAccount(account);
      return { success: true, account: { id: account.id, email: account.email, provider: account.provider, name: account.name } };
    } catch (err) {
      throw new Error(err.message || 'Error signing in with Google');
    }
  });

  ipcMain.handle('auth-microsoft', async () => {
    try {
      const account = await microsoftAuth.startAuthFlow();
      accountStore.addAccount(account);
      return { success: true, account: { id: account.id, email: account.email, provider: account.provider, name: account.name } };
    } catch (err) {
      throw new Error(err.message || 'Error signing in with Microsoft');
    }
  });

  ipcMain.handle('list-emails', async (_event, options) => {
    try {
      return await emailService.listEmails(options);
    } catch (err) {
      throw new Error(err.message || 'Error listing e-mails');
    }
  });

  ipcMain.handle('list-domains', async (_event, options) => {
    try {
      return await emailService.listDomains(options);
    } catch (err) {
      throw new Error(err.message || 'Error listing domains');
    }
  });

  ipcMain.handle('get-email', async (_event, emailId) => {
    try {
      return await emailService.getEmail(emailId);
    } catch (err) {
      throw new Error(err.message || 'Error loading the e-mail');
    }
  });

  ipcMain.handle('delete-email', async (_event, emailId, options) => {
    try {
      await emailService.deleteEmail(emailId, options);
      return { success: true };
    } catch (err) {
      throw new Error(err.message || 'Error deleting the e-mail');
    }
  });

  ipcMain.handle('restore-email', async (_event, emailId, options) => {
    try {
      await emailService.restoreEmail(emailId, options);
      return { success: true };
    } catch (err) {
      throw new Error(err.message || 'Error restoring the e-mail');
    }
  });

  ipcMain.handle('empty-trash', async () => {
    try {
      await emailService.emptyTrash();
      return { success: true };
    } catch (err) {
      throw new Error(err.message || 'Error emptying the trash');
    }
  });

  ipcMain.handle('get-automation-rules', () => {
    return automationStore.getRules();
  });

  ipcMain.handle('save-automation-rule', (_event, rule) => {
    return automationStore.saveRule(rule || {});
  });

  ipcMain.handle('delete-automation-rule', (_event, id) => {
    return automationStore.deleteRule(id);
  });
}

module.exports = { registerIpcHandlers };
