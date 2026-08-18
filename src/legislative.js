const { searchable } = require('./normalize');
const { SOURCES } = require('./sources');

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

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function effectEvidence(status) {
  const normalized = searchable(status || '');
  if (normalized.includes('transformad') && normalized.includes('norma juridica')
    || normalized.includes('convertid') && normalized.includes('lei')) {
    return {
      stage: 'ENACTED',
      label: 'Virou norma jurídica',
      explanation: 'A situação oficial confirma a conversão em norma. O impacto real depende da execução e de avaliações públicas; não é estimado pelo VotoClaro.',
    };
  }
  if (['arquivad', 'rejeitad', 'retirad', 'prejudicad', 'devolvid'].some((word) => normalized.includes(word))) {
    return {
      stage: 'NOT_ENACTED',
      label: 'Sem efeito legal direto',
      explanation: 'A situação oficial não indica uma norma em vigor decorrente desta proposta. Por isso, não atribuímos impacto real à população.',
    };
  }
  return {
    stage: 'PROPOSAL',
    label: 'Proposta em acompanhamento',
    explanation: 'Uma proposição não produz, por si só, efeito real na população. O VotoClaro só confirmará efeito legal quando a fonte oficial registrar sua conversão em norma.',
  };
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

async function enrichDeputyProposal(item, config) {
  const id = encodeURIComponent(item.id);
  const [detail, themes] = await Promise.allSettled([
    fetchJson(`https://dadosabertos.camara.leg.br/api/v2/proposicoes/${id}`, config),
    fetchJson(`https://dadosabertos.camara.leg.br/api/v2/proposicoes/${id}/temas`, config),
  ]);
  const published = detail.status === 'fulfilled' ? detail.value.dados || {} : {};
  const themeRows = themes.status === 'fulfilled' ? themes.value.dados || [] : [];
  const status = published.statusProposicao?.descricaoSituacao
    || published.statusProposicao?.descricaoTramitacao
    || 'Situação detalhada não publicada nesta consulta.';
  return {
    id: item.id,
    type: item.siglaTipo,
    number: item.numero,
    year: item.ano,
    title: `${item.siglaTipo} ${item.numero}/${item.ano}`,
    summary: published.ementa || item.ementa || 'Ementa não publicada.',
    date: published.dataApresentacao || null,
    status,
    themes: themeRows.map((theme) => theme.tema).filter(Boolean).slice(0, 4),
    primaryAuthor: published.autor || null,
    officialUrl: `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${encodeURIComponent(item.id)}`,
    fullTextUrl: published.urlInteiroTeor || null,
    evidence: effectEvidence(status),
  };
}

async function enrichSenateMatter(item, config) {
  const code = encodeURIComponent(item.Codigo);
  const detail = await fetchJson(`https://legis.senado.leg.br/dadosabertos/materia/${code}.json`, config).catch(() => null);
  const status = findFirstString(detail, ['DescricaoSituacao', 'DescricaoSituacaoMateria', 'DescricaoTramitacao'])
    || 'Situação detalhada disponível na página oficial.';
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
    themes: [],
    primaryAuthor: item.IndicadorAutorPrincipal || null,
    officialUrl: `https://www25.senado.leg.br/web/atividade/materias/-/materia/${encodeURIComponent(item.Codigo)}`,
    evidence: effectEvidence(status),
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
  constructor(config) {
    this.config = config;
    this.cache = new Map();
  }

  async get(candidate) {
    if (!candidate.legislative) return null;
    const key = `${candidate.legislative.chamber}:${candidate.legislative.memberId}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.savedAt < 15 * 60 * 1000) return cached.data;
    const data = candidate.legislative.chamber === 'CAMARA'
      ? await this.getDeputy(candidate.legislative)
      : await this.getSenator(candidate.legislative);
    this.cache.set(key, { savedAt: Date.now(), data });
    return data;
  }

  async getDeputy(link) {
    const id = encodeURIComponent(link.memberId);
    const [profile, expenses, proposals] = await Promise.allSettled([
      fetchJson(`https://dadosabertos.camara.leg.br/api/v2/deputados/${id}`, this.config),
      fetchJson(`https://dadosabertos.camara.leg.br/api/v2/deputados/${id}/despesas?ano=2026&itens=100&ordem=DESC&ordenarPor=dataDocumento`, this.config),
      fetchJson(`https://dadosabertos.camara.leg.br/api/v2/proposicoes?idDeputadoAutor=${id}&itens=20&ordem=DESC&ordenarPor=id`, this.config),
    ]);
    const expenseRows = expenses.status === 'fulfilled' ? expenses.value.dados || [] : [];
    const proposalRows = proposals.status === 'fulfilled' ? proposals.value.dados || [] : [];
    const selected = selectLatestLegislativeItems(proposalRows.map((item) => ({ ...item, type: item.siglaTipo })), 5);
    const enriched = await Promise.all(selected.map((item) => enrichDeputyProposal(item, this.config)));
    return {
      chamber: 'Câmara dos Deputados',
      profile: profile.status === 'fulfilled' ? profile.value.dados : null,
      expenses: {
        year: 2026,
        recordsShown: expenseRows.length,
        totalShown: expenseRows.reduce((sum, row) => sum + Number(row.valorLiquido || 0), 0),
        partial: expenseRows.length === 100,
      },
      proposals: enriched,
      methodology: {
        limit: 5,
        rule: 'Cinco proposições legislativas mais recentes entre os tipos de projeto, conforme autoria e data publicadas pela Casa.',
        impactRule: 'Proposição não é lei. Efeito real só é afirmado quando a situação oficial registra conversão em norma; resultado social mensurado exige avaliação pública adicional.',
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
    const selected = selectLatestLegislativeItems(authorshipRows, 5);
    const proposals = await Promise.all(selected.map((item) => enrichSenateMatter(item, this.config)));
    return {
      chamber: 'Senado Federal',
      profile,
      expenses: null,
      proposals,
      note: 'A identificação do mandato e as autorias foram consultadas nas APIs oficiais do Senado. Requerimentos procedimentais não entram neste recorte de projetos.',
      methodology: {
        limit: 5,
        rule: 'Cinco matérias legislativas mais recentes entre PL, PLP, PEC, PDL, PLS, PLC, PRS e MPV. Requerimentos administrativos e de sessão ficam fora.',
        impactRule: 'Proposição não é lei. Efeito real só é afirmado quando a situação oficial registra conversão em norma; resultado social mensurado exige avaliação pública adicional.',
      },
      source: { name: SOURCES.senado.name, url: link.profileUrl, fetchedAt: new Date().toISOString(), confidence: 'OFFICIAL' },
    };
  }
}

module.exports = {
  enrichCandidatesWithLegislativeLinks,
  LegislativeService,
  effectEvidence,
  selectLatestLegislativeItems,
};
