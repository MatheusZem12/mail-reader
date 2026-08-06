const { getGmailClient } = require('./auth/google-auth');
const { graphRequest } = require('./auth/microsoft-auth');
const accountStore = require('./storage/account-store');
const emailCache = require('./storage/email-cache');

const PAGE_SIZE = 50;

// Pastas de e-mail (as que listam mensagens de verdade) e como cada provedor
// as chama. "Domínios" e "Automatizador" não entram aqui: são telas próprias.
const GMAIL_FOLDER_QUERY = {
  inbox: 'in:inbox',
  spam: 'in:spam',
  trash: 'in:trash',
};

const GRAPH_FOLDER = {
  inbox: 'inbox',
  spam: 'junkemail',
  trash: 'deleteditems',
};

// Limite de chamadas simultâneas à API por conta. Buscar metadados de uma
// página inteira (até 50 mensagens) de uma vez só derrubava com "Too many
// concurrent requests for user" — a API não aguenta tanta coisa em paralelo.
const API_CONCURRENCY = 5;

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Sessão de listagem por conta+pasta+busca+período+ordem: guarda a lista
// COMPLETA de ids (threadId no Gmail, conversationId no Outlook) já na ordem
// certa de exibição, montada uma vez (barato: só ids, sem metadados), e cada
// "carregar mais" apenas avança um offset sobre essa lista, buscando os
// metadados completos (caro) só da fatia pedida. Vive só na memória do
// processo — não persiste entre reinícios do app.
const pageCursors = new Map();

function buildCursorKey(accountId, filters) {
  const { folder = 'inbox', query = '', dateFrom = '', dateTo = '', sortOrder = 'desc' } = filters;
  return `${accountId}:${folder}:${query}:${dateFrom}:${dateTo}:${sortOrder}`;
}

async function listEmails(options = {}) {
  const {
    refresh = false,
    folder = 'inbox',
    loadMore = false,
    query = '',
    dateFrom = '',
    dateTo = '',
    sortOrder = 'desc',
    currentEmails = [],
  } = options;
  const filters = { folder, query, dateFrom, dateTo, sortOrder };
  // Qualquer filtro fora do padrão (busca, período ou ordem invertida) sempre
  // vai ao servidor — o cache local de pastas só serve pra listagem cronológica
  // padrão (mais recentes primeiro, sem filtro nenhum).
  const isDefaultView = !query && !dateFrom && !dateTo && sortOrder === 'desc';

  if (loadMore) {
    return loadMoreEmails(filters, currentEmails);
  }

  if (isDefaultView && !refresh) {
    const cached = emailCache.getList(folder);
    if (cached && cached.emails.length > 0) {
      return { emails: cached.emails, syncedAt: cached.syncedAt, fromCache: true, errors: [], hasMore: cached.hasMore, total: cached.total };
    }
  }

  const accounts = accountStore.getAccounts();
  if (accounts.length === 0) {
    return { emails: [], syncedAt: Date.now(), fromCache: false, errors: [], hasMore: false, total: isDefaultView ? 0 : null };
  }

  // Busca todas as contas em paralelo (primeira página); falha em uma conta não derruba as outras.
  const errors = [];
  const results = await Promise.all(
    accounts.map(async (account) => {
      try {
        const accountWithToken = await getValidAccount(account.id);
        if (!accountWithToken) {
          errors.push(`${account.email}: sessão expirada, reconecte a conta`);
          return { emails: [], hasMore: false, total: null };
        }
        return await listEmailsForAccount(accountWithToken, filters, false);
      } catch (err) {
        errors.push(`${account.email}: ${err.message || 'erro desconhecido'}`);
        return { emails: [], hasMore: false, total: null };
      }
    })
  );

  const allEmails = dedupeAndSort(results.flatMap((r) => r.emails), sortOrder);
  const hasMore = results.some((r) => r.hasMore);
  const total = combineTotals(results);

  if (allEmails.length === 0 && errors.length === accounts.length && errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  // Com qualquer filtro fora do padrão, não faz sentido guardar no cache de
  // pastas (que é só para a listagem cronológica normal).
  if (!isDefaultView) {
    return { emails: allEmails, syncedAt: Date.now(), fromCache: false, errors, hasMore, total };
  }

  emailCache.saveList(folder, allEmails, hasMore, total);
  return { emails: allEmails, syncedAt: Date.now(), fromCache: false, errors, hasMore, total };
}

// Soma o total entre contas; se nenhuma conta conseguiu informar um total,
// devolve null (para a UI mostrar só a contagem carregada, sem "de Y").
function combineTotals(results) {
  if (results.every((r) => r.total == null)) return null;
  return results.reduce((sum, r) => sum + (r.total || 0), 0);
}

// Busca a próxima página (por conta) usando a sessão já montada. Na listagem
// padrão, mescla com o que está no cache local; com qualquer filtro ativo,
// mescla com o que o renderer já tinha carregado (currentEmails).
async function loadMoreEmails(filters, currentEmails) {
  const accounts = accountStore.getAccounts();
  const errors = [];
  const isDefaultView = !filters.query && !filters.dateFrom && !filters.dateTo && filters.sortOrder === 'desc';

  const results = await Promise.all(
    accounts.map(async (account) => {
      try {
        const accountWithToken = await getValidAccount(account.id);
        if (!accountWithToken) return { emails: [], hasMore: false, total: null };
        return await listEmailsForAccount(accountWithToken, filters, true);
      } catch (err) {
        errors.push(`${account.email}: ${err.message || 'erro desconhecido'}`);
        return { emails: [], hasMore: false, total: null };
      }
    })
  );

  const newEmails = results.flatMap((r) => r.emails);
  const hasMore = results.some((r) => r.hasMore);
  const total = combineTotals(results);

  if (!isDefaultView) {
    const merged = dedupeAndSort([...(currentEmails || []), ...newEmails], filters.sortOrder);
    return { emails: merged, syncedAt: Date.now(), fromCache: false, errors, hasMore, total };
  }

  const existing = emailCache.getList(filters.folder)?.emails || [];
  const merged = dedupeAndSort([...existing, ...newEmails], filters.sortOrder);

  emailCache.saveList(filters.folder, merged, hasMore, total);
  return { emails: merged, syncedAt: Date.now(), fromCache: false, errors, hasMore, total };
}

function dedupeAndSort(emails, sortOrder = 'desc') {
  const byId = new Map(emails.map((e) => [e.id, e]));
  const list = [...byId.values()];
  list.sort((a, b) => {
    const diff = new Date(a.date) - new Date(b.date);
    return sortOrder === 'asc' ? diff : -diff;
  });
  return list;
}

// Gmail: "before:" é exclusivo, por isso soma 1 dia à data final pra incluí-la.
function addOneDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function buildGmailDateQuery(dateFrom, dateTo) {
  const parts = [];
  if (dateFrom) parts.push(`after:${dateFrom.replace(/-/g, '/')}`);
  if (dateTo) parts.push(`before:${addOneDay(dateTo).replace(/-/g, '/')}`);
  return parts.join(' ');
}

function buildGraphDateFilter(dateFrom, dateTo) {
  const parts = [];
  if (dateFrom) parts.push(`receivedDateTime ge ${dateFrom}T00:00:00Z`);
  if (dateTo) parts.push(`receivedDateTime lt ${addOneDay(dateTo)}T00:00:00Z`);
  return parts.join(' and ');
}

async function listEmailsForAccount(account, filters, more) {
  const cursorKey = buildCursorKey(account.id, filters);

  // Primeira página da sessão: monta a lista completa de ids (na ordem certa)
  // do zero. Isso já nos dá de graça um total EXATO (é só o tamanho da lista),
  // em vez de estimativas que o Gmail/Graph dão e que podem variar a cada
  // chamada mesmo sem nada ter mudado.
  if (!more) {
    const ids = await fetchOrderedThreadIds(account, filters);
    pageCursors.set(cursorKey, { ids, offset: 0, total: ids.length });
  }

  const session = pageCursors.get(cursorKey);
  if (!session) return { emails: [], hasMore: false, total: null };

  const pageIds = session.ids.slice(session.offset, session.offset + PAGE_SIZE);
  const nextOffset = session.offset + pageIds.length;
  pageCursors.set(cursorKey, { ...session, offset: nextOffset });

  if (pageIds.length === 0) return { emails: [], hasMore: false, total: session.total };

  if (account.provider === 'google') {
    const gmail = getGmailClient(account.accessToken);
    // Metadados buscados em paralelo, mas com limite de concorrência (sequencial
    // levava ~20x mais tempo; sem limite, a API rejeitava com "too many concurrent requests").
    const details = await mapWithConcurrency(pageIds, API_CONCURRENCY, (threadId) =>
      gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'To', 'Date'],
      })
    );
    return {
      emails: details.map((detail) => mapGmailThread(detail.data, account)),
      hasMore: nextOffset < session.total,
      total: session.total,
    };
  }

  if (account.provider === 'microsoft') {
    const threadRows = await mapWithConcurrency(pageIds, API_CONCURRENCY, (conversationId) =>
      fetchOutlookThreadSummary(conversationId, account)
    );
    return { emails: threadRows, hasMore: nextOffset < session.total, total: session.total };
  }

  return { emails: [], hasMore: false, total: null };
}

async function fetchOrderedThreadIds(account, filters) {
  if (account.provider === 'google') return fetchOrderedGmailThreadIds(account, filters);
  if (account.provider === 'microsoft') return fetchOrderedOutlookConversationIds(account, filters);
  return [];
}

// Coleta TODOS os ids de conversa que batem com o filtro (só o id, sem
// metadados — barato mesmo pra caixas com milhares de e-mails). O Gmail
// sempre devolve na ordem mais recente → mais antiga; pra "mais antigos
// primeiro" só precisamos inverter essa lista já coletada (o Gmail não tem
// como pedir a ordem invertida direto na API).
async function fetchOrderedGmailThreadIds(account, { folder, query, dateFrom, dateTo, sortOrder }) {
  const gmail = getGmailClient(account.accessToken);
  const folderQuery = GMAIL_FOLDER_QUERY[folder] || GMAIL_FOLDER_QUERY.inbox;
  const dateQuery = buildGmailDateQuery(dateFrom, dateTo);
  const q = [folderQuery, dateQuery, query].filter(Boolean).join(' ');
  // Sem isso o Gmail simplesmente ignora o que está em SPAM/TRASH, e a busca
  // dessas duas pastas volta vazia mesmo com o "in:" certo na query.
  const includeSpamTrash = folder === 'trash' || folder === 'spam';

  const ids = [];
  let pageToken;
  do {
    const res = await gmail.users.threads.list({ userId: 'me', q, includeSpamTrash, maxResults: 500, pageToken });
    ids.push(...(res.data.threads || []).map((t) => t.id));
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return sortOrder === 'asc' ? ids.reverse() : ids;
}

// Equivalente pro Outlook: o Graph não tem uma API de "threads", então
// buscamos id+conversationId+data de TODAS as mensagens que batem com o
// filtro (campos leves, sem corpo) e deduplicamos por conversationId mantendo
// a ordem certa. Sem busca de texto, o próprio Graph já ordena por data
// ($orderby); com busca ($search), o Graph não permite combinar com $orderby
// — nesse caso ordenamos no cliente depois de baixar tudo.
async function fetchOrderedOutlookConversationIds(account, { folder, query, dateFrom, dateTo, sortOrder }) {
  const graphFolder = GRAPH_FOLDER[folder] || GRAPH_FOLDER.inbox;
  const dateFilter = buildGraphDateFilter(dateFrom, dateTo);

  const params = new URLSearchParams();
  params.set('$select', 'id,conversationId,receivedDateTime');
  params.set('$top', '999');
  if (dateFilter) params.set('$filter', dateFilter);
  const requestOptions = {};
  if (query) {
    params.set('$search', `"${query.replace(/"/g, '')}"`);
    requestOptions.headers = { ConsistencyLevel: 'eventual' };
  } else {
    params.set('$orderby', `receivedDateTime ${sortOrder === 'asc' ? 'asc' : 'desc'}`);
  }

  let url = `/me/mailFolders/${graphFolder}/messages?${params.toString()}`;
  const messages = [];
  while (url) {
    const data = await graphRequest(url, account.accessToken, requestOptions);
    messages.push(...(data.value || []));
    url = data['@odata.nextLink'] || null;
  }

  if (query) {
    messages.sort((a, b) => {
      const diff = new Date(a.receivedDateTime) - new Date(b.receivedDateTime);
      return sortOrder === 'asc' ? diff : -diff;
    });
  }

  const seen = new Set();
  const orderedConversationIds = [];
  for (const m of messages) {
    if (!m.conversationId || seen.has(m.conversationId)) continue;
    seen.add(m.conversationId);
    orderedConversationIds.push(m.conversationId);
  }
  return orderedConversationIds;
}

// Mantém o total de uma sessão de listagem já em cache sincronizado com
// exclusões/restaurações, sem precisar recontar no servidor a cada mutação.
// Se não há uma sessão em cache pra esse filtro (ex.: app acabou de abrir),
// não faz nada — a próxima listagem já vai contar certo do zero.
function adjustFolderTotal(accountId, filters, delta) {
  const cursorKey = buildCursorKey(accountId, filters);
  const session = pageCursors.get(cursorKey);
  if (session && session.total != null) {
    pageCursors.set(cursorKey, { ...session, total: Math.max(0, session.total + delta) });
  }
}

// Busca o resumo (sem corpo) de todas as mensagens de uma conversa do Outlook,
// para montar uma linha de listagem agregada (equivalente ao threads.get do Gmail).
async function fetchOutlookThreadSummary(conversationId, account) {
  const messages = await fetchOutlookConversationMessages(
    conversationId,
    account,
    'id,subject,from,receivedDateTime,bodyPreview,isRead'
  );
  return mapMicrosoftThread(messages.map((m) => mapMicrosoftMessage(m, account)), conversationId, account);
}

// Busca todas as mensagens de uma conversa do Outlook (independente de paginação),
// usada tanto para listar quanto para abrir/excluir/restaurar a conversa inteira.
async function fetchOutlookConversationMessages(conversationId, account, select) {
  const filterValue = conversationId.replace(/'/g, "''");
  const url = `/me/messages?$select=${select}&$filter=${encodeURIComponent(`conversationId eq '${filterValue}'`)}&$orderby=receivedDateTime&$top=100`;
  const data = await graphRequest(url, account.accessToken);
  return data.value || [];
}

async function getEmail(emailId) {
  // Corpo já visto fica no cache local — reabrir é instantâneo e sem request.
  // Cache de antes desta versão (por mensagem, sem array `messages`) não bate
  // com o formato atual (por conversa): refaz o fetch.
  const cached = emailCache.getBody(emailId);
  if (cached && Array.isArray(cached.messages)) return cached;

  const email = await fetchThread(emailId);
  emailCache.saveBody(emailId, email);
  return email;
}

// Busca a conversa inteira (todas as mensagens), não só uma mensagem — pra
// exibir tudo empilhado numa mensagem só, como o Gmail faz.
async function fetchThread(emailId) {
  const [provider, accountId, threadKey] = emailId.split('::');
  const account = await getValidAccount(accountId);
  if (!account) throw new Error('Conta não encontrada');

  if (provider === 'google') {
    const gmail = getGmailClient(account.accessToken);
    const res = await gmail.users.threads.get({ userId: 'me', id: threadKey, format: 'full' });
    const messages = (res.data.messages || []).map((msg) => mapGmailMessageDetail(msg, account));
    return buildThreadDetail(emailId, account, messages);
  }

  if (provider === 'microsoft') {
    const messages = await fetchOutlookConversationMessages(
      threadKey,
      account,
      'id,subject,from,toRecipients,receivedDateTime,body,hasAttachments,attachments,isRead'
    );
    return buildThreadDetail(emailId, account, messages.map((msg) => mapMicrosoftMessageDetail(msg, account)));
  }

  throw new Error('Provedor não suportado');
}

function buildThreadDetail(emailId, account, messages) {
  const sorted = [...messages].sort((a, b) => new Date(a.date) - new Date(b.date));
  const last = sorted[sorted.length - 1];
  return {
    id: emailId,
    provider: account.provider,
    accountId: account.id,
    accountEmail: account.email,
    subject: last?.subject || '(sem assunto)',
    messageCount: sorted.length,
    messages: sorted,
  };
}

// Exclusão padrão: move para a lixeira (recuperável). Com { permanent: true },
// apaga de vez (usado na aba Lixeira). Age sobre a conversa inteira — igual ao
// Gmail, onde excluir uma linha da lista joga todas as mensagens dela fora.
async function deleteEmail(emailId, options = {}) {
  const {
    permanent = false,
    folder = permanent ? 'trash' : 'inbox',
    query = '',
    dateFrom = '',
    dateTo = '',
    sortOrder = 'desc',
  } = options;
  const filters = { folder, query, dateFrom, dateTo, sortOrder };
  const [provider, accountId, threadKey] = emailId.split('::');
  const account = await getValidAccount(accountId);
  if (!account) throw new Error('Conta não encontrada');

  if (provider === 'google') {
    const gmail = getGmailClient(account.accessToken);
    if (permanent) {
      await gmail.users.threads.delete({ userId: 'me', id: threadKey });
    } else {
      await gmail.users.threads.trash({ userId: 'me', id: threadKey });
    }
  } else if (provider === 'microsoft') {
    // Sem "delete de conversa" no Graph: buscamos todas as mensagens dessa
    // conversa (não só as já carregadas na tela) e apagamos uma por uma.
    const messageIds = await fetchOutlookConversationMessageIds(threadKey, account);
    await mapWithConcurrency(messageIds, API_CONCURRENCY, (id) =>
      // No Graph, DELETE na inbox move para "Itens Excluídos"; na lixeira, remove de vez.
      graphRequest(`/me/messages/${id}`, account.accessToken, { method: 'DELETE' })
    );
  } else {
    throw new Error('Provedor não suportado');
  }

  if (permanent) {
    emailCache.removeEmails([emailId]);
    adjustFolderTotal(accountId, filters, -1);
  } else {
    // A origem pode ser a caixa de entrada ou o spam — o cache precisa tirar a
    // linha da pasta certa, senão ela continua aparecendo lá até ressincronizar.
    emailCache.moveEmails([emailId], folder, 'trash');
    adjustFolderTotal(accountId, filters, -1);
    adjustFolderTotal(accountId, { ...filters, folder: 'trash' }, +1);
  }
}

// Restaura uma conversa inteira para a caixa de entrada — da lixeira
// ("restaurar") ou do spam ("não é spam").
async function restoreEmail(emailId, options = {}) {
  const { folder = 'trash', query = '', dateFrom = '', dateTo = '', sortOrder = 'desc' } = options;
  const filters = { folder, query, dateFrom, dateTo, sortOrder };
  const [provider, accountId, threadKey] = emailId.split('::');
  const account = await getValidAccount(accountId);
  if (!account) throw new Error('Conta não encontrada');

  if (provider === 'google') {
    const gmail = getGmailClient(account.accessToken);
    if (folder === 'spam') {
      // untrash não serve aqui: sair do spam é tirar a label SPAM (e devolver a
      // INBOX, que a marcação como spam removeu).
      await gmail.users.threads.modify({
        userId: 'me',
        id: threadKey,
        requestBody: { removeLabelIds: ['SPAM'], addLabelIds: ['INBOX'] },
      });
    } else {
      await gmail.users.threads.untrash({ userId: 'me', id: threadKey });
    }
  } else if (provider === 'microsoft') {
    const messageIds = await fetchOutlookConversationMessageIds(threadKey, account);
    await mapWithConcurrency(messageIds, API_CONCURRENCY, (id) =>
      graphRequest(`/me/messages/${id}/move`, account.accessToken, {
        method: 'POST',
        body: JSON.stringify({ destinationId: 'inbox' }),
      })
    );
  } else {
    throw new Error('Provedor não suportado');
  }

  emailCache.moveEmails([emailId], folder, 'inbox');
  adjustFolderTotal(accountId, filters, -1);
  adjustFolderTotal(accountId, { ...filters, folder: 'inbox' }, +1);
}

async function fetchOutlookConversationMessageIds(conversationId, account) {
  const messages = await fetchOutlookConversationMessages(conversationId, account, 'id');
  return messages.map((m) => m.id);
}

// Esvazia a lixeira de todas as contas — apaga PERMANENTEMENTE tudo o que
// estiver lá, não só o que já foi carregado na tela.
async function emptyTrash() {
  const accounts = accountStore.getAccounts();
  const errors = [];

  await Promise.all(
    accounts.map(async (account) => {
      try {
        const accountWithToken = await getValidAccount(account.id);
        if (!accountWithToken) {
          errors.push(`${account.email}: sessão expirada, reconecte a conta`);
          return;
        }
        if (accountWithToken.provider === 'google') await emptyGmailTrash(accountWithToken);
        else if (accountWithToken.provider === 'microsoft') await emptyOutlookTrash(accountWithToken);
      } catch (err) {
        errors.push(`${account.email}: ${err.message || 'erro desconhecido'}`);
      }
    })
  );

  emailCache.clearFolder('trash');
  // Cursores de paginação da lixeira ficariam apontando pra páginas que não
  // existem mais depois do esvaziamento.
  for (const key of [...pageCursors.keys()]) {
    if (/:trash:/.test(key)) pageCursors.delete(key);
  }

  if (errors.length > 0) throw new Error(errors.join('\n'));
}

// Gmail não tem "esvaziar lixeira" num único request: lista todos os ids de
// mensagem em TRASH (paginando) e apaga em lotes de até 1000 via batchDelete
// (bem mais rápido que apagar um por um).
async function emptyGmailTrash(account) {
  const gmail = getGmailClient(account.accessToken);
  const ids = [];
  let pageToken;
  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: 'in:trash',
      includeSpamTrash: true,
      maxResults: 500,
      pageToken,
    });
    ids.push(...(res.data.messages || []).map((m) => m.id));
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  for (let i = 0; i < ids.length; i += 1000) {
    await gmail.users.messages.batchDelete({ userId: 'me', requestBody: { ids: ids.slice(i, i + 1000) } });
  }
}

// Graph não tem uma ação de "esvaziar pasta": lista todos os ids da pasta
// Itens Excluídos (paginando) e apaga um por um (DELETE ali já é definitivo).
async function emptyOutlookTrash(account) {
  const ids = [];
  let url = `/me/mailFolders/deleteditems/messages?$select=id&$top=100`;
  while (url) {
    const data = await graphRequest(url, account.accessToken);
    ids.push(...(data.value || []).map((m) => m.id));
    url = data['@odata.nextLink'] || null;
  }

  await mapWithConcurrency(ids, API_CONCURRENCY, (id) =>
    graphRequest(`/me/messages/${id}`, account.accessToken, { method: 'DELETE' })
  );
}

async function getValidAccount(accountId) {
  const account = accountStore.getAccountWithToken(accountId);
  if (!account) return null;

  const needsRefresh = !account.expiresAt || Date.now() >= account.expiresAt - 60000;
  if (!needsRefresh) return account;

  try {
    if (account.provider === 'google') {
      if (!account.refreshToken) {
        throw new Error('token de atualização ausente, reconecte a conta');
      }
      const { refreshAccessToken } = require('./auth/google-auth');
      const tokens = await refreshAccessToken(account.refreshToken);
      accountStore.updateTokens(account.id, tokens.accessToken, tokens.expiresAt);
      account.accessToken = tokens.accessToken;
      account.expiresAt = tokens.expiresAt;
    } else if (account.provider === 'microsoft') {
      if (!account.msalAccount) {
        throw new Error('sessão do Outlook expirada, reconecte a conta');
      }
      const { refreshAccessToken } = require('./auth/microsoft-auth');
      const tokens = await refreshAccessToken(account.msalAccount);
      accountStore.updateTokens(account.id, tokens.accessToken, tokens.expiresAt, tokens.account);
      account.accessToken = tokens.accessToken;
      account.expiresAt = tokens.expiresAt;
      account.msalAccount = tokens.account;
    }
  } catch (err) {
    console.error('Erro ao renovar token:', err);
    const message = err.message || '';
    if (/invalid_grant|revoked|expired/i.test(message)) {
      throw new Error('autorização revogada ou expirada, reconecte a conta');
    }
    throw new Error(`falha ao renovar sessão: ${message}`);
  }

  return account;
}

// ---------------- Mappers ----------------

function mapGmailMessage(msg, account) {
  const headers = msg.payload?.headers || [];
  const getHeader = (name) => headers.find((h) => h.name === name)?.value || '';

  return {
    id: `google::${account.id}::${msg.id}`,
    accountId: account.id,
    provider: 'google',
    accountEmail: account.email,
    subject: getHeader('Subject') || '(sem assunto)',
    from: parseAddress(getHeader('From')),
    to: parseAddressList(getHeader('To')),
    date: new Date(parseInt(msg.internalDate, 10)).toISOString(),
    // snippet vem como texto puro com entidades HTML (não é base64)
    snippet: decodeHtmlEntities(msg.snippet || ''),
    isRead: !(msg.labelIds || []).includes('UNREAD'),
  };
}

// Constrói a linha de listagem de uma conversa a partir do retorno de
// threads.get(format:'metadata'), que já traz todas as mensagens da thread.
// Usa a última mensagem para assunto/remetente/data/trecho (é o que aparece
// mais recente na conversa) e conta como "não lida" se QUALQUER mensagem
// ainda tiver a label UNREAD — igual ao Gmail deixa a linha em negrito.
function mapGmailThread(threadData, account) {
  const messages = threadData.messages || [];
  const last = messages[messages.length - 1];
  const headers = last?.payload?.headers || [];
  const getHeader = (name) => headers.find((h) => h.name === name)?.value || '';

  return {
    id: `google::${account.id}::${threadData.id}`,
    accountId: account.id,
    provider: 'google',
    accountEmail: account.email,
    subject: getHeader('Subject') || '(sem assunto)',
    from: parseAddress(getHeader('From')),
    date: last ? new Date(parseInt(last.internalDate, 10)).toISOString() : new Date(0).toISOString(),
    snippet: decodeHtmlEntities(last?.snippet || ''),
    isRead: !messages.some((m) => (m.labelIds || []).includes('UNREAD')),
    messageCount: messages.length,
  };
}

function mapGmailMessageDetail(msg, account) {
  const base = mapGmailMessage(msg, account);
  const { text, html } = extractGmailBody(msg.payload);
  return {
    ...base,
    body: text || htmlToText(html),
    bodyHtml: html,
    attachments: extractGmailAttachments(msg.payload),
  };
}

function extractGmailBody(payload) {
  if (!payload) return { text: '', html: '' };

  const parts = payload.parts || [payload];
  let text = '';
  let html = '';

  for (const part of flattenParts(parts)) {
    const mimeType = part.mimeType;
    const data = part.body?.data;
    if (!data) continue;

    const decoded = decodeBase64Url(data);
    if (mimeType === 'text/plain') text += decoded;
    if (mimeType === 'text/html') html += decoded;
  }

  return { text, html };
}

function extractGmailAttachments(payload) {
  if (!payload) return [];
  const parts = flattenParts(payload.parts || [payload]);
  return parts
    .filter((p) => p.filename && p.filename.length > 0)
    .map((p) => p.filename);
}

function flattenParts(parts) {
  const result = [];
  for (const part of parts || []) {
    result.push(part);
    if (part.parts) {
      result.push(...flattenParts(part.parts));
    }
  }
  return result;
}

function mapMicrosoftMessage(msg, account) {
  return {
    id: `microsoft::${account.id}::${msg.id}`,
    accountId: account.id,
    provider: 'microsoft',
    accountEmail: account.email,
    subject: msg.subject || '(sem assunto)',
    from: msg.from?.emailAddress?.name
      ? `${msg.from.emailAddress.name} <${msg.from.emailAddress.address}>`
      : msg.from?.emailAddress?.address || '',
    to: (msg.toRecipients || []).map((r) =>
      r.emailAddress?.name
        ? `${r.emailAddress.name} <${r.emailAddress.address}>`
        : r.emailAddress?.address || ''
    ),
    date: new Date(msg.receivedDateTime).toISOString(),
    snippet: msg.bodyPreview || '',
    isRead: msg.isRead || false,
  };
}

// Equivalente ao mapGmailThread, mas para o Outlook: recebe as mensagens já
// mapeadas (mapMicrosoftMessage) de uma mesma conversationId e agrega numa
// única linha de listagem.
function mapMicrosoftThread(mappedMessages, conversationId, account) {
  const sorted = [...mappedMessages].sort((a, b) => new Date(a.date) - new Date(b.date));
  const last = sorted[sorted.length - 1];

  return {
    id: `microsoft::${account.id}::${conversationId}`,
    accountId: account.id,
    provider: 'microsoft',
    accountEmail: account.email,
    subject: last?.subject || '(sem assunto)',
    from: last?.from || '',
    date: last?.date || new Date(0).toISOString(),
    snippet: last?.snippet || '',
    isRead: sorted.every((m) => m.isRead),
    messageCount: sorted.length,
  };
}

function mapMicrosoftMessageDetail(msg, account) {
  const base = mapMicrosoftMessage(msg, account);
  const isHtml = msg.body?.contentType === 'html';
  const html = isHtml ? (msg.body?.content || '') : '';
  const text = isHtml ? '' : (msg.body?.content || '');

  return {
    ...base,
    body: text || htmlToText(html),
    bodyHtml: html,
    attachments: (msg.attachments || []).map((a) => a.name),
  };
}

// ---------------- Helpers ----------------

function parseAddress(value) {
  if (!value) return '';
  return value;
}

function parseAddressList(value) {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function decodeBase64Url(str) {
  if (!str) return '';
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const buffer = Buffer.from(base64, 'base64');
  return buffer.toString('utf-8');
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function htmlToText(html) {
  return html
    .replace(/<style[^>]*>.*?<\/style>/gis, '')
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------- Domínios (varredura de remetentes) ----------------
//
// Ideia: não existe nenhuma API de e-mail que liste "sites onde você tem
// cadastro" — só dá para inferir isso a partir de quem já te mandou e-mail.
// Por isso varremos a caixa toda (não só a inbox), pegando só o remetente de
// cada mensagem (mais leve que baixar o e-mail inteiro), e agrupamos por
// domínio. É incremental/paginado (reaproveita os mesmos PAGE_SIZE/cursor
// deste arquivo) porque a caixa pode ter milhares de mensagens.

async function listDomains(options = {}) {
  const { refresh = false, loadMore = false } = options;

  if (loadMore) return loadMoreDomains();

  if (!refresh) {
    const cached = emailCache.getList('domains');
    if (cached && cached.emails.length > 0) {
      return { domains: cached.emails, syncedAt: cached.syncedAt, fromCache: true, errors: [], hasMore: cached.hasMore, scanned: cached.total || 0 };
    }
  }

  const accounts = accountStore.getAccounts();
  if (accounts.length === 0) {
    return { domains: [], syncedAt: Date.now(), fromCache: false, errors: [], hasMore: false, scanned: 0 };
  }

  const errors = [];
  const results = await Promise.all(
    accounts.map(async (account) => {
      try {
        const accountWithToken = await getValidAccount(account.id);
        if (!accountWithToken) {
          errors.push(`${account.email}: sessão expirada, reconecte a conta`);
          return { senders: [], hasMore: false, scanned: 0 };
        }
        return await scanSendersForAccount(accountWithToken, { more: false });
      } catch (err) {
        errors.push(`${account.email}: ${err.message || 'erro desconhecido'}`);
        return { senders: [], hasMore: false, scanned: 0 };
      }
    })
  );

  const hasMore = results.some((r) => r.hasMore);
  const scanned = results.reduce((sum, r) => sum + r.scanned, 0);
  const domains = mergeDomains([], results.flatMap((r) => r.senders));

  emailCache.saveList('domains', domains, hasMore, scanned);
  return { domains, syncedAt: Date.now(), fromCache: false, errors, hasMore, scanned };
}

async function loadMoreDomains() {
  const accounts = accountStore.getAccounts();
  const errors = [];

  const results = await Promise.all(
    accounts.map(async (account) => {
      try {
        const accountWithToken = await getValidAccount(account.id);
        if (!accountWithToken) return { senders: [], hasMore: false, scanned: 0 };
        return await scanSendersForAccount(accountWithToken, { more: true });
      } catch (err) {
        errors.push(`${account.email}: ${err.message || 'erro desconhecido'}`);
        return { senders: [], hasMore: false, scanned: 0 };
      }
    })
  );

  const hasMore = results.some((r) => r.hasMore);
  const newScanned = results.reduce((sum, r) => sum + r.scanned, 0);

  const existingCache = emailCache.getList('domains');
  const domains = mergeDomains(existingCache?.emails || [], results.flatMap((r) => r.senders));
  const scanned = (existingCache?.total || 0) + newScanned;

  emailCache.saveList('domains', domains, hasMore, scanned);
  return { domains, syncedAt: Date.now(), fromCache: false, errors, hasMore, scanned };
}

// Busca só o remetente (From) de cada mensagem, sem restringir por pasta —
// isso varre a caixa toda (recebidos, arquivados etc.), que é o que interessa
// para saber "quem já me mandou e-mail alguma vez".
async function scanSendersForAccount(account, { more }) {
  const cursorKey = `${account.id}:domains-scan`;
  if (!more) pageCursors.delete(cursorKey);
  const cursor = pageCursors.get(cursorKey) || {};
  if (more && cursor.exhausted) return { senders: [], hasMore: false, scanned: 0 };

  if (account.provider === 'google') {
    const gmail = getGmailClient(account.accessToken);
    const res = await gmail.users.messages.list({
      userId: 'me',
      maxResults: PAGE_SIZE,
      pageToken: cursor.token,
    });

    const nextToken = res.data.nextPageToken || null;
    pageCursors.set(cursorKey, { token: nextToken, exhausted: !nextToken });

    if (!res.data.messages) return { senders: [], hasMore: !!nextToken, scanned: 0 };

    const details = await mapWithConcurrency(res.data.messages, API_CONCURRENCY, (msg) =>
      gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From'],
      })
    );
    const senders = details.map((detail) => {
      const headers = detail.data.payload?.headers || [];
      return {
        from: headers.find((h) => h.name === 'From')?.value || '',
        date: new Date(parseInt(detail.data.internalDate, 10)).toISOString(),
      };
    });
    return { senders, hasMore: !!nextToken, scanned: senders.length };
  }

  if (account.provider === 'microsoft') {
    const url = cursor.nextUrl || `/me/messages?$top=${PAGE_SIZE}&$select=from,receivedDateTime`;
    const data = await graphRequest(url, account.accessToken);

    const nextUrl = data['@odata.nextLink'] || null;
    pageCursors.set(cursorKey, { nextUrl, exhausted: !nextUrl });

    const senders = (data.value || []).map((msg) => ({
      from: msg.from?.emailAddress?.name
        ? `${msg.from.emailAddress.name} <${msg.from.emailAddress.address}>`
        : msg.from?.emailAddress?.address || '',
      date: msg.receivedDateTime,
    }));
    return { senders, hasMore: !!nextUrl, scanned: senders.length };
  }

  return { senders: [], hasMore: false, scanned: 0 };
}

// Agrega remetentes por domínio, mantendo contagem e primeira/última vez visto.
function mergeDomains(existingList, newSenders) {
  const map = new Map(existingList.map((d) => [d.domain, d]));
  for (const { from, date } of newSenders) {
    const domain = extractSenderDomain(from);
    if (!domain || !date) continue;
    const name = extractSenderName(from);
    const existing = map.get(domain);
    if (existing) {
      existing.count += 1;
      if (date > existing.lastSeen) existing.lastSeen = date;
      if (date < existing.firstSeen) existing.firstSeen = date;
      if (!existing.name && name) existing.name = name;
    } else {
      map.set(domain, { domain, name: name || domain, count: 1, firstSeen: date, lastSeen: date });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function extractSenderDomain(from) {
  const match = from.match(/@([^\s>]+)/);
  return match ? match[1].toLowerCase() : null;
}

function extractSenderName(from) {
  const match = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return match ? match[1].trim() : '';
}

module.exports = {
  listEmails,
  getEmail,
  deleteEmail,
  restoreEmail,
  listDomains,
  emptyTrash,
};
