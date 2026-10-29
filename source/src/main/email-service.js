const { getGmailClient } = require('./auth/google-auth');
const { graphRequest } = require('./auth/microsoft-auth');
const accountStore = require('./storage/account-store');
const emailCache = require('./storage/email-cache');

const PAGE_SIZE = 50;

// Mail folders (the ones that actually list messages) and what each provider
// calls them. "Domains" and "Automator" aren't here: they are screens of their own.
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

// Limit of simultaneous API calls per account. Fetching the metadata of a whole
// page (up to 50 messages) at once kept failing with "Too many concurrent
// requests for user" — the API can't take that much in parallel.
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

// A listing session per account+folder+search+period+order: it keeps the
// COMPLETE list of ids (threadId on Gmail, conversationId on Outlook) already in
// display order, built once (cheap: only ids, no metadata), and each "load
// more" just moves an offset over that list, fetching the full (expensive)
// metadata only for the requested slice. It lives only in the process memory
// — it doesn't persist across app restarts.
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
  // Any non-default filter (search, period or reversed order) always goes to
  // the server — the local folder cache only serves the default chronological
  // listing (newest first, no filter at all).
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

  // Fetches every account in parallel (first page); a failure in one account doesn't take down the others.
  const errors = [];
  const results = await Promise.all(
    accounts.map(async (account) => {
      try {
        const accountWithToken = await getValidAccount(account.id);
        if (!accountWithToken) {
          errors.push(`${account.email}: session expired, reconnect the account`);
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

  // With any non-default filter, it makes no sense to store it in the folder
  // cache (which is only for the normal chronological listing).
  if (!isDefaultView) {
    return { emails: allEmails, syncedAt: Date.now(), fromCache: false, errors, hasMore, total };
  }

  emailCache.saveList(folder, allEmails, hasMore, total);
  return { emails: allEmails, syncedAt: Date.now(), fromCache: false, errors, hasMore, total };
}

// Adds up the total across accounts; if no account could report a total,
// returns null (so the UI shows only the loaded count, without "of Y").
function combineTotals(results) {
  if (results.every((r) => r.total == null)) return null;
  return results.reduce((sum, r) => sum + (r.total || 0), 0);
}

// Fetches the next page (per account) using the session already built. In the
// default listing, it merges with what is in the local cache; with any active
// filter, it merges with what the renderer had already loaded (currentEmails).
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

// Gmail: "before:" is exclusive, so it adds 1 day to the end date to include it.
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

  // First page of the session: builds the complete list of ids (in the right
  // order) from scratch. That gives us an EXACT total for free (it's just the list
  // size), instead of the estimates Gmail/Graph give, which can vary on every
  // call even with nothing changed.
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
    // Metadata fetched in parallel, but with a concurrency limit (sequential
    // took ~20x longer; without a limit, the API rejected it with "too many concurrent requests").
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

// Collects ALL conversation ids matching the filter (just the id, no
// metadata — cheap even for mailboxes with thousands of e-mails). Gmail
// always returns newest → oldest; for "oldest first" we only need to
// reverse the already collected list (Gmail has no way to ask for the
// reversed order directly in the API).
async function fetchOrderedGmailThreadIds(account, { folder, query, dateFrom, dateTo, sortOrder }) {
  const gmail = getGmailClient(account.accessToken);
  const folderQuery = GMAIL_FOLDER_QUERY[folder] || GMAIL_FOLDER_QUERY.inbox;
  const dateQuery = buildGmailDateQuery(dateFrom, dateTo);
  const q = [folderQuery, dateQuery, query].filter(Boolean).join(' ');
  // Without this Gmail simply ignores what is in SPAM/TRASH, and searching
  // those two folders comes back empty even with the right "in:" in the query.
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

// The Outlook equivalent: Graph has no "threads" API, so we fetch
// id+conversationId+date of ALL messages matching the filter (light fields,
// no body) and deduplicate by conversationId keeping the right order.
// Without a text search, Graph itself sorts by date ($orderby); with a search
// ($search), Graph doesn't allow combining it with $orderby
// — in that case we sort on the client after downloading everything.
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

// Keeps the total of an already cached listing session in sync with
// deletions/restores, without recounting on the server on every mutation.
// If there's no cached session for this filter (e.g. the app just opened),
// it does nothing — the next listing will count correctly from scratch.
function adjustFolderTotal(accountId, filters, delta) {
  const cursorKey = buildCursorKey(accountId, filters);
  const session = pageCursors.get(cursorKey);
  if (session && session.total != null) {
    pageCursors.set(cursorKey, { ...session, total: Math.max(0, session.total + delta) });
  }
}

// Fetches the summary (no body) of every message in an Outlook conversation,
// to build an aggregated listing row (the equivalent of Gmail's threads.get).
async function fetchOutlookThreadSummary(conversationId, account) {
  const messages = await fetchOutlookConversationMessages(
    conversationId,
    account,
    'id,subject,from,receivedDateTime,bodyPreview,isRead'
  );
  return mapMicrosoftThread(messages.map((m) => mapMicrosoftMessage(m, account)), conversationId, account);
}

// Fetches every message in an Outlook conversation (regardless of paging),
// used both to list and to open/delete/restore the whole conversation.
async function fetchOutlookConversationMessages(conversationId, account, select) {
  const filterValue = conversationId.replace(/'/g, "''");
  const url = `/me/messages?$select=${select}&$filter=${encodeURIComponent(`conversationId eq '${filterValue}'`)}&$orderby=receivedDateTime&$top=100`;
  const data = await graphRequest(url, account.accessToken);
  return data.value || [];
}

async function getEmail(emailId) {
  // A body already seen stays in the local cache — reopening is instant, with no request.
  // A cache from before this version (per message, without a `messages` array) doesn't
  // match the current (per conversation) format: fetch again.
  const cached = emailCache.getBody(emailId);
  if (cached && Array.isArray(cached.messages)) return cached;

  const email = await fetchThread(emailId);
  emailCache.saveBody(emailId, email);
  return email;
}

// Fetches the whole conversation (every message), not just one message — to
// show it all stacked in a single message, as Gmail does.
async function fetchThread(emailId) {
  const [provider, accountId, threadKey] = emailId.split('::');
  const account = await getValidAccount(accountId);
  if (!account) throw new Error('Account not found');

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

  throw new Error('Unsupported provider');
}

function buildThreadDetail(emailId, account, messages) {
  const sorted = [...messages].sort((a, b) => new Date(a.date) - new Date(b.date));
  const last = sorted[sorted.length - 1];
  return {
    id: emailId,
    provider: account.provider,
    accountId: account.id,
    accountEmail: account.email,
    subject: last?.subject || '(no subject)',
    messageCount: sorted.length,
    messages: sorted,
  };
}

// Default deletion: moves to the trash (recoverable). With { permanent: true },
// deletes for good (used on the Trash tab). It acts on the whole conversation —
// like Gmail, where deleting a list row throws all of its messages away.
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
  if (!account) throw new Error('Account not found');

  if (provider === 'google') {
    const gmail = getGmailClient(account.accessToken);
    if (permanent) {
      await gmail.users.threads.delete({ userId: 'me', id: threadKey });
    } else {
      await gmail.users.threads.trash({ userId: 'me', id: threadKey });
    }
  } else if (provider === 'microsoft') {
    // No "conversation delete" in Graph: we fetch every message of this
    // conversation (not only the ones loaded on screen) and delete them one by one.
    const messageIds = await fetchOutlookConversationMessageIds(threadKey, account);
    await mapWithConcurrency(messageIds, API_CONCURRENCY, (id) =>
      // In Graph, DELETE in the inbox moves to "Deleted Items"; in the trash, it removes for good.
      graphRequest(`/me/messages/${id}`, account.accessToken, { method: 'DELETE' })
    );
  } else {
    throw new Error('Unsupported provider');
  }

  if (permanent) {
    emailCache.removeEmails([emailId]);
    adjustFolderTotal(accountId, filters, -1);
  } else {
    // The origin can be the inbox or spam — the cache must remove the row from
    // the right folder, otherwise it keeps showing there until the next sync.
    emailCache.moveEmails([emailId], folder, 'trash');
    adjustFolderTotal(accountId, filters, -1);
    adjustFolderTotal(accountId, { ...filters, folder: 'trash' }, +1);
  }
}

// Restores a whole conversation to the inbox — from the trash
// ("restore") or from spam ("not spam").
async function restoreEmail(emailId, options = {}) {
  const { folder = 'trash', query = '', dateFrom = '', dateTo = '', sortOrder = 'desc' } = options;
  const filters = { folder, query, dateFrom, dateTo, sortOrder };
  const [provider, accountId, threadKey] = emailId.split('::');
  const account = await getValidAccount(accountId);
  if (!account) throw new Error('Account not found');

  if (provider === 'google') {
    const gmail = getGmailClient(account.accessToken);
    if (folder === 'spam') {
      // untrash won't do here: leaving spam means removing the SPAM label (and giving
      // back the INBOX label, which marking as spam removed).
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
    throw new Error('Unsupported provider');
  }

  emailCache.moveEmails([emailId], folder, 'inbox');
  adjustFolderTotal(accountId, filters, -1);
  adjustFolderTotal(accountId, { ...filters, folder: 'inbox' }, +1);
}

async function fetchOutlookConversationMessageIds(conversationId, account) {
  const messages = await fetchOutlookConversationMessages(conversationId, account, 'id');
  return messages.map((m) => m.id);
}

// Empties the trash of every account — PERMANENTLY deletes everything in
// there, not only what was already loaded on screen.
async function emptyTrash() {
  const accounts = accountStore.getAccounts();
  const errors = [];

  await Promise.all(
    accounts.map(async (account) => {
      try {
        const accountWithToken = await getValidAccount(account.id);
        if (!accountWithToken) {
          errors.push(`${account.email}: session expired, reconnect the account`);
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
  // Trash paging cursors would point to pages that no longer exist
  // after emptying it.
  for (const key of [...pageCursors.keys()]) {
    if (/:trash:/.test(key)) pageCursors.delete(key);
  }

  if (errors.length > 0) throw new Error(errors.join('\n'));
}

// Gmail has no single-request "empty trash": it lists every message id in
// TRASH (paging) and deletes them in batches of up to 1000 via batchDelete
// (much faster than deleting one by one).
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

// Graph has no "empty folder" action: it lists every id in the Deleted Items
// folder (paging) and deletes them one by one (DELETE there is already final).
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
        throw new Error('refresh token missing, reconnect the account');
      }
      const { refreshAccessToken } = require('./auth/google-auth');
      const tokens = await refreshAccessToken(account.refreshToken);
      accountStore.updateTokens(account.id, tokens.accessToken, tokens.expiresAt);
      account.accessToken = tokens.accessToken;
      account.expiresAt = tokens.expiresAt;
    } else if (account.provider === 'microsoft') {
      if (!account.msalAccount) {
        throw new Error('Outlook session expired, reconnect the account');
      }
      const { refreshAccessToken } = require('./auth/microsoft-auth');
      const tokens = await refreshAccessToken(account.msalAccount);
      accountStore.updateTokens(account.id, tokens.accessToken, tokens.expiresAt, tokens.account);
      account.accessToken = tokens.accessToken;
      account.expiresAt = tokens.expiresAt;
      account.msalAccount = tokens.account;
    }
  } catch (err) {
    console.error('Error renewing the token:', err);
    const message = err.message || '';
    if (/invalid_grant|revoked|expired/i.test(message)) {
      // When this comes back every ~7 days it isn't the account: it's the Google Cloud
      // project stuck in "Testing", a mode in which Google expires the refresh token
      // within that period. Publishing the app (Audience → Publish app) fixes it for good.
      throw new Error(
        account.provider === 'google'
          ? 'authorization expired, reconnect the account. If this happens every week, publish your app in Google Cloud (Audience → Publish app): in "Testing" Google expires access every 7 days.'
          : 'authorization revoked or expired, reconnect the account'
      );
    }
    throw new Error(`failed to renew the session: ${message}`);
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
    subject: getHeader('Subject') || '(no subject)',
    from: parseAddress(getHeader('From')),
    to: parseAddressList(getHeader('To')),
    date: new Date(parseInt(msg.internalDate, 10)).toISOString(),
    // the snippet comes as plain text with HTML entities (it isn't base64)
    snippet: decodeHtmlEntities(msg.snippet || ''),
    isRead: !(msg.labelIds || []).includes('UNREAD'),
  };
}

// Builds a conversation's listing row from the result of
// threads.get(format:'metadata'), which already brings every message in the thread.
// It uses the last message for subject/sender/date/snippet (it's what shows
// as the most recent in the conversation) and counts as "unread" if ANY message
// still has the UNREAD label — like Gmail makes the row bold.
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
    subject: getHeader('Subject') || '(no subject)',
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
    subject: msg.subject || '(no subject)',
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

// The mapGmailThread equivalent, but for Outlook: it gets the messages already
// mapped (mapMicrosoftMessage) of one conversationId and aggregates them into a
// single listing row.
function mapMicrosoftThread(mappedMessages, conversationId, account) {
  const sorted = [...mappedMessages].sort((a, b) => new Date(a.date) - new Date(b.date));
  const last = sorted[sorted.length - 1];

  return {
    id: `microsoft::${account.id}::${conversationId}`,
    accountId: account.id,
    provider: 'microsoft',
    accountEmail: account.email,
    subject: last?.subject || '(no subject)',
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

// ---------------- Domains (sender scan) ----------------
//
// The idea: no e-mail API lists "sites where you have an account" — it can
// only be inferred from who has already e-mailed you. That's why we scan the
// whole mailbox (not just the inbox), taking only each message's sender
// (lighter than downloading the whole e-mail), and group by domain. It is
// incremental/paged (reusing this file's PAGE_SIZE/cursor) because the
// mailbox can have thousands of messages.

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
          errors.push(`${account.email}: session expired, reconnect the account`);
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

// Fetches only the sender (From) of each message, without restricting the folder —
// this scans the whole mailbox (received, archived etc.), which is what matters
// to know "who has ever e-mailed me".
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

// Aggregates senders by domain, keeping the count and the first/last time seen.
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
