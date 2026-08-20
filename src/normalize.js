const crypto = require('crypto');
const { SOURCES } = require('./sources');

function clean(value) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  return ['#NULO#', '#NULO', '#NE#', '#NE', '-1', '-3', 'NULO'].includes(text.toUpperCase()) ? '' : text;
}

function searchable(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function canonicalOffice(value) {
  return searchable(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

const VOTER_OFFICES = new Set([
  'presidente',
  'governador',
  'senador',
  'deputado federal',
  'deputado estadual',
  'deputado distrital',
]);

const TICKET_RELATIONS = {
  presidente: ['vice presidente'],
  governador: ['vice governador'],
  senador: ['1 suplente', '2 suplente'],
};

function isVoterFacingOffice(candidateOrOffice) {
  const office = typeof candidateOrOffice === 'string'
    ? candidateOrOffice
    : candidateOrOffice?.office;
  return VOTER_OFFICES.has(canonicalOffice(office));
}

function ticketKey(candidate) {
  const electionId = clean(candidate?.electionId);
  const electionUnit = clean(candidate?.electionUnit);
  const ballotNumber = candidate?.ballotNumber;
  if (!electionId || !electionUnit || ballotNumber === null || ballotNumber === undefined) return '';
  return `${electionId}|${electionUnit}|${ballotNumber}`;
}

function runningMateSummary(candidate) {
  return {
    id: candidate.id,
    tseId: candidate.tseId,
    name: candidate.name,
    ballotName: candidate.ballotName,
    ballotNumber: candidate.ballotNumber,
    office: candidate.office,
    officeCode: candidate.officeCode,
    party: candidate.party,
    partyName: candidate.partyName,
    partyNumber: candidate.partyNumber,
    status: candidate.status,
    statusDetail: candidate.statusDetail,
    statusGroup: candidate.statusGroup,
    photoUrl: candidate.photoUrl,
    source: candidate.sources?.[0] || null,
    matchMethod: 'CD_ELEICAO + SG_UE + NR_CANDIDATO + cargo relacionado',
  };
}

function attachRunningMates(candidates = []) {
  const byTicket = new Map();
  for (const candidate of candidates) {
    const key = ticketKey(candidate);
    if (!key) continue;
    if (!byTicket.has(key)) byTicket.set(key, []);
    byTicket.get(key).push(candidate);
  }

  return candidates.filter(isVoterFacingOffice).map((candidate) => {
    const primaryOffice = canonicalOffice(candidate.office);
    const expected = TICKET_RELATIONS[primaryOffice] || [];
    const order = new Map(expected.map((office, index) => [office, index]));
    const runningMates = (byTicket.get(ticketKey(candidate)) || [])
      .filter((item) => item.id !== candidate.id && order.has(canonicalOffice(item.office)))
      .sort((left, right) => {
        const officeOrder = order.get(canonicalOffice(left.office)) - order.get(canonicalOffice(right.office));
        return officeOrder || left.ballotName.localeCompare(right.ballotName, 'pt-BR');
      })
      .map(runningMateSummary);
    return { ...candidate, runningMates };
  });
}

function parseInteger(value) {
  const parsed = Number.parseInt(clean(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBrazilianDecimal(value) {
  const text = clean(value).replace(/\s/g, '');
  if (!text) return 0;
  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusGroup(rawStatus, rawDetail = '') {
  const value = searchable(`${rawStatus} ${rawDetail}`);
  if (value.includes('falecid')) return 'DECEASED';
  if (value.includes('renuncia')) return 'WITHDRAWN';
  if (value.includes('cassad') || value.includes('cancelad')) return 'CANCELLED';
  if (value.includes('indeferid') || value.includes('nao conhecimento')) return 'DENIED';
  if (value.includes('deferid')) return 'APPROVED';
  return 'PENDING';
}

function sourceGeneratedAt(row) {
  const date = clean(row.DT_GERACAO);
  const time = clean(row.HH_GERACAO) || '00:00:00';
  if (!date) return null;
  const [day, month, year] = date.split('/');
  if (!year) return null;
  const parsed = new Date(`${year}-${month}-${day}T${time}-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function officialSource(source, row) {
  return {
    id: source.id,
    name: source.name,
    authority: source.authority,
    url: source.url,
    confidence: 'OFFICIAL',
    generatedAt: sourceGeneratedAt(row),
  };
}

function normalizeCandidate(row) {
  const id = clean(row.SQ_CANDIDATO);
  if (!id) return null;
  const electionId = clean(row.CD_ELEICAO);
  const electionUnit = clean(row.SG_UE) || clean(row.SG_UF);
  const uf = clean(row.SG_UF);
  const status = clean(row.DS_SITUACAO_CANDIDATURA) || 'Aguardando publicação';
  const statusDetail = clean(row.DS_DETALHE_SITUACAO_CAND);

  return {
    id,
    tseId: id,
    electionYear: 2026,
    electionId,
    name: clean(row.NM_CANDIDATO),
    ballotName: clean(row.NM_URNA_CANDIDATO) || clean(row.NM_CANDIDATO),
    ballotNumber: parseInteger(row.NR_CANDIDATO),
    office: clean(row.DS_CARGO),
    officeCode: clean(row.CD_CARGO),
    uf,
    electionUnit,
    electionUnitName: clean(row.NM_UE),
    party: clean(row.SG_PARTIDO),
    partyName: clean(row.NM_PARTIDO),
    partyNumber: parseInteger(row.NR_PARTIDO),
    coalition: clean(row.NM_COLIGACAO),
    federation: clean(row.NM_FEDERACAO),
    status,
    statusDetail,
    statusGroup: statusGroup(status, statusDetail),
    occupation: clean(row.DS_OCUPACAO),
    education: clean(row.DS_GRAU_INSTRUCAO),
    gender: clean(row.DS_GENERO),
    ageAtTakingOffice: parseInteger(row.NR_IDADE_DATA_POSSE),
    reelection: clean(row.ST_REELEICAO).toUpperCase() === 'S',
    photoUrl: null,
    photo: null,
    assets: [],
    socialLinks: [],
    finance: null,
    sources: [officialSource(SOURCES.tseCandidates, row)],
  };
}

function normalizeAsset(row) {
  const candidateId = clean(row.SQ_CANDIDATO);
  if (!candidateId) return null;
  return {
    candidateId,
    type: clean(row.DS_TIPO_BEM_CANDIDATO),
    description: clean(row.DS_BEM_CANDIDATO),
    value: parseBrazilianDecimal(row.VR_BEM_CANDIDATO),
    order: parseInteger(row.NR_ORDEM_CANDIDATO),
    source: officialSource(SOURCES.tseAssets, row),
  };
}

function normalizeSocial(row) {
  const candidateId = clean(row.SQ_CANDIDATO);
  const url = clean(row.DS_URL || row.DS_REDE_SOCIAL);
  if (!candidateId || !/^https?:\/\//i.test(url)) return null;
  return {
    candidateId,
    url,
    source: officialSource(SOURCES.tseSocial, row),
  };
}

function attachCandidateComplement(candidates, rows) {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const latestById = new Map();
  for (const row of rows) {
    const id = clean(row.SQ_CANDIDATO);
    if (id) latestById.set(id, row);
  }
  for (const [id, row] of latestById) {
    const candidate = byId.get(id);
    if (!candidate) continue;
    const judgmentStatus = clean(row.DS_SITUACAO_JULGAMENTO);
    const electionStatus = clean(row.DS_SITUACAO_CANDIDATO_PLEITO);
    const ballotStatus = clean(row.DS_SITUACAO_CANDIDATO_URNA);
    const publishedStatus = judgmentStatus || electionStatus || ballotStatus;
    if (publishedStatus) candidate.status = publishedStatus;
    const detail = clean(row.DS_DETALHE_SITUACAO_CAND);
    if (detail) candidate.statusDetail = detail;
    candidate.statusGroup = statusGroup(candidate.status, candidate.statusDetail);
    candidate.judgmentStatus = judgmentStatus || null;
    candidate.electionStatus = electionStatus || null;
    candidate.ballotStatus = ballotStatus || null;
    candidate.registrationProcess = clean(row.NR_PROCESSO) || null;
    candidate.acceptedAt = clean(row.DT_ACEITE_CANDIDATURA) || null;
    candidate.maximumCampaignExpense = parseBrazilianDecimal(row.VR_DESPESA_MAX_CAMPANHA);
    candidate.declaredAssets = clean(row.ST_DECLARAR_BENS).toUpperCase() === 'S';
    candidate.insertedInBallot = clean(row.ST_CANDIDATO_INSERIDO_URNA).toUpperCase() === 'SIM';
    candidate.replaced = clean(row.ST_SUBSTITUIDO).toUpperCase() === 'S';
    candidate.nationality = clean(row.DS_NACIONALIDADE) || null;
    candidate.birthplace = clean(row.NM_MUNICIPIO_NASCIMENTO) || null;
    const age = parseInteger(row.NR_IDADE_DATA_POSSE);
    if (age) candidate.ageAtTakingOffice = age;
    candidate.sources.push(officialSource(SOURCES.tseCandidateComplement, row));
  }
  return candidates;
}

function transactionCandidateId(row) {
  return clean(row.SQ_CANDIDATO || row.SQ_PRESTADOR_CONTAS);
}

function transactionValue(row, kind) {
  const keys = kind === 'revenue'
    ? ['VR_RECEITA', 'VR_RECEITA_TOTAL']
    : ['VR_DESPESA_CONTRATADA', 'VR_DESPESA_PAGA', 'VR_DESPESA'];
  for (const key of keys) {
    if (clean(row[key])) return parseBrazilianDecimal(row[key]);
  }
  return 0;
}

function attachRelatedData(candidates, assets, socialLinks, revenues, expenses) {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  for (const asset of assets) {
    const candidate = byId.get(asset.candidateId);
    if (candidate) candidate.assets.push({
      type: asset.type,
      description: asset.description,
      value: asset.value,
      order: asset.order,
    });
  }

  for (const social of socialLinks) {
    const candidate = byId.get(social.candidateId);
    if (candidate && !candidate.socialLinks.some((item) => item.url === social.url)) {
      candidate.socialLinks.push({ url: social.url });
    }
  }

  const finance = new Map();
  const ensureFinance = (id) => {
    if (!finance.has(id)) finance.set(id, { totalRevenue: 0, totalExpense: 0, revenueRecords: 0, expenseRecords: 0 });
    return finance.get(id);
  };

  for (const row of revenues) {
    const id = transactionCandidateId(row);
    if (!byId.has(id)) continue;
    const item = ensureFinance(id);
    item.totalRevenue += transactionValue(row, 'revenue');
    item.revenueRecords += 1;
  }
  for (const row of expenses) {
    const id = transactionCandidateId(row);
    if (!byId.has(id)) continue;
    const item = ensureFinance(id);
    item.totalExpense += transactionValue(row, 'expense');
    item.expenseRecords += 1;
  }

  for (const candidate of candidates) {
    candidate.assets.sort((a, b) => (a.order || 0) - (b.order || 0));
    candidate.assetTotal = candidate.assets.reduce((sum, asset) => sum + asset.value, 0);
    if (finance.has(candidate.id)) {
      const item = finance.get(candidate.id);
      candidate.finance = {
        ...item,
        balance: item.totalRevenue - item.totalExpense,
        note: 'Valores publicados pela Justiça Eleitoral; receitas podem ser informadas com até 72 horas de defasagem.',
      };
    }
    if (candidate.assets.length) candidate.sources.push(officialSource(SOURCES.tseAssets, assets.find((a) => a.candidateId === candidate.id) || {}));
    if (candidate.socialLinks.length) candidate.sources.push(officialSource(SOURCES.tseSocial, socialLinks.find((a) => a.candidateId === candidate.id) || {}));
    if (candidate.finance) {
      candidate.sources.push({ ...officialSource(SOURCES.tseRevenue, {}), generatedAt: null });
      candidate.sources.push({ ...officialSource(SOURCES.tseExpense, {}), generatedAt: null });
    }
  }

  return candidates;
}

function checksum(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function candidateChanges(previousCandidates = [], nextCandidates = []) {
  const previous = new Map(previousCandidates.map((candidate) => [candidate.id, candidate]));
  const changes = [];
  const fields = ['status', 'statusDetail', 'party', 'ballotNumber', 'office'];
  for (const candidate of nextCandidates) {
    const old = previous.get(candidate.id);
    if (!old) {
      changes.push({ type: 'CANDIDATE_ADDED', candidateId: candidate.id, candidateName: candidate.ballotName });
      continue;
    }
    for (const field of fields) {
      if (old[field] !== candidate[field]) {
        changes.push({
          type: 'FIELD_CHANGED',
          candidateId: candidate.id,
          candidateName: candidate.ballotName,
          field,
          previousValue: old[field] ?? null,
          currentValue: candidate[field] ?? null,
        });
      }
    }
    previous.delete(candidate.id);
  }
  for (const candidate of previous.values()) {
    changes.push({ type: 'CANDIDATE_REMOVED', candidateId: candidate.id, candidateName: candidate.ballotName });
  }
  return changes.slice(0, 5000);
}

module.exports = {
  clean,
  searchable,
  canonicalOffice,
  isVoterFacingOffice,
  attachRunningMates,
  parseBrazilianDecimal,
  statusGroup,
  sourceGeneratedAt,
  normalizeCandidate,
  normalizeAsset,
  normalizeSocial,
  attachCandidateComplement,
  attachRelatedData,
  checksum,
  candidateChanges,
};
