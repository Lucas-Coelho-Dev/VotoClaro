const crypto = require('crypto');
const { searchable } = require('./normalize');
const { SOURCES } = require('./sources');
const {
  LEGISLATIVE_LLM_ANALYSIS_VERSION,
  LEGISLATIVE_LLM_PROMPT_VERSION,
} = require('./local-llm');

async function fetchJson(url, config, accept = 'application/json') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.requestTimeoutMs, 30000));
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: accept, 'User-Agent': 'VotoClaro/2.0 (dados-publicos)' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${new URL(url).hostname}`);
    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Tempo limite em ${new URL(url).hostname}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function exactKey(name, uf, party) {
  return `${searchable(name)}|${String(uf || '').toUpperCase()}|${String(party || '').toUpperCase()}`;
}

const LEGISLATIVE_MATTER_TYPES = new Set(['PL', 'PLP', 'PEC', 'PDL', 'PLS', 'PLC', 'PRS', 'MPV']);
const LEGISLATIVE_PROFILE_VERSION = 4;

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function effectEvidence(status) {
  const normalized = searchable(typeof status === 'object'
    ? [status?.descricaoSituacao, status?.descricaoTramitacao, status?.despacho].filter(Boolean).join(' ')
    : status || '');
  if (isEnactedStatus(status)) {
    return {
      stage: 'ENACTED',
      label: 'Efeito jurídico confirmado',
      explanation: 'A fonte legislativa registra que a proposta gerou uma norma jurídica. A ementa abaixo descreve o que mudou no direito; isso não prova, sozinho, o resultado na vida das pessoas.',
      impactStatus: 'NOT_MEASURED',
      impactLabel: 'Impacto social ainda não medido nesta consulta',
      impactExplanation: 'Não foi localizada uma avaliação pública oficial vinculada que meça resultados sociais desta norma. O VotoClaro não transforma expectativa em impacto comprovado.',
    };
  }
  if (['arquivad', 'rejeitad', 'retirad', 'prejudicad', 'devolvid'].some((word) => normalized.includes(word))) {
    return {
      stage: 'NOT_ENACTED',
      label: 'Sem efeito legal direto',
      explanation: 'A situação oficial não indica uma norma em vigor decorrente desta proposta. Por isso, não atribuímos impacto real à população.',
      impactStatus: 'NOT_APPLICABLE',
    };
  }
  return {
    stage: 'PROPOSAL',
    label: 'Proposta em acompanhamento',
    explanation: 'Uma proposição não produz, por si só, efeito real na população. O VotoClaro só confirmará efeito legal quando a fonte oficial registrar sua conversão em norma.',
    impactStatus: 'NOT_APPLICABLE',
  };
}

function isEnactedStatus(status) {
  if (status && typeof status === 'object' && Number(status.codSituacao) === 1140) return true;
  const normalized = searchable(typeof status === 'object'
    ? [status?.descricaoSituacao, status?.descricaoTramitacao].filter(Boolean).join(' ')
    : status || '');
  return (normalized.includes('transformad') && normalized.includes('norma juridica'))
    || (normalized.includes('convertid') && normalized.includes('lei'));
}

function selectLatestLegislativeItems(items, limit = 5) {
  return [...items]
    .filter((item) => item && LEGISLATIVE_MATTER_TYPES.has(String(item.type || item.Sigla || '').toUpperCase()))
    .sort((left, right) => {
      const dateDifference = new Date(right.date || right.Data || 0).getTime() - new Date(left.date || left.Data || 0).getTime();
      if (Number.isFinite(dateDifference) && dateDifference !== 0) return dateDifference;
      return Number(right.id || right.Codigo || 0) - Number(left.id || left.Codigo || 0);
    })
    .slice(0, limit);
}

function legislativeItemKey(candidate, item) {
  const stableIdentity = [
    candidate?.legislative?.chamber,
    candidate?.legislative?.memberId,
    item?.id,
    item?.processId,
    item?.title,
    item?.lawTitle,
    item?.summary,
    item?.status,
  ].map((value) => String(value || '').trim()).join('|');
  return crypto.createHash('sha256').update(stableIdentity).digest('hex');
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await mapper(items[index], index);
      } catch {
        results[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function authorshipFromDeputyAuthors(authors, memberId) {
  const expected = String(memberId);
  const author = asArray(authors).find((item) => String(item.uri || '').split('/').pop() === expected);
  if (!author) return { role: 'VERIFIED_AUTHOR', label: 'Autoria registrada pela Câmara' };
  const firstSignature = Number(author.ordemAssinatura) === 1;
  return {
    role: firstSignature ? 'FIRST_SIGNATORY' : 'COAUTHOR',
    label: firstSignature ? 'Primeira assinatura' : 'Coautoria / assinatura',
    signatureOrder: Number(author.ordemAssinatura) || null,
  };
}

function authorshipFromSenate(item) {
  const primary = searchable(item?.IndicadorAutorPrincipal) === 'sim';
  return {
    role: primary ? 'PRIMARY_AUTHOR' : 'COAUTHOR',
    label: primary ? 'Autoria principal' : 'Coautoria',
  };
}

function generatedNorm(root) {
  const norm = root?.normaGerada;
  if (!norm || typeof norm !== 'object' || Array.isArray(norm) || !Object.keys(norm).length) return null;
  return norm;
}

function normReferenceFromText(text) {
  const value = String(text || '');
  const match = value.match(/(?:Lei(?: Complementar)?|Emenda Constitucional|Decreto Legislativo)\s*(?:n[ºo.]*)?\s*[\d.]+(?:\s*,?\s*de\s*\d{4})?/iu);
  return match?.[0]?.trim() || null;
}

function findFirstString(root, keys, depth = 0) {
  if (!root || typeof root !== 'object' || depth > 10) return '';
  for (const key of keys) {
    if (typeof root[key] === 'string' && root[key].trim()) return root[key].trim();
  }
  for (const value of Object.values(root)) {
    const found = findFirstString(value, keys, depth + 1);
    if (found) return found;
  }
  return '';
}

async function inspectDeputyProposal(item, config) {
  const id = encodeURIComponent(item.id);
  const detail = await fetchJson(`https://dadosabertos.camara.leg.br/api/v2/proposicoes/${id}`, config);
  const published = detail.dados || {};
  return { item, published };
}

async function enrichDeputyProposal(inspected, config, memberId) {
  const { item, published } = inspected;
  const id = encodeURIComponent(item.id);
  const [themes, authors, history] = await Promise.allSettled([
    fetchJson(`https://dadosabertos.camara.leg.br/api/v2/proposicoes/${id}/temas`, config),
    fetchJson(`https://dadosabertos.camara.leg.br/api/v2/proposicoes/${id}/autores`, config),
    fetchJson(`https://dadosabertos.camara.leg.br/api/v2/proposicoes/${id}/tramitacoes`, config),
  ]);
  const themeRows = themes.status === 'fulfilled' ? themes.value.dados || [] : [];
  const authorRows = authors.status === 'fulfilled' ? authors.value.dados || [] : [];
  const historyRows = history.status === 'fulfilled' ? history.value.dados || [] : [];
  const officialStatus = published.statusProposicao || {};
  const status = officialStatus.descricaoSituacao
    || published.statusProposicao?.descricaoTramitacao
    || 'Situação detalhada não publicada nesta consulta.';
  const normMovement = [...historyRows].reverse().find((movement) => (
    normReferenceFromText(`${movement.descricaoTramitacao || ''} ${movement.descricaoSituacao || ''} ${movement.despacho || ''}`)
  ));
  const lawReference = normReferenceFromText(`${status} ${officialStatus.despacho || ''}`)
    || normReferenceFromText(`${normMovement?.descricaoTramitacao || ''} ${normMovement?.descricaoSituacao || ''} ${normMovement?.despacho || ''}`);
  const enacted = isEnactedStatus(officialStatus);
  return {
    id: item.id,
    type: item.siglaTipo,
    number: item.numero,
    year: item.ano,
    title: `${item.siglaTipo} ${item.numero}/${item.ano}`,
    summary: published.ementa || item.ementa || 'Ementa não publicada.',
    date: published.dataApresentacao || null,
    status,
    lawTitle: enacted
      ? (lawReference || `${item.siglaTipo} ${item.numero}/${item.ano} — norma jurídica gerada`)
      : `${item.siglaTipo} ${item.numero}/${item.ano} — projeto em tramitação`,
    themes: themeRows.map((theme) => theme.tema).filter(Boolean).slice(0, 4),
    primaryAuthor: published.autor || null,
    authorship: authorshipFromDeputyAuthors(authorRows, memberId),
    officialUrl: `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${encodeURIComponent(item.id)}`,
    fullTextUrl: published.urlInteiroTeor || null,
    normOfficialUrl: enacted ? (officialStatus.url || normMovement?.url || null) : null,
    evidence: effectEvidence(officialStatus),
  };
}

async function enrichSenateMatter(item, config) {
  if (!item.IdentificacaoProcesso) return null;
  const processId = encodeURIComponent(item.IdentificacaoProcesso);
  const process = await fetchJson(`https://legis.senado.leg.br/dadosabertos/processo/${processId}`, config).catch(() => null);
  const norm = generatedNorm(process);
  if (!norm) return null;
  const normId = norm.id || norm.codigo || null;
  const normTitle = findFirstString(norm, ['identificacao', 'descricaoIdentificacao', 'descricao', 'nome', 'titulo'])
    || normReferenceFromText(findFirstString(norm, ['ementa', 'descricao']))
    || `${item.DescricaoIdentificacao || `${item.Sigla} ${item.Numero}/${item.Ano}`} — norma gerada`;
  const status = `Norma jurídica gerada${normTitle ? `: ${normTitle}` : ''}`;
  return {
    id: item.Codigo,
    processId: item.IdentificacaoProcesso || null,
    type: item.Sigla,
    number: item.Numero,
    year: item.Ano,
    title: item.DescricaoIdentificacao || `${item.Sigla} ${item.Numero}/${item.Ano}`,
    summary: item.Ementa || 'Ementa não publicada.',
    date: item.Data || null,
    status,
    lawTitle: normTitle,
    themes: asArray(process?.classificacoes).map((theme) => theme.descricao).filter(Boolean).slice(0, 4),
    primaryAuthor: item.IndicadorAutorPrincipal || null,
    authorship: authorshipFromSenate(item),
    officialUrl: `https://www25.senado.leg.br/web/atividade/materias/-/materia/${encodeURIComponent(item.Codigo)}`,
    normOfficialUrl: findFirstString(norm, ['url', 'Url'])
      || (normId ? `https://legis.senado.leg.br/norma/${encodeURIComponent(normId)}` : null),
    evidence: effectEvidence('Transformado em Norma Jurídica'),
  };
}

async function currentDeputies(config) {
  const deputies = [];
  for (let page = 1; page <= 8; page += 1) {
    const url = `https://dadosabertos.camara.leg.br/api/v2/deputados?itens=100&pagina=${page}&ordem=ASC&ordenarPor=nome`;
    const payload = await fetchJson(url, config);
    const pageData = payload.dados || [];
    deputies.push(...pageData);
    if (pageData.length < 100) break;
  }
  return deputies;
}

async function currentSenators(config) {
  const payload = await fetchJson('https://legis.senado.leg.br/dadosabertos/senador/lista/atual.json', config);
  const list = payload.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar || [];
  return list.map((item) => item.IdentificacaoParlamentar || item);
}

function uniqueMemberIndex(members, mapper) {
  const index = new Map();
  for (const member of members) {
    const mapped = mapper(member);
    const key = exactKey(mapped.name, mapped.uf, mapped.party);
    if (!mapped.name || !mapped.uf || !mapped.party) continue;
    if (index.has(key)) index.set(key, null);
    else index.set(key, mapped);
  }
  return index;
}

async function enrichCandidatesWithLegislativeLinks(candidates, config) {
  const results = await Promise.allSettled([currentDeputies(config), currentSenators(config)]);
  const statuses = {};
  let linked = 0;

  if (results[0].status === 'fulfilled') {
    const deputies = results[0].value;
    const index = uniqueMemberIndex(deputies, (member) => ({
      chamber: 'CAMARA',
      memberId: String(member.id),
      name: member.nome,
      uf: member.siglaUf,
      party: member.siglaPartido,
      photoUrl: member.urlFoto || null,
      profileUrl: `https://www.camara.leg.br/deputados/${member.id}`,
      source: { id: SOURCES.camara.id, name: SOURCES.camara.name, url: SOURCES.camara.url, confidence: 'OFFICIAL' },
    }));
    for (const candidate of candidates) {
      if (searchable(candidate.office) !== 'deputado federal') continue;
      const match = index.get(exactKey(candidate.ballotName, candidate.uf, candidate.party));
      if (!match) continue;
      candidate.legislative = { ...match, matchMethod: 'Nome de urna + UF + partido idênticos em duas fontes oficiais.' };
      if (!candidate.photoUrl && match.photoUrl) candidate.photoUrl = match.photoUrl;
      candidate.sources.push(match.source);
      linked += 1;
    }
    statuses[SOURCES.camara.id] = {
      state: 'OK',
      lastSuccessAt: new Date().toISOString(),
      records: deputies.length,
      message: `${deputies.length} parlamentares em exercício consultados; vínculos só são publicados em correspondência exata.`,
    };
  } else {
    statuses[SOURCES.camara.id] = { state: 'ERROR', lastAttemptAt: new Date().toISOString(), message: 'Falha temporária ao consultar parlamentares em exercício.', error: results[0].reason.message };
  }

  if (results[1].status === 'fulfilled') {
    const senators = results[1].value;
    const index = uniqueMemberIndex(senators, (member) => ({
      chamber: 'SENADO',
      memberId: String(member.CodigoParlamentar),
      name: member.NomeParlamentar,
      fullName: member.NomeCompletoParlamentar,
      uf: member.UfParlamentar,
      party: member.SiglaPartidoParlamentar,
      photoUrl: member.UrlFotoParlamentar ? member.UrlFotoParlamentar.replace(/^http:/, 'https:') : null,
      profileUrl: member.UrlPaginaParlamentar || 'https://www25.senado.leg.br/web/senadores/',
      source: { id: SOURCES.senado.id, name: SOURCES.senado.name, url: SOURCES.senado.url, confidence: 'OFFICIAL' },
    }));
    for (const candidate of candidates) {
      if (searchable(candidate.office) !== 'senador') continue;
      const match = index.get(exactKey(candidate.ballotName, candidate.uf, candidate.party));
      if (!match) continue;
      candidate.legislative = { ...match, matchMethod: 'Nome de urna + UF + partido idênticos em duas fontes oficiais.' };
      if (!candidate.photoUrl && match.photoUrl) candidate.photoUrl = match.photoUrl;
      candidate.sources.push(match.source);
      linked += 1;
    }
    statuses[SOURCES.senado.id] = {
      state: 'OK',
      lastSuccessAt: new Date().toISOString(),
      records: senators.length,
      message: `${senators.length} parlamentares em exercício consultados; vínculos só são publicados em correspondência exata.`,
    };
  } else {
    statuses[SOURCES.senado.id] = { state: 'ERROR', lastAttemptAt: new Date().toISOString(), message: 'Falha temporária ao consultar parlamentares em exercício.', error: results[1].reason.message };
  }

  return { statuses, linked };
}

class LegislativeService {
  constructor(config, store = null, localLlmClient = null) {
    this.config = config;
    this.store = store;
    this.localLlmClient = localLlmClient;
    this.cache = new Map();
    this.analysisQueue = [];
    this.queuedAnalysisKeys = new Set();
    this.analysisWorkerRunning = false;
    this.precomputeRunning = false;
    this.precomputeScannedCandidates = 0;
    this.precomputeEligibleCandidates = 0;
    this.precomputeCompletedAt = null;
  }

  async getRaw(candidate) {
    if (!candidate.legislative) return null;
    const key = `${candidate.legislative.chamber}:${candidate.legislative.memberId}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.savedAt < 15 * 60 * 1000) return cached.data;
    const stored = await this.store?.getLegislativeProfileCache?.(
      candidate.legislative.chamber,
      candidate.legislative.memberId,
      6 * 60 * 60 * 1000,
    );
    if (stored?.payload?.profileVersion === LEGISLATIVE_PROFILE_VERSION) {
      this.cache.set(key, { savedAt: new Date(stored.fetchedAt).getTime(), data: stored.payload });
      return stored.payload;
    }
    const data = candidate.legislative.chamber === 'CAMARA'
      ? await this.getDeputy(candidate.legislative)
      : await this.getSenator(candidate.legislative);
    this.cache.set(key, { savedAt: Date.now(), data });
    await this.store?.saveLegislativeProfileCache?.(
      candidate.legislative.chamber,
      candidate.legislative.memberId,
      data,
    ).catch(() => {});
    return data;
  }

  queueExplanation(candidate, item, itemKey, priority = 'interactive') {
    if (!this.localLlmClient?.isEnabled() || this.queuedAnalysisKeys.has(itemKey)) {
      if (priority === 'interactive' && this.queuedAnalysisKeys.has(itemKey)) {
        const index = this.analysisQueue.findIndex((job) => job.itemKey === itemKey);
        if (index > 0) this.analysisQueue.unshift(...this.analysisQueue.splice(index, 1));
      }
      return;
    }
    this.queuedAnalysisKeys.add(itemKey);
    const job = { candidate, item, itemKey };
    if (priority === 'background') this.analysisQueue.push(job);
    else this.analysisQueue.unshift(job);
    setImmediate(() => this.runAnalysisQueue());
  }

  async attachExplanations(candidate, data, priority) {
    if (!data?.laws?.length || (!this.localLlmClient?.isEnabled() && !this.config.aiWorkerAvailable)) return data;
    const laws = [];
    for (const item of data.laws) {
      const itemKey = legislativeItemKey(candidate, item);
      const stored = await this.store?.getLegislativeItemAnalysis?.(
        itemKey,
        LEGISLATIVE_LLM_ANALYSIS_VERSION,
      );
      if (stored?.status === 'READY' && stored.payload) {
        laws.push({ ...item, plainLanguage: stored.payload });
        continue;
      }
      const attempts = Number(stored?.attempts) || 0;
      const status = attempts >= 3 ? 'FAILED' : (stored?.status || 'QUEUED');
      laws.push({
        ...item,
        plainLanguage: {
          status,
          local: true,
          mode: this.localLlmClient?.isEnabled() ? 'LOCAL_SERVER' : 'DEDICATED_WORKER',
          attempts,
          analysisVersion: LEGISLATIVE_LLM_ANALYSIS_VERSION,
          updatedAt: stored?.updatedAt || null,
        },
      });
      if (attempts < 3 && this.localLlmClient?.isEnabled()) this.queueExplanation(candidate, item, itemKey, priority);
    }
    return { ...data, laws };
  }

  async get(candidate, options = {}) {
    const data = await this.getRaw(candidate);
    return this.attachExplanations(candidate, data, options.background ? 'background' : 'interactive');
  }

  async runAnalysisQueue() {
    if (this.analysisWorkerRunning || !this.localLlmClient?.isEnabled()) return;
    this.analysisWorkerRunning = true;
    try {
      while (this.analysisQueue.length) {
        const job = this.analysisQueue.shift();
        try {
          await this.processExplanation(job);
        } catch (error) {
          console.error(`Falha na explicação legislativa ${job.itemKey.slice(0, 12)}:`, error.message);
          if (error.code === 'LOCAL_LLM_NOT_READY') {
            this.analysisQueue.length = 0;
            this.queuedAnalysisKeys.clear();
            break;
          }
        } finally {
          this.queuedAnalysisKeys.delete(job.itemKey);
        }
      }
    } finally {
      this.analysisWorkerRunning = false;
    }
  }

  async processExplanation(job) {
    const stored = await this.store?.getLegislativeItemAnalysis?.(
      job.itemKey,
      LEGISLATIVE_LLM_ANALYSIS_VERSION,
    );
    const attempts = Number(stored?.attempts) || 0;
    if (attempts >= 3) return;
    const baseRecord = {
      itemKey: job.itemKey,
      analysisVersion: LEGISLATIVE_LLM_ANALYSIS_VERSION,
      model: this.config.localLlmModel,
      promptVersion: LEGISLATIVE_LLM_PROMPT_VERSION,
      attempts: attempts + 1,
    };
    await this.store?.saveLegislativeItemAnalysis?.({ ...baseRecord, status: 'PROCESSING' });
    try {
      await this.localLlmClient.waitUntilReady();
      const explanation = await this.localLlmClient.analyzeLegislativeItem(job.item, {
        candidateName: job.candidate.ballotName || job.candidate.name,
      });
      await this.store?.saveLegislativeItemAnalysis?.({
        ...baseRecord,
        status: 'READY',
        payload: {
          ...explanation,
          status: 'READY',
          local: true,
          analysisVersion: LEGISLATIVE_LLM_ANALYSIS_VERSION,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      await this.store?.saveLegislativeItemAnalysis?.({
        ...baseRecord,
        status: 'FAILED',
        error: String(error.message || error).slice(0, 1000),
      });
      throw error;
    }
  }

  async precomputeCandidates(candidates) {
    if (!this.config.localLlmPrecomputeOnStart || !this.localLlmClient?.isEnabled() || this.precomputeRunning) return;
    const eligible = (Array.isArray(candidates) ? candidates : [])
      .filter((candidate) => candidate.legislative)
      .slice(0, this.config.localLlmLegislativePrecomputeLimit);
    this.precomputeRunning = true;
    this.precomputeEligibleCandidates = eligible.length;
    this.precomputeScannedCandidates = 0;
    try {
      for (const candidate of eligible) {
        try {
          await this.get(candidate, { background: true });
        } catch (error) {
          console.error(`Histórico legislativo não preparado para ${candidate.id}:`, error.message);
        } finally {
          this.precomputeScannedCandidates += 1;
        }
      }
      await this.runAnalysisQueue();
      this.precomputeCompletedAt = new Date().toISOString();
    } finally {
      this.precomputeRunning = false;
    }
  }

  getStatus() {
    return {
      enabled: Boolean(this.localLlmClient?.isEnabled() || this.config.aiWorkerAvailable),
      mode: this.localLlmClient?.isEnabled() ? 'LOCAL_SERVER' : (this.config.aiWorkerAvailable ? 'DEDICATED_WORKER' : 'DISABLED'),
      queuedItems: this.analysisQueue.length,
      workerRunning: this.analysisWorkerRunning,
      precomputeRunning: this.precomputeRunning,
      scannedCandidates: this.precomputeScannedCandidates,
      eligibleCandidates: this.precomputeEligibleCandidates,
      completedAt: this.precomputeCompletedAt,
    };
  }

  async getDeputy(link) {
    const id = encodeURIComponent(link.memberId);
    const today = new Date().toISOString().slice(0, 10);
    const voteStart = new Date();
    voteStart.setUTCDate(voteStart.getUTCDate() - 89);
    const voteStartDate = voteStart.toISOString().slice(0, 10);
    const projectTypes = [...LEGISLATIVE_MATTER_TYPES]
      .map((type) => `siglaTipo=${encodeURIComponent(type)}`)
      .join('&');
    const [profile, expenses, proposals, speeches, events, votesIndex] = await Promise.allSettled([
      fetchJson(`https://dadosabertos.camara.leg.br/api/v2/deputados/${id}`, this.config),
      fetchJson(`https://dadosabertos.camara.leg.br/api/v2/deputados/${id}/despesas?ano=2026&itens=100&ordem=DESC&ordenarPor=dataDocumento`, this.config),
      fetchJson(`https://dadosabertos.camara.leg.br/api/v2/proposicoes?idDeputadoAutor=${id}&${projectTypes}&itens=100&ordem=DESC&ordenarPor=id`, this.config),
      fetchJson(`https://dadosabertos.camara.leg.br/api/v2/deputados/${id}/discursos?dataInicio=2026-01-01&dataFim=${today}&itens=5&ordem=DESC&ordenarPor=dataHoraInicio`, this.config),
      fetchJson(`https://dadosabertos.camara.leg.br/api/v2/deputados/${id}/eventos?dataInicio=2026-01-01&dataFim=${today}&itens=100&ordem=DESC&ordenarPor=dataHoraInicio`, this.config),
      fetchJson(`https://dadosabertos.camara.leg.br/api/v2/votacoes?dataInicio=${voteStartDate}&dataFim=${today}&itens=12&ordem=DESC&ordenarPor=dataHoraRegistro`, this.config),
    ]);
    const expenseRows = expenses.status === 'fulfilled' ? expenses.value.dados || [] : [];
    const proposalRows = proposals.status === 'fulfilled' ? proposals.value.dados || [] : [];
    const speechRows = speeches.status === 'fulfilled' ? speeches.value.dados || [] : [];
    const eventRows = events.status === 'fulfilled' ? events.value.dados || [] : [];
    const voteSessions = votesIndex.status === 'fulfilled' ? votesIndex.value.dados || [] : [];
    const voteDetails = await mapWithConcurrency(voteSessions, 4, async (vote) => {
      const payload = await fetchJson(`https://dadosabertos.camara.leg.br/api/v2/votacoes/${encodeURIComponent(vote.id)}/votos`, this.config);
      const found = (payload.dados || []).find((item) => String(item.deputado_?.id || item.deputado?.id || '') === String(link.memberId));
      if (!found) return null;
      return {
        id: vote.id,
        date: found.dataRegistroVoto || vote.dataHoraRegistro || null,
        vote: found.tipoVoto || null,
        description: vote.descricao || vote.ultimaApresentacaoProposicao?.descricao || 'Votação nominal',
        officialUrl: `https://dadosabertos.camara.leg.br/api/v2/votacoes/${encodeURIComponent(vote.id)}/votos`,
      };
    });
    const expenseCategories = new Map();
    for (const row of expenseRows) {
      const category = String(row.tipoDespesa || 'Não informado').trim();
      const current = expenseCategories.get(category) || { category, value: 0, records: 0 };
      current.value += Number(row.valorLiquido || 0);
      current.records += 1;
      expenseCategories.set(category, current);
    }
    const projectsByType = new Map();
    for (const row of proposalRows) projectsByType.set(row.siglaTipo || 'Outro', (projectsByType.get(row.siglaTipo || 'Outro') || 0) + 1);
    const selected = selectLatestLegislativeItems(
      proposalRows.map((item) => ({ ...item, type: item.siglaTipo })),
      80,
    );
    const inspected = await mapWithConcurrency(selected, 8, (item) => inspectDeputyProposal(item, this.config));
    const validInspected = inspected.filter(Boolean);
    const confirmed = validInspected.filter((item) => isEnactedStatus(item.published.statusProposicao));
    const enacted = await mapWithConcurrency(
      confirmed.slice(0, 12),
      4,
      (item) => enrichDeputyProposal(item, this.config, link.memberId),
    );
    const enactedItems = enacted.filter(Boolean).sort((left, right) => {
      const role = { FIRST_SIGNATORY: 0, VERIFIED_AUTHOR: 1, COAUTHOR: 2 };
      return (role[left.authorship?.role] ?? 3) - (role[right.authorship?.role] ?? 3)
        || new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime();
    });
    const missing = Math.max(0, 3 - enactedItems.length);
    const pending = missing
      ? await mapWithConcurrency(
        validInspected.filter((item) => !isEnactedStatus(item.published.statusProposicao)).slice(0, missing),
        Math.min(3, missing),
        (item) => enrichDeputyProposal(item, this.config, link.memberId),
      )
      : [];
    const laws = [...enactedItems, ...pending.filter(Boolean)].slice(0, 3);
    return {
      profileVersion: LEGISLATIVE_PROFILE_VERSION,
      chamber: 'Câmara dos Deputados',
      profile: profile.status === 'fulfilled' ? profile.value.dados : null,
      expenses: {
        year: 2026,
        recordsShown: expenseRows.length,
        totalShown: expenseRows.reduce((sum, row) => sum + Number(row.valorLiquido || 0), 0),
        partial: expenseRows.length === 100,
        byCategory: [...expenseCategories.values()].sort((left, right) => right.value - left.value),
      },
      activity: {
        period: { from: '2026-01-01', to: today },
        officialEventParticipations: eventRows.length,
        eventParticipationsPartial: eventRows.length === 100,
        nominalVotesInspected: voteSessions.length,
        nominalVotesFound: voteDetails.filter(Boolean).length,
        recentVotes: voteDetails.filter(Boolean).slice(0, 5),
        speeches: speechRows.map((speech) => ({
          date: speech.dataHoraInicio || null,
          type: speech.tipoDiscurso || null,
          summary: speech.sumario || speech.transcricao || 'Discurso registrado pela Câmara.',
          phase: speech.faseEvento?.titulo || null,
          officialUrl: link.profileUrl,
        })),
        projectsReturned: proposalRows.length,
        projectsPartial: proposalRows.length === 100,
        projectsByType: [...projectsByType].map(([type, count]) => ({ type, count })).sort((left, right) => right.count - left.count),
        attendanceNote: 'A Câmara retornou participações em eventos e votos nominais deste recorte. O VotoClaro não transforma esse recorte em taxa oficial de presença, porque nem toda votação é nominal e a elegibilidade para votar varia.',
      },
      promiseVsAction: {
        status: 'NOT_COMPARABLE',
        message: 'Esta consulta não localizou, com vínculo individual verificável, um plano eleitoral anterior que possa ser comparado à atuação. O VotoClaro não presume promessa partidária como promessa pessoal.',
      },
      laws,
      methodology: {
        limit: 3,
        scanned: inspected.filter(Boolean).length,
        rule: 'Até três itens com autoria ou coautoria registrada. Normas confirmadas são priorizadas; quando há menos de três, o recorte é completado por projetos recentes claramente identificados como propostas.',
        impactRule: 'A conversão confirma efeito jurídico. Impacto social só pode ser chamado de medido quando houver avaliação pública oficial vinculada; sem ela, o VotoClaro informa a ausência.',
      },
      source: { name: SOURCES.camara.name, url: link.profileUrl, fetchedAt: new Date().toISOString(), confidence: 'OFFICIAL' },
    };
  }

  async getSenator(link) {
    const id = encodeURIComponent(link.memberId);
    const [profile, authorships] = await Promise.all([
      fetchJson(`https://legis.senado.leg.br/dadosabertos/senador/${id}.json`, this.config).catch(() => null),
      fetchJson(`https://legis.senado.leg.br/dadosabertos/senador/${id}/autorias.json`, this.config).catch(() => null),
    ]);
    const authorshipRows = asArray(authorships?.MateriasAutoriaParlamentar?.Parlamentar?.Autorias?.Autoria)
      .map((authorship) => ({ ...(authorship.Materia || {}), IndicadorAutorPrincipal: authorship.IndicadorAutorPrincipal }));
    const selected = selectLatestLegislativeItems(authorshipRows, 120)
      .sort((left, right) => {
        const authorDifference = Number(searchable(right.IndicadorAutorPrincipal) === 'sim')
          - Number(searchable(left.IndicadorAutorPrincipal) === 'sim');
        if (authorDifference) return authorDifference;
        return new Date(right.Data || 0).getTime() - new Date(left.Data || 0).getTime();
      })
      .slice(0, 80);
    const inspected = await mapWithConcurrency(selected, 8, (item) => enrichSenateMatter(item, this.config));
    const laws = inspected.filter(Boolean).slice(0, 3);
    return {
      profileVersion: LEGISLATIVE_PROFILE_VERSION,
      chamber: 'Senado Federal',
      profile,
      expenses: null,
      activity: {
        projectsReturned: authorshipRows.length,
        projectsPartial: false,
        recentVotes: [],
        speeches: [],
        attendanceNote: 'A consulta atual do Senado confirma perfil, autorias e normas. Presença, despesas e discursos ainda não são exibidos porque esses conjuntos exigem uma integração oficial separada e validação de cobertura.',
      },
      promiseVsAction: {
        status: 'NOT_COMPARABLE',
        message: 'Não há plano eleitoral individual anterior vinculado de forma verificável nesta consulta. O VotoClaro não converte programa partidário em promessa pessoal.',
      },
      laws,
      note: 'A identificação do mandato, a autoria e a norma gerada foram confirmadas nos dados oficiais do Senado. Requerimentos procedimentais não entram neste recorte.',
      methodology: {
        limit: 3,
        scanned: selected.length,
        rule: 'Até três matérias cuja consulta oficial do processo contém uma norma gerada. Autoria principal é priorizada e coautoria permanece identificada.',
        impactRule: 'A norma gerada confirma efeito jurídico. Resultado social mensurado exige uma avaliação pública oficial adicional; sem ela, não fazemos estimativa.',
      },
      source: { name: SOURCES.senado.name, url: link.profileUrl, fetchedAt: new Date().toISOString(), confidence: 'OFFICIAL' },
    };
  }
}

module.exports = {
  enrichCandidatesWithLegislativeLinks,
  LegislativeService,
  effectEvidence,
  isEnactedStatus,
  authorshipFromDeputyAuthors,
  authorshipFromSenate,
  generatedNorm,
  selectLatestLegislativeItems,
  legislativeItemKey,
};
