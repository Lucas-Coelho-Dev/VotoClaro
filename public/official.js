const STATUS_LABELS = {
  APPROVED: 'Deferida',
  PENDING: 'Em análise',
  DENIED: 'Indeferida',
  CANCELLED: 'Cancelada/cassada',
  WITHDRAWN: 'Renúncia',
  DECEASED: 'Falecimento',
};

const COLINHA_ROLES = [
  ['deputadoFederal', 'Deputado federal'],
  ['deputadoEstadual', 'Deputado estadual/distrital'],
  ['senador1', 'Senador — 1ª vaga'],
  ['senador2', 'Senador — 2ª vaga'],
  ['governador', 'Governador'],
  ['presidente', 'Presidente'],
];

const state = {
  view: 'explore',
  page: 1,
  totalPages: 1,
  pageSize: 24,
  candidates: [],
  popularCandidates: [],
  candidateCache: new Map(),
  compareIds: [],
  filters: { q: '', office: '', uf: '', party: '', ideology: '' },
  snapshot: null,
  retryTimer: null,
  hasSearched: false,
  sessionViewIds: new Set(),
  sessionViewsLoaded: false,
};

const CANDIDATE_VIEW_SESSION_KEY = 'votoclaro_candidate_views_v1';

const elements = {};

function byId(id) { return document.getElementById(id); }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}
function formatNumber(value) { return new Intl.NumberFormat('pt-BR').format(value || 0); }
function formatCurrency(value) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0); }
function formatDate(value, includeTime = true) {
  if (!value) return 'Não informado pela fonte';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não informado pela fonte';
  return new Intl.DateTimeFormat('pt-BR', includeTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { dateStyle: 'short' }).format(date);
}
function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}
function statusClass(group) { return `status-${String(group || 'PENDING').toLowerCase()}`; }
function statusLabel(group, raw) { return STATUS_LABELS[group] || raw || 'Em análise'; }

async function requestJson(url, options) {
  const response = await fetch(url, { ...options, headers: { Accept: 'application/json', ...(options?.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `Falha HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function cacheElements() {
  Object.assign(elements, {
    healthBadge: byId('healthBadge'),
    globalNotice: byId('globalNotice'),
    candidateGrid: byId('candidateGrid'),
    popularSection: byId('popularSection'),
    popularGrid: byId('popularGrid'),
    resultCount: byId('resultCount'),
    snapshotTime: byId('snapshotTime'),
    candidateTotalHero: byId('candidateTotalHero'),
    previousPage: byId('previousPage'),
    nextPage: byId('nextPage'),
    pageInfo: byId('pageInfo'),
    filterForm: byId('filterForm'),
    searchInput: byId('searchInput'),
    officeFilter: byId('officeFilter'),
    stateFilter: byId('stateFilter'),
    useLocation: byId('useLocation'),
    locationStatus: byId('locationStatus'),
    partyFilter: byId('partyFilter'),
    ideologyFilter: byId('ideologyFilter'),
    candidateDialog: byId('candidateDialog'),
    candidateDetail: byId('candidateDetail'),
    compareCount: byId('compareCount'),
    colinhaNavCount: byId('colinhaNavCount'),
    colinhaProgress: byId('colinhaProgress'),
    colinhaProgressTitle: byId('colinhaProgressTitle'),
    colinhaProgressText: byId('colinhaProgressText'),
    colinhaProgressBar: byId('colinhaProgressBar'),
    comparisonContent: byId('comparisonContent'),
    colinhaSlots: byId('colinhaSlots'),
    sourceGrid: byId('sourceGrid'),
    syncRuns: byId('syncRuns'),
    changesList: byId('changesList'),
  });
}

function bindEvents() {
  document.querySelectorAll('[data-view-target]').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.viewTarget));
  });
  elements.filterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    state.hasSearched = true;
    renderPopularCandidates();
    readFilters();
    state.page = 1;
    loadCandidates();
  });
  elements.useLocation.addEventListener('click', useCurrentLocation);
  byId('clearFilters').addEventListener('click', clearFilters);
  byId('mobileColinhaShortcut').addEventListener('click', openColinha);
  byId('continueColinha').addEventListener('click', openColinha);
  document.querySelector('[data-colinha-nav]').addEventListener('click', openColinha);
  byId('backToCandidates').addEventListener('click', () => {
    elements.filterForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  elements.previousPage.addEventListener('click', () => changePage(-1));
  elements.nextPage.addEventListener('click', () => changePage(1));
  byId('clearComparison').addEventListener('click', () => { state.compareIds = []; updateCompareCount(); renderComparison(); renderCandidates(); });
  byId('clearColinha').addEventListener('click', clearColinha);
  byId('copyColinha').addEventListener('click', copyColinha);
  document.querySelector('[data-close-dialog]').addEventListener('click', () => elements.candidateDialog.close());
  elements.candidateDialog.addEventListener('click', (event) => {
    if (event.target === elements.candidateDialog) elements.candidateDialog.close();
  });
  elements.candidateGrid.addEventListener('click', handleCandidateAction);
  elements.popularGrid.addEventListener('click', handleCandidateAction);
  elements.candidateDetail.addEventListener('click', handleCandidateAction);
  elements.comparisonContent.addEventListener('click', handleCandidateAction);
  elements.colinhaSlots.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-slot]');
    if (remove) removeColinhaSlot(remove.dataset.removeSlot);
  });
}

function openColinha() {
  if (state.view !== 'explore') switchView('explore');
  if (window.matchMedia('(max-width: 640px)').matches) {
    document.querySelectorAll('.main-nav .nav-link').forEach((button) => {
      button.classList.toggle('active', button.hasAttribute('data-colinha-nav'));
    });
  }
  window.setTimeout(() => {
    document.querySelector('.side-column')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  document.querySelectorAll('[data-view-target]').forEach((button) => button.classList.toggle('active', button.dataset.viewTarget === view));
  document.querySelector('[data-colinha-nav]')?.classList.remove('active');
  if (view === 'compare') renderComparison();
  if (view === 'sources') loadSources();
  if (view === 'changes') loadChanges();
  const mobileSection = window.matchMedia('(max-width: 640px)').matches && view !== 'explore'
    ? document.querySelector(`#view-${view}`)
    : null;
  if (mobileSection) mobileSection.scrollIntoView({ block: 'start', behavior: 'smooth' });
  else window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadHealth() {
  try {
    const response = await fetch('/api/v1/health', { headers: { Accept: 'application/json' } });
    const health = await response.json();
    const healthy = health.status === 'OK';
    elements.healthBadge.className = `health-badge ${healthy ? 'is-ok' : 'is-warning'}`;
    elements.healthBadge.innerHTML = `<span class="health-dot"></span><span>${healthy ? 'Dados atualizados' : health.status === 'INITIALIZING' ? 'Sincronizando com o TSE' : 'Dados precisam atualizar'}</span>`;
    if (health.candidateCount) elements.candidateTotalHero.textContent = formatNumber(health.candidateCount);
  } catch {
    elements.healthBadge.className = 'health-badge is-warning';
    elements.healthBadge.innerHTML = '<span class="health-dot"></span><span>Servidor indisponível</span>';
  }
}

async function loadFilters() {
  try {
    const payload = await requestJson('/api/v1/filters');
    fillSelect(elements.officeFilter, payload.offices, 'Todos os cargos');
    fillSelect(elements.stateFilter, payload.states, 'Brasil');
    fillSelect(elements.partyFilter, payload.parties, 'Todos');
  } catch (error) {
    if (error.status !== 503) showNotice('Não foi possível carregar os filtros. A busca por nome continua disponível.');
  }
}

function fillSelect(select, values, firstLabel) {
  const selected = select.value;
  select.innerHTML = `<option value="">${escapeHtml(firstLabel)}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
  select.value = selected;
}

function readFilters() {
  state.filters = {
    q: elements.searchInput.value.trim(),
    office: elements.officeFilter.value,
    uf: elements.stateFilter.value,
    party: elements.partyFilter.value,
    ideology: elements.ideologyFilter.value,
  };
}

function clearFilters() {
  elements.filterForm.reset();
  state.filters = { q: '', office: '', uf: '', party: '', ideology: '' };
  state.page = 1;
  state.hasSearched = false;
  renderPopularCandidates();
  loadPopularCandidates();
  loadCandidates();
}

function requestBrowserLocation() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 12000,
      maximumAge: 10 * 60 * 1000,
    });
  });
}

function locationErrorMessage(error) {
  if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return 'Em celulares, a localização exige o site publicado com HTTPS. Enquanto isso, escolha a UF manualmente.';
  }
  if (error?.code === 1) return 'Permissão de localização recusada. Você pode continuar escolhendo a UF manualmente.';
  if (error?.code === 2) return 'O aparelho não conseguiu identificar a localização. Escolha a UF manualmente.';
  if (error?.code === 3) return 'A localização demorou demais para responder. Tente novamente ou escolha a UF.';
  return 'Não foi possível identificar o estado agora. Nenhuma coordenada foi enviada ou armazenada.';
}

async function useCurrentLocation() {
  if (!navigator.geolocation) {
    elements.locationStatus.textContent = 'Este navegador não oferece localização. Escolha a UF manualmente.';
    return;
  }
  elements.useLocation.disabled = true;
  elements.useLocation.textContent = 'Identificando…';
  elements.locationStatus.textContent = 'Aguardando sua autorização no navegador…';
  try {
    const [boundaryPayload, position] = await Promise.all([
      requestJson('/api/v1/geography/states'),
      requestBrowserLocation(),
    ]);
    const uf = window.VotoClaroGeo.stateFromCoordinates(
      position.coords.longitude,
      position.coords.latitude,
      boundaryPayload.data,
    );
    if (!uf || !elements.stateFilter.querySelector(`option[value="${uf}"]`)) {
      throw new Error('UF_NOT_FOUND');
    }
    elements.stateFilter.value = uf;
    readFilters();
    state.page = 1;
    state.hasSearched = true;
    renderPopularCandidates();
    await loadCandidates();
    elements.locationStatus.textContent = `Estado identificado: ${uf}. As coordenadas foram usadas somente neste navegador, sem envio ou armazenamento.`;
  } catch (error) {
    elements.locationStatus.textContent = locationErrorMessage(error);
  } finally {
    elements.useLocation.disabled = false;
    elements.useLocation.textContent = 'Usar minha localização';
  }
}

function candidateQuery() {
  const params = new URLSearchParams({ page: state.page, pageSize: state.pageSize });
  Object.entries(state.filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  return params;
}

function renderSkeletons() {
  elements.candidateGrid.setAttribute('aria-busy', 'true');
  elements.candidateGrid.innerHTML = Array.from({ length: 9 }, () => '<div class="skeleton"></div>').join('');
}

async function loadCandidates() {
  renderSkeletons();
  clearTimeout(state.retryTimer);
  try {
    const payload = await requestJson(`/api/v1/candidates?${candidateQuery()}`);
    state.candidates = payload.data;
    state.snapshot = payload.snapshot;
    state.totalPages = payload.pagination.totalPages;
    for (const candidate of payload.data) state.candidateCache.set(candidate.id, candidate);
    renderCandidates();
    updatePagination(payload.pagination);
    updateSnapshot(payload.snapshot);
    elements.resultCount.textContent = `${formatNumber(payload.pagination.total)} candidaturas encontradas`;
    elements.candidateTotalHero.textContent = formatNumber(payload.snapshot.candidateCount);
    hideNotice();
  } catch (error) {
    state.candidates = [];
    if (error.status === 503) {
      elements.candidateGrid.innerHTML = '<div class="empty-state"><strong>Sincronizando com o TSE</strong><p>A primeira importação oficial está em andamento. Esta página tentará novamente em alguns segundos.</p></div>';
      elements.resultCount.textContent = 'Aguardando dados oficiais';
      showNotice('O VotoClaro está baixando e validando a publicação oficial de 2026. Nenhum dado simulado será exibido enquanto isso.');
      state.retryTimer = setTimeout(() => { loadHealth(); loadFilters(); loadCandidates(); }, 10000);
    } else {
      elements.candidateGrid.innerHTML = '<div class="empty-state"><strong>Não foi possível consultar os dados</strong><p>Tente novamente em alguns instantes.</p></div>';
      elements.resultCount.textContent = 'Fonte temporariamente indisponível';
      showNotice('A consulta falhou. O portal não substituirá a fonte oficial por dados estimados.');
    }
  } finally {
    elements.candidateGrid.setAttribute('aria-busy', 'false');
  }
}

async function loadPopularCandidates() {
  if (state.hasSearched) {
    renderPopularCandidates();
    return;
  }
  elements.popularGrid.setAttribute('aria-busy', 'true');
  try {
    const payload = await requestJson('/api/v1/popular-candidates?limit=6');
    state.popularCandidates = payload.data;
    for (const candidate of payload.data) state.candidateCache.set(candidate.id, candidate);
    renderPopularCandidates();
  } catch {
    if (!state.hasSearched) {
      elements.popularSection.hidden = false;
      elements.popularGrid.innerHTML = '<div class="popular-empty">Não foi possível atualizar os mais consultados agora. A busca oficial continua disponível.</div>';
    }
  } finally {
    elements.popularGrid.setAttribute('aria-busy', 'false');
  }
}

function avatarHtml(candidate) {
  const fallback = escapeHtml(initials(candidate.ballotName));
  if (!candidate.photoUrl) return `<span class="avatar">${fallback}</span>`;
  return `<img class="avatar avatar-image" src="${escapeHtml(candidate.photoUrl)}" alt="Foto oficial de ${escapeHtml(candidate.ballotName)}" data-fallback="${fallback}" width="56" height="56" loading="lazy" decoding="async">`;
}

function partyMarkHtml(candidate, compact = false) {
  const party = String(candidate.party || '?').toUpperCase().slice(0, 8);
  const number = candidate.partyNumber ?? '—';
  const title = `Identificação visual do partido ${party}${number !== '—' ? `, número ${number}` : ''}, nas cores da legenda`;
  const source = candidate.partyImageUrl || `/api/v1/parties/${encodeURIComponent(candidate.party || 'SEM-PARTIDO')}/mark.svg?v=2`;
  return `<img class="party-mark-image ${compact ? 'compact' : ''}" src="${escapeHtml(source)}" alt="${escapeHtml(title)}" title="${escapeHtml(title)}" width="43" height="43" loading="lazy" decoding="async">`;
}

function partyIdeologyLabel(candidate, detailed = false) {
  const ideology = candidate.partyIdeology;
  if (!ideology) return 'Sem classificação';
  if (detailed && ideology.score !== null) return `${ideology.detailedLabel} (${String(ideology.score).replace('.', ',')})`;
  return ideology.bucketLabel || 'Sem classificação';
}

function ideologyPillHtml(candidate) {
  const ideology = candidate.partyIdeology;
  if (!ideology) return '';
  const title = `${partyIdeologyLabel(candidate, true)} na pesquisa acadêmica do partido. Não classifica individualmente a candidatura.`;
  return `<span class="meta-pill ideology-pill" title="${escapeHtml(title)}">Partido: ${escapeHtml(partyIdeologyLabel(candidate))}</span>`;
}

function runningMateLabel(candidate) {
  const runningMates = Array.isArray(candidate.runningMates) ? candidate.runningMates : [];
  if (!runningMates.length) return '';
  const prefix = String(candidate.office || '').toUpperCase() === 'SENADOR' ? 'Suplentes' : 'Vice';
  return `${prefix}: ${runningMates.map((item) => item.ballotName).join(' · ')}`;
}

function candidateCard(candidate) {
  const selected = state.compareIds.includes(candidate.id);
  return `
    <article class="candidate-card">
      <button class="candidate-open" type="button" data-open-candidate="${escapeHtml(candidate.id)}">
        <div class="candidate-top">
          ${avatarHtml(candidate)}
          <div class="candidate-ident">
            <h3 title="${escapeHtml(candidate.ballotName)}">${escapeHtml(candidate.ballotName)}</h3>
            <p>${escapeHtml(candidate.name)}</p>
            <div class="ballot-number">${candidate.ballotNumber ?? '—'}</div>
          </div>
          ${partyMarkHtml(candidate)}
        </div>
        <div class="candidate-meta">
          <span class="meta-pill">${escapeHtml(candidate.office)}</span>
          <span class="meta-pill">${escapeHtml(candidate.party || 'Sem sigla')}</span>
          <span class="meta-pill">${escapeHtml(candidate.uf || 'BR')}</span>
          ${ideologyPillHtml(candidate)}
          <span class="status-pill ${statusClass(candidate.statusGroup)}">${escapeHtml(statusLabel(candidate.statusGroup, candidate.status))}</span>
        </div>
        ${runningMateLabel(candidate) ? `<div class="ticket-line">${escapeHtml(runningMateLabel(candidate))}</div>` : ''}
        <div class="official-line">Registro oficial TSE 2026</div>
      </button>
      <div class="candidate-actions">
        <button type="button" data-compare-candidate="${escapeHtml(candidate.id)}" class="${selected ? 'selected' : ''}">${selected ? 'Remover comparação' : 'Comparar'}</button>
        <button type="button" data-colinha-candidate="${escapeHtml(candidate.id)}">Adicionar à colinha</button>
      </div>
    </article>`;
}

function popularCandidateCard(candidate, index) {
  const count = Number(candidate.consultationCount) || 0;
  const countLabel = count === 1 ? '1 consulta registrada' : `${formatNumber(count)} consultas registradas`;
  return `
    <article class="popular-card">
      <button class="popular-open" type="button" data-open-candidate="${escapeHtml(candidate.id)}" aria-label="Abrir ficha de ${escapeHtml(candidate.ballotName)}, ${countLabel}">
        <span class="popular-rank" aria-hidden="true">#${index + 1}</span>
        ${avatarHtml(candidate)}
        <div class="popular-ident">
          <h4 title="${escapeHtml(candidate.ballotName)}">${escapeHtml(candidate.ballotName)}</h4>
          <div class="popular-party">${partyMarkHtml(candidate, true)}<p>${escapeHtml(candidate.office)} · ${escapeHtml(candidate.party || 'Sem sigla')} · ${escapeHtml(candidate.uf || 'BR')}</p></div>
          <span class="popular-count">${countLabel}</span>
        </div>
      </button>
    </article>`;
}

function renderPopularCandidates() {
  elements.popularSection.hidden = state.hasSearched;
  if (state.hasSearched) return;
  if (!state.popularCandidates.length) {
    elements.popularGrid.innerHTML = '<div class="popular-empty"><strong>Ainda não há consultas suficientes.</strong><br>Os primeiros perfis aparecerão aqui após suas fichas serem abertas.</div>';
    return;
  }
  elements.popularGrid.innerHTML = state.popularCandidates.map(popularCandidateCard).join('');
  bindImageFallbacks(elements.popularGrid);
}

function renderCandidates() {
  if (!state.candidates.length) {
    elements.candidateGrid.innerHTML = '<div class="empty-state"><strong>Nenhuma candidatura encontrada</strong><p>Altere os filtros. A ausência de resultado reflete a publicação oficial atualmente importada.</p></div>';
    return;
  }
  elements.candidateGrid.innerHTML = state.candidates.map(candidateCard).join('');
  bindImageFallbacks(elements.candidateGrid);
}

function bindImageFallbacks(container) {
  container.querySelectorAll('.avatar-image').forEach((image) => {
    image.addEventListener('error', () => {
      const fallback = document.createElement('span');
      fallback.className = 'avatar';
      fallback.textContent = image.dataset.fallback || '?';
      image.replaceWith(fallback);
    }, { once: true });
  });
}

function updatePagination(pagination) {
  elements.pageInfo.textContent = `Página ${pagination.page} de ${pagination.totalPages}`;
  elements.previousPage.disabled = pagination.page <= 1;
  elements.nextPage.disabled = pagination.page >= pagination.totalPages;
}

function changePage(delta) {
  const next = state.page + delta;
  if (next < 1 || next > state.totalPages) return;
  state.page = next;
  state.hasSearched = true;
  renderPopularCandidates();
  loadCandidates();
  document.querySelector('#exploreTitle').scrollIntoView({ behavior: 'smooth' });
}

function updateSnapshot(snapshot) {
  const sourceTime = snapshot.sourceGeneratedAt ? `Fonte gerada em ${formatDate(snapshot.sourceGeneratedAt)}` : 'Horário de geração não informado';
  elements.snapshotTime.textContent = `${sourceTime} · importada em ${formatDate(snapshot.importedAt)}`;
}

function showNotice(message) {
  elements.globalNotice.hidden = false;
  elements.globalNotice.textContent = message;
}
function hideNotice() { elements.globalNotice.hidden = true; }

function handleCandidateAction(event) {
  const showMoreProposals = event.target.closest('[data-show-more-proposals]');
  if (showMoreProposals) return showNextPlanProposals(showMoreProposals);
  const open = event.target.closest('[data-open-candidate]');
  if (open) return openCandidate(open.dataset.openCandidate);
  const compare = event.target.closest('[data-compare-candidate]');
  if (compare) return toggleComparison(compare.dataset.compareCandidate);
  const colinha = event.target.closest('[data-colinha-candidate]');
  if (colinha) return addToColinhaById(colinha.dataset.colinhaCandidate);
  const legislative = event.target.closest('[data-load-legislative]');
  if (legislative) return loadLegislative(legislative.dataset.loadLegislative);
  const governmentPlan = event.target.closest('[data-load-government-plan]');
  if (governmentPlan) return loadGovernmentPlan(governmentPlan.dataset.loadGovernmentPlan);
}

async function openCandidate(id) {
  elements.candidateDetail.innerHTML = '<div class="detail-body"><div class="skeleton"></div></div>';
  elements.candidateDialog.showModal();
  try {
    const payload = await requestJson(`/api/v1/candidates/${encodeURIComponent(id)}`);
    state.candidateCache.set(id, payload.data);
    renderCandidateDetail(payload.data, payload.snapshot);
    loadIntegrity(id);
    registerCandidateView(id);
  } catch {
    elements.candidateDetail.innerHTML = '<div class="detail-body"><div class="not-published">Não foi possível carregar este registro oficial agora.</div></div>';
  }
}

function loadSessionCandidateViews() {
  if (state.sessionViewsLoaded) return;
  state.sessionViewsLoaded = true;
  try {
    const stored = JSON.parse(sessionStorage.getItem(CANDIDATE_VIEW_SESSION_KEY) || '[]');
    if (Array.isArray(stored)) {
      stored.filter((id) => /^\d{1,32}$/.test(String(id))).forEach((id) => state.sessionViewIds.add(String(id)));
    }
  } catch {
    // O conjunto em memória ainda evita duplicidade durante esta página.
  }
}

function saveSessionCandidateViews() {
  try {
    sessionStorage.setItem(CANDIDATE_VIEW_SESSION_KEY, JSON.stringify([...state.sessionViewIds]));
  } catch {
    // Navegadores que bloqueiam armazenamento continuam com a proteção em memória.
  }
}

async function registerCandidateView(id) {
  const normalizedId = String(id || '');
  loadSessionCandidateViews();
  if (!/^\d{1,32}$/.test(normalizedId) || state.sessionViewIds.has(normalizedId)) return;
  state.sessionViewIds.add(normalizedId);
  saveSessionCandidateViews();
  try {
    await requestJson(`/api/v1/candidates/${encodeURIComponent(normalizedId)}/view`, {
      method: 'POST',
      headers: { 'X-VotoClaro-Interaction': 'candidate-detail' },
    });
    if (!state.hasSearched) await loadPopularCandidates();
  } catch {
    state.sessionViewIds.delete(normalizedId);
    saveSessionCandidateViews();
  }
}

function renderCandidateDetail(candidate, snapshot) {
  const finance = candidate.finance
    ? `<div class="fact-grid">
        <div class="fact"><span>Receitas publicadas</span><strong>${formatCurrency(candidate.finance.totalRevenue)}</strong></div>
        <div class="fact"><span>Despesas publicadas</span><strong>${formatCurrency(candidate.finance.totalExpense)}</strong></div>
        <div class="fact"><span>Saldo calculado</span><strong>${formatCurrency(candidate.finance.balance)}</strong></div>
      </div><p class="muted">${escapeHtml(candidate.finance.note)}</p>`
    : '<div class="not-published">Dados financeiros ainda não publicados na fonte oficial importada. O VotoClaro não faz estimativas.</div>';
  const assets = candidate.assets.length
    ? `<div class="table-scroll" role="region" aria-label="Bens declarados" tabindex="0"><table class="asset-table"><thead><tr><th>Bem declarado</th><th>Tipo</th><th>Valor</th></tr></thead><tbody>${candidate.assets.map((asset) => `<tr><td>${escapeHtml(asset.description || 'Descrição não informada')}</td><td>${escapeHtml(asset.type || 'Não informado')}</td><td>${formatCurrency(asset.value)}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="2">Total declarado</th><th>${formatCurrency(candidate.assetTotal)}</th></tr></tfoot></table></div>`
    : '<div class="not-published">Nenhum bem consta no arquivo oficial importado. Isso pode significar ausência de declaração ou publicação ainda não processada.</div>';
  const social = candidate.socialLinks.length
    ? `<div class="source-list">${candidate.socialLinks.map((item) => `<a class="source-item" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(socialDomain(item.url))}</strong><span>Abrir endereço declarado ↗</span></a>`).join('')}</div>`
    : '<div class="not-published">Nenhuma rede social foi publicada no arquivo oficial importado.</div>';
  const sources = candidate.sources.map((source) => `<div class="source-item"><div><strong>${escapeHtml(source.name)}</strong><span>${escapeHtml(source.authority)} · ${formatDate(source.generatedAt)}</span></div><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">Ver fonte ↗</a></div>`).join('');
  const legislative = candidate.legislative
    ? `<section class="detail-section"><h3>Mandato parlamentar atual</h3><div class="not-published"><strong>Correspondência entre fontes oficiais encontrada.</strong><br>${escapeHtml(candidate.legislative.matchMethod)}<br><a class="inline-link" href="${escapeHtml(candidate.legislative.profileUrl)}" target="_blank" rel="noopener noreferrer">Abrir perfil oficial ↗</a><br><button class="secondary-button" type="button" data-load-legislative="${escapeHtml(candidate.id)}">Ver até 5 projetos recentes</button></div><div id="legislativeData"></div></section>`
    : `<section class="detail-section"><h3>Mandato parlamentar atual</h3><div class="not-published">Não encontramos correspondência exata por nome de urna, UF e partido nas listas atuais da Câmara ou do Senado. Não fazemos associação aproximada.</div></section>`;
  const planEligible = ['GOVERNADOR', 'PRESIDENTE'].includes(String(candidate.office || '').toUpperCase());
  const governmentPlan = planEligible
    ? `<section class="detail-section"><h3>Propostas para o mandato</h3><div id="governmentPlanData"><div class="not-published"><strong>Documento entregue ao TSE.</strong><br>O vínculo usa o identificador oficial desta candidatura.<br><button class="secondary-button" type="button" data-load-government-plan="${escapeHtml(candidate.id)}">Ver resumo e plano oficial</button></div></div></section>`
    : `<section class="detail-section"><h3>Propostas para o mandato</h3><div class="not-published">O conjunto “Propostas de governo” do TSE é publicado para candidaturas a presidente e governador. Para os demais cargos, não atribuímos documentos por aproximação.</div></section>`;
  const ticketEligible = ['PRESIDENTE', 'GOVERNADOR', 'SENADOR'].includes(String(candidate.office || '').toUpperCase());
  const runningMates = Array.isArray(candidate.runningMates) ? candidate.runningMates : [];
  const ticket = ticketEligible
    ? `<section class="detail-section"><h3>Chapa registrada</h3><p class="method-note">Vice e suplentes são vinculados somente quando coincidem eleição, unidade eleitoral, número e cargo relacionado no arquivo do TSE.</p>${runningMates.length
      ? `<div class="ticket-members">${runningMates.map((member) => `<article class="ticket-member">${avatarHtml(member)}<div><small>${escapeHtml(member.office)}</small><strong>${escapeHtml(member.ballotName)}</strong><span>${escapeHtml(member.name)}</span><div class="ticket-party">${partyMarkHtml(member, true)}<span>${escapeHtml([member.party, member.partyName].filter(Boolean).join(' — '))}</span></div><span class="status-pill ${statusClass(member.statusGroup)}">${escapeHtml(statusLabel(member.statusGroup, member.status))}</span></div></article>`).join('')}</div>`
      : '<div class="not-published">Ainda não encontramos integrante relacionado por essa chave exata no arquivo oficial importado.</div>'}</section>`
    : '';
  elements.candidateDetail.innerHTML = `
    <div class="detail-hero">
      <div class="detail-hero-main">${avatarHtml(candidate)}<div><span class="status-pill ${statusClass(candidate.statusGroup)}">${escapeHtml(statusLabel(candidate.statusGroup, candidate.status))}</span><h2>${escapeHtml(candidate.ballotName)}</h2><p>${escapeHtml(candidate.name)} · ${escapeHtml(candidate.party)} · ${candidate.ballotNumber ?? 'número não publicado'}</p></div>${partyMarkHtml(candidate)}</div>
    </div>
    <div class="detail-body">
      <div class="provenance-banner"><span>✓ Dados reproduzidos da publicação oficial do TSE</span><span>Importado em ${formatDate(snapshot.importedAt)}</span></div>
      <div class="detail-actions"><button class="primary-button" type="button" data-colinha-candidate="${escapeHtml(candidate.id)}">Adicionar à colinha</button><button class="secondary-button" type="button" data-compare-candidate="${escapeHtml(candidate.id)}">Comparar</button></div>
      <section class="detail-section"><h3>Registro da candidatura</h3><div class="fact-grid">
        ${fact('Cargo', candidate.office)}${fact('Situação publicada', candidate.status)}${fact('Detalhe da situação', candidate.statusDetail)}
        ${fact('Partido', [candidate.party, candidate.partyName].filter(Boolean).join(' — '))}${fact('Faixa ideológica do partido', partyIdeologyLabel(candidate, true))}${fact('UF / unidade eleitoral', [candidate.uf, candidate.electionUnitName].filter(Boolean).join(' — '))}${fact('Reeleição declarada', candidate.reelection ? 'Sim' : 'Não')}
        ${fact('Ocupação', candidate.occupation)}${fact('Escolaridade', candidate.education)}${fact('Idade na posse', candidate.ageAtTakingOffice ? `${candidate.ageAtTakingOffice} anos` : '')}
        ${fact('Julgamento', candidate.judgmentStatus)}${fact('Processo de registro', candidate.registrationProcess)}${fact('Aceite da candidatura', candidate.acceptedAt)}
        ${fact('Coligação', candidate.coalition)}${fact('Federação', candidate.federation)}${fact('Código TSE', candidate.tseId)}
        ${fact('Limite oficial de gastos', candidate.maximumCampaignExpense ? formatCurrency(candidate.maximumCampaignExpense) : '')}${fact('Declarou bens', candidate.declaredAssets ? 'Sim' : 'Não informado/Não')}${fact('Inserida na urna', candidate.insertedInBallot ? 'Sim' : 'Ainda não')}
      </div><p class="method-note ideology-method-note">A faixa ideológica se refere ao partido na pesquisa acadêmica, não à posição individual da pessoa candidata. <a href="/methodology.html#ideologia-partidaria">Ver fonte, limites e ressalvas</a>.</p></section>
      ${ticket}
      <section class="detail-section"><h3>Bens declarados</h3>${assets}</section>
      <section class="detail-section"><h3>Financiamento da campanha</h3>${finance}</section>
      ${governmentPlan}
      ${legislative}
      <section class="detail-section"><h3>Fiscalização, dinheiro público e integridade</h3><div id="integrityData"><div class="mini-loading">Consultando TCU, TSE e fontes oficiais de transparência…</div></div></section>
      <section class="detail-section"><h3>Redes sociais declaradas</h3>${social}</section>
      <section class="detail-section"><h3>Proveniência</h3><div class="source-list">${sources}</div><p class="muted">Checksum da importação: ${escapeHtml(snapshot.checksum)}</p></section>
    </div>`;
  bindImageFallbacks(elements.candidateDetail);
}

async function loadIntegrity(id, { forceRefresh = false } = {}) {
  const container = byId('integrityData');
  if (!container) return;
  container.innerHTML = '<div class="mini-loading">Consultando TCU, TSE e fontes oficiais de transparência…</div>';
  try {
    const suffix = forceRefresh ? '?refresh=1' : '';
    const payload = await requestJson(`/api/v1/candidates/${encodeURIComponent(id)}/integrity${suffix}`);
    container.innerHTML = renderIntegrityData(payload.data);
  } catch {
    container.innerHTML = renderIntegrityData({ status: 'UNAVAILABLE', message: 'As consultas de integridade não responderam agora. Os dados eleitorais oficiais permanecem disponíveis acima.' });
  }
  const retryButton = container.querySelector('[data-integrity-retry]');
  if (retryButton) retryButton.addEventListener('click', () => loadIntegrity(id, { forceRefresh: true }));
}

function integrityStageLabel(record) {
  if (record.stage === 'FINAL_DECISION') return 'Decisão final publicada';
  if (record.stage === 'ADMINISTRATIVE_SANCTION') return 'Sanção administrativa publicada';
  return 'Registro oficial publicado';
}

function integrityMeta(label, value) {
  return value ? `<span><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</span>` : '';
}

function renderTcuRecord(record) {
  const links = Array.isArray(record.officialLinks) ? record.officialLinks : [];
  return `<article class="integrity-record integrity-record-final">
    <div class="integrity-record-heading"><span class="integrity-stage final">${integrityStageLabel(record)}</span>${record.finalDecisionDate ? `<time>Trânsito em julgado: ${escapeHtml(record.finalDecisionDate)}</time>` : ''}</div>
    <h5>${escapeHtml(record.label || 'Registro do TCU')}</h5>
    <p>${escapeHtml(record.explanation || '')}</p>
    <div class="integrity-meta">${integrityMeta('Processo', record.processNumber)}${integrityMeta('Acórdão', record.decisionNumber)}${integrityMeta('Data da decisão', record.decisionDate)}${integrityMeta('Fim do período', record.endDate)}${integrityMeta('Local', [record.municipality, record.uf].filter(Boolean).join(' — '))}</div>
    ${links.map((url, index) => `<a class="inline-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${index === 0 ? 'Conferir deliberações' : 'Acompanhar processo'} no TCU ↗</a>`).join(' ')}
  </article>`;
}

function renderSanctionRecord(record) {
  return `<article class="integrity-record integrity-record-sanction">
    <div class="integrity-record-heading"><span class="integrity-stage administrative">${integrityStageLabel(record)}</span>${record.registry ? `<span class="integrity-registry">${escapeHtml(record.registry)}</span>` : ''}</div>
    <h5>${escapeHtml(record.sanctionType || record.label || 'Sanção publicada')}</h5>
    <p>${escapeHtml(record.explanation || '')}</p>
    <div class="integrity-meta">${integrityMeta('Processo', record.processNumber)}${integrityMeta('Órgão', record.sanctioningBody)}${integrityMeta('Publicação', record.publicationDate)}${integrityMeta('Início', record.startDate)}${integrityMeta('Fim', record.endDate)}${integrityMeta('UF', record.uf)}${record.fineValue !== null && record.fineValue !== undefined ? integrityMeta('Multa', formatCurrency(record.fineValue)) : ''}</div>
    ${record.legalBasis ? `<div class="integrity-basis"><strong>Fundamentação publicada</strong><p>${escapeHtml(record.legalBasis)}</p></div>` : ''}
    ${record.publicationUrl ? `<a class="inline-link" href="${escapeHtml(record.publicationUrl)}" target="_blank" rel="noopener noreferrer">Abrir publicação oficial ↗</a>` : ''}
  </article>`;
}

function renderIntegrityRegistry(title, section, renderer) {
  const current = section || { status: 'UNAVAILABLE', records: [], message: 'Fonte indisponível.' };
  const records = Array.isArray(current.records) ? current.records : [];
  const sourceLink = current.source?.url
    ? `<a class="inline-link" href="${escapeHtml(current.source.url)}" target="_blank" rel="noopener noreferrer">Consultar a fonte ↗</a>`
    : '';
  let emptyLabel = 'Fonte indisponível';
  if (current.status === 'NONE_FOUND') emptyLabel = 'Nenhum registro retornado';
  else if (current.status === 'DISABLED') emptyLabel = 'Consulta ainda não habilitada';
  else if (current.status === 'IDENTITY_NOT_READY') emptyLabel = 'Sincronização em andamento';
  else if (current.status === 'PARTIAL') emptyLabel = 'Consulta parcial';
  const content = records.length
    ? `<div class="integrity-record-list">${records.map(renderer).join('')}</div>`
    : `<div class="integrity-empty integrity-empty-${escapeHtml(String(current.status || '').toLowerCase())}"><strong>${emptyLabel}</strong><p>${escapeHtml(current.message || 'Nenhuma conclusão substituta foi exibida.')}</p>${sourceLink}</div>`;
  return `<section class="integrity-group"><div class="integrity-group-heading"><div><span>FONTE OFICIAL</span><h4>${escapeHtml(title)}</h4></div>${current.source?.name ? `<small>${escapeHtml(current.source.name)}</small>` : ''}</div>${content}${records.length ? `<p class="integrity-source-note">${escapeHtml(current.message || '')} ${sourceLink}</p>` : ''}</section>`;
}

function renderIntegrityMoney(data) {
  const campaign = data.campaignFinance || {};
  const assets = data.declaredAssets || {};
  const legislative = data.legislativeExpenses || {};
  const campaignFacts = campaign.status === 'PUBLISHED'
    ? `${fact('Receitas de campanha', formatCurrency(campaign.totalRevenue))}${fact('Despesas de campanha', formatCurrency(campaign.totalExpense))}${fact('Lançamentos publicados', formatNumber(Number(campaign.revenueRecords || 0) + Number(campaign.expenseRecords || 0)))}`
    : `${fact('Receitas de campanha', 'Ainda não publicadas')}${fact('Despesas de campanha', 'Ainda não publicadas')}`;
  const assetFacts = `${fact('Bens declarados', assets.status === 'PUBLISHED' ? formatCurrency(assets.total) : 'Nenhum no arquivo atual')}${fact('Itens de bens publicados', formatNumber(assets.count))}`;
  let legislativeFact = fact('Despesas do mandato atual', 'Sem mandato atual verificado');
  if (legislative.status === 'PUBLISHED') legislativeFact = fact(`Despesas parlamentares ${legislative.year || ''}`.trim(), `${formatCurrency(legislative.totalShown)}${legislative.partial ? ' — recorte parcial' : ''}`);
  else if (legislative.status === 'UNAVAILABLE') legislativeFact = fact('Despesas do mandato atual', 'Fonte indisponível agora');
  else if (legislative.status === 'NOT_PUBLISHED_IN_QUERY') legislativeFact = fact('Despesas do mandato atual', 'Não publicadas nesta consulta');
  return `<section class="integrity-group"><div class="integrity-group-heading"><div><span>VALORES PUBLICADOS</span><h4>Dinheiro e patrimônio declarados</h4></div><small>TSE e Casa legislativa</small></div><div class="fact-grid integrity-money-grid">${campaignFacts}${assetFacts}${legislativeFact}</div><p class="integrity-source-note">${escapeHtml(campaign.message || '')} ${escapeHtml(assets.message || '')} ${escapeHtml(legislative.message || '')}</p></section>`;
}

function renderIntegrityData(data, compact = false) {
  if (!data || data.status === 'UNAVAILABLE') {
    const retry = compact ? '' : '<button class="secondary-button integrity-retry-button" type="button" data-integrity-retry>Tentar novamente</button>';
    return `<div class="not-published"><p>${escapeHtml(data?.message || 'As fontes oficiais não responderam agora. Nenhuma conclusão substituta foi exibida.')}</p>${retry}</div>`;
  }
  const methodology = compact ? '' : `<div class="integrity-methodology"><strong>Como interpretar</strong><p>${escapeHtml(data.methodology?.legalStage || '')}</p><p>${escapeHtml(data.methodology?.absence || '')}</p><p>${escapeHtml(data.methodology?.privacy || '')}</p></div>`;
  return `<div class="integrity-check"><div class="integrity-alert"><div><span>LEITURA RESPONSÁVEL</span><strong>${escapeHtml(data.summary?.label || 'Consulta oficial concluída')}</strong></div><p>${escapeHtml(data.summary?.warning || 'Cada registro é mostrado com sua situação e fonte; não há nota automática.')}</p></div>${renderIntegrityRegistry('Decisões e impedimentos do TCU', data.publicAccounts, renderTcuRecord)}${renderIntegrityRegistry('Sanções administrativas federais', data.sanctions, renderSanctionRecord)}${renderIntegrityMoney(data)}${methodology}<p class="muted">Consulta realizada em ${formatDate(data.checkedAt)}.</p></div>`;
}

async function loadLegislative(id) {
  const container = byId('legislativeData');
  if (!container) return;
  container.innerHTML = '<div class="mini-loading">Consultando a Casa legislativa…</div>';
  try {
    const payload = await requestJson(`/api/v1/candidates/${encodeURIComponent(id)}/legislative`);
    container.innerHTML = renderLegislativeContent(payload.data, true);
  } catch (error) {
    container.innerHTML = `<div class="not-published">A API legislativa não respondeu agora. Nenhum valor substituto foi exibido.</div>`;
  }
}

function proposalCard(proposal) {
  const themes = proposal.themes?.length
    ? `<div class="proposal-themes">${proposal.themes.map((theme) => `<span>${escapeHtml(theme)}</span>`).join('')}</div>`
    : '';
  const evidence = proposal.evidence || {
    stage: 'PROPOSAL',
    label: 'Efeito não confirmado',
    explanation: 'A fonte consultada não publicou evidência suficiente para afirmar efeito real.',
  };
  return `<article class="proposal-card">
    <div class="proposal-heading"><strong>${escapeHtml(proposal.title || `${proposal.type} ${proposal.number}/${proposal.year}`)}</strong>${proposal.date ? `<time>${formatDate(proposal.date, false)}</time>` : ''}</div>
    ${themes}
    <div class="proposal-block"><span>O que propõe — ementa oficial</span><p>${escapeHtml(proposal.summary || 'Ementa não publicada.')}</p></div>
    <div class="proposal-block"><span>Situação oficial</span><p>${escapeHtml(proposal.status || 'Não publicada nesta consulta.')}</p></div>
    <div class="effect-evidence effect-${escapeHtml(String(evidence.stage || '').toLowerCase())}"><strong>${escapeHtml(evidence.label)}</strong><p>${escapeHtml(evidence.explanation)}</p></div>
    <a class="inline-link" href="${escapeHtml(proposal.officialUrl)}" target="_blank" rel="noopener noreferrer">Acompanhar na fonte oficial ↗</a>
  </article>`;
}

function renderLegislativeContent(data, includeExpenses = false) {
  const expenses = includeExpenses
    ? (data.expenses
      ? `<div class="fact"><span>Despesas consultadas em 2026</span><strong>${formatCurrency(data.expenses.totalShown)}</strong></div><div class="fact"><span>Registros considerados</span><strong>${formatNumber(data.expenses.recordsShown)}${data.expenses.partial ? ' — recorte parcial' : ''}</strong></div>`
      : '<div class="fact"><span>Despesas</span><strong>Não publicadas nesta consulta</strong></div>')
    : '';
  const facts = includeExpenses
    ? `<div class="fact-grid">${expenses}<div class="fact"><span>Casa legislativa</span><strong>${escapeHtml(data.chamber)}</strong></div></div>`
    : '';
  const proposals = data.proposals?.length
    ? `<div class="proposal-list">${data.proposals.slice(0, 5).map(proposalCard).join('')}</div>`
    : '<div class="not-published">Nenhum projeto dos tipos incluídos no recorte foi retornado. Isso não significa ausência de outras atividades parlamentares.</div>';
  return `<div class="detail-section">${facts}${data.note ? `<p class="muted">${escapeHtml(data.note)}</p>` : ''}<h3>Até 5 projetos legislativos mais recentes</h3><p class="method-note">${escapeHtml(data.methodology?.rule || 'Recorte de proposições publicado pela Casa legislativa.')} ${escapeHtml(data.methodology?.impactRule || '')}</p>${proposals}<p class="muted">Consultado em ${formatDate(data.source.fetchedAt)} · <a href="${escapeHtml(data.source.url)}" target="_blank" rel="noopener noreferrer">fonte oficial</a></p></div>`;
}

async function loadGovernmentPlan(id) {
  const container = byId('governmentPlanData');
  if (!container) return;
  container.innerHTML = '<div class="mini-loading">Localizando e lendo o documento oficial do TSE…</div>';
  try {
    const payload = await requestJson(`/api/v1/candidates/${encodeURIComponent(id)}/government-plan/status`);
    container.innerHTML = renderGovernmentPlan(payload.data, id);
    if (payload.data?.available) await loadGovernmentPlanSummary(id, container);
  } catch {
    container.innerHTML = '<div class="not-published">Não foi possível consultar o arquivo oficial agora. Nenhum documento alternativo foi usado.</div>';
  }
}

async function loadGovernmentPlanSummary(id, container) {
  const host = container.querySelector('[data-plan-summary-host]');
  if (!host) return;
  try {
    const payload = await requestJson(`/api/v1/candidates/${encodeURIComponent(id)}/government-plan/summary?v=local-llm-v1`);
    host.innerHTML = renderPlanSummary(payload.data);
  } catch {
    host.innerHTML = '<div class="not-published">O PDF oficial está disponível, mas o resumo automático não pôde ser produzido agora.</div>';
  }
}

function renderPlanSummary(summary) {
  if (!summary?.themeSummaries?.length) {
    return '<div class="not-published">O PDF foi localizado, mas não contém texto extraível suficiente para um resumo confiável. Consulte o documento original.</div>';
  }
  let firstFoundOpened = false;
  const themes = summary.themeSummaries.map((theme) => {
    const hasProposals = theme.status === 'FOUND' && theme.proposals?.length;
    const open = hasProposals && !firstFoundOpened;
    if (open) firstFoundOpened = true;
    return renderPlanTheme(theme, summary.pdfUrl, open);
  }).join('');
  const foundCount = summary.themeSummaries.filter((theme) => theme.status === 'FOUND').length;
  const totalThemes = summary.themeSummaries.length;
  const localAiReady = summary.summaryType === 'AUTOMATIC_THEMATIC_LOCAL_LLM' && summary.aiAnalysis?.status === 'READY';
  const analysisBadge = localAiReady ? 'IA LOCAL · PDF PROCESSADO' : `LEITURA POR ${totalThemes} TEMAS`;
  const pending = summary.aiAnalysis?.status === 'QUEUED'
    ? '<div class="analysis-progress"><strong>Análise aprofundada em processamento</strong><span>Os trechos oficiais já estão disponíveis. A consolidação pela IA local será salva e aparecerá automaticamente em uma próxima consulta.</span></div>'
    : '';
  const modelNote = localAiReady
    ? ` · IA local ${escapeHtml(summary.aiAnalysis.model || '')} · ${Number(summary.aiAnalysis.chunksProcessed || 0)} blocos processados`
    : '';
  return `<section class="plan-summary"><div class="plan-summary-heading"><div><span class="summary-badge">${analysisBadge}</span><h4>Propostas organizadas para comparação</h4></div><span class="coverage-pill">${foundCount}/${totalThemes} temas com propostas</span></div><p class="plan-overview">${escapeHtml(summary.overview)}</p>${pending}<div class="plan-theme-list">${themes}</div><div class="summary-notice"><strong>Como ler esta classificação</strong><p>${escapeHtml(summary.notice)}</p><span>${Number(summary.document?.pages || 0)} páginas · texto extraível em ${Number(summary.document?.textCoveragePercent || 0)}% das páginas processadas${modelNote} · gerado em ${formatDate(summary.generatedAt)}</span></div></section>`;
}

function renderPlanTheme(theme, pdfUrl, open = false) {
  const proposals = Array.isArray(theme.proposals) ? theme.proposals : [];
  const found = theme.status === 'FOUND' && proposals.length > 0;
  const pageLabel = theme.pages?.length
    ? `páginas ${theme.pages.map((page) => Number(page) || 1).join(', ')}`
    : 'nenhuma página classificada';
  const content = found
    ? `${proposals.map((proposal, index) => renderPlanProposal(proposal, pdfUrl, index)).join('')}${proposals.length > 3 ? `<button class="secondary-button proposal-more-button" type="button" data-show-more-proposals>Ver mais 3 propostas</button>` : ''}`
    : '<div class="theme-not-found">Nenhum trecho com linguagem de proposta foi identificado automaticamente neste tema. Isso não comprova que o assunto esteja ausente do documento.</div>';
  return `<details class="plan-theme ${found ? 'is-found' : 'is-missing'}" ${open ? 'open' : ''}><summary><span class="theme-status" aria-hidden="true">${found ? 'Encontrado' : 'Não identificado'}</span><span class="theme-title"><strong>${escapeHtml(theme.label)}</strong><small>${found ? `${proposals.length} ${proposals.length === 1 ? 'proposta' : 'propostas'} · ${escapeHtml(pageLabel)}` : 'sem proposta classificada'}</small></span><span class="theme-expand" aria-hidden="true">+</span></summary><div class="theme-content">${content}</div></details>`;
}

function renderListBlock(label, values, className = '') {
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!items.length) return '';
  return `<div class="proposal-context ${className}"><strong>${escapeHtml(label)}</strong><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`;
}

function renderPlanProposal(proposal, pdfUrl, index) {
  const localAi = proposal.extraction === 'LOCAL_LLM_GROUNDED';
  const hidden = index >= 3 ? ' hidden data-collapsed-proposal' : '';
  if (!localAi) {
    return `<article class="theme-proposal"${hidden}><p>${escapeHtml(proposal.text)}</p><div class="theme-location"><span><strong>Seção:</strong> ${escapeHtml(proposal.section || 'não identificada no texto extraído')}</span><a href="${escapeHtml(pdfUrl)}#page=${Number(proposal.page) || 1}" target="_blank" rel="noopener noreferrer">Conferir na página ${Number(proposal.page) || 1} ↗</a></div></article>`;
  }
  const evidences = Array.isArray(proposal.evidences) ? proposal.evidences : [];
  const scenario = proposal.fourYearScenario || {};
  const pages = [...new Set(evidences.map((evidence) => Number(evidence.page) || 1))];
  const evidenceContent = evidences.map((evidence) => `<blockquote><p>${escapeHtml(evidence.quote)}</p><a href="${escapeHtml(pdfUrl)}#page=${Number(evidence.page) || 1}" target="_blank" rel="noopener noreferrer">Conferir página ${Number(evidence.page) || 1} ↗</a></blockquote>`).join('');
  return `<article class="theme-proposal is-ai-consolidated"${hidden}><div class="proposal-title-row"><span>${index + 1}</span><div><small>PROPOSTA CONSOLIDADA</small><h5>${escapeHtml(proposal.title || 'Proposta identificada')}</h5></div></div><p class="proposal-summary-text">${escapeHtml(proposal.summary || proposal.text)}</p><section class="four-year-impact"><span>POSSÍVEL IMPACTO EM 4 ANOS · CENÁRIO CONDICIONAL</span><p>${escapeHtml(scenario.potentialImpact || 'O resultado dependerá da execução e dos recursos disponíveis.')}</p><ol><li><strong>Primeiro ano</strong><p>${escapeHtml(scenario.firstYear || 'Etapa não detalhada no plano.')}</p></li><li><strong>Anos 2 e 3</strong><p>${escapeHtml(scenario.yearsTwoAndThree || 'Etapa não detalhada no plano.')}</p></li><li><strong>Quarto ano</strong><p>${escapeHtml(scenario.fourthYear || 'Resultado não quantificado no plano.')}</p></li></ol></section><div class="proposal-context-grid">${renderListBlock('Quem pode ser afetado', proposal.audience)}${renderListBlock('Dependências', proposal.requirements)}${renderListBlock('Riscos de execução', proposal.risks, 'is-risk')}${renderListBlock('Como acompanhar', proposal.indicators)}${renderListBlock('Não identificado nos trechos', proposal.missingInformation, 'is-missing')}</div><details class="proposal-evidence"><summary>Ver ${evidences.length} ${evidences.length === 1 ? 'evidência' : 'evidências'} no PDF · ${escapeHtml(pages.map((page) => `p. ${page}`).join(', '))}</summary>${evidenceContent}</details>${proposal.section ? `<div class="theme-location"><span><strong>Seção associada:</strong> ${escapeHtml(proposal.section)}</span></div>` : ''}</article>`;
}

function showNextPlanProposals(button) {
  const host = button.closest('.theme-content');
  if (!host) return;
  const hidden = [...host.querySelectorAll('[data-collapsed-proposal][hidden]')];
  hidden.slice(0, 3).forEach((proposal) => { proposal.hidden = false; });
  const remaining = host.querySelectorAll('[data-collapsed-proposal][hidden]').length;
  if (!remaining) button.remove();
  else button.textContent = `Ver mais ${Math.min(3, remaining)} propostas`;
}

function renderGovernmentPlan(plan, candidateId, summary = null) {
  if (!plan?.available) {
    return `<div class="not-published">${escapeHtml(plan?.message || 'O documento não consta no arquivo oficial atual.')}</div>`;
  }
  const summaryContent = summary
    ? renderPlanSummary({ ...summary, pdfUrl: summary.pdfUrl || plan.url })
    : '<div class="mini-loading">Lendo as páginas e classificando propostas nos 9 temas…</div>';
  return `<div class="plan-experience"><div data-plan-summary-host>${summaryContent}</div><article class="plan-card"><span class="source-state ok">Documento oficial localizado</span><h4>Plano de governo entregue ao TSE</h4><p>Associado pelo identificador único da candidatura. O resumo acima é automático; o PDF permanece como fonte integral.</p><a class="secondary-button document-link" href="${escapeHtml(plan.url)}" target="_blank" rel="noopener noreferrer">Abrir PDF completo</a><a class="inline-link" href="${escapeHtml(plan.source.url)}" target="_blank" rel="noopener noreferrer">Ver conjunto de dados do TSE ↗</a></article></div>`;
}

function fact(label, value) {
  return `<div class="fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || 'Não publicado')}</strong></div>`;
}
function socialDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Rede social declarada'; }
}

function toggleComparison(id) {
  const index = state.compareIds.indexOf(id);
  if (index >= 0) state.compareIds.splice(index, 1);
  else if (state.compareIds.length < 2) state.compareIds.push(id);
  else {
    window.alert('A comparação aceita duas candidaturas por vez. Remova uma para adicionar outra.');
    return;
  }
  updateCompareCount();
  renderCandidates();
  if (state.view === 'compare') renderComparison();
}

function updateCompareCount() { elements.compareCount.textContent = state.compareIds.length; }

async function renderComparison() {
  if (state.compareIds.length !== 2) {
    elements.comparisonContent.innerHTML = '<div class="compare-empty"><strong>Selecione duas candidaturas</strong><p>Use o botão “Comparar” nos cartões. Só exibimos campos publicados pelas fontes.</p></div>';
    return;
  }
  elements.comparisonContent.innerHTML = '<div class="skeleton"></div>';
  try {
    const candidates = await Promise.all(state.compareIds.map(async (id) => {
      const cached = state.candidateCache.get(id);
      if (cached?.assets) return cached;
      const payload = await requestJson(`/api/v1/candidates/${encodeURIComponent(id)}`);
      state.candidateCache.set(id, payload.data);
      return payload.data;
    }));
    const [a, b] = candidates;
    const rows = [
      ['Nome de urna', a.ballotName, b.ballotName],
      ['Número', a.ballotNumber, b.ballotNumber],
      ['Cargo', a.office, b.office],
      ['Partido', a.party, b.party],
      ['Faixa ideológica do partido', partyIdeologyLabel(a, true), partyIdeologyLabel(b, true)],
      ['Chapa', runningMateLabel(a) || 'Sem vice/suplente para este cargo', runningMateLabel(b) || 'Sem vice/suplente para este cargo'],
      ['Situação', a.status, b.status],
      ['UF', a.uf, b.uf],
      ['Ocupação', a.occupation || 'Não publicado', b.occupation || 'Não publicado'],
      ['Bens declarados', formatCurrency(a.assetTotal), formatCurrency(b.assetTotal)],
      ['Receitas publicadas', a.finance ? formatCurrency(a.finance.totalRevenue) : 'Ainda não publicado', b.finance ? formatCurrency(b.finance.totalRevenue) : 'Ainda não publicado'],
      ['Despesas publicadas', a.finance ? formatCurrency(a.finance.totalExpense) : 'Ainda não publicado', b.finance ? formatCurrency(b.finance.totalExpense) : 'Ainda não publicado'],
    ];
    elements.comparisonContent.innerHTML = `<div class="compare-grid">
      <div class="compare-cell compare-label">Campo</div><div class="compare-cell compare-head"><div class="compare-candidate-head">${partyMarkHtml(a, true)}<span>${escapeHtml(a.ballotName)}</span></div><div class="compare-source">Fonte oficial TSE</div></div><div class="compare-cell compare-head"><div class="compare-candidate-head">${partyMarkHtml(b, true)}<span>${escapeHtml(b.ballotName)}</span></div><div class="compare-source">Fonte oficial TSE</div></div>
      ${rows.map(([label, left, right]) => `<div class="compare-cell compare-label">${escapeHtml(label)}</div><div class="compare-cell">${escapeHtml(left ?? 'Não publicado')}</div><div class="compare-cell">${escapeHtml(right ?? 'Não publicado')}</div>`).join('')}
    </div><div id="comparisonEvidence" class="comparison-evidence"><div class="mini-loading">Consultando propostas e projetos nas fontes oficiais…</div></div>`;
    const comparisonKey = state.compareIds.join('|');
    await renderComparisonEvidence(candidates, comparisonKey);
  } catch {
    elements.comparisonContent.innerHTML = '<div class="compare-empty"><strong>Comparação indisponível</strong><p>Não foi possível carregar os registros oficiais agora.</p></div>';
  }
}

async function candidateEvidence(candidate) {
  const planEligible = ['GOVERNADOR', 'PRESIDENTE'].includes(String(candidate.office || '').toUpperCase());
  const [planResult, planSummaryResult, legislativeResult, integrityResult] = await Promise.allSettled([
    planEligible
      ? requestJson(`/api/v1/candidates/${encodeURIComponent(candidate.id)}/government-plan/status`)
      : Promise.resolve(null),
    planEligible
      ? requestJson(`/api/v1/candidates/${encodeURIComponent(candidate.id)}/government-plan/summary?v=local-llm-v1`)
      : Promise.resolve(null),
    candidate.legislative
      ? requestJson(`/api/v1/candidates/${encodeURIComponent(candidate.id)}/legislative`)
      : Promise.resolve(null),
    requestJson(`/api/v1/candidates/${encodeURIComponent(candidate.id)}/integrity`),
  ]);
  return {
    planEligible,
    plan: planResult.status === 'fulfilled' ? planResult.value?.data || null : { error: true },
    planSummary: planSummaryResult.status === 'fulfilled' ? planSummaryResult.value?.data || null : { error: true },
    legislative: legislativeResult.status === 'fulfilled' ? legislativeResult.value?.data || null : { error: true },
    integrity: integrityResult.status === 'fulfilled' ? integrityResult.value?.data || null : { status: 'UNAVAILABLE' },
  };
}

function comparisonEvidenceColumn(candidate, evidence) {
  let plan;
  if (!evidence.planEligible) {
    plan = '<div class="not-published">O TSE publica este conjunto de planos para presidente e governador. Não atribuímos um documento a este cargo.</div>';
  } else if (evidence.plan?.error) {
    plan = '<div class="not-published">O arquivo do TSE não respondeu agora.</div>';
  } else {
    plan = renderGovernmentPlan(evidence.plan, candidate.id, evidence.planSummary?.error ? { available: false } : evidence.planSummary);
  }

  let legislative;
  if (!candidate.legislative) {
    legislative = '<div class="not-published">Sem correspondência exata com mandato parlamentar atual. Nenhum projeto foi atribuído por semelhança de nome.</div>';
  } else if (evidence.legislative?.error) {
    legislative = '<div class="not-published">A Casa legislativa não respondeu agora.</div>';
  } else {
    legislative = renderLegislativeContent(evidence.legislative, false);
  }

  const integrity = renderIntegrityData(evidence.integrity, true);
  return `<section class="evidence-column"><h3>${escapeHtml(candidate.ballotName)}</h3><div class="evidence-section"><h4>Propostas para o mandato</h4>${plan}</div><div class="evidence-section"><h4>Projetos no mandato atual</h4>${legislative}</div><div class="evidence-section"><h4>Fiscalização e integridade</h4>${integrity}</div></section>`;
}

async function renderComparisonEvidence(candidates, comparisonKey) {
  const results = await Promise.all(candidates.map(candidateEvidence));
  if (comparisonKey !== state.compareIds.join('|')) return;
  const container = byId('comparisonEvidence');
  if (!container) return;
  container.innerHTML = `<div class="evidence-intro"><strong>Mesmos critérios, fontes oficiais preservadas</strong><p>Os planos são classificados nos mesmos nove temas — incluindo segurança pública e combate ao crime organizado — e cada trecho mantém página e seção de origem. “Não identificado” não significa ausência de proposta. Decisões do TCU, sanções administrativas e valores declarados aparecem pelo estágio publicado, sem nota, ranking ou presunção de culpa.</p></div><div class="compare-evidence-grid">${candidates.map((candidate, index) => comparisonEvidenceColumn(candidate, results[index])).join('')}</div>`;
}

function readColinha() {
  try { return JSON.parse(localStorage.getItem('votoclaro_colinha_v2')) || {}; } catch { return {}; }
}
function saveColinha(colinha) {
  localStorage.setItem('votoclaro_colinha_v2', JSON.stringify(colinha));
  renderColinha();
}
function slotForCandidate(candidate, colinha) {
  const office = String(candidate.office || '').toLowerCase();
  if (office.includes('presidente')) return 'presidente';
  if (office.includes('governador')) return 'governador';
  if (office.includes('senador')) return !colinha.senador1 ? 'senador1' : !colinha.senador2 ? 'senador2' : 'senador1';
  if (office.includes('deputado federal')) return 'deputadoFederal';
  if (office.includes('deputado estadual') || office.includes('deputado distrital')) return 'deputadoEstadual';
  return null;
}
async function addToColinhaById(id) {
  let candidate = state.candidateCache.get(id);
  if (!candidate) {
    try { candidate = (await requestJson(`/api/v1/candidates/${encodeURIComponent(id)}`)).data; } catch { return; }
  }
  const colinha = readColinha();
  const slot = slotForCandidate(candidate, colinha);
  if (!slot) return window.alert('Esse cargo não possui espaço na colinha das Eleições Gerais de 2026.');
  if (colinha[slot] && !window.confirm(`Substituir ${colinha[slot].ballotName} por ${candidate.ballotName}?`)) return;
  colinha[slot] = { id: candidate.id, ballotName: candidate.ballotName, ballotNumber: candidate.ballotNumber, party: candidate.party, partyName: candidate.partyName, partyNumber: candidate.partyNumber, office: candidate.office };
  saveColinha(colinha);
  if (elements.candidateDialog.open) elements.candidateDialog.close();
}
function removeColinhaSlot(slot) { const colinha = readColinha(); delete colinha[slot]; saveColinha(colinha); }
function clearColinha() { if (window.confirm('Apagar todas as escolhas salvas somente neste navegador?')) saveColinha({}); }
function colinhaPlainText() {
  const colinha = readColinha();
  const choices = COLINHA_ROLES.map(([key, label]) => {
    const candidate = colinha[key];
    if (!candidate) return `${label}: ainda não escolhido`;
    const number = candidate.ballotNumber ?? 'número não publicado';
    const party = candidate.party ? ` · ${candidate.party}` : '';
    return `${label}: ${number} — ${candidate.ballotName}${party}`;
  });
  return [
    'MINHA COLINHA — ELEIÇÕES 2026',
    '',
    ...choices,
    '',
    'Confira os números antes de votar. Colinha montada no VotoClaro.',
  ].join('\n');
}
async function writeClipboardText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, field.value.length);
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('COPY_NOT_SUPPORTED');
}
async function copyColinha() {
  const button = byId('copyColinha');
  try {
    await writeClipboardText(colinhaPlainText());
    button.textContent = 'Colinha copiada ✓';
    window.setTimeout(() => { button.textContent = 'Copiar colinha'; }, 2200);
  } catch {
    window.prompt('Seu navegador não permitiu copiar automaticamente. Selecione e copie o texto:', colinhaPlainText());
  }
}
function renderColinha() {
  const colinha = readColinha();
  elements.colinhaSlots.innerHTML = COLINHA_ROLES.map(([key, label]) => {
    const candidate = colinha[key];
    return `<div class="colinha-slot ${candidate ? 'filled' : ''}">${candidate ? partyMarkHtml(candidate, true) : ''}<div><small>${escapeHtml(label)}</small><strong>${candidate ? `${escapeHtml(candidate.ballotName)} · ${escapeHtml(candidate.ballotNumber)}` : 'Ainda não escolhido'}</strong></div>${candidate ? `<button type="button" data-remove-slot="${key}" aria-label="Remover ${escapeHtml(candidate.ballotName)}">×</button>` : ''}</div>`;
  }).join('');
  const completed = COLINHA_ROLES.filter(([key]) => Boolean(colinha[key])).length;
  const remaining = COLINHA_ROLES.length - completed;
  const complete = remaining === 0;
  elements.colinhaNavCount.textContent = `${completed}/6`;
  elements.colinhaProgress.classList.toggle('complete', complete);
  elements.colinhaProgressTitle.textContent = complete ? 'Sua colinha está pronta: 6 de 6 escolhas' : `Sua colinha: ${completed} de 6 escolhas`;
  elements.colinhaProgressText.textContent = complete ? 'Cartão concluído. Revise os números antes de votar.' : `Faltam ${remaining} ${remaining === 1 ? 'escolha' : 'escolhas'} para concluir seu cartão.`;
  elements.colinhaProgressBar.style.width = `${Math.round((completed / COLINHA_ROLES.length) * 100)}%`;
  elements.colinhaProgressBar.parentElement.setAttribute('aria-valuenow', String(completed));
  byId('continueColinha').textContent = complete ? 'Revisar colinha' : 'Continuar minha colinha';
}

async function loadSources() {
  elements.sourceGrid.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const payload = await requestJson('/api/v1/sources');
    elements.sourceGrid.innerHTML = payload.sources.map((source) => {
      const current = source.status || {};
      const stateLabel = { OK: 'Ativa', PARTIAL: 'Parcial', PLANNED: 'Planejada', NOT_SYNCED: 'Não sincronizada', UNAVAILABLE: 'Ainda indisponível', ERROR: 'Falha temporária' }[current.state] || current.state;
      return `<article class="source-card"><div><span class="source-state ${String(current.state || '').toLowerCase()}">${escapeHtml(stateLabel)}</span><span class="source-kind">${source.kind === 'OFFICIAL' ? 'Fonte oficial' : 'Fonte secundária'}</span></div><h3>${escapeHtml(source.name)}</h3><p>${escapeHtml(source.description)}</p><div class="source-meta"><p><strong>Periodicidade:</strong> ${escapeHtml(source.cadence)}</p><p>${escapeHtml(current.message || '')}</p><a class="inline-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">Abrir fonte ↗</a></div></article>`;
    }).join('');
    elements.syncRuns.innerHTML = payload.syncRuns.length ? payload.syncRuns.map((run) => `<div class="sync-row"><strong>${escapeHtml(run.sourceId)}</strong><span>${escapeHtml(run.status)}</span><span>${formatDate(run.finishedAt || run.startedAt)}</span><span>${run.recordCount ? formatNumber(run.recordCount) : '—'}</span></div>`).join('') : '<div class="sync-row"><span>Ainda não há execuções registradas.</span></div>';
  } catch {
    elements.sourceGrid.innerHTML = '<div class="empty-state"><strong>Auditoria indisponível</strong><p>Tente novamente em instantes.</p></div>';
  }
}

async function loadChanges() {
  elements.changesList.innerHTML = '<div class="skeleton"></div>';
  try {
    const payload = await requestJson('/api/v1/changes');
    if (!payload.data.length) {
      elements.changesList.innerHTML = '<div class="empty-state"><strong>Nenhuma mudança entre versões</strong><p>Na primeira importação não há uma versão anterior para comparação.</p></div>';
      return;
    }
    elements.changesList.innerHTML = payload.data.map((change) => `<article class="timeline-item"><time>${formatDate(change.detectedAt)}</time><div><strong>${escapeHtml(change.candidateName || change.candidateId)}</strong><p>${escapeHtml(changeDescription(change))}</p><p>Fonte: TSE — Candidatos 2026</p></div></article>`).join('');
  } catch {
    elements.changesList.innerHTML = '<div class="empty-state"><strong>Histórico indisponível</strong><p>Tente novamente em instantes.</p></div>';
  }
}
function changeDescription(change) {
  if (change.type === 'CANDIDATE_ADDED') return 'Candidatura incluída na publicação oficial.';
  if (change.type === 'CANDIDATE_REMOVED') return 'Candidatura não consta na versão oficial atual.';
  return `${change.field}: “${change.previousValue || 'não publicado'}” → “${change.currentValue || 'não publicado'}”.`;
}

async function initialize() {
  cacheElements();
  bindEvents();
  renderColinha();
  updateCompareCount();
  renderSkeletons();
  await loadHealth();
  await Promise.all([loadFilters(), loadCandidates(), loadPopularCandidates()]);
}

document.addEventListener('DOMContentLoaded', initialize);
