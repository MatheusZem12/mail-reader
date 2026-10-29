const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

// A local e-mail cache to avoid repeated API requests.
// Estrutura: { folders: { inbox: { syncedAt, emails }, trash: {...} }, bodies: { id: detail } }
// Everything encrypted with safeStorage (the same pattern as account-store).
const CACHE_FILE = 'email-cache.bin';

// v2: linhas por conversa/thread (Gmail Threads API, Outlook agrupado por
// conversationId) instead of per individual message — the ids changed
// format, so a cache from the previous version must be dropped.
// v3: Gmail's total moved from labels.get().threadsTotal (inaccurate for
// system labels) to threads.list's resultSizeEstimate — dropped so the old
// (inflated) total doesn't show until the next automatic refresh.
// v4: resultSizeEstimate is also just an ESTIMATE (it varies on every call,
// even without mutations) — replaced by an exact count (it walks every page
// of ids). Drops the old, unstable cached total.
const SCHEMA_VERSION = 4;

function getCachePath() {
  return path.join(app.getPath('userData'), CACHE_FILE);
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

function readCache() {
  const filePath = getCachePath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const cache = JSON.parse(decrypt(fs.readFileSync(filePath, 'utf-8')));
    // Old format (no folders, or from an earlier schema version): dropped, it will be resynced
    if (!cache.folders) return null;
    if (cache.schemaVersion !== SCHEMA_VERSION) return null;
    return cache;
  } catch {
    return null;
  }
}

function writeCache(cache) {
  fs.writeFileSync(getCachePath(), encrypt(JSON.stringify(cache)));
}

function emptyCache() {
  return { schemaVersion: SCHEMA_VERSION, folders: {}, bodies: {} };
}

function getList(folder) {
  const entry = readCache()?.folders?.[folder];
  if (!entry || !Array.isArray(entry.emails)) return null;
  // A cache saved before hasMore/total existed: assumes there may be more and
  // uses the loaded count as the total (better than showing nothing).
  return {
    emails: entry.emails,
    syncedAt: entry.syncedAt || 0,
    hasMore: entry.hasMore ?? true,
    total: entry.total ?? entry.emails.length,
  };
}

function saveList(folder, emails, hasMore = true, total = null) {
  const cache = readCache() || emptyCache();
  cache.folders[folder] = { syncedAt: Date.now(), emails, hasMore, total: total ?? emails.length };

  // Prunes bodies of e-mails that aren't in any folder, so the file doesn't grow without limit.
  const validIds = new Set(
    Object.values(cache.folders).flatMap((entry) => (entry.emails || []).map((e) => e.id))
  );
  const bodies = {};
  for (const [id, body] of Object.entries(cache.bodies || {})) {
    if (validIds.has(id)) bodies[id] = body;
  }
  cache.bodies = bodies;

  writeCache(cache);
}

function getBody(emailId) {
  const cache = readCache();
  return cache?.bodies?.[emailId] || null;
}

function saveBody(emailId, detail) {
  const cache = readCache() || emptyCache();
  cache.bodies = cache.bodies || {};
  cache.bodies[emailId] = detail;
  writeCache(cache);
}

// Moves the summaries between cache folders (e.g. delete = inbox → trash),
// keeping tab switches instant without a new request.
function moveEmails(ids, fromFolder, toFolder) {
  const cache = readCache();
  if (!cache) return;
  const toMove = new Set(ids);

  const from = cache.folders[fromFolder];
  const moved = [];
  if (from && Array.isArray(from.emails)) {
    from.emails = from.emails.filter((e) => {
      if (toMove.has(e.id)) {
        moved.push(e);
        return false;
      }
      return true;
    });
  }

  const to = cache.folders[toFolder];
  if (to && Array.isArray(to.emails) && moved.length > 0) {
    to.emails = [...moved, ...to.emails].sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  writeCache(cache);
}

function removeEmails(ids) {
  const cache = readCache();
  if (!cache) return;
  const toRemove = new Set(ids);
  for (const entry of Object.values(cache.folders)) {
    if (Array.isArray(entry.emails)) {
      entry.emails = entry.emails.filter((e) => !toRemove.has(e.id));
    }
  }
  cache.bodies = cache.bodies || {};
  for (const id of toRemove) delete cache.bodies[id];
  writeCache(cache);
}

// Empties a whole folder of the local cache (used after "empty trash").
function clearFolder(folder) {
  const cache = readCache();
  if (!cache) return;
  const removedIds = (cache.folders[folder]?.emails || []).map((e) => e.id);
  cache.folders[folder] = { syncedAt: Date.now(), emails: [], hasMore: false, total: 0 };
  cache.bodies = cache.bodies || {};
  for (const id of removedIds) delete cache.bodies[id];
  writeCache(cache);
}

module.exports = {
  getList,
  saveList,
  getBody,
  saveBody,
  moveEmails,
  removeEmails,
  clearFolder,
};
