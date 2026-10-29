import { navigate } from '../app.js';
import {
  listEmails,
  listDomains,
  getEmail,
  deleteEmail,
  restoreEmail,
  emptyTrash,
  getAccounts,
  getAutomationRules,
  saveAutomationRule,
  deleteAutomationRule,
  openExternal,
  getBodyZoom,
  setBodyZoom,
  onZoomChange,
} from '../services/email-api.js';
import { confirmDialog, automationFormDialog } from '../services/dialogs.js';

const BASE_FONT_SIZE = 14;

const STALE_MS = 2 * 60 * 1000; // resyncs in the background if the cache is older than this

// Limit of simultaneous deletions/restores. Selecting many e-mails
// (now that Shift+arrow allows it) and deleting them all at once
// fired one request per e-mail at the same time — the API rejected it with
// "Too many concurrent requests for user" above a few dozen.
const DELETE_CONCURRENCY = 5;

async function mapWithConcurrencySettled(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (err) {
        results[i] = { status: 'rejected', reason: err };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const ICONS = {
  trash: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
  restore: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>',
  mail: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>',
  edit: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
  bolt: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
  boltSmall: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
  notSpam: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8z"></path><polyline points="9 11 11 13 15 9"></polyline></svg>',
};

// Side nav: mail folders first, screens of their own (which don't list
// e-mails) after. The order here is the order on screen.
const NAV_ITEMS = [
  {
    folder: 'inbox',
    label: 'Inbox',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>',
  },
  {
    folder: 'spam',
    label: 'Spam',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>',
  },
  {
    folder: 'trash',
    label: 'Trash',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
  },
  {
    folder: 'automator',
    label: 'Automator',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
  },
  {
    folder: 'domains',
    label: 'Domains',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>',
  },
];

// Folders that actually list e-mails (paging, selection, keyboard shortcuts).
// "domains" and "automator" are screens of their own and stay out.
const EMAIL_FOLDERS = ['inbox', 'spam', 'trash'];

function isEmailFolder(folder) {
  return EMAIL_FOLDERS.includes(folder);
}

export async function renderListScreen(container) {
  container.innerHTML = `
    <header class="app-header">
      <h1>Mail Reader</h1>
      <div class="header-center">
      <div class="search-box">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input type="text" id="search-input" placeholder="Search by sender, subject or content...">
        <button class="search-clear" id="search-clear" title="Clear" hidden>&times;</button>
      </div>
      <div class="filter-wrap" id="filter-wrap">
        <button class="icon-btn filter-toggle-btn" id="filter-toggle-btn" title="Filters">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
          <span class="filter-badge" id="filter-badge" hidden></span>
        </button>
        <div class="filter-popover" id="filter-popover" hidden>
          <div class="calendar-nav">
            <button class="icon-btn" id="cal-prev-btn" title="Previous month">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <span class="calendar-month-label" id="calendar-month-label"></span>
            <button class="icon-btn" id="cal-next-btn" title="Next month">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </div>
          <div class="calendar-weekdays">
            <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
          </div>
          <div class="calendar-grid" id="calendar-grid"></div>
          <div class="filter-popover-footer">
            <button class="btn-link" id="filter-clear-range">Clear period</button>
            <button class="icon-btn sort-toggle-btn" id="sort-toggle-btn" title="Newest first">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
            </button>
          </div>
        </div>
      </div>
      </div>
      <div class="app-header-actions">
        <span class="sync-info" id="sync-info"></span>
        <div class="zoom-control" title="E-mail body zoom">
          <button class="icon-btn" id="zoom-out-btn" title="Zoom out (Ctrl+-)">−</button>
          <button class="zoom-label" id="zoom-label" title="Reset zoom (Ctrl+0)">100%</button>
          <button class="icon-btn" id="zoom-in-btn" title="Zoom in (Ctrl+=)">+</button>
        </div>
        <button class="icon-btn" id="refresh-btn" title="Sync now">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
        </button>
        <button class="icon-btn" id="accounts-btn" title="Accounts">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
        </button>
      </div>
    </header>
    <div class="app-body">
      <nav class="folder-nav" id="folder-nav">
        ${NAV_ITEMS.map((item) => `
          <button class="folder-nav-item ${item.folder === 'inbox' ? 'active' : ''}" data-folder="${item.folder}" title="${item.label}">
            <span class="folder-nav-icon">${item.icon}</span>
            <span class="folder-nav-label">${item.label}</span>
          </button>
        `).join('')}
      </nav>
      <div class="split-view">
        <div class="list-pane" id="list-pane">
          <div class="list-toolbar">
            <input type="checkbox" id="select-all" title="Select all">
            <span class="selection-info" id="selection-info"></span>
            <button class="btn-action-text" id="new-automation-btn" hidden>+ New automation</button>
            <button class="btn-action-text" id="run-all-automations-btn" hidden>▶ Run all</button>
            <button class="btn-action-text" id="restore-selected" hidden></button>
            <button class="btn-danger-text" id="delete-selected" hidden></button>
            <button class="btn-danger-text" id="empty-trash-btn" hidden>Empty trash</button>
          </div>
          <div class="sync-errors" id="sync-errors" hidden></div>
          <div id="email-list" class="email-list">
            <div class="loading-state"><div class="spinner"></div>Loading e-mails...</div>
          </div>
        </div>
        <div class="split-divider" id="split-divider"></div>
        <div class="reading-pane" id="reading-pane"></div>
      </div>
    </div>
  `;

  const listEl = container.querySelector('#email-list');
  const readingPane = container.querySelector('#reading-pane');
  const searchInput = container.querySelector('#search-input');
  const searchClear = container.querySelector('#search-clear');
  const selectAllEl = container.querySelector('#select-all');
  const selectionInfo = container.querySelector('#selection-info');
  const deleteSelectedBtn = container.querySelector('#delete-selected');
  const restoreSelectedBtn = container.querySelector('#restore-selected');
  const emptyTrashBtn = container.querySelector('#empty-trash-btn');
  const newAutomationBtn = container.querySelector('#new-automation-btn');
  const runAllAutomationsBtn = container.querySelector('#run-all-automations-btn');
  const filterWrapEl = container.querySelector('#filter-wrap');
  const filterToggleBtn = container.querySelector('#filter-toggle-btn');
  const filterBadge = container.querySelector('#filter-badge');
  const filterPopover = container.querySelector('#filter-popover');
  const calPrevBtn = container.querySelector('#cal-prev-btn');
  const calNextBtn = container.querySelector('#cal-next-btn');
  const calendarMonthLabel = container.querySelector('#calendar-month-label');
  const calendarGrid = container.querySelector('#calendar-grid');
  const filterClearRangeBtn = container.querySelector('#filter-clear-range');
  const sortToggleBtn = container.querySelector('#sort-toggle-btn');
  const syncErrorsEl = container.querySelector('#sync-errors');
  const syncInfoEl = container.querySelector('#sync-info');
  const refreshBtn = container.querySelector('#refresh-btn');
  const accountsBtn = container.querySelector('#accounts-btn');
  const folderNavItems = container.querySelectorAll('.folder-nav-item');
  const zoomOutBtn = container.querySelector('#zoom-out-btn');
  const zoomInBtn = container.querySelector('#zoom-in-btn');
  const zoomLabel = container.querySelector('#zoom-label');
  const listPaneEl = container.querySelector('#list-pane');
  const splitViewEl = container.querySelector('.split-view');
  const splitDivider = container.querySelector('#split-divider');

  let emails = [];
  let folder = 'inbox';
  let query = '';
  let dateFrom = ''; // 'YYYY-MM-DD' or '' (no lower bound)
  let dateTo = ''; // 'YYYY-MM-DD' or '' (no upper bound)
  let sortOrder = 'desc'; // 'desc' = newest first (default); 'asc' = oldest first
  let filterPopoverOpen = false;
  let calendarViewDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1); // month shown in the popover
  let rangeStart = null; // selection in progress on the calendar (Date); it only becomes dateFrom/dateTo once the range closes
  let rangeEnd = null;
  let hoverDate = null; // day under the mouse, to preview the range before closing it
  // Created early (not only in the "Keyboard shortcuts" section) because the
  // filter popover also needs it to close on an outside click, before that section.
  const keyboardController = new AbortController();
  let openId = null;
  let syncing = false;
  let hasMore = true;
  let loadingMore = false;
  let total = null; // the folder's real total on the server (null until the 1st answer arrives)
  let focusId = null; // row "in focus" by keyboard (independent of which one is open for reading)
  let selectionAnchorId = null; // the (fixed) starting point of the Shift+arrow selection session
  let selectionSessionLow = null; // lowest index reached in this session
  let selectionSessionHigh = null; // highest index reached in this session
  let bodyZoom = 1; // e-mail body zoom, persisted and applied to all
  let openBodyHosts = []; // { frame, pre } of each message already rendered in the open conversation (zoom applies to all)
  let mutatingInFlight = false; // locks simultaneous delete/restore (holding Delete repeated too fast and the API rejected it with "too many concurrent requests")
  const selectedIds = new Set();

  // --- "Domains" tab (a mode of its own, not an e-mail list) ---
  let domains = [];
  let domainsQuery = ''; // local filter — the scanned domains all stay in memory
  let domainsHasMore = true;
  let domainsLoadingMore = false;
  let domainsSyncing = false;
  let domainsScanned = 0;
  let selectedDomain = null;

  // --- "Automator" tab (saved cleanup rules) ---
  let automationRules = [];
  let automationQuery = ''; // local filter by name/sender
  let running = false; // blocks re-entry while some run is in progress

  clearReadingPane();

  function updateZoomLabel() {
    zoomLabel.textContent = `${Math.round(bodyZoom * 100)}%`;
  }

  function applyBodyZoom(newZoom) {
    bodyZoom = Math.min(2, Math.max(0.5, Math.round(newZoom * 10) / 10));
    updateZoomLabel();
    setBodyZoom(bodyZoom);
    for (const host of openBodyHosts) {
      if (host.frame?._applyZoom) host.frame._applyZoom(bodyZoom);
      if (host.pre) host.pre.style.fontSize = `${BASE_FONT_SIZE * bodyZoom}px`;
    }
  }

  // Search is now done on the server (Gmail/Graph) — `emails` already comes filtered
  // by the query when there is one; this function only exists to keep the many
  // places in the code that work on "the list on screen" decoupled
  // from how it was obtained.
  function filteredEmails() {
    return emails;
  }

  function renderList() {
    const filtered = filteredEmails();

    if (emails.length === 0) {
      const emptyByFolder = {
        trash: 'The trash is empty.',
        spam: 'No e-mails marked as spam.',
      };
      const emptyMsg = query
        ? `Nothing found for "${escapeHtml(query)}".`
        : (emptyByFolder[folder] || 'No e-mails found.');
      listEl.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
      updateToolbar();
      return;
    }

    const rowActionIcon = folder === 'trash' ? ICONS.restore : ICONS.trash;
    const rowActionTitle = folder === 'trash' ? 'Restore to the inbox' : 'Move to the trash';
    // In spam the row has two actions: take it out of spam ("not spam") or send
    // it straight to the trash.
    const showRowRestore = folder === 'spam';

    const rows = filtered.map((email) => `
      <div class="email-row ${email.isRead ? '' : 'unread'} ${email.id === openId ? 'open' : ''} ${email.id === focusId ? 'focused' : ''}" data-id="${escapeHtml(email.id)}">
        <input type="checkbox" class="row-check" data-id="${escapeHtml(email.id)}" ${selectedIds.has(email.id) ? 'checked' : ''}>
        <span class="provider-dot ${email.provider}" title="${email.provider === 'google' ? 'Gmail' : 'Outlook'} — ${escapeHtml(email.accountEmail)}"></span>
        <div class="email-row-body">
          <div class="email-row-line1">
            <span class="email-row-from">${escapeHtml(fromName(email.from))}${email.messageCount > 1 ? ` <span class="email-row-count">${email.messageCount}</span>` : ''}</span>
            <span class="email-row-date">${formatDateCompact(email.date)}</span>
          </div>
          <div class="email-row-line2">
            <span class="email-row-subject">${escapeHtml(email.subject)}</span>${email.snippet ? `<span class="email-row-snippet"> — ${escapeHtml(email.snippet)}</span>` : ''}
          </div>
        </div>
        <div class="email-row-actions">
          ${showRowRestore ? `<button class="icon-btn row-restore" data-id="${escapeHtml(email.id)}" title="Not spam — move to the inbox">${ICONS.notSpam}</button>` : ''}
          <button class="icon-btn row-action" data-id="${escapeHtml(email.id)}" title="${rowActionTitle}">${rowActionIcon}</button>
        </div>
      </div>
    `).join('');

    // Infinite scroll paging 50 at a time — it applies both to the normal listing
    // and during a search (which is now paged on the server too).
    let pagingRow = '';
    if (loadingMore) {
      pagingRow = '<div class="load-more-row"><div class="spinner spinner-small"></div></div>';
    } else if (!hasMore) {
      pagingRow = `<div class="load-more-row load-more-end">${query ? 'No more results' : 'No more e-mails'}</div>`;
    }

    listEl.innerHTML = rows + pagingRow;

    listEl.querySelectorAll('.email-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.row-check') || e.target.closest('.email-row-actions')) return;
        openEmail(row.dataset.id);
      });
    });

    listEl.querySelectorAll('.row-action').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (folder === 'trash') restoreEmails([btn.dataset.id]);
        else removeEmails([btn.dataset.id], { permanent: false });
      });
    });

    listEl.querySelectorAll('.row-restore').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        restoreEmails([btn.dataset.id]);
      });
    });

    listEl.querySelectorAll('.row-check').forEach((check) => {
      check.addEventListener('click', (e) => e.stopPropagation());
      check.addEventListener('change', () => {
        if (check.checked) selectedIds.add(check.dataset.id);
        else selectedIds.delete(check.dataset.id);
        updateToolbar();
      });
    });

    updateToolbar();
  }

  function updateToolbar() {
    const filtered = filteredEmails();
    // Keeps the selection consistent with what exists in the list
    const validIds = new Set(emails.map((e) => e.id));
    for (const id of selectedIds) {
      if (!validIds.has(id)) selectedIds.delete(id);
    }
    if (focusId && !validIds.has(focusId)) focusId = null;
    if (selectionAnchorId && !validIds.has(selectionAnchorId)) {
      selectionAnchorId = null;
      selectionSessionLow = null;
      selectionSessionHigh = null;
    }

    const count = selectedIds.size;
    selectAllEl.checked = filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id));
    selectAllEl.indeterminate = count > 0 && !selectAllEl.checked;

    // Always in the "X of Y" form, searching or not — only the word changes.
    const unit = query ? 'result' : 'e-mail';
    if (count > 0) {
      selectionInfo.textContent = `${count} selected`;
    } else if (total != null) {
      selectionInfo.textContent = `${emails.length} of ${total} ${unit}${total !== 1 ? 's' : ''}`;
    } else {
      selectionInfo.textContent = `${emails.length} ${unit}${emails.length !== 1 ? 's' : ''}`;
    }

    restoreSelectedBtn.hidden = count === 0 || (folder !== 'trash' && folder !== 'spam');
    restoreSelectedBtn.textContent = folder === 'spam' ? `Not spam (${count})` : `Restore (${count})`;
    deleteSelectedBtn.hidden = count === 0;
    deleteSelectedBtn.textContent = folder === 'trash' ? `Delete forever (${count})` : `Delete (${count})`;
    // Independent of the selection — it empties the whole trash, not only what is checked.
    emptyTrashBtn.hidden = folder !== 'trash' || emails.length === 0;
  }

  function updateSyncInfo(syncedAt) {
    if (!syncedAt) return;
    const time = new Date(syncedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    syncInfoEl.textContent = `Synced at ${time}`;
  }

  function showSyncErrors(errors) {
    if (errors && errors.length > 0) {
      syncErrorsEl.hidden = false;
      syncErrorsEl.textContent = `⚠ ${errors.join(' · ')}`;
    } else {
      syncErrorsEl.hidden = true;
    }
  }

  // Updates the row highlight/focus at once (no network cost) — separate from
  // fetching/rendering the body, which can be deferred (see scheduleOpenEmail).
  function focusEmailRow(emailId, { resetSelection = true } = {}) {
    openId = emailId;
    focusId = emailId;
    // Opening an e-mail by a normal click/arrow ends a range selection in
    // progress; Shift+arrow calls this with resetSelection:false, since it keeps
    // controlling the anchor itself between one press and the next.
    if (resetSelection) {
      selectionAnchorId = null;
      selectionSessionLow = null;
      selectionSessionHigh = null;
    }
    listEl.querySelectorAll('.email-row').forEach((row) => {
      row.classList.toggle('open', row.dataset.id === emailId);
      row.classList.toggle('focused', row.dataset.id === emailId);
    });
  }

  const READ_DEBOUNCE_MS = 1500;
  let openEmailDebounceTimer = null;

  // Used by keyboard navigation (arrow/Shift+arrow): moves the highlight at
  // once, but only fetches and renders the body if the user stays on that
  // row for READ_DEBOUNCE_MS — avoids one request per row when holding the
  // key and passing quickly over several (which caused "too many concurrent
  // requests" API errors and a lot of useless loading in the pane).
  function scheduleOpenEmail(emailId, options) {
    focusEmailRow(emailId, options);
    clearTimeout(openEmailDebounceTimer);
    openEmailDebounceTimer = setTimeout(() => {
      if (openId === emailId) openEmail(emailId, { ...options, skipFocus: true });
    }, READ_DEBOUNCE_MS);
  }

  async function openEmail(emailId, { resetSelection = true, skipFocus = false } = {}) {
    if (!skipFocus) focusEmailRow(emailId, { resetSelection });
    clearTimeout(openEmailDebounceTimer); // a real open cancels any pending debounce

    readingPane.innerHTML = '<div class="loading-state"><div class="spinner"></div>Loading e-mail...</div>';

    try {
      const email = await getEmail(emailId);
      if (openId !== emailId) return; // the user already clicked another one

      const deleteButton = folder === 'trash'
        ? `<button class="icon-btn" id="reading-delete" title="Delete permanently">${ICONS.trash}</button>`
        : `<button class="icon-btn" id="reading-delete" title="Move to the trash">${ICONS.trash}</button>`;
      const restoreButton = folder === 'trash'
        ? `<button class="icon-btn" id="reading-restore" title="Restore to the inbox">${ICONS.restore}</button>`
        : folder === 'spam'
          ? `<button class="icon-btn" id="reading-restore" title="Not spam — move to the inbox">${ICONS.notSpam}</button>`
          : '';
      const actions = restoreButton + deleteButton;

      const messages = email.messages || [];
      const lastIndex = messages.length - 1;

      // The whole conversation stacked in a single message, like Gmail: the most
      // recent comes open, the earlier ones stay collapsed (just sender + snippet
      // + date) and expand on click.
      const messagesHtml = messages.map((msg, index) => `
        <div class="thread-message ${index === lastIndex ? 'expanded' : ''}" data-index="${index}">
          <div class="thread-message-summary">
            <span class="thread-message-from">${escapeHtml(fromName(msg.from))}</span>
            <span class="thread-message-snippet">${escapeHtml(msg.snippet || '')}</span>
            <span class="thread-message-date">${formatDateCompact(msg.date)}</span>
          </div>
          <div class="thread-message-detail">
            <div class="detail-row"><strong>De:</strong> ${escapeHtml(msg.from)}</div>
            <div class="detail-row"><strong>To:</strong> ${escapeHtml((msg.to || []).join(', '))}</div>
            <div class="detail-row"><strong>Date:</strong> ${formatDateFull(msg.date)}</div>
            ${msg.attachments?.length ? `<div class="attachments"><strong>Attachments:</strong> ${escapeHtml(msg.attachments.join(', '))}</div>` : ''}
            <div class="thread-message-body-host"></div>
          </div>
        </div>
      `).join('');

      readingPane.innerHTML = `
        <div class="reading-header">
          <div class="reading-header-top">
            <div class="email-meta">
              <span class="provider-badge ${email.provider}">${email.provider === 'google' ? 'Gmail' : 'Outlook'}</span>
              <span class="account-email">${escapeHtml(email.accountEmail)}</span>
              ${messages.length > 1 ? `<span class="thread-count">${messages.length} messages</span>` : ''}
            </div>
            <div class="reading-actions">${actions}</div>
          </div>
          <h2>${escapeHtml(email.subject)}</h2>
        </div>
        <div class="thread-messages">${messagesHtml}</div>
      `;

      openBodyHosts = [];
      const renderedIndices = new Set();

      function renderMessageBody(index) {
        if (renderedIndices.has(index)) return;
        renderedIndices.add(index);
        const msg = messages[index];
        const block = readingPane.querySelector(`.thread-message[data-index="${index}"]`);
        const bodyHost = block?.querySelector('.thread-message-body-host');
        if (!bodyHost) return;

        if (msg.bodyHtml) {
          const frame = renderHtmlBody(bodyHost, msg.bodyHtml, {
            onLinkClick: (href) => openExternal(href),
            onKeydown: handleKeyboardShortcuts,
            zoom: bodyZoom,
          });
          openBodyHosts.push({ frame });
        } else {
          const pre = document.createElement('pre');
          pre.className = 'detail-body';
          pre.textContent = msg.body;
          pre.style.fontSize = `${BASE_FONT_SIZE * bodyZoom}px`;
          bodyHost.replaceWith(pre);
          openBodyHosts.push({ pre });
        }
      }

      if (lastIndex >= 0) renderMessageBody(lastIndex);

      readingPane.querySelectorAll('.thread-message-summary').forEach((summary) => {
        summary.addEventListener('click', () => {
          const block = summary.closest('.thread-message');
          const index = Number(block.dataset.index);
          const expanding = !block.classList.contains('expanded');
          block.classList.toggle('expanded', expanding);
          if (expanding) renderMessageBody(index);
        });
      });

      readingPane.querySelector('#reading-delete').addEventListener('click', () => {
        removeEmails([emailId], { permanent: folder === 'trash' });
      });
      readingPane.querySelector('#reading-restore')?.addEventListener('click', () => {
        restoreEmails([emailId]);
      });
    } catch (err) {
      if (openId !== emailId) return;
      readingPane.innerHTML = `
        <div class="empty-state">
          <p>Error loading the e-mail:<br>${escapeHtml(err.message || 'Unknown error')}</p>
        </div>
      `;
    }
  }

  function clearReadingPane() {
    openId = null;
    openBodyHosts = [];
    selectedDomain = null;

    if (folder === 'automator') {
      readingPane.innerHTML = `
        <div class="empty-state reading-empty">
          ${ICONS.bolt}
          <p>Run progress shows up here</p>
          <div class="automation-empty-hint">
            Each automation holds one or more senders separated by ";" (e.g.
            "acmebank;shopco;newsletter") and moves to the trash everything that
            <strong>came</strong> from them — mentioning the name in the subject or
            body doesn't count. The sender's address is split on "@", ".", "_", "-"
            and the piece has to equal what you typed: "acmebank" catches
            @e.acmebank.com and acmebank@gmail.com, but "acme" catches nothing.
            Use ⚡ to run one, or "Run all" to run every enabled one — each
            row's switch decides which ones go in.
          </div>
        </div>
      `;
      return;
    }

    if (folder === 'domains') {
      readingPane.innerHTML = `
        <div class="empty-state reading-empty">
          ${ICONS.mail}
          <p>Select a domain to see its details</p>
        </div>
      `;
      return;
    }

    readingPane.innerHTML = `
      <div class="empty-state reading-empty">
        ${ICONS.mail}
        <p>Select an e-mail to read</p>
        <div class="reading-empty-shortcuts">
          <div><kbd>↑</kbd><kbd>↓</kbd> navigate</div>
          <div><kbd>Shift</kbd> + <kbd>↑</kbd><kbd>↓</kbd> select several</div>
          <div><kbd>Delete</kbd> delete</div>
        </div>
      </div>
    `;
  }

  function afterMutation(ids, failed) {
    const gone = new Set(ids);
    const removedCount = emails.filter((e) => gone.has(e.id)).length;
    emails = emails.filter((e) => !gone.has(e.id));
    // Optimistic adjustment (the loadMore() just below, if it runs, fixes it to the server's real value).
    if (total != null) total = Math.max(0, total - removedCount);
    for (const id of gone) selectedIds.delete(id);
    if (openId && gone.has(openId)) clearReadingPane();
    renderList();
    if (failed.length > 0) {
      showSyncErrors([`${failed.length} e-mail(s) failed: ${failed[0].reason?.message || ''}`]);
    }
    // Refills e-mails removed from the list, bringing more from the server if there are any
    // (and, on the way, fixes the displayed total to the server's real value).
    if (gone.size > 0 && hasMore) {
      loadMore();
    }
  }

  async function removeEmails(ids, { permanent }, nextId = null) {
    // Ignores repeated calls while a deletion is already in progress —
    // holding Delete makes the keyboard repeat much faster than the API
    // handles in parallel, and that has already caused "too many concurrent requests" errors.
    if (mutatingInFlight) return;
    mutatingInFlight = true;
    try {
      const results = await mapWithConcurrencySettled(ids, DELETE_CONCURRENCY, (id) => deleteEmail(id, { permanent, folder, query, dateFrom, dateTo, sortOrder }));
      const done = ids.filter((_, i) => results[i].status === 'fulfilled');
      afterMutation(done, results.filter((r) => r.status === 'rejected'));
      if (nextId && done.length > 0) {
        openEmail(nextId);
      }
    } finally {
      mutatingInFlight = false;
    }
  }

  function scrollEmailIntoView(emailId) {
    const row = listEl.querySelector(`.email-row[data-id="${CSS.escape(emailId)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  function handleKeyboardShortcuts(e) {
    if (folder === 'domains' || folder === 'automator') return; // e-mail shortcuts don't apply to these screens
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === 'Delete') {
      if (!openId) return;
      const filtered = filteredEmails();
      const index = filtered.findIndex((email) => email.id === openId);
      if (index === -1) return;

      e.preventDefault();
      const nextEmail = filtered[index + 1] || filtered[index - 1] || null;
      removeEmails([openId], { permanent: folder === 'trash' }, nextEmail?.id || null);
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const filtered = filteredEmails();
      if (filtered.length === 0) return;
      e.preventDefault();

      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const currentId = focusId ?? openId;
      let index = filtered.findIndex((email) => email.id === currentId);

      if (e.shiftKey) {
        // Shift+arrow opens a selection "window" from an anchor fixed
        // for this session (until Shift is released and you move without it). Everything
        // the window has already reached (selectionSessionLow..High) is under its control:
        // whatever is inside the current window gets checked, whatever fell outside is
        // unchecked — even if it had been checked by an earlier session.
        // What this session never touched keeps whatever was already selected.
        if (index === -1) {
          index = delta > 0 ? 0 : filtered.length - 1;
          selectionAnchorId = filtered[index].id;
          selectionSessionLow = index;
          selectionSessionHigh = index;
        } else {
          if (!selectionAnchorId) {
            selectionAnchorId = filtered[index].id;
            selectionSessionLow = index;
            selectionSessionHigh = index;
          }
          index = Math.min(Math.max(index + delta, 0), filtered.length - 1);
        }

        selectionSessionLow = Math.min(selectionSessionLow, index);
        selectionSessionHigh = Math.max(selectionSessionHigh, index);

        focusId = filtered[index].id;
        applyRangeSelection(selectionAnchorId, focusId, filtered, selectionSessionLow, selectionSessionHigh);
        scrollEmailIntoView(focusId);
        // It also opens in the reading pane, like normal navigation — it just doesn't
        // reset the anchor, so the range can keep being extended afterwards.
        // Debounced: holding Shift+arrow must not fetch one e-mail per row.
        scheduleOpenEmail(focusId, { resetSelection: false });
        renderList();
        return;
      }

      const nextIndex = index === -1
        ? (delta > 0 ? 0 : filtered.length - 1)
        : Math.min(Math.max(index + delta, 0), filtered.length - 1);

      if (nextIndex !== index || !openId) {
        // Debounced: holding the arrow must not fire one request per row.
        scheduleOpenEmail(filtered[nextIndex].id);
        scrollEmailIntoView(filtered[nextIndex].id);
      }
    }
  }

  // Applies this Shift+arrow session's selection window. Rows inside the
  // current window (between the anchor and the focus) get checked; rows the session
  // reached before (sessionLow..sessionHigh) but that fell outside the
  // current window get unchecked — even if they were checked before.
  // Rows outside this session's reach aren't touched (it keeps other
  // selections made before this session started).
  function applyRangeSelection(anchorId, focusIdValue, filtered, sessionLow, sessionHigh) {
    const anchorIndex = filtered.findIndex((email) => email.id === anchorId);
    const focusIndex = filtered.findIndex((email) => email.id === focusIdValue);
    if (anchorIndex === -1 || focusIndex === -1) return;

    const windowStart = Math.min(anchorIndex, focusIndex);
    const windowEnd = Math.max(anchorIndex, focusIndex);

    for (let i = sessionLow; i <= sessionHigh; i++) {
      const id = filtered[i]?.id;
      if (!id) continue;
      if (i >= windowStart && i <= windowEnd) selectedIds.add(id);
      else selectedIds.delete(id);
    }
  }

  async function restoreEmails(ids) {
    if (mutatingInFlight) return;
    mutatingInFlight = true;
    try {
      const results = await mapWithConcurrencySettled(ids, DELETE_CONCURRENCY, (id) => restoreEmail(id, { folder, query, dateFrom, dateTo, sortOrder }));
      const done = ids.filter((_, i) => results[i].status === 'fulfilled');
      afterMutation(done, results.filter((r) => r.status === 'rejected'));
    } finally {
      mutatingInFlight = false;
    }
  }

  // A filter (search, period or order) changes what is being asked of the
  // server — if it changes while an answer is still on its way, that
  // answer is stale and must not be applied.
  function currentRequestSignature() {
    return `${folder}:${query}:${dateFrom}:${dateTo}:${sortOrder}`;
  }

  async function loadMore() {
    if (loadingMore || !hasMore || syncing) return;
    loadingMore = true;
    const requestedSignature = currentRequestSignature();
    renderList();

    try {
      const result = await listEmails({ folder, loadMore: true, query, dateFrom, dateTo, sortOrder, currentEmails: emails });
      if (currentRequestSignature() === requestedSignature) {
        emails = result.emails;
        hasMore = result.hasMore;
        total = result.total;
        if (result.errors?.length) showSyncErrors(result.errors);
      }
    } catch (err) {
      if (currentRequestSignature() === requestedSignature) {
        showSyncErrors([err.message || 'Error loading more e-mails']);
      }
    } finally {
      loadingMore = false;
      if (currentRequestSignature() === requestedSignature) renderList();
    }
  }

  async function sync({ refresh }) {
    if (syncing) return;
    syncing = true;
    refreshBtn.classList.add('spinning');
    const requestedSignature = currentRequestSignature();

    try {
      const result = await listEmails({ refresh, folder, query, dateFrom, dateTo, sortOrder });
      if (currentRequestSignature() !== requestedSignature) return; // changed tab/search/filter during the request
      emails = result.emails;
      hasMore = result.hasMore;
      total = result.total;
      updateSyncInfo(result.syncedAt);
      showSyncErrors(result.errors);
      renderList();

      // Stale cache? Refreshes in the background without freezing the screen (only
      // outside a search, which never uses the cache).
      if (result.fromCache && Date.now() - result.syncedAt > STALE_MS) {
        syncing = false;
        refreshBtn.classList.remove('spinning');
        return sync({ refresh: true });
      }
    } catch (err) {
      if (currentRequestSignature() !== requestedSignature) return;
      if (emails.length === 0) {
        const needsReconnect = /reconnect|authorization revoked|session expired|refresh token/i.test(err.message || '');
        listEl.innerHTML = `
          <div class="empty-state">
            <p>Error ${query ? 'searching' : 'loading'} e-mails:<br>${escapeHtml(err.message || 'Unknown error')}</p>
            <div style="display: flex; gap: 12px; justify-content: center; margin-top: 16px; flex-wrap: wrap;">
              <button class="btn btn-primary" id="retry-btn">Try again</button>
              ${needsReconnect ? `<button class="btn" id="manage-accounts-btn">Manage accounts</button>` : ''}
            </div>
          </div>
        `;
        listEl.querySelector('#retry-btn')?.addEventListener('click', () => sync({ refresh: true }));
        listEl.querySelector('#manage-accounts-btn')?.addEventListener('click', () => navigate('login'));
      } else {
        showSyncErrors([err.message || 'Error syncing']);
      }
    } finally {
      syncing = false;
      refreshBtn.classList.remove('spinning');
    }
  }

  // Restarts the listing from scratch — used when switching folders and changing the search,
  // since both change what must be fetched from the server.
  function restartListing() {
    emails = [];
    hasMore = true; // optimistic; sync() adjusts it to the real value
    total = null;
    loadingMore = false;
    selectedIds.clear();
    selectionAnchorId = null;
    selectionSessionLow = null;
    selectionSessionHigh = null;
    clearReadingPane();
    listEl.innerHTML = `<div class="loading-state"><div class="spinner"></div>${query ? 'Searching...' : 'Loading e-mails...'}</div>`;
    sync({ refresh: false });
  }

  // presetQuery is used by the "See e-mails from this sender" button on the
  // Domains screen: switches to the Inbox with the search already filled in, in one step.
  function switchFolder(next, { presetQuery = null } = {}) {
    if (next === folder && presetQuery == null) return;
    // Domains and Automator have local filters of their own, separate from the
    // e-mail search — on entering or leaving either of them, we start from scratch.
    const enteringSpecial = !isEmailFolder(next);
    const leavingSpecial = !isEmailFolder(folder);
    folder = next;
    folderNavItems.forEach((item) => item.classList.toggle('active', item.dataset.folder === folder));

    if (presetQuery != null) {
      query = presetQuery;
      searchInput.value = presetQuery;
      searchClear.hidden = presetQuery.length === 0;
    } else if (enteringSpecial || leavingSpecial) {
      query = '';
      domainsQuery = '';
      automationQuery = '';
      searchInput.value = '';
      searchClear.hidden = true;
    }

    selectedIds.clear();
    // Buttons that only make sense outside the special screens.
    newAutomationBtn.hidden = true;
    runAllAutomationsBtn.hidden = true;
    clearReadingPane();

    if (folder === 'domains') {
      searchInput.placeholder = 'Filter the loaded domains...';
      selectAllEl.hidden = true;
      restoreSelectedBtn.hidden = true;
      deleteSelectedBtn.hidden = true;
      emptyTrashBtn.hidden = true;
      filterWrapEl.hidden = true;
      closeFilterPopover();
      startDomainsView();
    } else if (folder === 'automator') {
      searchInput.placeholder = 'Filter automations...';
      selectAllEl.hidden = true;
      restoreSelectedBtn.hidden = true;
      deleteSelectedBtn.hidden = true;
      emptyTrashBtn.hidden = true;
      newAutomationBtn.hidden = false;
      filterWrapEl.hidden = true;
      closeFilterPopover();
      startAutomatorView();
    } else {
      // The search is always within the open folder — the placeholder makes that clear.
      const placeholderByFolder = {
        trash: 'Search the trash...',
        spam: 'Search spam...',
      };
      searchInput.placeholder = placeholderByFolder[folder] || 'Search by sender, subject or content...';
      selectAllEl.hidden = false;
      filterWrapEl.hidden = false;
      restartListing();
    }
  }

  // --- Domains: who has e-mailed me (a proxy for "where I have an account") ---

  function filteredDomains() {
    if (!domainsQuery) return domains;
    const q = domainsQuery.toLowerCase();
    return domains.filter((d) => d.domain.toLowerCase().includes(q) || d.name.toLowerCase().includes(q));
  }

  function renderDomainsList() {
    const filtered = filteredDomains();

    if (domains.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No domains found yet.</div>';
      updateDomainsToolbar();
      return;
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-state">Nothing found for "${escapeHtml(domainsQuery)}".</div>`;
      updateDomainsToolbar();
      return;
    }

    const rows = filtered.map((d) => `
      <div class="domain-row ${d.domain === selectedDomain ? 'open' : ''}" data-domain="${escapeHtml(d.domain)}">
        <div class="domain-row-body">
          <div class="domain-row-line1">
            <span class="domain-row-name">${escapeHtml(d.name)}</span>
            <span class="domain-row-count">${d.count}</span>
          </div>
          <div class="domain-row-line2">${escapeHtml(d.domain)} · last seen ${formatDateCompact(d.lastSeen)}</div>
        </div>
      </div>
    `).join('');

    let pagingRow = '';
    if (domainsLoadingMore) {
      pagingRow = '<div class="load-more-row"><div class="spinner spinner-small"></div></div>';
    } else if (!domainsHasMore) {
      pagingRow = '<div class="load-more-row load-more-end">The whole mailbox has been scanned</div>';
    }

    listEl.innerHTML = rows + pagingRow;

    listEl.querySelectorAll('.domain-row').forEach((row) => {
      row.addEventListener('click', () => openDomain(row.dataset.domain));
    });

    updateDomainsToolbar();
  }

  function updateDomainsToolbar() {
    const filtered = filteredDomains();
    selectionInfo.textContent = domainsQuery
      ? `${filtered.length} of ${domains.length} domains`
      : `${domains.length} domain${domains.length !== 1 ? 's' : ''} · ${domainsScanned} e-mail${domainsScanned !== 1 ? 's' : ''} scanned`;
  }

  function openDomain(domain) {
    selectedDomain = domain;
    listEl.querySelectorAll('.domain-row').forEach((row) => {
      row.classList.toggle('open', row.dataset.domain === domain);
    });

    const info = domains.find((d) => d.domain === domain);
    if (!info) return;

    readingPane.innerHTML = `
      <div class="reading-header">
        <h2>${escapeHtml(info.name)}</h2>
        <div class="detail-row"><strong>Domain:</strong> ${escapeHtml(info.domain)}</div>
        <div class="detail-row"><strong>E-mails received:</strong> ${info.count}</div>
        <div class="detail-row"><strong>First contact:</strong> ${formatDateFull(info.firstSeen)}</div>
        <div class="detail-row"><strong>Last contact:</strong> ${formatDateFull(info.lastSeen)}</div>
      </div>
      <button class="btn btn-primary" id="see-domain-emails-btn" style="margin-top: 16px;">See e-mails from this sender</button>
    `;

    readingPane.querySelector('#see-domain-emails-btn').addEventListener('click', () => {
      switchFolder('inbox', { presetQuery: info.domain });
    });
  }

  async function startDomainsView() {
    domains = [];
    domainsHasMore = true;
    domainsLoadingMore = false;
    domainsScanned = 0;
    selectedDomain = null;
    listEl.innerHTML = '<div class="loading-state"><div class="spinner"></div>Scanning e-mails...</div>';
    await loadDomains({ refresh: false });
  }

  async function loadDomains({ refresh }) {
    if (domainsSyncing) return;
    domainsSyncing = true;
    refreshBtn.classList.add('spinning');

    try {
      const result = await listDomains({ refresh });
      if (folder !== 'domains') return; // the user switched tabs during the request
      domains = result.domains;
      domainsHasMore = result.hasMore;
      domainsScanned = result.scanned;
      updateSyncInfo(result.syncedAt);
      showSyncErrors(result.errors);
      renderDomainsList();
    } catch (err) {
      if (folder !== 'domains') return;
      if (domains.length === 0) {
        listEl.innerHTML = `
          <div class="empty-state">
            <p>Error scanning e-mails:<br>${escapeHtml(err.message || 'Unknown error')}</p>
            <button class="btn btn-primary" id="retry-btn" style="margin-top: 16px;">Try again</button>
          </div>
        `;
        listEl.querySelector('#retry-btn')?.addEventListener('click', () => loadDomains({ refresh: true }));
      } else {
        showSyncErrors([err.message || 'Error scanning e-mails']);
      }
    } finally {
      domainsSyncing = false;
      refreshBtn.classList.remove('spinning');
    }
  }

  async function loadMoreDomains() {
    if (domainsLoadingMore || !domainsHasMore || domainsSyncing) return;
    domainsLoadingMore = true;
    renderDomainsList();

    try {
      const result = await listDomains({ loadMore: true });
      if (folder !== 'domains') return;
      domains = result.domains;
      domainsHasMore = result.hasMore;
      domainsScanned = result.scanned;
      if (result.errors?.length) showSyncErrors(result.errors);
    } catch (err) {
      if (folder === 'domains') showSyncErrors([err.message || 'Error loading more domains']);
    } finally {
      domainsLoadingMore = false;
      if (folder === 'domains') renderDomainsList();
    }
  }

  // --- Automator: rules that move e-mails to the trash in bulk ---

  function filteredRules() {
    if (!automationQuery) return automationRules;
    const q = automationQuery.toLowerCase();
    return automationRules.filter(
      (r) => (r.name || '').toLowerCase().includes(q) || (r.query || '').toLowerCase().includes(q)
    );
  }

  function automationRunSummary(rule) {
    if (!rule.lastRunAt) return 'never run';
    return `last: ${rule.lastRunCount || 0} e-mail(s) on ${formatDateCompact(rule.lastRunAt)}`;
  }

  // Rules created before the toggle existed lack the field — they count as active.
  function isRuleEnabled(rule) {
    return rule.enabled !== false;
  }

  // Each rule term is a sender DOMAIN, not free text: "acme"
  // means "e-mails coming from @acme...". It takes several separated by ";"
  // — e.g. "acmebank;shopco;news" cleans all three at once — and tolerates the user
  // typing with an "@" in front or the full domain ("shopco.com").
  function ruleTerms(rule) {
    return String(rule.query || '')
      .split(';')
      .map((t) => normalizeDomainTerm(t))
      .filter(Boolean);
  }

  // Space is the only one that disappears without becoming a separator: "ACME BANK" is one
  // word ("acmebank"). The other special characters stay and count as separators in the
  // comparison; at the ends ("@shopco", "shopco.") they are just typing noise.
  function normalizeDomainTerm(term) {
    return String(term || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  }

  // The sender's address from the From header ("Name <x@domain.com>").
  // Only the address: the display name is left out on purpose, otherwise someone
  // named "Shopco" sending from a personal Gmail would match without being Shopco.
  function senderAddress(from) {
    const raw = String(from || '');
    const inAngles = raw.match(/<([^>]+)>/);
    const address = inAngles ? inAngles[1] : (raw.match(/\S+@\S+/)?.[0] || '');
    return address.trim().toLowerCase();
  }

  // Every character that isn't a letter or a digit splits a piece: "@", ".", "_",
  // "-", "+"... It applies to the address and to the term, so both are
  // split the same way before comparing.
  const PIECE_SEPARATOR = /[^\p{L}\p{N}]+/u;

  // Comparison by piece, and EQUAL — no "starts with". It splits the whole
  // address on the separators and requires one piece to be identical to the term:
  //
  //   x@e.acmebank.com         →  [x, e, acmebank, com]
  //   acmebank@gmail.com       →  [acmebank, gmail, com]
  //   no-reply_acmebank@...    →  [no, reply, acmebank, ...]
  //   term "acmebank"          →  matches all three ✓ (before or after the @, either way)
  //   term "acme"              →  no piece is "acme", so it matches nothing
  //   term "bb"                →  no piece is "bb", so @abbott.com stays
  //
  // A term with a separator ("shopco.com", "acme-bank") counts as a sequence:
  // its pieces must appear in the same order, right next to each other.
  function addressMatchesTerm(address, term) {
    if (!address || !term) return false;
    const pieces = address.split(PIECE_SEPARATOR).filter(Boolean);
    const wanted = term.split(PIECE_SEPARATOR).filter(Boolean);
    if (wanted.length === 0 || wanted.length > pieces.length) return false;
    return pieces.some((_, i) => wanted.every((w, j) => pieces[i + j] === w));
  }

  // What the provider search returns still matches subject/body — it is just a
  // coarse sieve. This is what decides: without the sender filter, an
  // e-mail that merely *mentions* "shopco" would go to the trash along with Shopco's.
  // (In a conversation, the sender considered is the last message's — it is what the
  // listing brings, the same that shows on the list row.)
  function senderMatchesTerm(from, term) {
    return addressMatchesTerm(senderAddress(from), term);
  }

  // The search sent to the provider: "from:" so Gmail/Graph already filter by
  // sender, with the loose term in the OR because not every provider search matches
  // part of a word inside the address — better to bring too much and sift it
  // here than to miss an e-mail that should go.
  function ruleSearchQuery(term) {
    return `(from:${term} OR ${term})`;
  }

  function formatTerms(rule) {
    const terms = ruleTerms(rule);
    return terms.map((t) => `"${t}"`).join(', ');
  }

  // Two equal names make it impossible to know which rule is which in the list —
  // and "Run all" becomes a lottery. Compared without accents/case/extra spaces.
  function normalizeName(name) {
    return String(name || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function findDuplicateName(name, exceptId = null) {
    const target = normalizeName(name);
    return automationRules.find((r) => r.id !== exceptId && normalizeName(r.name) === target) || null;
  }

  function enabledRules() {
    return automationRules.filter(isRuleEnabled);
  }

  function updateAutomatorToolbar() {
    const count = automationRules.length;
    const active = enabledRules().length;
    selectionInfo.textContent = count === 0
      ? '0 automations'
      : `${count} ${count === 1 ? 'automation' : 'automations'} · ${active} active`;

    // Offering "run all" only makes sense if some rule is active.
    runAllAutomationsBtn.hidden = folder !== 'automator' || active === 0;
    runAllAutomationsBtn.textContent = running ? 'Running...' : `▶ Run all (${active})`;
    runAllAutomationsBtn.disabled = running;
  }

  async function startAutomatorView() {
    listEl.innerHTML = '<div class="loading-state"><div class="spinner"></div>Loading automations...</div>';
    try {
      automationRules = await getAutomationRules();
    } catch (err) {
      automationRules = [];
      showSyncErrors([err.message || 'Error loading automations']);
    }
    if (folder !== 'automator') return; // switched tabs during the load
    renderAutomatorList();
  }

  function renderAutomatorList() {
    updateAutomatorToolbar();
    const filtered = filteredRules();

    if (automationRules.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No automations yet.<br>Click "+ New automation" to create one.</div>';
      return;
    }
    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-state">Nothing found for "${escapeHtml(automationQuery)}".</div>`;
      return;
    }

    listEl.innerHTML = filtered.map((rule) => {
      const on = isRuleEnabled(rule);
      return `
      <div class="automation-row ${on ? '' : 'off'}" data-id="${escapeHtml(rule.id)}">
        <label class="switch" title="${on ? 'Disable automation' : 'Enable automation'}">
          <input type="checkbox" class="rule-toggle" data-id="${escapeHtml(rule.id)}" ${on ? 'checked' : ''}>
          <span class="switch-track"></span>
        </label>
        <div class="automation-row-body">
          <div class="automation-row-line1">
            <span class="automation-row-name">${escapeHtml(rule.name)}</span>
            ${on ? '' : '<span class="automation-off-badge">disabled</span>'}
          </div>
          <div class="automation-row-line2">${ruleTerms(rule).length > 1 ? 'remetentes' : 'remetente'}: ${escapeHtml(formatTerms(rule))} · ${automationRunSummary(rule)}</div>
        </div>
        <div class="automation-row-actions">
          <button class="icon-btn action-run" data-id="${escapeHtml(rule.id)}" title="Run now">${ICONS.boltSmall}</button>
          <button class="icon-btn action-edit" data-id="${escapeHtml(rule.id)}" title="Edit automation">${ICONS.edit}</button>
          <button class="icon-btn action-delete" data-id="${escapeHtml(rule.id)}" title="Delete automation">${ICONS.trash}</button>
        </div>
      </div>
    `;
    }).join('');

    const ruleOf = (btn) => automationRules.find((r) => r.id === btn.dataset.id);
    const wire = (selector, handler) => {
      listEl.querySelectorAll(selector).forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const rule = ruleOf(btn);
          if (rule) handler(rule);
        });
      });
    };
    wire('.automation-row .action-run', (rule) => runRule(rule));
    wire('.automation-row .action-edit', (rule) => showRuleForm(rule));
    wire('.automation-row .action-delete', (rule) => removeRule(rule));

    // Clicking the row (outside the buttons) opens the edit — the right pane is
    // only for runs now, there's no "rule detail" to open any more.
    listEl.querySelectorAll('.automation-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.icon-btn') || e.target.closest('.switch')) return;
        const rule = automationRules.find((r) => r.id === row.dataset.id);
        if (rule) showRuleForm(rule);
      });
    });

    listEl.querySelectorAll('.rule-toggle').forEach((toggle) => {
      toggle.addEventListener('click', (e) => e.stopPropagation());
      toggle.addEventListener('change', () => {
        const rule = automationRules.find((r) => r.id === toggle.dataset.id);
        if (rule) setRuleEnabled(rule, toggle.checked);
      });
    });
  }

  // Enabling/disabling touches no e-mail at all — it only decides whether the rule joins
  // "Run all". Running a disabled rule by hand is still allowed.
  async function setRuleEnabled(rule, enabled) {
    const previous = isRuleEnabled(rule);
    rule.enabled = enabled; // optimistic: the list already re-renders with the new state
    renderAutomatorList();
    try {
      automationRules = await saveAutomationRule({ id: rule.id, enabled });
    } catch (err) {
      rule.enabled = previous;
      showSyncErrors([err.message || 'Error saving the automation']);
    }
    if (folder === 'automator') renderAutomatorList();
  }

  // Creating and editing happen in a centered modal — the reading pane
  // is kept for viewing/running the automation.
  async function showRuleForm(rule = null) {
    const isEdit = !!rule;
    const values = await automationFormDialog({
      rule,
      validate: ({ name, query: q }) => {
        if (!name || !q) return 'Fill in the name and the senders.';
        if (ruleTerms({ query: q }).length === 0) return 'Enter at least one valid sender.';
        const duplicate = findDuplicateName(name, isEdit ? rule.id : null);
        if (duplicate) return `An automation named "${duplicate.name}" already exists. Pick another name.`;
        return null;
      },
    });
    if (!values) return; // cancelled

    const id = isEdit ? rule.id : crypto.randomUUID();
    try {
      automationRules = await saveAutomationRule({
        id,
        name: values.name,
        query: values.query,
        enabled: isEdit ? isRuleEnabled(rule) : true,
      });
    } catch (err) {
      showSyncErrors([err.message || 'Error saving automation']);
      return;
    }
    if (folder !== 'automator') return;
    renderAutomatorList();
  }

  async function removeRule(rule) {
    const confirmed = await confirmDialog({
      title: `Delete the automation "${rule.name}"?`,
      message: 'Existing e-mails are not affected.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    try {
      automationRules = await deleteAutomationRule(rule.id);
    } catch (err) {
      showSyncErrors([err.message || 'Error deleting automation']);
      return;
    }
    if (folder !== 'automator') return;
    renderAutomatorList();
  }

  // Gathers every page of a search — the bulk deletion needs the whole
  // list, not only the first page.
  async function collectMatchingEmails(searchQuery) {
    let result = await listEmails({ folder: 'inbox', query: searchQuery, sortOrder: 'desc' });
    let all = result.emails;
    let guard = 0; // guard against an infinite loop (if hasMore gets stuck on true)
    while (result.hasMore && guard < 500) {
      guard++;
      const before = all.length;
      result = await listEmails({ folder: 'inbox', loadMore: true, query: searchQuery, sortOrder: 'desc', currentEmails: all });
      all = result.emails;
      if (all.length === before) break;
    }
    return all;
  }

  // Fetches, one domain at a time, everything matching the rule. Sequential on
  // purpose (each search already pages several times on the server) and without repeating
  // e-mails: two terms of the same rule often land in the same conversation.
  async function collectRuleMatches(rule, onSearch) {
    const terms = ruleTerms(rule);
    const seen = new Set();
    const matches = []; // { id, query } — the query goes along because the deletion uses it to adjust the cache
    for (let i = 0; i < terms.length; i++) {
      onSearch?.({ term: terms[i], index: i, total: terms.length, found: matches.length });
      const searchQuery = ruleSearchQuery(terms[i]);
      for (const email of await collectMatchingEmails(searchQuery)) {
        if (seen.has(email.id)) continue;
        // Only what came FROM the domain goes; a mention in the subject/body doesn't count.
        if (!senderMatchesTerm(email.from, terms[i])) continue;
        seen.add(email.id);
        matches.push({ id: email.id, query: searchQuery });
      }
    }
    return matches;
  }

  // The core of running a rule, with no UI at all: fetches everything matching
  // the terms, moves it to the trash and returns the summary. The caller decides
  // how to show it (a single run in the rule's pane or "run all").
  async function executeRule(rule, { onSearch, onProgress } = {}) {
    const matches = await collectRuleMatches(rule, onSearch);
    if (matches.length === 0) return { total: 0, okCount: 0, failCount: 0, networkDown: false };

    let done = 0;
    // If the network drops midway, there's no point insisting on each remaining e-mail:
    // as soon as a connection error shows up, the following requests are
    // short-circuited (avoids firing dozens of doomed requests).
    let networkDown = false;
    onProgress?.({ done: 0, total: matches.length });
    const results = await mapWithConcurrencySettled(matches, DELETE_CONCURRENCY, async ({ id, query: searchQuery }) => {
      if (networkDown) throw new Error('offline');
      try {
        const r = await deleteEmail(id, { permanent: false, folder: 'inbox', query: searchQuery });
        done++;
        onProgress?.({ done, total: matches.length });
        return r;
      } catch (err) {
        if (isNetworkError(err)) networkDown = true;
        throw err;
      }
    });
    const okCount = results.filter((r) => r.status === 'fulfilled').length;

    // Only records run stats if it actually moved something.
    if (okCount > 0) {
      try {
        automationRules = await saveAutomationRule({ id: rule.id, lastRunAt: Date.now(), lastRunCount: okCount });
      } catch {}
    }

    return { total: matches.length, okCount, failCount: results.length - okCount, networkDown };
  }

  // A short text for a rule's result — the same sentence in a single run and
  // in the bulk run, since both now use the same pane.
  function runResultMessage({ total, okCount, failCount, networkDown }) {
    if (total === 0) return { text: 'nothing found', cls: '' };
    if (networkDown) return { text: `no connection — ${okCount} moved before it dropped`, cls: 'error' };
    if (failCount > 0) return { text: `${okCount} moved, ${failCount} failed`, cls: 'error' };
    return { text: `${okCount} e-mail(s) para a lixeira`, cls: 'success' };
  }

  // The run pane (right side). One row per rule — it serves both
  // "Run all" and a single run.
  function renderRunPanel(rules, title) {
    readingPane.innerHTML = `
      <div class="reading-header">
        <div class="reading-header-top">
          <div class="email-meta"><span class="automation-badge">Running</span></div>
        </div>
        <h2>${escapeHtml(title)}</h2>
      </div>
      <div class="run-all-list">
        ${rules.map((rule) => `
          <div class="run-all-item" data-id="${escapeHtml(rule.id)}">
            <span class="run-all-item-name">${escapeHtml(rule.name)}</span>
            <span class="run-all-item-status">queued</span>
          </div>
        `).join('')}
      </div>
      <div class="rule-run-status" id="run-all-summary"></div>
    `;
  }

  // Runs a list of rules, one at a time. Sequential on purpose:
  // each rule already fires DELETE_CONCURRENCY deletions in parallel, and running
  // several together blows the API's simultaneous request limit.
  async function runRules(rules, { confirmTitle, confirmMessage, panelTitle }) {
    if (running) return;
    if (rules.length === 0) return;

    const confirmed = await confirmDialog({
      title: confirmTitle,
      message: confirmMessage,
      confirmLabel: 'Run',
      danger: true,
    });
    if (!confirmed) return;

    running = true;
    renderRunPanel(rules, panelTitle);
    renderAutomatorList();

    const setItemStatus = (id, html, cls = '') => {
      const el = readingPane.querySelector(`.run-all-item[data-id="${CSS.escape(id)}"] .run-all-item-status`);
      if (!el) return; // the pane was replaced — just ignore it
      el.className = `run-all-item-status ${cls}`.trim();
      el.innerHTML = html;
    };
    const setSummary = (html, cls = '') => {
      const el = readingPane.querySelector('#run-all-summary');
      if (!el) return;
      el.className = `rule-run-status ${cls}`.trim();
      el.innerHTML = html;
    };

    let totalMoved = 0;
    let failedRules = 0;
    try {
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        setSummary(rules.length > 1
          ? `<div class="spinner-small"></div>Running ${i + 1} of ${rules.length}: ${escapeHtml(rule.name)}...`
          : `<div class="spinner-small"></div>Running "${escapeHtml(rule.name)}"...`);
        readingPane.querySelector(`.run-all-item[data-id="${CSS.escape(rule.id)}"]`)?.classList.add('running');
        setItemStatus(rule.id, 'procurando...');
        try {
          const result = await executeRule(rule, {
            onSearch: ({ term, index, total }) => {
              setItemStatus(rule.id, total > 1 ? `procurando "${escapeHtml(term)}" (${index + 1}/${total})...` : 'procurando...');
            },
            onProgress: ({ done, total }) => {
              setItemStatus(rule.id, `movendo ${done} de ${total}...`);
            },
          });
          totalMoved += result.okCount;
          if (result.failCount > 0 || result.networkDown) failedRules++;
          const { text, cls } = runResultMessage(result);
          setItemStatus(rule.id, escapeHtml(text), cls);
          // The network dropped: the next rules would only pile error upon error.
          if (result.networkDown) {
            setSummary('No stable internet connection — the run was stopped. Check the network and try again.', 'error');
            return;
          }
        } catch (err) {
          failedRules++;
          setItemStatus(rule.id, escapeHtml(err.message || 'erro'), 'error');
          if (isNetworkError(err)) {
            setSummary('No internet connection — the run was stopped. Check your network and try again.', 'error');
            return;
          }
        } finally {
          readingPane.querySelector(`.run-all-item[data-id="${CSS.escape(rule.id)}"]`)?.classList.remove('running');
        }
      }

      setSummary(
        failedRules > 0
          ? `✓ ${totalMoved} e-mail(s) moved to the trash. ${failedRules} automation(s) failed.`
          : `✓ Done — ${totalMoved} e-mail(s) moved to the trash.`,
        failedRules > 0 ? 'error' : 'success'
      );
    } finally {
      running = false;
      if (folder === 'automator') renderAutomatorList();
    }
  }

  function runRule(rule) {
    const terms = ruleTerms(rule);
    return runRules([rule], {
      confirmTitle: `Run "${rule.name}"?`,
      confirmMessage: terms.length > 1
        ? `This will look for every e-mail received from any of these ${terms.length} senders — ${formatTerms(rule)} — and move them to the trash.`
        : `This will look for every e-mail received from "${terms[0] || rule.query}" and move them to the trash.`,
      panelTitle: rule.name,
    });
  }

  function runAllRules() {
    const rules = enabledRules();
    if (rules.length === 0) return;
    const plural = rules.length === 1 ? '' : 's';
    return runRules(rules, {
      confirmTitle: `Run ${rules.length} active automation${plural}?`,
      confirmMessage: 'Disabled automations are left out. Every e-mail received from the registered senders will be moved to the trash.',
      panelTitle: `${rules.length} active automation${plural}`,
    });
  }

  // --- Bar events ---

  folderNavItems.forEach((item) => {
    item.addEventListener('click', () => switchFolder(item.dataset.folder));
  });

  // The e-mail search goes to the server (Gmail/Graph); the domain one is local
  // (the scanned domains all stay in memory, the filter is instant).
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    if (folder === 'domains') {
      domainsQuery = searchInput.value.trim();
      searchClear.hidden = domainsQuery.length === 0;
      renderDomainsList();
      return;
    }
    if (folder === 'automator') {
      automationQuery = searchInput.value.trim();
      searchClear.hidden = automationQuery.length === 0;
      renderAutomatorList();
      return;
    }
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const newQuery = searchInput.value.trim();
      if (newQuery === query) return;
      query = newQuery;
      searchClear.hidden = query.length === 0;
      restartListing();
    }, 400);
  });

  searchClear.addEventListener('click', () => {
    if (folder === 'domains') {
      if (!domainsQuery) return;
      searchInput.value = '';
      domainsQuery = '';
      searchClear.hidden = true;
      renderDomainsList();
      searchInput.focus();
      return;
    }
    if (folder === 'automator') {
      if (!automationQuery) return;
      searchInput.value = '';
      automationQuery = '';
      searchClear.hidden = true;
      renderAutomatorList();
      searchInput.focus();
      return;
    }
    if (!query) return;
    searchInput.value = '';
    query = '';
    searchClear.hidden = true;
    restartListing();
    searchInput.focus();
  });

  // --- Period filter (calendar with range selection) and display order ---

  const MONTH_LABELS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  function formatDateInput(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function parseDateInput(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function updateFilterBadge() {
    filterBadge.hidden = !dateFrom && !dateTo;
  }

  function updateSortToggleUI() {
    sortToggleBtn.title = sortOrder === 'asc' ? 'Oldest first' : 'Newest first';
    sortToggleBtn.classList.toggle('flipped', sortOrder === 'asc');
  }

  function renderCalendar() {
    calendarMonthLabel.textContent = `${MONTH_LABELS[calendarViewDate.getMonth()]} ${calendarViewDate.getFullYear()}`;

    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();

    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push('<span class="calendar-day empty"></span>');
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const classes = ['calendar-day'];
      if (isSameDay(date, today)) classes.push('today');
      if (rangeStart && isSameDay(date, rangeStart)) classes.push('range-start');
      if (rangeEnd && isSameDay(date, rangeEnd)) classes.push('range-end');
      if (rangeStart && rangeEnd && date > rangeStart && date < rangeEnd) classes.push('in-range');
      if (rangeStart && !rangeEnd && hoverDate && date > rangeStart && date <= hoverDate) classes.push('in-range-preview');
      cells.push(`<button type="button" class="${classes.join(' ')}" data-date="${formatDateInput(date)}">${day}</button>`);
    }

    calendarGrid.innerHTML = cells.join('');
  }

  function applyDateRange() {
    dateFrom = formatDateInput(rangeStart);
    dateTo = formatDateInput(rangeEnd);
    updateFilterBadge();
    closeFilterPopover();
    restartListing();
  }

  function openFilterPopover() {
    filterPopoverOpen = true;
    filterPopover.hidden = false;
    // Restarts the calendar selection from the filter already applied (if any).
    rangeStart = dateFrom ? parseDateInput(dateFrom) : null;
    rangeEnd = dateTo ? parseDateInput(dateTo) : null;
    hoverDate = null;
    const anchor = rangeStart || new Date();
    calendarViewDate = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    renderCalendar();
  }

  function closeFilterPopover() {
    filterPopoverOpen = false;
    filterPopover.hidden = true;
  }

  filterToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (filterPopoverOpen) closeFilterPopover();
    else openFilterPopover();
  });

  // Closes on a click outside the popover (but not on a click inside it).
  document.addEventListener('click', (e) => {
    if (!filterPopoverOpen || filterWrapEl.contains(e.target)) return;
    closeFilterPopover();
  }, { signal: keyboardController.signal });

  calPrevBtn.addEventListener('click', () => {
    calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() - 1, 1);
    renderCalendar();
  });

  calNextBtn.addEventListener('click', () => {
    calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() + 1, 1);
    renderCalendar();
  });

  calendarGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.calendar-day:not(.empty)');
    if (!btn) return;
    const date = parseDateInput(btn.dataset.date);

    if (!rangeStart || rangeEnd || date < rangeStart) {
      rangeStart = date;
      rangeEnd = null;
      hoverDate = null;
      renderCalendar();
    } else {
      rangeEnd = date;
      renderCalendar();
      applyDateRange();
    }
  });

  calendarGrid.addEventListener('mouseover', (e) => {
    if (!rangeStart || rangeEnd) return;
    const btn = e.target.closest('.calendar-day:not(.empty)');
    if (!btn) return;
    hoverDate = parseDateInput(btn.dataset.date);
    renderCalendar();
  });

  filterClearRangeBtn.addEventListener('click', () => {
    const hadFilter = dateFrom || dateTo;
    rangeStart = null;
    rangeEnd = null;
    hoverDate = null;
    dateFrom = '';
    dateTo = '';
    renderCalendar();
    updateFilterBadge();
    if (hadFilter) restartListing();
  });

  sortToggleBtn.addEventListener('click', () => {
    sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    updateSortToggleUI();
    restartListing();
  });

  selectAllEl.addEventListener('change', () => {
    const filtered = filteredEmails();
    if (selectAllEl.checked) {
      filtered.forEach((e) => selectedIds.add(e.id));
    } else {
      filtered.forEach((e) => selectedIds.delete(e.id));
    }
    renderList();
  });

  deleteSelectedBtn.addEventListener('click', () => {
    if (selectedIds.size === 0) return;
    removeEmails([...selectedIds], { permanent: folder === 'trash' });
  });

  restoreSelectedBtn.addEventListener('click', () => {
    if (selectedIds.size === 0) return;
    restoreEmails([...selectedIds]);
  });

  emptyTrashBtn.addEventListener('click', async () => {
    if (emails.length === 0 || mutatingInFlight) return;
    const confirmed = await confirmDialog({
      title: 'Empty the trash?',
      message: 'Every e-mail in the trash will be permanently deleted. This cannot be undone.',
      confirmLabel: 'Empty',
      danger: true,
    });
    if (!confirmed) return;

    mutatingInFlight = true;
    emptyTrashBtn.disabled = true;
    emptyTrashBtn.textContent = 'Emptying...';
    try {
      await emptyTrash();
      emails = [];
      total = 0;
      hasMore = false;
      selectedIds.clear();
      clearReadingPane();
      renderList();
    } catch (err) {
      showSyncErrors([err.message || 'Error emptying the trash']);
    } finally {
      mutatingInFlight = false;
      emptyTrashBtn.disabled = false;
      emptyTrashBtn.textContent = 'Empty trash';
    }
  });

  newAutomationBtn.addEventListener('click', () => {
    if (folder === 'automator') showRuleForm();
  });

  runAllAutomationsBtn.addEventListener('click', () => {
    if (folder === 'automator') runAllRules();
  });

  refreshBtn.addEventListener('click', () => {
    if (folder === 'domains') loadDomains({ refresh: true });
    else if (folder === 'automator') { if (!running) startAutomatorView(); }
    else sync({ refresh: true });
  });
  accountsBtn.addEventListener('click', () => navigate('login'));

  listEl.addEventListener('scroll', () => {
    const nearBottom = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 150;
    if (!nearBottom) return;
    if (folder === 'domains') loadMoreDomains();
    else if (isEmailFolder(folder)) loadMore();
  });

  // --- E-mail body zoom ---

  zoomOutBtn.addEventListener('click', () => applyBodyZoom(bodyZoom - 0.1));
  zoomInBtn.addEventListener('click', () => applyBodyZoom(bodyZoom + 0.1));
  zoomLabel.addEventListener('click', () => applyBodyZoom(1));

  // Comes from the native menu (View → zoom / Ctrl+=, Ctrl+-, Ctrl+0). If the screen
  // no longer exists (the user navigated elsewhere), it unsubscribes on its own.
  const unsubscribeZoom = onZoomChange((action) => {
    if (!container.contains(zoomLabel)) {
      unsubscribeZoom();
      return;
    }
    if (action === 'reset') applyBodyZoom(1);
    else applyBodyZoom(bodyZoom + action);
  });

  // --- Draggable divider between the list and the reading pane (35%–65%) ---

  let draggingDivider = false;
  splitDivider.addEventListener('mousedown', (e) => {
    draggingDivider = true;
    splitDivider.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!draggingDivider) return;
    if (!container.contains(splitDivider)) {
      draggingDivider = false;
      return;
    }
    const rect = splitViewEl.getBoundingClientRect();
    const pct = Math.min(65, Math.max(35, ((e.clientX - rect.left) / rect.width) * 100));
    listPaneEl.style.flexBasis = `${pct}%`;
  });
  window.addEventListener('mouseup', () => {
    if (!draggingDivider) return;
    draggingDivider = false;
    splitDivider.classList.remove('dragging');
  });

  // --- Keyboard shortcuts ---
  document.addEventListener('keydown', (e) => {
    if (!container.querySelector('#email-list')) {
      keyboardController.abort();
      return;
    }
    handleKeyboardShortcuts(e);
  }, { signal: keyboardController.signal });

  // --- Initial load ---

  bodyZoom = await getBodyZoom();
  updateZoomLabel();
  updateSortToggleUI();
  updateFilterBadge();

  const accounts = await getAccounts();
  if (accounts.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <p>No accounts connected.</p>
        <button class="btn btn-primary" id="add-account-btn" style="margin-top: 16px;">Add account</button>
      </div>
    `;
    container.querySelector('#add-account-btn')?.addEventListener('click', () => navigate('login'));
    return;
  }

  await sync({ refresh: false });
}

// Renders the e-mail HTML in an <iframe sandbox>, isolated from the app document —
// the same technique Gmail/Outlook use. That guarantees full fidelity (including the
// e-mail's own <style>, tables and fonts) without that CSS leaking into the app,
// and the sandbox (no allow-scripts) disables any embedded script/handler.
function renderHtmlBody(host, html, { onLinkClick, onKeydown, zoom = 1 } = {}) {
  const iframe = document.createElement('iframe');
  iframe.className = 'detail-body-frame';
  iframe.setAttribute('sandbox', 'allow-same-origin');
  host.replaceWith(iframe);

  // The app is dark, but HTML e-mails are designed for a light background — the
  // iframe becomes a white "sheet of paper" (the same approach as dark Gmail).
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #212121; background: #ffffff; }
    body { padding: 14px 16px; word-wrap: break-word; }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; }
    a { color: #1976d2; }
  </style></head><body>${stripScripts(html)}</body></html>`;

  iframe.addEventListener('load', () => {
    const idoc = iframe.contentDocument;
    if (!idoc) return;

    const resize = () => {
      iframe.style.height = `${idoc.documentElement.scrollHeight}px`;
    };

    // Exposed so the bar's zoom control can reapply it without reloading the iframe.
    iframe._applyZoom = (z) => {
      idoc.documentElement.style.zoom = z;
      resize();
    };
    iframe._applyZoom(zoom);

    idoc.querySelectorAll('img').forEach((img) => img.addEventListener('load', resize));

    idoc.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;
      e.preventDefault();
      onLinkClick?.(link.href);
    });

    // Forwards keyboard shortcuts even with focus inside the e-mail body.
    if (onKeydown) idoc.addEventListener('keydown', onKeydown);
  });

  iframe.srcdoc = doc;
  return iframe;
}

function stripScripts(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '');
}

// Network/DNS errors (getaddrinfo EAI_AGAIN, host not found, connection
// refused/timed out, etc.) — used to give a clear "no connection" message
// instead of leaking the raw API error.
function isNetworkError(err) {
  const msg = (err && err.message ? err.message : String(err || '')).toLowerCase();
  return /eai_again|enotfound|econnrefused|econnreset|etimedout|epipe|getaddrinfo|network|failed to fetch|socket hang up|offline/.test(msg);
}

function fromName(from) {
  if (!from) return '';
  const match = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return match ? match[1].trim() : from.replace(/[<>]/g, '').trim();
}

function formatDateCompact(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  return date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatDateFull(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
