const IDEOLOGY_SOURCE = Object.freeze({
  name: 'Bolognesi, Ribeiro, Codato e Silva — O desaparecimento do centro ideológico no sistema partidário brasileiro',
  url: 'https://doi.org/10.1590/1807-0191202531120',
  surveyYear: 2022,
  publishedAt: '2026-01-23',
  scale: '0 (extrema esquerda) a 10 (extrema direita)',
});

const PARTY_DATA = Object.freeze({
  REPUBLICANOS: { number: 10, name: 'Republicanos', score: 8.584, detailedLabel: 'Extrema direita', sourceParty: 'REP' },
  PP: { number: 11, name: 'Progressistas', score: 8.398, detailedLabel: 'Direita', sourceParty: 'PROGRE' },
  PDT: { number: 12, name: 'Partido Democrático Trabalhista', score: 3.977, detailedLabel: 'Centro-esquerda' },
  PT: { number: 13, name: 'Partido dos Trabalhadores', score: 2.761, detailedLabel: 'Esquerda' },
  MISSAO: { number: 14, name: 'Partido Missão', score: null, detailedLabel: 'Sem classificação' },
  MDB: { number: 15, name: 'Movimento Democrático Brasileiro', score: 6.698, detailedLabel: 'Centro-direita' },
  PSTU: { number: 16, name: 'Partido Socialista dos Trabalhadores Unificado', score: 0.525, detailedLabel: 'Extrema esquerda' },
  REDE: { number: 18, name: 'Rede Sustentabilidade', score: 3.802, detailedLabel: 'Centro-esquerda' },
  PODE: { number: 20, name: 'Podemos', score: 7.666, detailedLabel: 'Direita' },
  PCB: { number: 21, name: 'Partido Comunista Brasileiro', score: 0.711, detailedLabel: 'Extrema esquerda' },
  PL: { number: 22, name: 'Partido Liberal', score: 9.068, detailedLabel: 'Extrema direita' },
  CIDADANIA: { number: 23, name: 'Cidadania', score: 6.358, detailedLabel: 'Centro-direita', sourceParty: 'CDD' },
  PRD: { number: 25, name: 'Partido Renovação Democrática', score: null, detailedLabel: 'Sem classificação' },
  DC: { number: 27, name: 'Democracia Cristã', score: 8.460, detailedLabel: 'Direita' },
  PRTB: { number: 28, name: 'Partido Renovador Trabalhista Brasileiro', score: 7.718, detailedLabel: 'Direita' },
  PCO: { number: 29, name: 'Partido da Causa Operária', score: 0.566, detailedLabel: 'Extrema esquerda' },
  NOVO: { number: 30, name: 'Partido Novo', score: 8.934, detailedLabel: 'Extrema direita' },
  MOBILIZA: {
    number: 33,
    name: 'Mobilização Nacional',
    score: 6.945,
    detailedLabel: 'Centro-direita',
    sourceParty: 'PMN',
    continuityNote: 'Nota do antigo PMN, cuja mudança de nome para Mobiliza foi registrada pelo TSE.',
  },
  DEMOCRATA: {
    number: 35,
    name: 'Democrata',
    score: 7.512,
    detailedLabel: 'Direita',
    sourceParty: 'PMB',
    continuityNote: 'Nota do antigo PMB, cuja mudança de nome para Democrata foi aprovada pelo TSE.',
  },
  AGIR: { number: 36, name: 'Agir', score: 7.780, detailedLabel: 'Direita' },
  PSB: { number: 40, name: 'Partido Socialista Brasileiro', score: 3.699, detailedLabel: 'Centro-esquerda' },
  PV: { number: 43, name: 'Partido Verde', score: 4.245, detailedLabel: 'Centro-esquerda' },
  UNIAO: { number: 44, name: 'União Brasil', score: 8.749, detailedLabel: 'Extrema direita', sourceParty: 'UNIÃO' },
  PSDB: { number: 45, name: 'Partido da Social Democracia Brasileira', score: 6.966, detailedLabel: 'Centro-direita' },
  PSOL: { number: 50, name: 'Partido Socialismo e Liberdade', score: 1.453, detailedLabel: 'Extrema esquerda' },
  PSD: { number: 55, name: 'Partido Social Democrático', score: 7.151, detailedLabel: 'Direita' },
  PCDOB: { number: 65, name: 'Partido Comunista do Brasil', score: 1.834, detailedLabel: 'Esquerda', sourceParty: 'PCdoB' },
  AVANTE: { number: 70, name: 'Avante', score: 6.667, detailedLabel: 'Centro-direita' },
  SOLIDARIEDADE: { number: 77, name: 'Solidariedade', score: 6.193, detailedLabel: 'Centro-direita', sourceParty: 'SDD' },
  UP: { number: 80, name: 'Unidade Popular', score: 1.679, detailedLabel: 'Esquerda' },
});

const PARTY_ALIASES = Object.freeze({
  PC_DO_B: 'PCDOB',
  PC_DO_BRASIL: 'PCDOB',
  UNIAO_BRASIL: 'UNIAO',
  SOLIDARIEDADE_77: 'SOLIDARIEDADE',
  PMN: 'MOBILIZA',
  PMB: 'DEMOCRATA',
});

// Paletas de referência da identidade visual pública de cada legenda.
// Elas servem somente para reconhecimento do partido e não representam ideologia.
const PARTY_PALETTES = Object.freeze({
  REPUBLICANOS: { primary: '#073B67', accent: '#F28C28', text: '#FFFFFF', accentText: '#102A43' },
  PP: { primary: '#00529B', accent: '#FFFFFF', text: '#FFFFFF', accentText: '#00529B' },
  PDT: { primary: '#D71920', accent: '#171717', text: '#FFFFFF', accentText: '#FFFFFF' },
  PT: { primary: '#C8102E', accent: '#FFFFFF', text: '#FFFFFF', accentText: '#C8102E' },
  MISSAO: { primary: '#171717', accent: '#F4C300', text: '#FFFFFF', accentText: '#171717' },
  MDB: { primary: '#008A4B', accent: '#F4C300', text: '#FFFFFF', accentText: '#123B2A' },
  PSTU: { primary: '#C8102E', accent: '#171717', text: '#FFFFFF', accentText: '#FFFFFF' },
  REDE: { primary: '#007C83', accent: '#72BF44', text: '#FFFFFF', accentText: '#103B2C' },
  PODE: { primary: '#006B54', accent: '#73B744', text: '#FFFFFF', accentText: '#123B2A' },
  PCB: { primary: '#B5121B', accent: '#F4C300', text: '#FFFFFF', accentText: '#551014' },
  PL: { primary: '#003B70', accent: '#D62828', text: '#FFFFFF', accentText: '#FFFFFF' },
  CIDADANIA: { primary: '#6B2C91', accent: '#F58220', text: '#FFFFFF', accentText: '#FFFFFF' },
  PRD: { primary: '#005CA9', accent: '#F4C300', text: '#FFFFFF', accentText: '#123B2A' },
  DC: { primary: '#164E78', accent: '#F2C94C', text: '#FFFFFF', accentText: '#16324F' },
  PRTB: { primary: '#123B67', accent: '#F4C300', text: '#FFFFFF', accentText: '#123B2A' },
  PCO: { primary: '#B5121B', accent: '#F4C300', text: '#FFFFFF', accentText: '#551014' },
  NOVO: { primary: '#D85B00', accent: '#FFFFFF', text: '#FFFFFF', accentText: '#A84300' },
  MOBILIZA: { primary: '#C8102E', accent: '#5B2C83', text: '#FFFFFF', accentText: '#FFFFFF' },
  DEMOCRATA: { primary: '#072F5F', accent: '#4A90D9', text: '#FFFFFF', accentText: '#FFFFFF' },
  AGIR: { primary: '#0067B1', accent: '#55A9DF', text: '#FFFFFF', accentText: '#102A43' },
  PSB: { primary: '#D85B00', accent: '#FFFFFF', text: '#FFFFFF', accentText: '#A84300' },
  PV: { primary: '#087A3D', accent: '#FFFFFF', text: '#FFFFFF', accentText: '#087A3D' },
  UNIAO: { primary: '#005AA9', accent: '#F4C300', text: '#FFFFFF', accentText: '#123B67' },
  PSDB: { primary: '#00529B', accent: '#F4C300', text: '#FFFFFF', accentText: '#123B67' },
  PSOL: { primary: '#D9471F', accent: '#F4C300', text: '#FFFFFF', accentText: '#6B2517' },
  PSD: { primary: '#003F72', accent: '#18A558', text: '#FFFFFF', accentText: '#FFFFFF' },
  PCDOB: { primary: '#C8102E', accent: '#F4C300', text: '#FFFFFF', accentText: '#551014' },
  AVANTE: { primary: '#005A9C', accent: '#72BF44', text: '#FFFFFF', accentText: '#123B2A' },
  SOLIDARIEDADE: { primary: '#D85B00', accent: '#163B65', text: '#FFFFFF', accentText: '#FFFFFF' },
  UP: { primary: '#171717', accent: '#FFFFFF', text: '#FFFFFF', accentText: '#171717' },
});

const NEUTRAL_PALETTE = Object.freeze({
  primary: '#102A43', accent: '#D9E2EC', text: '#FFFFFF', accentText: '#102A43',
});

const IDEOLOGY_FILTERS = Object.freeze([
  Object.freeze({ value: 'ESQUERDA', label: 'Esquerda', range: '0 a 3' }),
  Object.freeze({ value: 'CENTRO', label: 'Centro (faixa ampla)', range: '3,01 a 7' }),
  Object.freeze({ value: 'DIREITA', label: 'Direita', range: '7,01 a 10' }),
  Object.freeze({ value: 'NAO_CLASSIFICADO', label: 'Sem classificação', range: null }),
]);

function canonicalParty(value) {
  const key = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return PARTY_ALIASES[key] || key;
}

function broadBucket(score) {
  if (!Number.isFinite(score)) return 'NAO_CLASSIFICADO';
  if (score <= 3) return 'ESQUERDA';
  if (score <= 7) return 'CENTRO';
  return 'DIREITA';
}

function ideologyBucketLabel(bucket) {
  return IDEOLOGY_FILTERS.find((item) => item.value === bucket)?.label || 'Sem classificação';
}

function getPartyIdeology(party) {
  const canonical = canonicalParty(party);
  const entry = PARTY_DATA[canonical];
  const score = entry?.score ?? null;
  const bucket = broadBucket(score);
  return {
    bucket,
    bucketLabel: ideologyBucketLabel(bucket),
    detailedLabel: entry?.detailedLabel || 'Sem classificação',
    score,
    sourceParty: entry?.sourceParty || canonical || null,
    continuityNote: entry?.continuityNote || null,
    source: IDEOLOGY_SOURCE,
    candidateCaveat: 'A classificação é do partido na pesquisa acadêmica e não determina a posição individual da candidatura.',
  };
}

function partyVisual(party, suppliedNumber = null, suppliedName = null) {
  const canonical = canonicalParty(party);
  const entry = PARTY_DATA[canonical];
  return {
    sigla: canonical || String(party || '?').toUpperCase().slice(0, 10),
    number: entry?.number ?? suppliedNumber ?? null,
    name: entry?.name || suppliedName || null,
    palette: PARTY_PALETTES[canonical] || NEUTRAL_PALETTE,
  };
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[character]));
}

function partyMarkSvg(party, suppliedNumber = null, suppliedName = null) {
  const visual = partyVisual(party, suppliedNumber, suppliedName);
  const sigla = visual.sigla.slice(0, 10);
  const number = visual.number ?? '—';
  const fontSize = sigla.length <= 4 ? 18 : sigla.length <= 7 ? 13 : 10;
  const title = `Identificação visual do partido ${visual.name || sigla}, número ${number}, nas cores de referência da legenda`;
  const { primary, accent, text, accentText } = visual.palette;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" role="img" aria-labelledby="title"><title id="title">${xmlEscape(title)}</title><defs><clipPath id="card"><rect x="1" y="1" width="70" height="70" rx="15"/></clipPath></defs><g clip-path="url(#card)"><rect x="1" y="1" width="70" height="70" fill="${primary}"/><rect x="1" y="43" width="70" height="28" fill="${accent}"/><path d="M1 43h70" stroke="#FFFFFF" stroke-opacity=".45" stroke-width="1"/></g><rect x="1" y="1" width="70" height="70" rx="15" fill="none" stroke="#102A43" stroke-opacity=".24" stroke-width="2"/><text x="36" y="32" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}" font-weight="800" fill="${text}">${xmlEscape(sigla)}</text><text x="36" y="61" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="900" fill="${accentText}">${xmlEscape(number)}</text></svg>`;
}

module.exports = {
  IDEOLOGY_SOURCE,
  PARTY_DATA,
  PARTY_PALETTES,
  IDEOLOGY_FILTERS,
  canonicalParty,
  broadBucket,
  getPartyIdeology,
  partyVisual,
  partyMarkSvg,
};
