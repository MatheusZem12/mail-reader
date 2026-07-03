const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

// Cache local de e-mails para evitar requests repetidos às APIs.
// Estrutura: { folders: { inbox: { syncedAt, emails }, trash: {...} }, bodies: { id: detail } }
// Tudo criptografado com safeStorage (mesmo padrão do account-store).
const CACHE_FILE = 'email-cache.bin';

// v2: linhas por conversa/thread (Gmail Threads API, Outlook agrupado por
// conversationId) em vez de por mensagem individual — os ids mudaram de
// formato, então um cache da versão anterior precisa ser descartado.
// v3: total do Gmail trocou de labels.get().threadsTotal (impreciso pra
// labels de sistema) para resultSizeEstimate de threads.list — descarta pra
// não mostrar o total antigo (inflado) até o próximo refresh automático.
// v4: resultSizeEstimate também é só uma ESTIMATIVA (varia a cada chamada,
// mesmo sem mutações) — trocado por contagem exata (percorre todas as páginas
// de ids). Descarta o total antigo, instável, guardado em cache.
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
    // Formato antigo (sem pastas, ou de uma versão de schema anterior): descarta, será ressincronizado
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
  // Cache salvo antes de hasMore/total existirem: assume que pode ter mais e
  // usa a quantidade carregada como total (melhor do que não mostrar nada).
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

  // Poda corpos de e-mails que não estão em nenhuma pasta, para o arquivo não crescer sem limite.
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

// Move os resumos entre pastas do cache (ex.: excluir = inbox → trash),
// mantendo a troca de aba instantânea sem novo request.
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

// Esvazia uma pasta inteira do cache local (usado depois de "esvaziar lixeira").
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
