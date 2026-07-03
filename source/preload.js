const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getTerms: () => ipcRenderer.invoke('get-terms'),
  acceptTerms: () => ipcRenderer.invoke('accept-terms'),
  declineTerms: () => ipcRenderer.invoke('decline-terms'),
  getOAuthStatus: () => ipcRenderer.invoke('get-oauth-status'),
  getOAuthConfig: () => ipcRenderer.invoke('get-oauth-config'),
  saveOAuthConfig: (config) => ipcRenderer.invoke('save-oauth-config', config),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  removeAccount: (id) => ipcRenderer.invoke('remove-account', id),
  authGoogle: () => ipcRenderer.invoke('auth-google'),
  authMicrosoft: () => ipcRenderer.invoke('auth-microsoft'),
  listEmails: (options) => ipcRenderer.invoke('list-emails', options),
  listDomains: (options) => ipcRenderer.invoke('list-domains', options),
  getEmail: (emailId) => ipcRenderer.invoke('get-email', emailId),
  deleteEmail: (emailId, options) => ipcRenderer.invoke('delete-email', emailId, options),
  restoreEmail: (emailId, options) => ipcRenderer.invoke('restore-email', emailId, options),
  emptyTrash: () => ipcRenderer.invoke('empty-trash'),
  getBodyZoom: () => ipcRenderer.invoke('get-body-zoom'),
  setBodyZoom: (value) => ipcRenderer.invoke('set-body-zoom', value),
  onZoomChange: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on('zoom-change', handler);
    return () => ipcRenderer.removeListener('zoom-change', handler);
  },
});
