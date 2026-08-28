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
  comparisonEvidence: null,
  activeCandidateId: null,
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

const PHOTO_CACHE_VERSION = 'postgres-import-1';

function versionedCandidatePhotoUrl(value) {
  const url = String(value || '');
  if (!/^\/api\/v1\/candidates\/\d+\/photo(?:\?|$)/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${PHOTO_CACHE_VERSION}`;
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
    sourceAlerts: byId('sourceAlerts'),
    syncRuns: byId('syncRuns'),
    changesList: byId('changesList'),
    shareComparisonTheme: byId('shareComparisonTheme'),
    shareComparisonImage: byId('shareComparisonImage'),
    shareComparisonStatus: byId('shareComparisonStatus'),
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
  byId('shareComparisonImage').addEventListener('click', shareComparisonImage);
  document.querySelector('[data-close-dialog]').addEventListener('click', closeCandidate);
  window.addEventListener('popstate', synchronizeCandidateRoute);
  elements.candidateGrid.addEventListener('click', handleCandidateAction);
  elements.popularGrid.addEventListener('click', handleCandidateAction);
  elements.candidateDetail.addEventListener('click', handleCandidateAction);
  elements.candidateDetail.addEventListener('submit', handleAnalysisReportSubmit);
  elements.comparisonContent.addEventListener('click', handleCandidateAction);
  elements.comparisonContent.addEventListener('submit', handleAnalysisReportSubmit);
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
    const alertCount = Array.isArray(health.sourceAlerts) ? health.sourceAlerts.length : 0;
    elements.healthBadge.innerHTML = `<span class="health-dot"></span><span>${alertCount ? `${alertCount} ${alertCount === 1 ? 'fonte com alerta' : 'fontes com alerta'}` : healthy ? 'Dados atualizados' : health.status === 'INITIALIZING' ? 'Sincronizando com o TSE' : 'Dados precisam atualizar'}</span>`;
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
  return `<img class="avatar avatar-image" src="${escapeHtml(versionedCandidatePhotoUrl(candidate.photoUrl))}" alt="Foto oficial de ${escapeHtml(candidate.ballotName)}" data-fallback="${fallback}" width="56" height="56" loading="lazy" decoding="async">`;
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
  elements.snapshotTime.textContent = `${sourceTime} · última atualização publicada em ${formatDate(snapshot.importedAt)}`;
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
  const governmentPlan = event.target.closest('[data-load-government-plan]');
  if (governmentPlan) return loadGovernmentPlan(governmentPlan.dataset.loadGovernmentPlan);
  const question = event.target.closest('[data-question-suggestion]');
  if (question) {
    const input = byId('officialQuestionInput');
    if (input) { input.value = question.dataset.questionSuggestion; input.focus(); }
  }
}

async function openCandidate(id, options = {}) {
  const updateUrl = options.updateUrl !== false;
  state.activeCandidateId = String(id);
  elements.candidateDetail.innerHTML = '<div class="detail-body"><div class="skeleton"></div></div>';
  if (!elements.candidateDialog.open) elements.candidateDialog.showModal();
  if (updateUrl && window.location.pathname !== `/candidato/${encodeURIComponent(id)}`) {
    history.pushState({ candidateId: String(id) }, '', `/candidato/${encodeURIComponent(id)}`);
  }
  try {
    const payload = await requestJson(`/api/v1/candidates/${encodeURIComponent(id)}`);
    state.candidateCache.set(id, payload.data);
    renderCandidateDetail(payload.data, payload.snapshot);
    loadAssetHistory(id);
    loadCandidateHistory(id);
    loadIntegrity(id);
    if (payload.data.legislative) loadLegislative(id);
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
  const spendingLimit = candidate.maximumCampaignExpense
    ? fact('Limite oficial de gastos', formatCurrency(candidate.maximumCampaignExpense))
    : '';
  const finance = candidate.finance
    ? `<div class="fact-grid">
        ${spendingLimit}
        <div class="fact"><span>Receitas publicadas</span><strong>${formatCurrency(candidate.finance.totalRevenue)}</strong></div>
        <div class="fact"><span>Despesas publicadas</span><strong>${formatCurrency(candidate.finance.totalExpense)}</strong></div>
        <div class="fact"><span>Saldo calculado</span><strong>${formatCurrency(candidate.finance.balance)}</strong></div>
      </div><p class="muted">${escapeHtml(candidate.finance.note)}</p>`
    : `${spendingLimit ? `<div class="fact-grid">${spendingLimit}</div>` : ''}<div class="not-published"><strong>Receitas e despesas ainda não publicadas.</strong><br>Os arquivos consolidados de prestação de contas de 2026 ainda não constam na fonte oficial importada. O limite acima é oficial; o VotoClaro não estima arrecadação nem gastos.</div>`;
  const assets = candidate.assets.length
    ? `<div class="table-scroll" role="region" aria-label="Bens declarados" tabindex="0"><table class="asset-table"><thead><tr><th>Bem declarado</th><th>Tipo</th><th>Valor</th></tr></thead><tbody>${candidate.assets.map((asset) => `<tr><td>${escapeHtml(asset.description || 'Descrição não informada')}</td><td>${escapeHtml(asset.type || 'Não informado')}</td><td>${formatCurrency(asset.value)}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="2">Total declarado</th><th>${formatCurrency(candidate.assetTotal)}</th></tr></tfoot></table></div>`
    : '<div class="not-published">Nenhum bem consta no arquivo oficial importado. Isso pode significar ausência de declaração ou publicação ainda não processada.</div>';
  const social = candidate.socialLinks.length
    ? `<div class="source-list">${candidate.socialLinks.map((item) => `<a class="source-item" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(socialDomain(item.url))}</strong><span>Abrir endereço declarado ↗</span></a>`).join('')}</div>`
    : '<div class="not-published">Nenhuma rede social foi publicada no arquivo oficial importado.</div>';
  const sources = candidate.sources.map((source) => `<div class="source-item"><div><strong>${escapeHtml(source.name)}</strong><span>${escapeHtml(source.authority)} · ${formatDate(source.generatedAt)}</span></div><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">Ver fonte ↗</a></div>`).join('');
  const registrationStatus = [candidate.status, candidate.statusDetail]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(' — ');
  const electoralAlliance = [candidate.coalition, candidate.federation]
    .filter(Boolean)
    .join(' · ');
  const planEligible = ['GOVERNADOR', 'PRESIDENTE'].includes(String(candidate.office || '').toUpperCase());
  const governmentPlan = planEligible
    ? `<section class="detail-section"><h3>Plano de governo</h3><div id="governmentPlanData"><div class="not-published"><strong>Documento entregue ao TSE.</strong><br>O vínculo usa o identificador oficial desta candidatura.<br><button class="secondary-button" type="button" data-load-government-plan="${escapeHtml(candidate.id)}">Ver resumo e plano oficial</button></div></div></section>`
    : `<section class="detail-section"><h3>Plano de governo</h3><div class="not-published"><strong>Este cargo não entrega plano de governo individual nesse conjunto do TSE.</strong><br>Planos de governo são publicados para presidente e governador. Para cargos legislativos, o histórico verificável de normas aparece abaixo quando há vínculo oficial exato.</div></section>`;
  const legislativeHistory = candidate.legislative
    ? '<section class="detail-section"><h3>Painel do mandato anterior</h3><div id="legislativeData"><div class="mini-loading">Confirmando atuação, despesas, projetos e normas nas fontes legislativas oficiais…</div></div></section>'
    : '<section class="detail-section"><h3>Painel do mandato anterior</h3><div class="not-published">Não há correspondência exata com um mandato parlamentar em exercício nas listas atuais da Câmara ou do Senado. Por segurança, nenhum projeto, voto, despesa ou norma é atribuído apenas por semelhança de nome.</div></section>';
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
      <section class="detail-section"><h3>Informações principais</h3><div class="fact-grid">
        ${fact('Cargo', candidate.office)}${fact('Situação do registro', registrationStatus)}
        ${fact('Partido', [candidate.party, candidate.partyName].filter(Boolean).join(' — '))}${fact('UF / unidade eleitoral', [candidate.uf, candidate.electionUnitName].filter(Boolean).join(' — '))}
        ${optionalFact('Aliança eleitoral', electoralAlliance)}${fact('Inserida na urna', candidate.insertedInBallot ? 'Sim' : 'Ainda não')}
        ${fact('Reeleição declarada', candidate.reelection ? 'Sim' : 'Não')}${optionalFact('Idade na posse', candidate.ageAtTakingOffice ? `${candidate.ageAtTakingOffice} anos` : '')}
        ${optionalFact('Ocupação', candidate.occupation)}${optionalFact('Escolaridade', candidate.education)}${fact('Faixa ideológica do partido', partyIdeologyLabel(candidate, true))}
      </div><p class="method-note ideology-method-note">A faixa ideológica se refere ao partido na pesquisa acadêmica, não à posição individual da pessoa candidata. <a href="/methodology.html#ideologia-partidaria">Ver fonte, limites e ressalvas</a>.</p></section>
      ${ticket}
      <section class="detail-section"><h3>Evolução patrimonial declarada</h3>${assets}<div id="assetHistoryData"><div class="mini-loading">Cruzando eleições anteriores pelo identificador oficial protegido…</div></div></section>
      <section class="detail-section"><h3>Financiamento da campanha</h3>${finance}</section>
      ${governmentPlan}
      ${legislativeHistory}
      <section class="detail-section official-question-section"><h3>Pergunte aos documentos oficiais</h3><p class="method-note">A IA recebe somente trechos do plano oficial e itens legislativos com vínculo confirmado. Ela não pesquisa opinião, notícia ou internet aberta.</p><div class="question-suggestions"><button type="button" data-question-suggestion="O que esta candidatura propõe para educação?">Propostas para educação</button><button type="button" data-question-suggestion="O documento explica como financiar as propostas?">Como pretende financiar?</button><button type="button" data-question-suggestion="Quais leis desta pessoa podem afetar trabalhadores e o que a fonte confirma?">Leis que afetam trabalhadores</button></div><form id="officialQuestionForm" data-official-question-form data-candidate-id="${escapeHtml(candidate.id)}"><label for="officialQuestionInput">Sua pergunta</label><div class="official-question-input"><input id="officialQuestionInput" name="question" minlength="10" maxlength="240" required placeholder="Ex.: em quais páginas fala de saúde?"><button class="primary-button" type="submit">Perguntar</button></div></form><div id="officialQuestionResult" aria-live="polite"></div></section>
      <section class="detail-section"><h3>O que mudou?</h3><div id="candidateHistoryData"><div class="mini-loading">Comparando versões oficiais importadas…</div></div></section>
      <section class="detail-section"><h3>Fiscalização, dinheiro público e integridade</h3><div id="integrityData"><div class="mini-loading">Consultando TCU, TSE e fontes oficiais de transparência…</div></div></section>
      <section class="detail-section"><h3>Redes sociais declaradas</h3>${social}</section>
      <section class="detail-section"><h3>Proveniência</h3><div class="source-list">${sources}</div><p class="muted">Checksum da importação: ${escapeHtml(snapshot.checksum)}</p></section>
    </div>`;
  bindImageFallbacks(elements.candidateDetail);
}

async function loadAssetHistory(id) {
  const container = byId('assetHistoryData');
  if (!container) return;
  try {
    const payload = await requestJson(`/api/v1/candidates/${encodeURIComponent(id)}/assets/history`);
    const history = payload.data;
    const rows = history.elections.map((election) => {
      const change = election.changeFromPrevious;
      const changeText = !change ? 'Primeira eleição localizada' : `${change.absolute >= 0 ? '+' : '−'} ${formatCurrency(Math.abs(change.absolute))}${change.percentage === null ? '' : ` (${change.percentage >= 0 ? '+' : ''}${change.percentage.toFixed(1).replace('.', ',')}%)`} desde ${change.previousYear}`;
      const composition = election.composition.slice(0, 5).map((item) => `<li><span>${escapeHtml(item.category)} · ${formatNumber(item.count)} ${item.count === 1 ? 'item' : 'itens'}</span><strong>${formatCurrency(item.value)}</strong></li>`).join('');
      return `<article class="asset-history-card"><div><span>ELEIÇÃO ${election.year}</span><strong>${formatCurrency(election.total)}</strong><small>${escapeHtml(changeText)}</small></div><ul>${composition || '<li>Nenhum item publicado nesta eleição.</li>'}</ul><a class="inline-link" href="${escapeHtml(election.source.url)}" target="_blank" rel="noopener noreferrer">Conferir no TSE ↗</a></article>`;
    }).join('');
    container.innerHTML = `<div class="asset-history-grid">${rows}</div><div class="asset-caveats"><strong>Contexto obrigatório</strong>${history.caveats.map((item) => `<p>${escapeHtml(item)}</p>`).join('')}<small>${escapeHtml(history.matching)}</small></div>`;
  } catch {
    container.innerHTML = '<div class="not-published">O histórico de eleições anteriores não respondeu agora. A declaração atual acima permanece disponível.</div>';
  }
}

async function loadCandidateHistory(id) {
  const container = byId('candidateHistoryData');
  if (!container) return;
  try {
    const payload = await requestJson(`/api/v1/candidates/${encodeURIComponent(id)}/history`);
    if (!payload.data.length) {
      container.innerHTML = `<div class="not-published"><strong>Nenhuma mudança registrada nas versões preservadas.</strong><br>${escapeHtml(payload.note)}</div>`;
      return;
    }
    container.innerHTML = `<div class="candidate-change-list">${payload.data.map((event) => `<article><time>${formatDate(event.detectedAt)}</time><div><strong>${escapeHtml(event.label || event.type)}</strong>${event.before !== undefined || event.after !== undefined ? `<p>${escapeHtml(historyValue(event.before))} → ${escapeHtml(historyValue(event.after))}</p>` : ''}${event.resolutionNote ? `<p>${escapeHtml(event.resolutionNote)}</p>` : ''}<small>${escapeHtml(event.source || '')}</small></div></article>`).join('')}</div><p class="method-note">${escapeHtml(payload.note)}</p>`;
  } catch {
    container.innerHTML = '<div class="not-published">Não foi possível comparar as versões preservadas agora.</div>';
  }
}

function historyValue(value) {
  if (value === null || value === undefined || value === '') return 'não publicado';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'nenhum integrante publicado';
  if (typeof value === 'object') {
    if ('totalRevenue' in value || 'totalExpense' in value) return `receitas ${formatCurrency(value.totalRevenue)}; despesas ${formatCurrency(value.totalExpense)}`;
    return 'registro atualizado';
  }
  if (typeof value === 'number') return formatCurrency(value);
  return String(value);
}

async function loadIntegrity(id, { forceRefresh = false } = {}) {
  const container = byId('integrityData');
  if (!container) return;
  container.innerHTML = '<div class="mini-loading">Consultando TCU, TSE, DataJud e fontes de transparência e checagem…</div>';
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
  if (record.stage === 'ELECTORAL_REGISTRATION_PROCESS') return 'Processo de registro eleitoral';
  if (record.stage === 'SECONDARY_FACT_CHECK') return 'Checagem publicada por terceiro';
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

function renderDatajudRecord(record) {
  return `<article class="integrity-record integrity-record-datajud">
    <div class="integrity-record-heading"><span class="integrity-stage">${integrityStageLabel(record)}</span>${record.court ? `<span class="integrity-registry">${escapeHtml(record.court)}</span>` : ''}</div>
    <h5>${escapeHtml(record.className || 'Metadados processuais')}</h5>
    <p>${escapeHtml(record.explanation || '')}</p>
    <div class="integrity-meta">${integrityMeta('Número CNJ', record.processNumber)}${integrityMeta('Grau', record.degree)}${integrityMeta('Órgão julgador', record.judgingBody)}${integrityMeta('Ajuizamento', record.filingDate)}${integrityMeta('Último movimento', record.lastMovement ? [record.lastMovement.name, record.lastMovement.date].filter(Boolean).join(' — ') : null)}</div>
    ${record.subjects?.length ? `<div class="integrity-basis"><strong>Assuntos publicados</strong><p>${escapeHtml(record.subjects.join(', '))}</p></div>` : ''}
  </article>`;
}

function renderFactCheckRecord(record) {
  return `<article class="integrity-record integrity-record-fact-check">
    <div class="integrity-record-heading"><span class="integrity-stage administrative">${integrityStageLabel(record)}</span>${record.publisher ? `<span class="integrity-registry">${escapeHtml(record.publisher)}</span>` : ''}</div>
    <h5>${escapeHtml(record.title || record.claim)}</h5>
    ${record.claim ? `<p><strong>Alegação analisada:</strong> ${escapeHtml(record.claim)}</p>` : ''}
    <div class="integrity-meta">${integrityMeta('Pessoa/organização citada', record.claimant)}${integrityMeta('Avaliação publicada', record.rating)}${integrityMeta('Data da checagem', record.reviewDate)}</div>
    <a class="inline-link" href="${escapeHtml(record.url)}" target="_blank" rel="noopener noreferrer">Ler a checagem no publicador ↗</a>
  </article>`;
}

function renderIntegrityRegistry(title, section, renderer, kindLabel = 'FONTE OFICIAL') {
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
  else if (current.status === 'NOT_APPLICABLE') emptyLabel = 'Sem identificador aplicável';
  const content = records.length
    ? `<div class="integrity-record-list">${records.map(renderer).join('')}</div>`
    : `<div class="integrity-empty integrity-empty-${escapeHtml(String(current.status || '').toLowerCase())}"><strong>${emptyLabel}</strong><p>${escapeHtml(current.message || 'Nenhuma conclusão substituta foi exibida.')}</p>${sourceLink}</div>`;
  return `<section class="integrity-group"><div class="integrity-group-heading"><div><span>${escapeHtml(kindLabel)}</span><h4>${escapeHtml(title)}</h4></div>${current.source?.name ? `<small>${escapeHtml(current.source.name)}</small>` : ''}</div>${content}${records.length ? `<p class="integrity-source-note">${escapeHtml(current.message || '')} ${sourceLink}</p>` : ''}</section>`;
}

function renderIntegrityMoney(data) {
  const campaign = data.campaignFinance || {};
  const assets = data.declaredAssets || {};
  const legislative = data.legislativeExpenses || {};
  const campaignFacts = campaign.status === 'PUBLISHED'
    ? `${fact('Receitas de campanha', formatCurrency(campaign.totalRevenue))}${fact(campaign.expenseBasis === 'CONTRACTED' ? 'Despesas contratadas' : 'Despesas de campanha', formatCurrency(campaign.totalExpense))}${fact('Lançamentos publicados', formatNumber(Number(campaign.revenueRecords || 0) + Number(campaign.expenseRecords || 0)))}`
    : `${fact('Receitas de campanha', 'Ainda não publicadas')}${fact('Despesas de campanha', 'Ainda não publicadas')}`;
  const assetFacts = `${fact('Bens declarados', assets.status === 'PUBLISHED' ? formatCurrency(assets.total) : 'Nenhum no arquivo atual')}${fact('Itens de bens publicados', formatNumber(assets.count))}`;
  const legislativeFact = legislative.status === 'PUBLISHED'
    ? fact(`Despesas parlamentares ${legislative.year || ''}`.trim(), `${formatCurrency(legislative.totalShown)}${legislative.partial ? ' — recorte parcial' : ''}`)
    : '';
  return `<section class="integrity-group"><div class="integrity-group-heading"><div><span>VALORES PUBLICADOS</span><h4>Dinheiro e patrimônio declarados</h4></div><small>${legislativeFact ? 'TSE e Casa legislativa' : 'TSE'}</small></div><div class="fact-grid integrity-money-grid">${campaignFacts}${assetFacts}${legislativeFact}</div><p class="integrity-source-note">${escapeHtml(campaign.message || '')} ${escapeHtml(assets.message || '')}${legislativeFact ? ` ${escapeHtml(legislative.message || '')}` : ''}</p></section>`;
}

async function loadLegislative(id) {
  const container = byId('legislativeData');
  if (!container) return;
  container.innerHTML = '<div class="mini-loading">Confirmando autoria, projetos e normas nas fontes legislativas oficiais…</div>';
  try {
    const payload = await requestJson(`/api/v1/candidates/${encodeURIComponent(id)}/legislative?v=legislative-profile-v4`);
    container.innerHTML = renderLegislativeContent(payload.data, false, id);
    clearTimeout(container.legislativePollTimer);
    if (payload.data?.laws?.some((law) => ['QUEUED', 'PROCESSING'].includes(law.plainLanguage?.status))) {
      container.legislativePollTimer = setTimeout(() => loadLegislative(id), 6000);
    }
  } catch {
    container.innerHTML = '<div class="not-published">A Câmara ou o Senado não respondeu agora. Nenhuma lei foi atribuída sem confirmação.</div>';
  }
}

function closeCandidate() {
  state.activeCandidateId = null;
  if (history.state?.directCandidate) window.location.assign('/');
  else if (history.state?.candidateId || /^\/candidato\/\d+$/.test(window.location.pathname)) history.back();
  else elements.candidateDialog.close();
}

function synchronizeCandidateRoute() {
  const candidateId = window.location.pathname.match(/^\/candidato\/(\d+)$/)?.[1];
  if (candidateId) {
    if (state.activeCandidateId !== candidateId) openCandidate(candidateId, { updateUrl: false });
    return;
  }
  state.activeCandidateId = null;
  if (elements.candidateDialog.open) elements.candidateDialog.close();
}

function renderLegislativePlainLanguage(proposal) {
  const explanation = proposal.plainLanguage;
  if (!explanation) return '';
  if (explanation.status === 'READY') {
    return `<section class="law-ai-explanation"><div class="law-ai-heading"><span>LEITURA EM LINGUAGEM SIMPLES · IA LOCAL</span><small>Baseada apenas na ementa e situação oficiais</small></div><div class="law-ai-grid"><article><strong>O que isso quer dizer</strong><p>${escapeHtml(explanation.plainLanguage)}</p></article><article><strong>O que pode mudar na prática</strong><p>${escapeHtml(explanation.possibleImpact)}</p></article><article class="law-fine-print"><strong>A letra miúda</strong><p>${escapeHtml(explanation.finePrint)}</p></article></div></section>`;
  }
  if (['QUEUED', 'PROCESSING'].includes(explanation.status)) {
    return '<div class="law-ai-pending"><strong>Explicação em preparação automática</strong><span>A fonte oficial já está disponível. A IA local está traduzindo a ementa sem alterar o texto original.</span></div>';
  }
  return '<div class="law-ai-pending is-failed"><strong>A explicação automática ainda não ficou pronta</strong><span>A ementa e os links oficiais abaixo continuam disponíveis para conferência.</span></div>';
}

function renderIntegrityData(data, compact = false) {
  if (!data || data.status === 'UNAVAILABLE') {
    const retry = compact ? '' : '<button class="secondary-button integrity-retry-button" type="button" data-integrity-retry>Tentar novamente</button>';
    return `<div class="not-published"><p>${escapeHtml(data?.message || 'As fontes oficiais não responderam agora. Nenhuma conclusão substituta foi exibida.')}</p>${retry}</div>`;
  }
  const methodology = compact ? '' : `<div class="integrity-methodology"><strong>Como interpretar</strong><p>${escapeHtml(data.methodology?.legalStage || '')}</p><p>${escapeHtml(data.methodology?.absence || '')}</p><p>${escapeHtml(data.methodology?.privacy || '')}</p><p>${escapeHtml(data.methodology?.datajud || '')}</p><p>${escapeHtml(data.methodology?.factCheck || '')}</p></div>`;
  return `<div class="integrity-check"><div class="integrity-alert"><div><span>LEITURA RESPONSÁVEL</span><strong>${escapeHtml(data.summary?.label || 'Consulta oficial concluída')}</strong></div><p>${escapeHtml(data.summary?.warning || 'Cada registro é mostrado com sua situação e fonte; não há nota automática.')}</p></div>${renderIntegrityRegistry('Decisões e impedimentos do TCU', data.publicAccounts, renderTcuRecord)}${renderIntegrityRegistry('Sanções administrativas federais', data.sanctions, renderSanctionRecord)}${renderIntegrityRegistry('Processo de registro no DataJud', data.datajud, renderDatajudRecord)}${renderIntegrityRegistry('Checagens relacionadas à busca textual', data.factChecks, renderFactCheckRecord, 'FONTE SECUNDÁRIA · SEM ATRIBUIÇÃO AUTOMÁTICA')}${renderIntegrityMoney(data)}${methodology}<p class="muted">Consulta realizada em ${formatDate(data.checkedAt)}.</p></div>`;
}

function renderLegislativeReportForm(proposal, candidateId) {
  if (!candidateId || proposal.plainLanguage?.status !== 'READY') return '';
  const subjectKey = String(proposal.analysisKey || proposal.id || proposal.officialUrl || '').slice(0, 128);
  const version = proposal.plainLanguage.analysisVersion || 'legislative-plain-language-v3';
  return `<details class="problem-report compact"><summary>Encontrou um problema nesta explicação?</summary><form data-analysis-report-form><input type="hidden" name="candidateId" value="${escapeHtml(candidateId)}"><input type="hidden" name="subjectType" value="LEGISLATIVE_ITEM"><input type="hidden" name="subjectKey" value="${escapeHtml(subjectKey)}"><input type="hidden" name="analysisVersion" value="${escapeHtml(version)}"><label>O que precisa ser revisto?<select name="category" required><option value="">Selecione</option><option value="INCORRECT_EXCERPT">Ementa interpretada incorretamente</option><option value="AUTHORSHIP">Associação de autoria incorreta</option><option value="BIASED_LANGUAGE">Linguagem tendenciosa</option><option value="OTHER">Outro problema</option></select></label><label>Explique o problema<textarea name="details" minlength="20" maxlength="1000" required></textarea></label><button class="secondary-button" type="submit">Enviar para revisão</button><p class="report-result" role="status" data-report-result></p></form></details>`;
}

function proposalCard(proposal, candidateId = '') {
  const themes = proposal.themes?.length
    ? `<div class="proposal-themes">${proposal.themes.map((theme) => `<span>${escapeHtml(theme)}</span>`).join('')}</div>`
    : '';
  const evidence = proposal.evidence || {
    stage: 'ENACTED',
    label: 'Efeito jurídico confirmado',
    explanation: 'A fonte oficial registra uma norma gerada.',
    impactStatus: 'NOT_MEASURED',
    impactLabel: 'Impacto social ainda não medido nesta consulta',
    impactExplanation: 'Não foi localizada avaliação pública oficial vinculada.',
  };
  return `<article class="proposal-card">
    <div class="proposal-heading"><strong>${escapeHtml(proposal.lawTitle || proposal.title || `${proposal.type} ${proposal.number}/${proposal.year}`)}</strong>${proposal.date ? `<time>proposta apresentada em ${formatDate(proposal.date, false)}</time>` : ''}</div>
    <div class="proposal-themes"><span>${escapeHtml(proposal.authorship?.label || 'Autoria oficial confirmada')}</span></div>
    ${themes}
    ${renderLegislativePlainLanguage(proposal)}
    <div class="proposal-block"><span>O que mudou juridicamente — ementa oficial</span><p>${escapeHtml(proposal.summary || 'Ementa não publicada.')}</p></div>
    <div class="proposal-block"><span>Confirmação da fonte legislativa</span><p>${escapeHtml(proposal.status || 'Norma gerada confirmada na consulta oficial.')}</p></div>
    <div class="effect-evidence effect-${escapeHtml(String(evidence.stage || '').toLowerCase())}"><strong>${escapeHtml(evidence.label)}</strong><p>${escapeHtml(evidence.explanation)}</p></div>
    <div class="effect-evidence effect-impact"><strong>${escapeHtml(evidence.impactLabel || 'Impacto na sociedade')}</strong><p>${escapeHtml(evidence.impactExplanation || 'Nenhuma medição pública oficial foi vinculada nesta consulta.')}</p></div>
    <a class="inline-link" href="${escapeHtml(proposal.officialUrl)}" target="_blank" rel="noopener noreferrer">Conferir autoria e tramitação ↗</a>${proposal.normOfficialUrl ? ` · <a class="inline-link" href="${escapeHtml(proposal.normOfficialUrl)}" target="_blank" rel="noopener noreferrer">Abrir norma oficial ↗</a>` : ''}${renderLegislativeReportForm(proposal, candidateId)}
  </article>`;
}

function renderLegislativeContent(data, includeExpenses = false, candidateId = '') {
  const detailed = Boolean(candidateId) || includeExpenses;
  const expenses = detailed
    ? (data.expenses
      ? `<div class="fact"><span>Despesas parlamentares no recorte</span><strong>${formatCurrency(data.expenses.totalShown)}</strong></div><div class="fact"><span>Registros de despesa considerados</span><strong>${formatNumber(data.expenses.recordsShown)}${data.expenses.partial ? ' — recorte parcial' : ''}</strong></div>`
      : '<div class="fact"><span>Despesas</span><strong>Não publicadas nesta consulta</strong></div>')
    : '';
  const activity = data.activity || {};
  const facts = detailed
    ? `<div class="fact-grid">${expenses}<div class="fact"><span>Casa legislativa</span><strong>${escapeHtml(data.chamber)}</strong></div><div class="fact"><span>Projetos retornados pela fonte</span><strong>${formatNumber(activity.projectsReturned)}${activity.projectsPartial ? ' — recorte parcial' : ''}</strong></div>${activity.officialEventParticipations === undefined ? '' : `<div class="fact"><span>Participações oficiais em eventos</span><strong>${formatNumber(activity.officialEventParticipations)}${activity.eventParticipationsPartial ? ' — recorte parcial' : ''}</strong></div>`}${activity.nominalVotesInspected === undefined ? '' : `<div class="fact"><span>Votos nominais localizados</span><strong>${formatNumber(activity.nominalVotesFound)} em ${formatNumber(activity.nominalVotesInspected)} votações recentes inspecionadas</strong></div>`}</div>`
    : '';
  const expenseCategories = detailed && data.expenses?.byCategory?.length
    ? `<section class="mandate-subsection"><h4>Despesas por categoria</h4><div class="expense-category-list">${data.expenses.byCategory.slice(0, 8).map((item) => `<div><span>${escapeHtml(item.category)} · ${formatNumber(item.records)} ${item.records === 1 ? 'registro' : 'registros'}</span><strong>${formatCurrency(item.value)}</strong></div>`).join('')}</div><p class="method-note">Valores somados somente dentro dos registros retornados pela API; “recorte parcial” não representa o total anual completo.</p></section>`
    : '';
  const votes = detailed && activity.recentVotes?.length
    ? `<section class="mandate-subsection"><h4>Como votou em votações nominais recentes</h4><div class="mandate-activity-list">${activity.recentVotes.map((vote) => `<article><time>${formatDate(vote.date, false)}</time><div><strong>Voto: ${escapeHtml(vote.vote || 'não informado')}</strong><p>${escapeHtml(vote.description)}</p><a class="inline-link" href="${escapeHtml(vote.officialUrl)}" target="_blank" rel="noopener noreferrer">Conferir votação oficial ↗</a></div></article>`).join('')}</div></section>`
    : '';
  const speeches = detailed && activity.speeches?.length
    ? `<section class="mandate-subsection"><h4>Discursos recentes registrados</h4><div class="mandate-activity-list">${activity.speeches.slice(0, 5).map((speech) => `<article><time>${formatDate(speech.date, false)}</time><div><strong>${escapeHtml(speech.type || speech.phase || 'Discurso registrado')}</strong><p>${escapeHtml(speech.summary)}</p><a class="inline-link" href="${escapeHtml(speech.officialUrl)}" target="_blank" rel="noopener noreferrer">Conferir perfil oficial ↗</a></div></article>`).join('')}</div></section>`
    : '';
  const projectTypes = detailed && activity.projectsByType?.length
    ? `<section class="mandate-subsection"><h4>Projetos apresentados no recorte</h4><div class="project-type-pills">${activity.projectsByType.map((item) => `<span>${escapeHtml(item.type)} · ${formatNumber(item.count)}</span>`).join('')}</div></section>`
    : '';
  const coverage = detailed && activity.attendanceNote ? `<p class="method-note">${escapeHtml(activity.attendanceNote)}</p>` : '';
  const promiseComparison = detailed && data.promiseVsAction
    ? `<section class="mandate-subsection promise-action"><h4>Promessa anterior × atuação real</h4><div class="not-published">${escapeHtml(data.promiseVsAction.message)}</div></section>`
    : '';
  const laws = data.laws?.length
    ? `<section class="mandate-subsection"><h4>Três leis ou projetos com autoria confirmada</h4><div class="proposal-list">${data.laws.slice(0, 3).map((proposal) => proposalCard(proposal, candidateId)).join('')}</div></section>`
    : '<div class="not-published"><strong>Nenhum projeto ou norma passou por todas as confirmações deste recorte.</strong><br>Isso não prova que a pessoa nunca participou de outra matéria: a consulta cobre somente as autorias retornadas para o mandato vinculado.</div>';
  return `<div class="legislative-results">${facts}${coverage}${expenseCategories}${projectTypes}${votes}${speeches}${data.note ? `<p class="muted">${escapeHtml(data.note)}</p>` : ''}<p class="method-note">${escapeHtml(data.methodology?.rule || 'Recorte de normas e autorias publicado pela Casa legislativa.')} ${escapeHtml(data.methodology?.impactRule || '')}</p>${laws}${promiseComparison}<p class="muted">Consultado em ${formatDate(data.source.fetchedAt)} · <a href="${escapeHtml(data.source.url)}" target="_blank" rel="noopener noreferrer">fonte oficial</a></p></div>`;
}

async function loadGovernmentPlan(id) {
  const container = byId('governmentPlanData');
  if (!container) return;
  clearTimeout(container.planSummaryPollTimer);
  container.planSummaryCandidateId = String(id);
  container.innerHTML = '<div class="mini-loading">Localizando e lendo o documento oficial do TSE…</div>';
  try {
    const payload = await requestJson(`/api/v1/candidates/${encodeURIComponent(id)}/government-plan/status`);
    if (container.planSummaryCandidateId !== String(id)) return;
    container.innerHTML = renderGovernmentPlan(payload.data, id);
    if (payload.data?.available) await loadGovernmentPlanSummary(id, container);
  } catch {
    if (container.planSummaryCandidateId !== String(id)) return;
    container.innerHTML = '<div class="not-published">Não foi possível consultar o arquivo oficial agora. Nenhum documento alternativo foi usado.</div>';
  }
}

function capturePlanViewState(host) {
  const scrollHost = host.closest('.candidate-dialog');
  return {
    alreadyRendered: Boolean(host.querySelector('.plan-summary')),
    openThemeIds: new Set([...host.querySelectorAll('[data-plan-theme][open]')]
      .map((theme) => theme.getAttribute('data-plan-theme'))
      .filter(Boolean)),
    scrollHost,
    scrollTop: scrollHost?.scrollTop || 0,
  };
}

function restorePlanViewState(host, viewState) {
  if (!viewState.alreadyRendered) return;
  host.querySelectorAll('[data-plan-theme]').forEach((theme) => {
    theme.open = viewState.openThemeIds.has(theme.getAttribute('data-plan-theme'));
  });
  if (viewState.scrollHost) viewState.scrollHost.scrollTop = viewState.scrollTop;
}

async function loadGovernmentPlanSummary(id, container) {
  const host = container.querySelector('[data-plan-summary-host]');
  if (!host) return;
  try {
    const payload = await requestJson(`/api/v1/candidates/${encodeURIComponent(id)}/government-plan/summary?v=local-llm-v16`);
    if (container.planSummaryCandidateId !== String(id)) return;
    const viewState = capturePlanViewState(host);
    host.innerHTML = renderPlanSummary(payload.data, id);
    restorePlanViewState(host, viewState);
    clearTimeout(container.planSummaryPollTimer);
    const retrying = payload.data?.aiAnalysis?.status === 'FAILED'
      && Number(payload.data?.aiAnalysis?.attempts || 0) < 3;
    if (['QUEUED', 'PROCESSING'].includes(payload.data?.aiAnalysis?.status) || retrying) {
      container.planSummaryPollTimer = setTimeout(() => {
        if (container.isConnected && container.planSummaryCandidateId === String(id)) {
          loadGovernmentPlanSummary(id, container);
        }
      }, 8000);
    }
  } catch {
    if (container.planSummaryCandidateId !== String(id)) return;
    host.innerHTML = '<div class="not-published">O PDF oficial está disponível, mas o resumo automático não pôde ser produzido agora.</div>';
  }
}

function renderPlanObjective(objective, pdfUrl, themeSummaries = []) {
  if (!objective?.summary || !objective.evidences?.length) return '';
  const summary = (() => {
    const text = String(objective.summary).trim();
    if (!text || /[.!?…]$/u.test(text)) return text;
    const boundary = Math.max(text.lastIndexOf('.'), text.lastIndexOf('!'), text.lastIndexOf('?'));
    return boundary >= Math.floor(text.length * 0.35) ? text.slice(0, boundary + 1).trim() : text;
  })();
  const priorities = Array.isArray(objective.priorities) ? objective.priorities : [];
  const priorityList = priorities.length
    ? `<div class="objective-theme-list">${priorities.map((priority) => {
      const theme = themeSummaries.find((item) => item.id === priority.id);
      const impact = priority.potentialImpact || theme?.digest?.potentialImpact || 'O plano não trouxe elementos suficientes para explicar como essa direção pode chegar à vida cotidiana.';
      const limits = priority.conditionsAndLimits || theme?.digest?.conditionsAndLimits || 'Os trechos selecionados não detalham todas as etapas de execução, os recursos necessários nem como os resultados seriam medidos.';
      const pages = [...new Set((priority.pages?.length
        ? priority.pages
        : theme?.digest?.pages?.length
          ? theme.digest.pages
          : [priority.page]
      ).map((page) => Number(page) || 1))];
      const pageLinks = pages.map((page) => `<a href="${escapeHtml(pdfUrl)}#page=${page}" target="_blank" rel="noopener noreferrer" aria-label="Conferir ${escapeHtml(priority.label)} na página ${page}">p. ${page} ↗</a>`).join(' · ');
      return `<details class="objective-theme-card"><summary><span class="objective-theme-heading"><strong>${escapeHtml(priority.label)}</strong><small>Entenda o efeito possível e os pontos que faltam</small></span><p><b>Direção principal:</b> ${escapeHtml(priority.summary)}</p><span class="objective-theme-expand" aria-hidden="true">+</span></summary><div class="objective-theme-details"><section class="is-impact"><strong>Como isso pode chegar à sociedade</strong><p>${escapeHtml(impact)}</p></section><section class="is-limits"><strong>O que o eleitor precisa conferir</strong><p>${escapeHtml(limits)}</p></section><div class="objective-theme-sources"><strong>Trechos oficiais usados:</strong> ${pageLinks}</div></div></details>`;
    }).join('')}</div>`
    : `<div class="objective-sources"><strong>Baseado em trechos validados:</strong> ${objective.evidences.map((evidence) => `<a href="${escapeHtml(pdfUrl)}#page=${Number(evidence.page) || 1}" target="_blank" rel="noopener noreferrer">p. ${Number(evidence.page) || 1}</a>`).join(' · ')}</div>`;
  return `<article class="plan-objective"><span>VISÃO GERAL DO PLANO · LEITURA DA IA</span><h5>O plano em linguagem prática: o que muda e o que falta explicar</h5><p class="objective-intro">${escapeHtml(summary)}</p><div class="objective-reading-guide"><strong>Como usar esta leitura</strong><p>Abra um tema para entender a direção proposta, como ela pode alcançar a população e quais informações ainda precisam ser cobradas antes de avaliar a promessa.</p></div>${priorityList}</article>`;
}

function renderAnalysisReportForm(summary, candidateId) {
  if (!candidateId) return '';
  const version = summary?.aiAnalysis?.analysisVersion || summary?.aiAnalysis?.version || 'não informada';
  return `<details class="problem-report"><summary>Encontrou um problema nesta análise?</summary><form data-analysis-report-form><input type="hidden" name="candidateId" value="${escapeHtml(candidateId)}"><input type="hidden" name="subjectType" value="GOVERNMENT_PLAN"><input type="hidden" name="analysisVersion" value="${escapeHtml(version)}"><label>O que precisa ser revisto?<select name="category" required><option value="">Selecione</option><option value="INCORRECT_EXCERPT">Trecho interpretado incorretamente</option><option value="WRONG_PAGE">Página indicada está errada</option><option value="AUTHORSHIP">Associação de autoria incorreta</option><option value="BIASED_LANGUAGE">Linguagem tendenciosa</option><option value="OTHER">Outro problema</option></select></label><label>Página do PDF, se houver<input name="pageNumber" type="number" min="1" max="5000" inputmode="numeric"></label><label>Explique o problema<textarea name="details" minlength="20" maxlength="1000" required placeholder="Descreva o que está incorreto e, se possível, indique o trecho oficial."></textarea></label><button class="secondary-button" type="submit">Enviar para revisão</button><p class="report-result" role="status" data-report-result></p></form><a class="inline-link" href="/report-status.html">Acompanhar um protocolo</a></details>`;
}

function renderPlanSummary(summary, candidateId = '') {
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
  const analysisBadge = localAiReady ? 'IA LOCAL · EVIDÊNCIAS DO PDF' : `LEITURA POR ${totalThemes} TEMAS`;
  const retrying = summary.aiAnalysis?.status === 'FAILED'
    && Number(summary.aiAnalysis?.attempts || 0) < 3;
  const analysisPending = ['QUEUED', 'PROCESSING'].includes(summary.aiAnalysis?.status) || retrying;
  const stageLabel = retrying
    ? 'Refazendo a explicação com segurança'
    : summary.aiAnalysis?.status === 'QUEUED'
    ? 'Aguardando a IA local'
    : summary.aiAnalysis?.stage === 'SELECTING_EVIDENCE'
      ? 'Selecionando evidências do PDF'
      : 'Explicando objetivo e propostas';
  const pending = analysisPending
    ? `<div class="analysis-progress"><strong>${stageLabel}</strong><span>Os trechos oficiais já estão disponíveis. Esta tela verifica o resultado automaticamente; você não precisa fechar nem atualizar.</span></div>`
    : summary.aiAnalysis?.status === 'FAILED'
      ? '<div class="analysis-progress is-failed"><strong>A explicação da IA não ficou pronta</strong><span>Os trechos oficiais continuam disponíveis abaixo, sem alteração. Uma nova tentativa poderá ser feita automaticamente.</span></div>'
      : '';
  const modelNote = localAiReady
    ? ` · IA local ${escapeHtml(summary.aiAnalysis.model || '')} · ${Number(summary.aiAnalysis.evidenceExcerpts || 0)} evidências selecionadas`
    : '';
  const objective = localAiReady ? renderPlanObjective(summary.candidateObjective, summary.pdfUrl, summary.themeSummaries) : '';
  return `<section class="plan-summary"><div class="plan-summary-heading"><div><span class="summary-badge">${analysisBadge}</span><h4>Entenda o plano antes de escolher</h4></div><span class="coverage-pill">${foundCount}/${totalThemes} temas com propostas</span></div><p class="plan-overview">${escapeHtml(summary.overview)}</p>${pending}${objective}<div class="plan-theme-list">${themes}</div><div class="summary-notice"><strong>Como ler esta classificação</strong><p>${escapeHtml(summary.notice)}</p><span>${Number(summary.document?.pages || 0)} páginas · texto extraível em ${Number(summary.document?.textCoveragePercent || 0)}% das páginas processadas${modelNote} · gerado em ${formatDate(summary.generatedAt)}</span><a class="inline-link" href="/ai-methodology.html">Ver modelo, prompt, validações e histórico da IA</a></div>${renderAnalysisReportForm(summary, candidateId)}</section>`;
}

function renderPlanTheme(theme, pdfUrl, open = false) {
  const proposals = Array.isArray(theme.proposals) ? theme.proposals : [];
  const found = theme.status === 'FOUND' && proposals.length > 0;
  const pageLabel = theme.pages?.length
    ? `páginas ${theme.pages.map((page) => Number(page) || 1).join(', ')}`
    : 'nenhuma página classificada';
  const digest = theme.digest ? renderThemeDigest(theme.digest, pdfUrl) : '';
  const evidenceCount = Array.isArray(theme.digest?.evidences) ? theme.digest.evidences.length : 0;
  const content = found
    ? `${digest}${digest ? `<div class="official-excerpts-label">${evidenceCount || 'Até 3'} ${evidenceCount === 1 ? 'trecho oficial usado' : 'trechos oficiais usados'} na explicação</div>` : ''}${proposals.map((proposal, index) => renderPlanProposal(proposal, pdfUrl, index)).join('')}${proposals.length > 3 ? `<button class="secondary-button proposal-more-button" type="button" data-show-more-proposals>Ver mais 3 propostas</button>` : ''}`
    : '<div class="theme-not-found">Nenhum trecho com linguagem de proposta foi identificado automaticamente neste tema. Isso não comprova que o assunto esteja ausente do documento.</div>';
  return `<details class="plan-theme ${found ? 'is-found' : 'is-missing'}" data-plan-theme="${escapeHtml(theme.id)}" ${open ? 'open' : ''}><summary><span class="theme-status" aria-hidden="true">${found ? 'Encontrado' : 'Não identificado'}</span><span class="theme-title"><strong>${escapeHtml(theme.label)}</strong><small>${found ? `${proposals.length} ${proposals.length === 1 ? 'proposta' : 'propostas'} · ${escapeHtml(pageLabel)}` : 'sem proposta classificada'}</small></span><span class="theme-expand" aria-hidden="true">+</span></summary><div class="theme-content">${content}</div></details>`;
}

function renderThemeDigest(digest, pdfUrl) {
  const evidences = Array.isArray(digest.evidences) ? digest.evidences : [];
  const pages = [...new Set(evidences.map((evidence) => Number(evidence.page) || 1))];
  const pageLinks = pages.map((page) => `<a href="${escapeHtml(pdfUrl)}#page=${page}" target="_blank" rel="noopener noreferrer">p. ${page} ↗</a>`).join(' · ');
  const limits = digest.conditionsAndLimits || 'Os trechos selecionados não detalham todas as etapas de execução, os recursos necessários nem como os resultados seriam medidos.';
  return `<article class="theme-digest"><div class="theme-digest-heading"><span>EXPLICAÇÃO DA IA · BASEADA NOS TRECHOS DESTE TEMA</span>${pageLinks ? `<small>${pageLinks}</small>` : ''}</div><div class="theme-explanation-grid"><section class="theme-explanation-block is-action"><span>O QUE O PLANO PRETENDE MUDAR</span><p>${escapeHtml(digest.summary)}</p></section><section class="theme-explanation-block is-impact"><span>COMO ISSO PODE CHEGAR À SOCIEDADE</span><p>${escapeHtml(digest.potentialImpact || 'O efeito depende de como a medida será executada e de quais grupos serão alcançados.')}</p></section><section class="theme-explanation-block is-limits"><span>O QUE AINDA PRECISA SER EXPLICADO</span><p>${escapeHtml(limits)}</p></section></div></article>`;
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
  const timelineItems = [
    ['Primeiro ano', scenario.firstYear],
    ['Anos 2 e 3', scenario.yearsTwoAndThree],
    ['Quarto ano', scenario.fourthYear],
  ].filter((item) => item[1]);
  const timeline = timelineItems.length
    ? `<ol>${timelineItems.map(([label, text]) => `<li><strong>${escapeHtml(label)}</strong><p>${escapeHtml(text)}</p></li>`).join('')}</ol>`
    : '';
  const pages = [...new Set(evidences.map((evidence) => Number(evidence.page) || 1))];
  const evidenceContent = evidences.map((evidence) => `<blockquote><p>${escapeHtml(evidence.quote)}</p><a href="${escapeHtml(pdfUrl)}#page=${Number(evidence.page) || 1}" target="_blank" rel="noopener noreferrer">Conferir página ${Number(evidence.page) || 1} ↗</a></blockquote>`).join('');
  return `<article class="theme-proposal is-ai-consolidated"${hidden}><div class="proposal-title-row"><span>${index + 1}</span><div><small>PRIORIDADE EXPLICADA PELA IA</small><h5>${escapeHtml(proposal.title || 'Proposta identificada')}</h5></div></div><p class="proposal-summary-text">${escapeHtml(proposal.summary || proposal.text)}</p><section class="four-year-impact"><span>POSSÍVEL IMPACTO EM 4 ANOS · CENÁRIO CONDICIONAL</span><p>${escapeHtml(scenario.potentialImpact || 'O resultado dependerá da execução e dos recursos disponíveis.')}</p>${timeline}</section><div class="proposal-context-grid">${renderListBlock('Quem pode ser afetado', proposal.audience)}${renderListBlock('O que precisa acontecer', proposal.requirements)}${renderListBlock('O plano não detalha', proposal.missingInformation, 'is-missing')}</div><details class="proposal-evidence"><summary>Ver ${evidences.length} ${evidences.length === 1 ? 'evidência' : 'evidências'} no PDF · ${escapeHtml(pages.map((page) => `p. ${page}`).join(', '))}</summary>${evidenceContent}</details>${proposal.section ? `<div class="theme-location"><span><strong>Seção associada:</strong> ${escapeHtml(proposal.section)}</span></div>` : ''}</article>`;
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
    ? renderPlanSummary({ ...summary, pdfUrl: summary.pdfUrl || plan.url }, candidateId)
    : '<div class="mini-loading">Lendo as páginas e classificando propostas nos 9 temas…</div>';
  return `<div class="plan-experience"><div data-plan-summary-host>${summaryContent}</div><article class="plan-card"><span class="source-state ok">Documento oficial localizado</span><h4>Plano de governo entregue ao TSE</h4><p>Associado pelo identificador único da candidatura. O resumo acima é automático; o PDF permanece como fonte integral.</p><a class="secondary-button document-link" href="${escapeHtml(plan.url)}" target="_blank" rel="noopener noreferrer">Abrir PDF completo</a><a class="inline-link" href="${escapeHtml(plan.source.url)}" target="_blank" rel="noopener noreferrer">Ver conjunto de dados do TSE ↗</a></article></div>`;
}

function fact(label, value) {
  return `<div class="fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || 'Não publicado')}</strong></div>`;
}
function optionalFact(label, value) {
  return value ? fact(label, value) : '';
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
  state.comparisonEvidence = null;
  elements.shareComparisonImage.disabled = true;
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
      ? requestJson(`/api/v1/candidates/${encodeURIComponent(candidate.id)}/government-plan/summary?v=local-llm-v16`)
      : Promise.resolve(null),
    candidate.legislative
      ? requestJson(`/api/v1/candidates/${encodeURIComponent(candidate.id)}/legislative?v=legislative-profile-v4`)
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
  return `<section class="evidence-column"><h3>${escapeHtml(candidate.ballotName)}</h3><div class="evidence-section"><h4>Plano de governo</h4>${plan}</div><div class="evidence-section"><h4>Leis e projetos com autoria confirmada</h4>${legislative}</div><div class="evidence-section"><h4>Fiscalização e integridade</h4>${integrity}</div></section>`;
}

async function renderComparisonEvidence(candidates, comparisonKey) {
  const results = await Promise.all(candidates.map(candidateEvidence));
  if (comparisonKey !== state.compareIds.join('|')) return;
  const container = byId('comparisonEvidence');
  if (!container) return;
  state.comparisonEvidence = { candidates, results };
  elements.shareComparisonImage.disabled = false;
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
  if (elements.candidateDialog.open) closeCandidate();
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
  const invitationUrl = new URL('/', window.location.origin);
  invitationUrl.searchParams.set('nova-colinha', '1');
  return [
    'MINHA COLINHA — ELEIÇÕES 2026',
    '',
    ...choices,
    '',
    'Confira os números antes de votar. Colinha montada no VotoClaro.',
    '',
    `Faça também a sua colinha: ${invitationUrl.toString()}`,
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

function comparisonShareText(candidate, evidence, themeId) {
  const summary = evidence?.planSummary;
  if (themeId === 'GERAL') {
    return summary?.candidateObjective?.summary || summary?.overview || 'A fonte oficial consultada não trouxe uma visão geral pronta para este card.';
  }
  const theme = summary?.themeSummaries?.find((item) => item.id === themeId);
  return theme?.digest?.summary || theme?.proposals?.[0]?.summary || theme?.proposals?.[0]?.text || 'Nenhum trecho de proposta foi identificado automaticamente neste tema.';
}

function canvasWrappedText(context, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth) line = candidate;
    else { if (line) lines.push(line); line = word; }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.length && lines.join(' ').length < String(text).length - 5) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,;:]?$/, '')}…`;
  lines.forEach((item, index) => context.fillText(item, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

async function imageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

async function shareComparisonImage() {
  const prepared = state.comparisonEvidence;
  if (!prepared || prepared.candidates.length !== 2) return;
  const status = elements.shareComparisonStatus;
  const themeId = elements.shareComparisonTheme.value;
  const themeLabel = elements.shareComparisonTheme.selectedOptions[0].textContent;
  status.textContent = 'Gerando imagem com fonte, data e acesso direto…';
  elements.shareComparisonImage.disabled = true;
  try {
    const sharePath = `/comparar?candidatos=${prepared.candidates.map((candidate) => encodeURIComponent(candidate.id)).join(',')}&tema=${encodeURIComponent(themeId)}`;
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f3f7fb'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#0b2942'; context.fillRect(0, 0, canvas.width, 190);
    context.fillStyle = '#ffffff'; context.font = '800 54px Arial'; context.fillText('VotoClaro', 64, 83);
    context.font = '500 26px Arial'; context.fillText('COMPARE. CONFIRA. DECIDA.', 64, 132);
    context.fillStyle = '#1263df'; context.fillRect(64, 225, 952, 6);
    context.fillStyle = '#0b2942'; context.font = '800 36px Arial'; context.fillText(`Tema: ${themeLabel}`, 64, 292);
    context.font = '500 22px Arial'; context.fillStyle = '#557086'; context.fillText(`Atualizado em ${formatDate(new Date().toISOString())}`, 64, 330);
    prepared.candidates.forEach((candidate, index) => {
      const x = 64 + index * 494;
      const y = 385;
      context.fillStyle = '#ffffff'; context.fillRect(x, y, 458, 650);
      context.strokeStyle = '#c9d8e5'; context.lineWidth = 2; context.strokeRect(x, y, 458, 650);
      context.fillStyle = index === 0 ? '#1263df' : '#087a4b'; context.fillRect(x, y, 458, 12);
      context.fillStyle = '#0b2942'; context.font = '800 33px Arial';
      let nextY = canvasWrappedText(context, candidate.ballotName, x + 28, y + 75, 402, 39, 2);
      context.fillStyle = '#557086'; context.font = '600 22px Arial'; context.fillText(`${candidate.party} · ${candidate.office}`, x + 28, nextY + 18);
      context.fillStyle = '#0b2942'; context.font = '500 25px Arial';
      canvasWrappedText(context, comparisonShareText(candidate, prepared.results[index], themeId), x + 28, nextY + 78, 402, 35, 12);
      context.fillStyle = '#e9f1fa'; context.fillRect(x + 28, y + 568, 402, 54);
      context.fillStyle = '#0b2942'; context.font = '700 20px Arial'; context.fillText('Resumo automático — confira as fontes', x + 44, y + 602);
    });
    const qr = await imageFromUrl(`/api/v1/share/qr.svg?path=${encodeURIComponent(sharePath)}`);
    context.drawImage(qr, 64, 1080, 180, 180);
    context.fillStyle = '#0b2942'; context.font = '800 28px Arial'; context.fillText('Abra a comparação completa', 280, 1140);
    context.fillStyle = '#557086'; context.font = '500 22px Arial';
    canvasWrappedText(context, 'Escaneie o QR Code para ler os trechos oficiais, páginas do PDF e metodologia.', 280, 1182, 720, 30, 3);
    context.fillStyle = '#0b2942'; context.font = '700 20px Arial'; context.fillText('VotoClaro™ · projeto independente · confira as fontes oficiais', 64, 1310);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.94));
    const file = new File([blob], `votoclaro-comparacao-${themeId.toLowerCase()}.png`, { type: 'image/png' });
    const shareUrl = new URL(sharePath, window.location.origin).toString();
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `Comparação VotoClaro — ${themeLabel}`, text: 'Compare e confira as fontes oficiais.', url: shareUrl });
      status.textContent = 'Imagem compartilhada.';
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob); link.download = file.name; link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      status.textContent = 'Imagem salva. Você já pode enviá-la pelo WhatsApp ou Instagram.';
    }
  } catch (error) {
    if (error.name !== 'AbortError') status.textContent = 'Não foi possível gerar o card agora. Tente novamente.';
  } finally {
    elements.shareComparisonImage.disabled = false;
  }
}

async function handleAnalysisReportSubmit(event) {
  const officialQuestionForm = event.target.closest('[data-official-question-form]');
  if (officialQuestionForm) return handleOfficialQuestionSubmit(event, officialQuestionForm);
  const form = event.target.closest('[data-analysis-report-form]');
  if (!form) return;
  event.preventDefault();
  const result = form.querySelector('[data-report-result]');
  const button = form.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(form).entries());
  if (!values.pageNumber) delete values.pageNumber;
  result.textContent = 'Enviando para revisão…';
  button.disabled = true;
  try {
    const payload = await requestJson('/api/v1/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = payload.data;
    result.innerHTML = `Relato recebido. Protocolo <strong>${escapeHtml(data.trackingCode)}</strong>. <a href="${escapeHtml(data.statusUrl)}">Acompanhar correção</a>`;
    form.querySelector('textarea').value = '';
  } catch (error) {
    result.textContent = error.message || 'Não foi possível enviar o relato agora.';
  } finally {
    button.disabled = false;
  }
}

async function handleOfficialQuestionSubmit(event, form) {
  event.preventDefault();
  const result = byId('officialQuestionResult');
  const button = form.querySelector('button[type="submit"]');
  const question = String(new FormData(form).get('question') || '').trim();
  result.innerHTML = '<div class="mini-loading">Localizando trechos e preparando uma resposta limitada às fontes…</div>';
  button.disabled = true;
  try {
    const payload = await requestJson(`/api/v1/candidates/${encodeURIComponent(form.dataset.candidateId)}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const data = payload.data;
    const citations = data.citations?.length
      ? `<div class="official-answer-sources"><strong>Fontes usadas</strong>${data.citations.map((citation) => `<a href="${escapeHtml(citation.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(citation.label)} ↗</a>`).join('')}</div>`
      : '';
    result.innerHTML = `<article class="official-answer ${data.notFound ? 'is-not-found' : ''}"><span>${data.generatedBy === 'LOCAL_LLM_GROUNDED' ? 'RESPOSTA DA IA LOCAL · RESTRITA ÀS FONTES' : 'BUSCA NAS FONTES OFICIAIS'}</span><p>${escapeHtml(data.answer)}</p>${citations}<small>${escapeHtml(payload.policy || '')}</small></article>`;
  } catch (error) {
    result.innerHTML = `<div class="not-published">${escapeHtml(error.message || 'A IA local não respondeu agora. As fontes acima continuam disponíveis.')}</div>`;
  } finally {
    button.disabled = false;
  }
}

async function loadSources() {
  elements.sourceGrid.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const payload = await requestJson('/api/v1/sources');
    const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
    elements.sourceAlerts.innerHTML = alerts.length
      ? `<section class="source-alert-panel" role="alert"><strong>${alerts.length} ${alerts.length === 1 ? 'fonte exige atenção' : 'fontes exigem atenção'}</strong><p>A versão publicada anterior continua no ar enquanto uma nova tentativa é feita.</p>${alerts.map((alert) => `<div><span>${escapeHtml(alert.sourceId)}</span><p>${escapeHtml(alert.message)}</p><small>Última tentativa: ${formatDate(alert.lastAttemptAt)} · último sucesso: ${formatDate(alert.lastSuccessAt)}</small></div>`).join('')}</section>`
      : '<section class="source-ok-panel"><strong>Todas as fontes automáticas responderam na última execução.</strong></section>';
    elements.sourceGrid.innerHTML = payload.sources.map((source) => {
      const current = source.status || {};
      const stateLabel = { OK: 'Ativa', PARTIAL: 'Parcial', PLANNED: 'Planejada', CREDENTIAL_REQUIRED: 'Aguardando chave', NOT_SYNCED: 'Não sincronizada', UNAVAILABLE: 'Ainda indisponível', ERROR: 'Falha temporária' }[current.state] || current.state;
      return `<article class="source-card"><div><span class="source-state ${String(current.state || '').toLowerCase()}">${escapeHtml(stateLabel)}</span><span class="source-kind">${source.kind === 'OFFICIAL' ? 'Fonte oficial' : 'Fonte secundária'}</span></div><h3>${escapeHtml(source.name)}</h3><p>${escapeHtml(source.description)}</p><div class="source-meta"><p><strong>Periodicidade:</strong> ${escapeHtml(source.cadence)}</p><p>${escapeHtml(current.message || '')}</p>${current.lastSuccessAt ? `<p><strong>Último sucesso:</strong> ${formatDate(current.lastSuccessAt)}</p>` : ''}${current.lastAttemptAt ? `<p><strong>Última tentativa:</strong> ${formatDate(current.lastAttemptAt)}</p>` : ''}<a class="inline-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">Abrir fonte ↗</a></div></article>`;
    }).join('');
    elements.syncRuns.innerHTML = payload.syncRuns.length ? payload.syncRuns.map((run) => `<div class="sync-row"><strong>${escapeHtml(run.sourceId)}</strong><span>${escapeHtml(run.status)}</span><span>${formatDate(run.finishedAt || run.startedAt)}</span><span>${run.recordCount ? formatNumber(run.recordCount) : '—'}</span></div>`).join('') : '<div class="sync-row"><span>Ainda não há execuções registradas.</span></div>';
  } catch {
    elements.sourceAlerts.innerHTML = '';
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
  const params = new URLSearchParams(window.location.search);
  const directCandidateId = window.location.pathname.match(/^\/candidato\/(\d+)$/)?.[1];
  if (directCandidateId) {
    history.replaceState({ candidateId: directCandidateId, directCandidate: true }, '', window.location.href);
    await openCandidate(directCandidateId, { updateUrl: false });
  }
  if (window.location.pathname === '/comparar') {
    const candidateIds = String(params.get('candidatos') || '').split(',').filter((id) => /^\d{1,32}$/.test(id)).slice(0, 2);
    if (candidateIds.length === 2) {
      state.compareIds = candidateIds;
      updateCompareCount();
      if ([...elements.shareComparisonTheme.options].some((option) => option.value === params.get('tema'))) elements.shareComparisonTheme.value = params.get('tema');
      switchView('compare');
    }
  }
  if (params.get('nova-colinha') === '1') {
    showNotice('Você recebeu uma colinha. Pesquise suas candidaturas e monte a sua — as escolhas ficam somente neste navegador.');
  }
}

document.addEventListener('DOMContentLoaded', initialize);
