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

const STALE_MS = 2 * 60 * 1000; // re-sincroniza em segundo plano se o cache for mais velho que isso

// Limite de exclusões/restaurações simultâneas. Selecionar muitos e-mails
// (agora que dá pra fazer isso com Shift+seta) e excluir todos de uma vez
// disparava um request por e-mail ao mesmo tempo — a API rejeitava com
// "Too many concurrent requests for user" acima de umas poucas dezenas.
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
};

export async function renderListScreen(container) {
  container.innerHTML = `
    <header class="app-header">
      <h1>Mail Reader</h1>
      <div class="header-center">
      <div class="search-box">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input type="text" id="search-input" placeholder="Buscar por remetente, assunto ou conteúdo...">
        <button class="search-clear" id="search-clear" title="Limpar" hidden>&times;</button>
      </div>
      <div class="filter-wrap" id="filter-wrap">
        <button class="icon-btn filter-toggle-btn" id="filter-toggle-btn" title="Filtros">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
          <span class="filter-badge" id="filter-badge" hidden></span>
        </button>
        <div class="filter-popover" id="filter-popover" hidden>
          <div class="calendar-nav">
            <button class="icon-btn" id="cal-prev-btn" title="Mês anterior">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <span class="calendar-month-label" id="calendar-month-label"></span>
            <button class="icon-btn" id="cal-next-btn" title="Próximo mês">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </div>
          <div class="calendar-weekdays">
            <span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span>
          </div>
          <div class="calendar-grid" id="calendar-grid"></div>
          <div class="filter-popover-footer">
            <button class="btn-link" id="filter-clear-range">Limpar período</button>
            <button class="icon-btn sort-toggle-btn" id="sort-toggle-btn" title="Mais recentes primeiro">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
            </button>
          </div>
        </div>
      </div>
      </div>
      <div class="app-header-actions">
        <span class="sync-info" id="sync-info"></span>
        <div class="zoom-control" title="Zoom do corpo do e-mail">
          <button class="icon-btn" id="zoom-out-btn" title="Diminuir zoom (Ctrl+-)">−</button>
          <button class="zoom-label" id="zoom-label" title="Redefinir zoom (Ctrl+0)">100%</button>
          <button class="icon-btn" id="zoom-in-btn" title="Aumentar zoom (Ctrl+=)">+</button>
        </div>
        <button class="icon-btn" id="refresh-btn" title="Sincronizar agora">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
        </button>
        <button class="icon-btn" id="accounts-btn" title="Contas">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
        </button>
      </div>
    </header>
    <div class="split-view">
      <div class="list-pane" id="list-pane">
        <div class="folder-tabs">
          <button class="folder-tab active" data-folder="inbox">Caixa de entrada</button>
          <button class="folder-tab" data-folder="trash">Lixeira</button>
          <button class="folder-tab" data-folder="automator">Automatizador</button>
          <button class="folder-tab" data-folder="domains">Domínios</button>
        </div>
        <div class="list-toolbar">
          <input type="checkbox" id="select-all" title="Selecionar todos">
          <span class="selection-info" id="selection-info"></span>
          <button class="btn-action-text" id="new-automation-btn" hidden>+ Nova automação</button>
          <button class="btn-action-text" id="run-all-automations-btn" hidden>▶ Executar todas</button>
          <button class="btn-action-text" id="restore-selected" hidden></button>
          <button class="btn-danger-text" id="delete-selected" hidden></button>
          <button class="btn-danger-text" id="empty-trash-btn" hidden>Esvaziar lixeira</button>
        </div>
        <div class="sync-errors" id="sync-errors" hidden></div>
        <div id="email-list" class="email-list">
          <div class="loading-state"><div class="spinner"></div>Carregando e-mails...</div>
        </div>
      </div>
      <div class="split-divider" id="split-divider"></div>
      <div class="reading-pane" id="reading-pane"></div>
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
  const folderTabs = container.querySelectorAll('.folder-tab');
  const zoomOutBtn = container.querySelector('#zoom-out-btn');
  const zoomInBtn = container.querySelector('#zoom-in-btn');
  const zoomLabel = container.querySelector('#zoom-label');
  const listPaneEl = container.querySelector('#list-pane');
  const splitViewEl = container.querySelector('.split-view');
  const splitDivider = container.querySelector('#split-divider');

  let emails = [];
  let folder = 'inbox';
  let query = '';
  let dateFrom = ''; // 'YYYY-MM-DD' ou '' (sem limite inferior)
  let dateTo = ''; // 'YYYY-MM-DD' ou '' (sem limite superior)
  let sortOrder = 'desc'; // 'desc' = mais recentes primeiro (padrão); 'asc' = mais antigos primeiro
  let filterPopoverOpen = false;
  let calendarViewDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1); // mês exibido no popover
  let rangeStart = null; // seleção em andamento no calendário (Date), só vira dateFrom/dateTo ao fechar o intervalo
  let rangeEnd = null;
  let hoverDate = null; // dia sob o mouse, pra pré-visualizar o intervalo antes de fechar
  // Criado cedo (não só na seção "Atalhos de teclado") porque o popover de
  // filtros também precisa dele pra fechar ao clicar fora, antes daquela seção.
  const keyboardController = new AbortController();
  let openId = null;
  let syncing = false;
  let hasMore = true;
  let loadingMore = false;
  let total = null; // total real da pasta no servidor (null até a 1ª resposta chegar)
  let focusId = null; // linha "em foco" pelo teclado (independente de qual está aberta na leitura)
  let selectionAnchorId = null; // ponto de partida (fixo) da sessão de seleção por Shift+seta
  let selectionSessionLow = null; // menor índice já alcançado nesta sessão
  let selectionSessionHigh = null; // maior índice já alcançado nesta sessão
  let bodyZoom = 1; // zoom do corpo do e-mail, persistido e aplicado a todos
  let openBodyHosts = []; // { frame, pre } de cada mensagem já renderizada na conversa aberta (zoom se aplica a todas)
  let mutatingInFlight = false; // trava excluir/restaurar simultâneos (segurar Delete repetia rápido demais e a API rejeitava com "too many concurrent requests")
  const selectedIds = new Set();

  // --- Aba "Domínios" (modo à parte, não é uma lista de e-mails) ---
  let domains = [];
  let domainsQuery = ''; // filtro local — os domínios já escaneados ficam todos na memória
  let domainsHasMore = true;
  let domainsLoadingMore = false;
  let domainsSyncing = false;
  let domainsScanned = 0;
  let selectedDomain = null;

  // --- Aba "Automatizador" (regras de limpeza salvas) ---
  let automationRules = [];
  let automationQuery = ''; // filtro local por nome/termo
  let running = false; // trava reentrância enquanto alguma execução está em andamento

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

  // A busca agora é feita no servidor (Gmail/Graph) — `emails` já vem filtrado
  // pela query quando houver uma; esta função existe só para manter os vários
  // pontos do código que operam sobre "a lista que está na tela" desacoplados
  // de como ela foi obtida.
  function filteredEmails() {
    return emails;
  }

  function renderList() {
    const filtered = filteredEmails();

    if (emails.length === 0) {
      const emptyMsg = query
        ? `Nada encontrado para "${escapeHtml(query)}".`
        : (folder === 'trash' ? 'A lixeira está vazia.' : 'Nenhum e-mail encontrado.');
      listEl.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
      updateToolbar();
      return;
    }

    const rowActionIcon = folder === 'trash' ? ICONS.restore : ICONS.trash;
    const rowActionTitle = folder === 'trash' ? 'Restaurar para a caixa de entrada' : 'Mover para a lixeira';

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
        <button class="icon-btn row-action" data-id="${escapeHtml(email.id)}" title="${rowActionTitle}">${rowActionIcon}</button>
      </div>
    `).join('');

    // Rolagem infinita paginando de 50 em 50 — vale tanto na listagem normal
    // quanto durante uma busca (que agora também é paginada no servidor).
    let pagingRow = '';
    if (loadingMore) {
      pagingRow = '<div class="load-more-row"><div class="spinner spinner-small"></div></div>';
    } else if (!hasMore) {
      pagingRow = `<div class="load-more-row load-more-end">${query ? 'Não há mais resultados' : 'Não há mais e-mails'}</div>`;
    }

    listEl.innerHTML = rows + pagingRow;

    listEl.querySelectorAll('.email-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.row-check') || e.target.closest('.row-action')) return;
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
    // Mantém a seleção coerente com o que existe na lista
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

    // Sempre no formato "X de Y", buscando ou não — só muda a palavra.
    const unit = query ? 'resultado' : 'e-mail';
    if (count > 0) {
      selectionInfo.textContent = `${count} selecionado${count > 1 ? 's' : ''}`;
    } else if (total != null) {
      selectionInfo.textContent = `${emails.length} de ${total} ${unit}${total !== 1 ? 's' : ''}`;
    } else {
      selectionInfo.textContent = `${emails.length} ${unit}${emails.length !== 1 ? 's' : ''}`;
    }

    restoreSelectedBtn.hidden = count === 0 || folder !== 'trash';
    restoreSelectedBtn.textContent = `Restaurar (${count})`;
    deleteSelectedBtn.hidden = count === 0;
    deleteSelectedBtn.textContent = folder === 'trash' ? `Excluir de vez (${count})` : `Excluir (${count})`;
    // Independe de seleção — esvazia a lixeira toda, não só o que está marcado.
    emptyTrashBtn.hidden = folder !== 'trash' || emails.length === 0;
  }

  function updateSyncInfo(syncedAt) {
    if (!syncedAt) return;
    const time = new Date(syncedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    syncInfoEl.textContent = `Sincronizado às ${time}`;
  }

  function showSyncErrors(errors) {
    if (errors && errors.length > 0) {
      syncErrorsEl.hidden = false;
      syncErrorsEl.textContent = `⚠ ${errors.join(' · ')}`;
    } else {
      syncErrorsEl.hidden = true;
    }
  }

  // Atualiza destaque/foco da linha na hora (sem custo de rede) — separado da
  // busca/renderização do corpo, que pode ser adiada (ver scheduleOpenEmail).
  function focusEmailRow(emailId, { resetSelection = true } = {}) {
    openId = emailId;
    focusId = emailId;
    // Abrir um e-mail por clique/seta normal encerra uma seleção por faixa em
    // andamento; já o Shift+seta chama isto com resetSelection:false, pois
    // ele mesmo continua controlando a âncora entre um aperto e o seguinte.
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

  // Usado pela navegação por teclado (seta/Shift+seta): move o destaque na
  // hora, mas só busca e renderiza o corpo se o usuário ficar parado nessa
  // linha por READ_DEBOUNCE_MS — evita um request por linha ao segurar a
  // tecla e passar rápido por várias (o que gerava erro de "muitos requests
  // simultâneos" na API e um monte de carregamento inútil no painel).
  function scheduleOpenEmail(emailId, options) {
    focusEmailRow(emailId, options);
    clearTimeout(openEmailDebounceTimer);
    openEmailDebounceTimer = setTimeout(() => {
      if (openId === emailId) openEmail(emailId, { ...options, skipFocus: true });
    }, READ_DEBOUNCE_MS);
  }

  async function openEmail(emailId, { resetSelection = true, skipFocus = false } = {}) {
    if (!skipFocus) focusEmailRow(emailId, { resetSelection });
    clearTimeout(openEmailDebounceTimer); // uma abertura de verdade cancela qualquer debounce pendente

    readingPane.innerHTML = '<div class="loading-state"><div class="spinner"></div>Carregando e-mail...</div>';

    try {
      const email = await getEmail(emailId);
      if (openId !== emailId) return; // usuário já clicou em outro

      const actions = folder === 'trash'
        ? `<button class="icon-btn" id="reading-restore" title="Restaurar para a caixa de entrada">${ICONS.restore}</button>
           <button class="icon-btn" id="reading-delete" title="Excluir definitivamente">${ICONS.trash}</button>`
        : `<button class="icon-btn" id="reading-delete" title="Mover para a lixeira">${ICONS.trash}</button>`;

      const messages = email.messages || [];
      const lastIndex = messages.length - 1;

      // Conversa inteira empilhada numa mensagem só, igual ao Gmail: a mais
      // recente já vem aberta, as anteriores ficam colapsadas (só remetente +
      // trecho + data) e expandem ao clicar.
      const messagesHtml = messages.map((msg, index) => `
        <div class="thread-message ${index === lastIndex ? 'expanded' : ''}" data-index="${index}">
          <div class="thread-message-summary">
            <span class="thread-message-from">${escapeHtml(fromName(msg.from))}</span>
            <span class="thread-message-snippet">${escapeHtml(msg.snippet || '')}</span>
            <span class="thread-message-date">${formatDateCompact(msg.date)}</span>
          </div>
          <div class="thread-message-detail">
            <div class="detail-row"><strong>De:</strong> ${escapeHtml(msg.from)}</div>
            <div class="detail-row"><strong>Para:</strong> ${escapeHtml((msg.to || []).join(', '))}</div>
            <div class="detail-row"><strong>Data:</strong> ${formatDateFull(msg.date)}</div>
            ${msg.attachments?.length ? `<div class="attachments"><strong>Anexos:</strong> ${escapeHtml(msg.attachments.join(', '))}</div>` : ''}
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
              ${messages.length > 1 ? `<span class="thread-count">${messages.length} mensagens</span>` : ''}
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
          <p>Erro ao carregar e-mail:<br>${escapeHtml(err.message || 'Erro desconhecido')}</p>
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
          <p>O progresso das execuções aparece aqui</p>
          <div class="automation-empty-hint">
            Cada automação guarda um ou mais termos separados por ";"
            (ex.: "santander;btg;itau") e move para a lixeira tudo que casar com
            eles. Use ⚡ para rodar uma, ou "Executar todas" para rodar todas as
            ativadas — o interruptor de cada linha decide quem entra.
          </div>
        </div>
      `;
      return;
    }

    if (folder === 'domains') {
      readingPane.innerHTML = `
        <div class="empty-state reading-empty">
          ${ICONS.mail}
          <p>Selecione um domínio para ver detalhes</p>
        </div>
      `;
      return;
    }

    readingPane.innerHTML = `
      <div class="empty-state reading-empty">
        ${ICONS.mail}
        <p>Selecione um e-mail para ler</p>
        <div class="reading-empty-shortcuts">
          <div><kbd>↑</kbd><kbd>↓</kbd> navegar</div>
          <div><kbd>Shift</kbd> + <kbd>↑</kbd><kbd>↓</kbd> selecionar vários</div>
          <div><kbd>Delete</kbd> excluir</div>
        </div>
      </div>
    `;
  }

  function afterMutation(ids, failed) {
    const gone = new Set(ids);
    const removedCount = emails.filter((e) => gone.has(e.id)).length;
    emails = emails.filter((e) => !gone.has(e.id));
    // Ajuste otimista (o loadMore() logo abaixo, se rodar, corrige para o valor real do servidor).
    if (total != null) total = Math.max(0, total - removedCount);
    for (const id of gone) selectedIds.delete(id);
    if (openId && gone.has(openId)) clearReadingPane();
    renderList();
    if (failed.length > 0) {
      showSyncErrors([`${failed.length} e-mail(s) com erro: ${failed[0].reason?.message || ''}`]);
    }
    // Repõe e-mails removidos da lista, trazendo mais do servidor se houver
    // (de quebra, corrige o total exibido para o valor real do servidor).
    if (gone.size > 0 && hasMore) {
      loadMore();
    }
  }

  async function removeEmails(ids, { permanent }, nextId = null) {
    // Ignora chamadas repetidas enquanto uma exclusão já está em andamento —
    // segurar Delete faz o teclado repetir bem mais rápido do que a API
    // aguenta em paralelo, e isso já causou erro de "muitos requests simultâneos".
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
    if (folder === 'domains' || folder === 'automator') return; // atalhos de e-mail não se aplicam a essas telas
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
        // Shift+seta abre uma "janela" de seleção a partir de uma âncora fixa
        // nesta sessão (até soltar o Shift e mexer sem ele). Tudo que a janela
        // já alcançou (selectionSessionLow..High) fica sob controle dela: quem
        // está dentro da janela atual fica marcado, quem ficou pra fora é
        // desmarcado — mesmo que já estivesse marcado por uma sessão anterior.
        // O que esta sessão nunca tocou mantém o que já estava selecionado.
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
        // Também abre no painel de leitura, igual a navegação normal — só não
        // reseta a âncora, pra dar pra continuar estendendo a faixa depois.
        // Debounced: segurar Shift+seta não deve buscar um e-mail por linha.
        scheduleOpenEmail(focusId, { resetSelection: false });
        renderList();
        return;
      }

      const nextIndex = index === -1
        ? (delta > 0 ? 0 : filtered.length - 1)
        : Math.min(Math.max(index + delta, 0), filtered.length - 1);

      if (nextIndex !== index || !openId) {
        // Debounced: segurar a seta não deve disparar um request por linha.
        scheduleOpenEmail(filtered[nextIndex].id);
        scrollEmailIntoView(filtered[nextIndex].id);
      }
    }
  }

  // Aplica a janela de seleção desta sessão de Shift+seta. Linhas dentro da
  // janela atual (entre a âncora e o foco) ficam marcadas; linhas que a sessão
  // já alcançou antes (sessionLow..sessionHigh) mas que ficaram de fora da
  // janela atual são desmarcadas — mesmo que estivessem marcadas de antes.
  // Linhas fora do alcance desta sessão não são tocadas (preserva outras
  // seleções feitas antes desta sessão começar).
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
      const results = await mapWithConcurrencySettled(ids, DELETE_CONCURRENCY, (id) => restoreEmail(id, { query, dateFrom, dateTo, sortOrder }));
      const done = ids.filter((_, i) => results[i].status === 'fulfilled');
      afterMutation(done, results.filter((r) => r.status === 'rejected'));
    } finally {
      mutatingInFlight = false;
    }
  }

  // Um filtro (busca, período ou ordem) muda o que está sendo pedido ao
  // servidor — se ele mudar enquanto uma resposta ainda está a caminho, essa
  // resposta ficou obsoleta e não deve ser aplicada.
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
        showSyncErrors([err.message || 'Erro ao carregar mais e-mails']);
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
      if (currentRequestSignature() !== requestedSignature) return; // mudou de aba/busca/filtro durante o request
      emails = result.emails;
      hasMore = result.hasMore;
      total = result.total;
      updateSyncInfo(result.syncedAt);
      showSyncErrors(result.errors);
      renderList();

      // Cache velho? Atualiza em segundo plano sem travar a tela (só se aplica
      // fora de uma busca, que nunca usa o cache).
      if (result.fromCache && Date.now() - result.syncedAt > STALE_MS) {
        syncing = false;
        refreshBtn.classList.remove('spinning');
        return sync({ refresh: true });
      }
    } catch (err) {
      if (currentRequestSignature() !== requestedSignature) return;
      if (emails.length === 0) {
        const needsReconnect = /reconecte|autorização revogada|sessão expirada|token de atualização/i.test(err.message || '');
        listEl.innerHTML = `
          <div class="empty-state">
            <p>Erro ao ${query ? 'buscar' : 'carregar'} e-mails:<br>${escapeHtml(err.message || 'Erro desconhecido')}</p>
            <div style="display: flex; gap: 12px; justify-content: center; margin-top: 16px; flex-wrap: wrap;">
              <button class="btn btn-primary" id="retry-btn">Tentar novamente</button>
              ${needsReconnect ? `<button class="btn" id="manage-accounts-btn">Gerenciar contas</button>` : ''}
            </div>
          </div>
        `;
        listEl.querySelector('#retry-btn')?.addEventListener('click', () => sync({ refresh: true }));
        listEl.querySelector('#manage-accounts-btn')?.addEventListener('click', () => navigate('login'));
      } else {
        showSyncErrors([err.message || 'Erro ao sincronizar']);
      }
    } finally {
      syncing = false;
      refreshBtn.classList.remove('spinning');
    }
  }

  // Reinicia a listagem do zero — usado ao trocar de pasta e ao mudar a busca,
  // já que os dois mudam o que deve ser buscado no servidor.
  function restartListing() {
    emails = [];
    hasMore = true; // otimista; sync() ajusta para o valor real
    total = null;
    loadingMore = false;
    selectedIds.clear();
    selectionAnchorId = null;
    selectionSessionLow = null;
    selectionSessionHigh = null;
    clearReadingPane();
    listEl.innerHTML = `<div class="loading-state"><div class="spinner"></div>${query ? 'Buscando...' : 'Carregando e-mails...'}</div>`;
    sync({ refresh: false });
  }

  // presetQuery é usado pelo botão "Ver e-mails desse remetente" da tela de
  // Domínios: troca pra Caixa de entrada já com a busca preenchida, num só passo.
  function switchFolder(next, { presetQuery = null } = {}) {
    if (next === folder && presetQuery == null) return;
    // Domínios e Automatizador têm filtros locais próprios, separados da busca
    // de e-mails — ao entrar ou sair de qualquer um deles, começamos do zero.
    const specialFolders = ['domains', 'automator'];
    const enteringSpecial = specialFolders.includes(next);
    const leavingSpecial = specialFolders.includes(folder);
    folder = next;
    folderTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.folder === folder));

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
    // Botões que só fazem sentido fora das telas especiais.
    newAutomationBtn.hidden = true;
    runAllAutomationsBtn.hidden = true;
    clearReadingPane();

    if (folder === 'domains') {
      searchInput.placeholder = 'Filtrar domínios já carregados...';
      selectAllEl.hidden = true;
      restoreSelectedBtn.hidden = true;
      deleteSelectedBtn.hidden = true;
      emptyTrashBtn.hidden = true;
      filterWrapEl.hidden = true;
      closeFilterPopover();
      startDomainsView();
    } else if (folder === 'automator') {
      searchInput.placeholder = 'Filtrar automações...';
      selectAllEl.hidden = true;
      restoreSelectedBtn.hidden = true;
      deleteSelectedBtn.hidden = true;
      emptyTrashBtn.hidden = true;
      newAutomationBtn.hidden = false;
      filterWrapEl.hidden = true;
      closeFilterPopover();
      startAutomatorView();
    } else {
      searchInput.placeholder = 'Buscar por remetente, assunto ou conteúdo...';
      selectAllEl.hidden = false;
      filterWrapEl.hidden = false;
      restartListing();
    }
  }

  // --- Domínios: quem já me mandou e-mail (proxy de "onde tenho cadastro") ---

  function filteredDomains() {
    if (!domainsQuery) return domains;
    const q = domainsQuery.toLowerCase();
    return domains.filter((d) => d.domain.toLowerCase().includes(q) || d.name.toLowerCase().includes(q));
  }

  function renderDomainsList() {
    const filtered = filteredDomains();

    if (domains.length === 0) {
      listEl.innerHTML = '<div class="empty-state">Nenhum domínio encontrado ainda.</div>';
      updateDomainsToolbar();
      return;
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-state">Nada encontrado para "${escapeHtml(domainsQuery)}".</div>`;
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
          <div class="domain-row-line2">${escapeHtml(d.domain)} · última vez ${formatDateCompact(d.lastSeen)}</div>
        </div>
      </div>
    `).join('');

    let pagingRow = '';
    if (domainsLoadingMore) {
      pagingRow = '<div class="load-more-row"><div class="spinner spinner-small"></div></div>';
    } else if (!domainsHasMore) {
      pagingRow = '<div class="load-more-row load-more-end">Toda a caixa já foi escaneada</div>';
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
      ? `${filtered.length} de ${domains.length} domínios`
      : `${domains.length} domínio${domains.length !== 1 ? 's' : ''} · ${domainsScanned} e-mail${domainsScanned !== 1 ? 's' : ''} escaneado${domainsScanned !== 1 ? 's' : ''}`;
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
        <div class="detail-row"><strong>Domínio:</strong> ${escapeHtml(info.domain)}</div>
        <div class="detail-row"><strong>E-mails recebidos:</strong> ${info.count}</div>
        <div class="detail-row"><strong>Primeiro contato:</strong> ${formatDateFull(info.firstSeen)}</div>
        <div class="detail-row"><strong>Último contato:</strong> ${formatDateFull(info.lastSeen)}</div>
      </div>
      <button class="btn btn-primary" id="see-domain-emails-btn" style="margin-top: 16px;">Ver e-mails desse remetente</button>
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
    listEl.innerHTML = '<div class="loading-state"><div class="spinner"></div>Escaneando e-mails...</div>';
    await loadDomains({ refresh: false });
  }

  async function loadDomains({ refresh }) {
    if (domainsSyncing) return;
    domainsSyncing = true;
    refreshBtn.classList.add('spinning');

    try {
      const result = await listDomains({ refresh });
      if (folder !== 'domains') return; // usuário trocou de aba durante o request
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
            <p>Erro ao escanear e-mails:<br>${escapeHtml(err.message || 'Erro desconhecido')}</p>
            <button class="btn btn-primary" id="retry-btn" style="margin-top: 16px;">Tentar novamente</button>
          </div>
        `;
        listEl.querySelector('#retry-btn')?.addEventListener('click', () => loadDomains({ refresh: true }));
      } else {
        showSyncErrors([err.message || 'Erro ao escanear e-mails']);
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
      if (folder === 'domains') showSyncErrors([err.message || 'Erro ao carregar mais domínios']);
    } finally {
      domainsLoadingMore = false;
      if (folder === 'domains') renderDomainsList();
    }
  }

  // --- Automatizador: regras que movem e-mails em massa para a lixeira ---

  function filteredRules() {
    if (!automationQuery) return automationRules;
    const q = automationQuery.toLowerCase();
    return automationRules.filter(
      (r) => (r.name || '').toLowerCase().includes(q) || (r.query || '').toLowerCase().includes(q)
    );
  }

  function automationRunSummary(rule) {
    if (!rule.lastRunAt) return 'nunca executada';
    return `última: ${rule.lastRunCount || 0} e-mail(s) em ${formatDateCompact(rule.lastRunAt)}`;
  }

  // Regras criadas antes do toggle existir não têm o campo — contam como ativas.
  function isRuleEnabled(rule) {
    return rule.enabled !== false;
  }

  // O termo aceita vários valores separados por ";" — ex.: "santander;btg;itau"
  // limpa os três de uma vez. Uma regra com um termo só continua funcionando
  // igual (split de string sem ";" devolve ela mesma).
  function ruleTerms(rule) {
    return String(rule.query || '')
      .split(';')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  function formatTerms(rule) {
    const terms = ruleTerms(rule);
    return terms.map((t) => `"${t}"`).join(', ');
  }

  // Dois nomes iguais deixam impossível saber qual regra é qual na lista —
  // e "Executar todas" vira uma roleta. Comparação sem acento/caixa/espaço extra.
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
      ? '0 automações'
      : `${count} ${count === 1 ? 'automação' : 'automações'} · ${active} ativa${active === 1 ? '' : 's'}`;

    // Só faz sentido oferecer "executar todas" se houver alguma ativa.
    runAllAutomationsBtn.hidden = folder !== 'automator' || active === 0;
    runAllAutomationsBtn.textContent = running ? 'Executando...' : `▶ Executar todas (${active})`;
    runAllAutomationsBtn.disabled = running;
  }

  async function startAutomatorView() {
    listEl.innerHTML = '<div class="loading-state"><div class="spinner"></div>Carregando automações...</div>';
    try {
      automationRules = await getAutomationRules();
    } catch (err) {
      automationRules = [];
      showSyncErrors([err.message || 'Erro ao carregar automações']);
    }
    if (folder !== 'automator') return; // trocou de aba durante o carregamento
    renderAutomatorList();
  }

  function renderAutomatorList() {
    updateAutomatorToolbar();
    const filtered = filteredRules();

    if (automationRules.length === 0) {
      listEl.innerHTML = '<div class="empty-state">Nenhuma automação ainda.<br>Clique em "+ Nova automação" para criar uma.</div>';
      return;
    }
    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-state">Nada encontrado para "${escapeHtml(automationQuery)}".</div>`;
      return;
    }

    listEl.innerHTML = filtered.map((rule) => {
      const on = isRuleEnabled(rule);
      return `
      <div class="automation-row ${on ? '' : 'off'}" data-id="${escapeHtml(rule.id)}">
        <label class="switch" title="${on ? 'Desativar automação' : 'Ativar automação'}">
          <input type="checkbox" class="rule-toggle" data-id="${escapeHtml(rule.id)}" ${on ? 'checked' : ''}>
          <span class="switch-track"></span>
        </label>
        <div class="automation-row-body">
          <div class="automation-row-line1">
            <span class="automation-row-name">${escapeHtml(rule.name)}</span>
            ${on ? '' : '<span class="automation-off-badge">desativada</span>'}
          </div>
          <div class="automation-row-line2">${ruleTerms(rule).length > 1 ? 'termos' : 'termo'}: ${escapeHtml(formatTerms(rule))} · ${automationRunSummary(rule)}</div>
        </div>
        <div class="automation-row-actions">
          <button class="icon-btn action-run" data-id="${escapeHtml(rule.id)}" title="Executar agora">${ICONS.boltSmall}</button>
          <button class="icon-btn action-edit" data-id="${escapeHtml(rule.id)}" title="Editar automação">${ICONS.edit}</button>
          <button class="icon-btn action-delete" data-id="${escapeHtml(rule.id)}" title="Excluir automação">${ICONS.trash}</button>
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

    // Clicar na linha (fora dos botões) abre a edição — o painel da direita é
    // só de execução agora, não tem mais "detalhe da regra" pra abrir.
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

  // Ativar/desativar não mexe em e-mail nenhum — só decide se a regra entra no
  // "Executar todas". Rodar uma regra desativada na mão continua permitido.
  async function setRuleEnabled(rule, enabled) {
    const previous = isRuleEnabled(rule);
    rule.enabled = enabled; // otimista: a lista já re-renderiza com o novo estado
    renderAutomatorList();
    try {
      automationRules = await saveAutomationRule({ id: rule.id, enabled });
    } catch (err) {
      rule.enabled = previous;
      showSyncErrors([err.message || 'Erro ao salvar a automação']);
    }
    if (folder === 'automator') renderAutomatorList();
  }

  // Criação e edição acontecem num modal centralizado — o painel de leitura
  // fica reservado para consultar/executar a automação.
  async function showRuleForm(rule = null) {
    const isEdit = !!rule;
    const values = await automationFormDialog({
      rule,
      validate: ({ name, query: q }) => {
        if (!name || !q) return 'Preencha o nome e os termos de busca.';
        if (ruleTerms({ query: q }).length === 0) return 'Informe pelo menos um termo de busca válido.';
        const duplicate = findDuplicateName(name, isEdit ? rule.id : null);
        if (duplicate) return `Já existe uma automação chamada "${duplicate.name}". Escolha outro nome.`;
        return null;
      },
    });
    if (!values) return; // cancelou

    const id = isEdit ? rule.id : crypto.randomUUID();
    try {
      automationRules = await saveAutomationRule({
        id,
        name: values.name,
        query: values.query,
        enabled: isEdit ? isRuleEnabled(rule) : true,
      });
    } catch (err) {
      showSyncErrors([err.message || 'Erro ao salvar automação']);
      return;
    }
    if (folder !== 'automator') return;
    renderAutomatorList();
  }

  async function removeRule(rule) {
    const confirmed = await confirmDialog({
      title: `Excluir a automação "${rule.name}"?`,
      message: 'Os e-mails já existentes não são afetados.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!confirmed) return;
    try {
      automationRules = await deleteAutomationRule(rule.id);
    } catch (err) {
      showSyncErrors([err.message || 'Erro ao excluir automação']);
      return;
    }
    if (folder !== 'automator') return;
    renderAutomatorList();
  }

  // Junta todas as páginas de uma busca — a exclusão em massa precisa da lista
  // inteira, não só da primeira página.
  async function collectMatchingEmails(searchQuery) {
    let result = await listEmails({ folder: 'inbox', query: searchQuery, sortOrder: 'desc' });
    let all = result.emails;
    let guard = 0; // trava contra loop infinito (se hasMore ficar preso em true)
    while (result.hasMore && guard < 500) {
      guard++;
      const before = all.length;
      result = await listEmails({ folder: 'inbox', loadMore: true, query: searchQuery, sortOrder: 'desc', currentEmails: all });
      all = result.emails;
      if (all.length === before) break;
    }
    return all;
  }

  // Busca, um termo de cada vez, tudo que casa com a regra. Sequencial de
  // propósito (cada busca já pagina várias vezes no servidor) e sem repetir
  // e-mail: dois termos da mesma regra costumam cair na mesma conversa.
  async function collectRuleMatches(rule, onSearch) {
    const terms = ruleTerms(rule);
    const seen = new Set();
    const matches = []; // { id, term } — o termo vai junto porque a exclusão o usa pra ajustar o cache
    for (let i = 0; i < terms.length; i++) {
      onSearch?.({ term: terms[i], index: i, total: terms.length, found: matches.length });
      for (const email of await collectMatchingEmails(terms[i])) {
        if (seen.has(email.id)) continue;
        seen.add(email.id);
        matches.push({ id: email.id, term: terms[i] });
      }
    }
    return matches;
  }

  // Núcleo da execução de uma regra, sem nada de interface: busca tudo que casa
  // com os termos, move para a lixeira e devolve o resumo. Quem chama decide
  // como mostrar (execução avulsa no painel da regra ou "executar todas").
  async function executeRule(rule, { onSearch, onProgress } = {}) {
    const matches = await collectRuleMatches(rule, onSearch);
    if (matches.length === 0) return { total: 0, okCount: 0, failCount: 0, networkDown: false };

    let done = 0;
    // Se a rede cair no meio, não adianta insistir em cada e-mail restante:
    // assim que der um erro de conexão, os pedidos seguintes já saem curto-
    // circuitados (evita disparar dezenas de requests condenados).
    let networkDown = false;
    onProgress?.({ done: 0, total: matches.length });
    const results = await mapWithConcurrencySettled(matches, DELETE_CONCURRENCY, async ({ id, term }) => {
      if (networkDown) throw new Error('offline');
      try {
        const r = await deleteEmail(id, { permanent: false, folder: 'inbox', query: term });
        done++;
        onProgress?.({ done, total: matches.length });
        return r;
      } catch (err) {
        if (isNetworkError(err)) networkDown = true;
        throw err;
      }
    });
    const okCount = results.filter((r) => r.status === 'fulfilled').length;

    // Só registra estatística de execução se de fato moveu algo.
    if (okCount > 0) {
      try {
        automationRules = await saveAutomationRule({ id: rule.id, lastRunAt: Date.now(), lastRunCount: okCount });
      } catch {}
    }

    return { total: matches.length, okCount, failCount: results.length - okCount, networkDown };
  }

  // Texto curto do resultado de uma regra — mesma frase na execução avulsa e
  // na execução em massa, já que agora as duas usam o mesmo painel.
  function runResultMessage({ total, okCount, failCount, networkDown }) {
    if (total === 0) return { text: 'nada encontrado', cls: '' };
    if (networkDown) return { text: `sem conexão — ${okCount} movido(s) antes de cair`, cls: 'error' };
    if (failCount > 0) return { text: `${okCount} movido(s), ${failCount} com erro`, cls: 'error' };
    return { text: `${okCount} e-mail(s) para a lixeira`, cls: 'success' };
  }

  // Painel de execução (lado direito). Uma linha por regra — vale tanto pro
  // "Executar todas" quanto pra execução de uma só.
  function renderRunPanel(rules, title) {
    readingPane.innerHTML = `
      <div class="reading-header">
        <div class="reading-header-top">
          <div class="email-meta"><span class="automation-badge">Executando</span></div>
        </div>
        <h2>${escapeHtml(title)}</h2>
      </div>
      <div class="run-all-list">
        ${rules.map((rule) => `
          <div class="run-all-item" data-id="${escapeHtml(rule.id)}">
            <span class="run-all-item-name">${escapeHtml(rule.name)}</span>
            <span class="run-all-item-status">na fila</span>
          </div>
        `).join('')}
      </div>
      <div class="rule-run-status" id="run-all-summary"></div>
    `;
  }

  // Executa uma lista de regras, uma de cada vez. Sequencial de propósito:
  // cada regra já dispara DELETE_CONCURRENCY exclusões em paralelo, e rodar
  // várias juntas estoura o limite de requests simultâneos da API.
  async function runRules(rules, { confirmTitle, confirmMessage, panelTitle }) {
    if (running) return;
    if (rules.length === 0) return;

    const confirmed = await confirmDialog({
      title: confirmTitle,
      message: confirmMessage,
      confirmLabel: 'Executar',
      danger: true,
    });
    if (!confirmed) return;

    running = true;
    renderRunPanel(rules, panelTitle);
    renderAutomatorList();

    const setItemStatus = (id, html, cls = '') => {
      const el = readingPane.querySelector(`.run-all-item[data-id="${CSS.escape(id)}"] .run-all-item-status`);
      if (!el) return; // painel foi substituído — só ignora
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
          ? `<div class="spinner-small"></div>Executando ${i + 1} de ${rules.length}: ${escapeHtml(rule.name)}...`
          : `<div class="spinner-small"></div>Executando "${escapeHtml(rule.name)}"...`);
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
          // Rede caiu: as próximas regras só somariam erro em cima de erro.
          if (result.networkDown) {
            setSummary('Sem conexão estável com a internet — execução interrompida. Verifique a rede e tente de novo.', 'error');
            return;
          }
        } catch (err) {
          failedRules++;
          setItemStatus(rule.id, escapeHtml(err.message || 'erro'), 'error');
          if (isNetworkError(err)) {
            setSummary('Sem conexão com a internet — execução interrompida. Verifique sua rede e tente de novo.', 'error');
            return;
          }
        } finally {
          readingPane.querySelector(`.run-all-item[data-id="${CSS.escape(rule.id)}"]`)?.classList.remove('running');
        }
      }

      setSummary(
        failedRules > 0
          ? `✓ ${totalMoved} e-mail(s) movido(s) para a lixeira. ${failedRules} automação(ões) com erro.`
          : `✓ Concluído — ${totalMoved} e-mail(s) movido(s) para a lixeira.`,
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
      confirmTitle: `Executar "${rule.name}"?`,
      confirmMessage: terms.length > 1
        ? `Isso vai procurar todos os e-mails que contêm qualquer um destes ${terms.length} termos — ${formatTerms(rule)} — e movê-los para a lixeira.`
        : `Isso vai procurar todos os e-mails que contêm "${terms[0] || rule.query}" e movê-los para a lixeira.`,
      panelTitle: rule.name,
    });
  }

  function runAllRules() {
    const rules = enabledRules();
    if (rules.length === 0) return;
    const plural = rules.length === 1 ? '' : 's';
    return runRules(rules, {
      confirmTitle: `Executar ${rules.length} automação${rules.length === 1 ? '' : 'ões'} ativa${plural}?`,
      confirmMessage: 'As automações desativadas ficam de fora. Todos os e-mails que casarem com os termos serão movidos para a lixeira.',
      panelTitle: `${rules.length} automação${rules.length === 1 ? '' : 'ões'} ativa${plural}`,
    });
  }

  // --- Eventos da barra ---

  folderTabs.forEach((tab) => {
    tab.addEventListener('click', () => switchFolder(tab.dataset.folder));
  });

  // A busca de e-mails vai ao servidor (Gmail/Graph); a de domínios é local
  // (os domínios já escaneados ficam todos na memória, filtro é instantâneo).
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

  // --- Filtro de período (calendário com seleção de intervalo) e ordem de exibição ---

  const MONTH_LABELS = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
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
    sortToggleBtn.title = sortOrder === 'asc' ? 'Mais antigos primeiro' : 'Mais recentes primeiro';
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
    // Recomeça a seleção do calendário a partir do filtro já aplicado (se houver).
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

  // Fecha ao clicar fora do popover (mas não ao clicar dentro dele).
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
      title: 'Esvaziar a lixeira?',
      message: 'Todos os e-mails da lixeira serão excluídos definitivamente. Essa ação não pode ser desfeita.',
      confirmLabel: 'Esvaziar',
      danger: true,
    });
    if (!confirmed) return;

    mutatingInFlight = true;
    emptyTrashBtn.disabled = true;
    emptyTrashBtn.textContent = 'Esvaziando...';
    try {
      await emptyTrash();
      emails = [];
      total = 0;
      hasMore = false;
      selectedIds.clear();
      clearReadingPane();
      renderList();
    } catch (err) {
      showSyncErrors([err.message || 'Erro ao esvaziar a lixeira']);
    } finally {
      mutatingInFlight = false;
      emptyTrashBtn.disabled = false;
      emptyTrashBtn.textContent = 'Esvaziar lixeira';
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
    else if (folder === 'inbox' || folder === 'trash') loadMore();
  });

  // --- Zoom do corpo do e-mail ---

  zoomOutBtn.addEventListener('click', () => applyBodyZoom(bodyZoom - 0.1));
  zoomInBtn.addEventListener('click', () => applyBodyZoom(bodyZoom + 0.1));
  zoomLabel.addEventListener('click', () => applyBodyZoom(1));

  // Vem do menu nativo (Exibir → zoom / Ctrl+=, Ctrl+-, Ctrl+0). Se a tela já
  // não existe mais (usuário navegou para outra), se desinscreve sozinho.
  const unsubscribeZoom = onZoomChange((action) => {
    if (!container.contains(zoomLabel)) {
      unsubscribeZoom();
      return;
    }
    if (action === 'reset') applyBodyZoom(1);
    else applyBodyZoom(bodyZoom + action);
  });

  // --- Divisor arrastável entre a lista e a leitura (35%–65%) ---

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

  // --- Atalhos de teclado ---
  document.addEventListener('keydown', (e) => {
    if (!container.querySelector('#email-list')) {
      keyboardController.abort();
      return;
    }
    handleKeyboardShortcuts(e);
  }, { signal: keyboardController.signal });

  // --- Carga inicial ---

  bodyZoom = await getBodyZoom();
  updateZoomLabel();
  updateSortToggleUI();
  updateFilterBadge();

  const accounts = await getAccounts();
  if (accounts.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <p>Nenhuma conta conectada.</p>
        <button class="btn btn-primary" id="add-account-btn" style="margin-top: 16px;">Adicionar conta</button>
      </div>
    `;
    container.querySelector('#add-account-btn')?.addEventListener('click', () => navigate('login'));
    return;
  }

  await sync({ refresh: false });
}

// Renderiza o HTML do e-mail num <iframe sandbox>, isolado do documento do app —
// mesma técnica que Gmail/Outlook usam. Isso garante fidelidade total (inclui
// <style>, tabelas, fontes do próprio e-mail) sem que esse CSS vaze para o app,
// e o sandbox (sem allow-scripts) desativa qualquer script/handler embutido.
function renderHtmlBody(host, html, { onLinkClick, onKeydown, zoom = 1 } = {}) {
  const iframe = document.createElement('iframe');
  iframe.className = 'detail-body-frame';
  iframe.setAttribute('sandbox', 'allow-same-origin');
  host.replaceWith(iframe);

  // O app é escuro, mas os e-mails HTML são desenhados para fundo claro — o
  // iframe vira uma "folha de papel" branca (mesma abordagem do Gmail escuro).
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

    // Exposto para o controle de zoom da barra reaplicar sem recarregar o iframe.
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

    // Encaminha atalhos de teclado mesmo com o foco dentro do corpo do e-mail.
    if (onKeydown) idoc.addEventListener('keydown', onKeydown);
  });

  iframe.srcdoc = doc;
  return iframe;
}

function stripScripts(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '');
}

// Erros de rede/DNS (getaddrinfo EAI_AGAIN, host não encontrado, conexão
// recusada/estourada, etc.) — usados para dar uma mensagem clara de "sem
// conexão" em vez de vazar o erro cru da API.
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
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
  }
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatDateFull(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleString('pt-BR', {
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
