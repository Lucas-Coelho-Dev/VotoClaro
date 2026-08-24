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
  return {
    id: item.id,
    type: item.siglaTipo,
    number: item.numero,
    year: item.ano,
    title: `${item.siglaTipo} ${item.numero}/${item.ano}`,
    summary: published.ementa || item.ementa || 'Ementa não publicada.',
    date: published.dataApresentacao || null,
    status,
    lawTitle: lawReference || `${item.siglaTipo} ${item.numero}/${item.ano} — norma jurídica gerada`,
    themes: themeRows.map((theme) => theme.tema).filter(Boolean).slice(0, 4),
    primaryAuthor: published.autor || null,
    authorship: authorshipFromDeputyAuthors(authorRows, memberId),
    officialUrl: `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${encodeURIComponent(item.id)}`,
    fullTextUrl: published.urlInteiroTeor || null,
    normOfficialUrl: officialStatus.url || normMovement?.url || null,
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
  constructor(config, store = null) {
    this.config = config;
    this.store = store;
    this.cache = new Map();
  }

  async get(candidate) {
    if (!candidate.legislative) return null;
    const key = `${candidate.legislative.chamber}:${candidate.legislative.memberId}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.savedAt < 15 * 60 * 1000) return cached.data;
    const stored = await this.store?.getLegislativeProfileCache?.(
      candidate.legislative.chamber,
      candidate.legislative.memberId,
      6 * 60 * 60 * 1000,
    );
    if (stored?.payload) {
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

  async getDeputy(link) {
    const id = encodeURIComponent(link.memberId);
    const projectTypes = [...LEGISLATIVE_MATTER_TYPES]
      .map((type) => `siglaTipo=${encodeURIComponent(type)}`)
      .join('&');
    const [profile, expenses, proposals] = await Promise.allSettled([
      fetchJson(`https://dadosabertos.camara.leg.br/api/v2/deputados/${id}`, this.config),
      fetchJson(`https://dadosabertos.camara.leg.br/api/v2/deputados/${id}/despesas?ano=2026&itens=100&ordem=DESC&ordenarPor=dataDocumento`, this.config),
      fetchJson(`https://dadosabertos.camara.leg.br/api/v2/proposicoes?idDeputadoAutor=${id}&${projectTypes}&itens=100&ordem=DESC&ordenarPor=id`, this.config),
    ]);
    const expenseRows = expenses.status === 'fulfilled' ? expenses.value.dados || [] : [];
    const proposalRows = proposals.status === 'fulfilled' ? proposals.value.dados || [] : [];
    const selected = selectLatestLegislativeItems(
      proposalRows.map((item) => ({ ...item, type: item.siglaTipo })),
      80,
    );
    const inspected = await mapWithConcurrency(selected, 8, (item) => inspectDeputyProposal(item, this.config));
    const confirmed = inspected.filter((item) => item && isEnactedStatus(item.published.statusProposicao));
    const enriched = await mapWithConcurrency(
      confirmed.slice(0, 12),
      4,
      (item) => enrichDeputyProposal(item, this.config, link.memberId),
    );
    const laws = enriched.filter(Boolean).sort((left, right) => {
      const role = { FIRST_SIGNATORY: 0, VERIFIED_AUTHOR: 1, COAUTHOR: 2 };
      return (role[left.authorship?.role] ?? 3) - (role[right.authorship?.role] ?? 3)
        || new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime();
    }).slice(0, 3);
    return {
      chamber: 'Câmara dos Deputados',
      profile: profile.status === 'fulfilled' ? profile.value.dados : null,
      expenses: {
        year: 2026,
        recordsShown: expenseRows.length,
        totalShown: expenseRows.reduce((sum, row) => sum + Number(row.valorLiquido || 0), 0),
        partial: expenseRows.length === 100,
      },
      laws,
      methodology: {
        limit: 3,
        scanned: inspected.filter(Boolean).length,
        rule: 'Até três propostas com autoria ou coautoria registrada que a situação detalhada da Câmara confirma como transformadas em norma. A primeira assinatura é priorizada.',
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
      chamber: 'Senado Federal',
      profile,
      expenses: null,
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
};
