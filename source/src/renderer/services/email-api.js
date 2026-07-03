export async function getTerms() {
  return window.electronAPI.getTerms();
}

export async function acceptTerms() {
  return window.electronAPI.acceptTerms();
}

export async function declineTerms() {
  return window.electronAPI.declineTerms();
}

export async function getOAuthStatus() {
  return window.electronAPI.getOAuthStatus();
}

export async function getOAuthConfig() {
  return window.electronAPI.getOAuthConfig();
}

export async function saveOAuthConfig(config) {
  return window.electronAPI.saveOAuthConfig(config);
}

export function openExternal(url) {
  return window.electronAPI.openExternal(url);
}

export async function getAccounts() {
  return window.electronAPI.getAccounts();
}

export async function removeAccount(id) {
  return window.electronAPI.removeAccount(id);
}

export async function authGoogle() {
  return window.electronAPI.authGoogle();
}

export async function authMicrosoft() {
  return window.electronAPI.authMicrosoft();
}

export async function listEmails(options = {}) {
  return window.electronAPI.listEmails(options);
}

export async function listDomains(options = {}) {
  return window.electronAPI.listDomains(options);
}

export async function getEmail(emailId) {
  return window.electronAPI.getEmail(emailId);
}

export async function deleteEmail(emailId, options = {}) {
  return window.electronAPI.deleteEmail(emailId, options);
}

export async function restoreEmail(emailId, options = {}) {
  return window.electronAPI.restoreEmail(emailId, options);
}

export async function emptyTrash() {
  return window.electronAPI.emptyTrash();
}

export async function getBodyZoom() {
  return window.electronAPI.getBodyZoom();
}

export async function setBodyZoom(value) {
  return window.electronAPI.setBodyZoom(value);
}

export function onZoomChange(callback) {
  return window.electronAPI.onZoomChange(callback);
}
