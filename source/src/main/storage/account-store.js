const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const ACCOUNTS_FILE = 'accounts.json';

function getAccountsPath() {
  return path.join(app.getPath('userData'), ACCOUNTS_FILE);
}

function readFile() {
  const filePath = getAccountsPath();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeFile(accounts) {
  const filePath = getAccountsPath();
  fs.writeFileSync(filePath, JSON.stringify(accounts, null, 2));
}

function encrypt(text) {
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(text).toString('base64');
  }
  return safeStorage.encryptString(text).toString('base64');
}

function decrypt(encrypted) {
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(encrypted, 'base64').toString('utf-8');
  }
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
}

function getAccounts() {
  const accounts = readFile();
  return accounts.map((account) => ({
    id: account.id,
    provider: account.provider,
    email: account.email,
    name: account.name,
    createdAt: account.createdAt,
  }));
}

function getAccountWithToken(id) {
  const accounts = readFile();
  const account = accounts.find((a) => a.id === id);
  if (!account) return null;
  return {
    ...account,
    accessToken: decrypt(account.accessToken),
    refreshToken: account.refreshToken ? decrypt(account.refreshToken) : undefined,
    msalAccount: account.msalAccount ? JSON.parse(decrypt(account.msalAccount)) : undefined,
  };
}

function addAccount(account) {
  // Reconectar a mesma conta substitui a entrada antiga em vez de duplicar.
  const accounts = readFile().filter((a) => a.id !== account.id);
  const newAccount = {
    id: account.id,
    provider: account.provider,
    email: account.email,
    name: account.name,
    accessToken: encrypt(account.accessToken),
    refreshToken: account.refreshToken ? encrypt(account.refreshToken) : undefined,
    expiresAt: account.expiresAt,
    createdAt: Date.now(),
  };
  if (account.msalAccount) {
    newAccount.msalAccount = encrypt(JSON.stringify(account.msalAccount));
  }
  accounts.push(newAccount);
  writeFile(accounts);
}

function removeAccount(id) {
  const accounts = readFile().filter((a) => a.id !== id);
  writeFile(accounts);
}

function updateTokens(id, accessToken, expiresAt, msalAccount) {
  const accounts = readFile();
  const index = accounts.findIndex((a) => a.id === id);
  if (index === -1) return;
  accounts[index].accessToken = encrypt(accessToken);
  accounts[index].expiresAt = expiresAt;
  if (msalAccount) {
    accounts[index].msalAccount = encrypt(JSON.stringify(msalAccount));
  }
  writeFile(accounts);
}

module.exports = {
  getAccounts,
  getAccountWithToken,
  addAccount,
  removeAccount,
  updateTokens,
};
