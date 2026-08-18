const fs = require('fs/promises');
const path = require('path');

const SUMMARY_VERSION = 'thematic-v5';
const MAX_PAGES = 350;
const MAX_TEXT_CHARACTERS = 3_000_000;
const MAX_PROPOSALS_PER_THEME = 3;

const THEMES = Object.freeze([
  {
    id: 'educacao',
    label: 'Educação',
    terms: ['educacao', 'escola*', 'ensino*', 'professor*', 'docente*', 'creche*', 'universidade*', 'aluno*', 'estudante*', 'alfabetizacao'],
  },
  {
    id: 'emprego-economia',
    label: 'Emprego e economia',
    terms: ['emprego*', 'renda', 'economia*', 'economico*', 'empreendedor*', 'empresa*', 'trabalho', 'trabalhador*', 'industria*', 'comercio', 'qualificacao profissional', 'desenvolvimento produtivo'],
  },
  {
    id: 'tecnologia-inovacao',
    label: 'Tecnologia e inovação',
    terms: ['tecnologia*', 'inovacao', 'inteligencia artificial', 'conectividade', 'internet', 'digital*', 'pesquisa cientifica', 'ciencia', 'startup*', 'dados abertos'],
  },
  {
    id: 'gestao-transparencia',
    label: 'Gestão e transparência',
    terms: ['gestao publica', 'administracao publica', 'transparencia', 'corrupcao', 'governanca', 'servico publico', 'eficiencia administrativa', 'auditoria', 'controladoria', 'participacao social', 'controle social', 'dados abertos', 'governo digital', 'planejamento'],
  },
  {
    id: 'saude',
    label: 'Saúde',
    terms: ['saude', 'hospital*', 'atencao basica', 'sus', 'medic*', 'upa', 'fila de atendimento', 'vacin*', 'saude mental', 'unidade de saude'],
  },
  {
    id: 'mobilidade-infraestrutura',
    label: 'Mobilidade e infraestrutura',
    terms: ['mobilidade', 'transporte*', 'metro', 'trem*', 'rodovia*', 'ferrovia*', 'infraestrutura', 'saneamento', 'obra*', 'estrada*', 'aeroporto*', 'porto*', 'transito', 'logistica', 'abastecimento de agua'],
  },
  {
    id: 'protecao-social',
    label: 'Proteção social',
    terms: ['assistencia social', 'protecao social', 'pobreza', 'fome', 'vulnerab*', 'inclusao social', 'direitos humanos', 'seguranca alimentar', 'transferencia de renda', 'mulher*', 'idoso*', 'pessoa com deficiencia', 'crianca*', 'adolescente*', 'populacao de rua', 'igualdade racial', 'lgbt*'],
  },
  {
    id: 'cultura-esporte-turismo',
    label: 'Cultura, esporte e turismo',
    terms: ['cultura*', 'esporte*', 'turismo', 'patrimonio cultural', 'lazer', 'artista*', 'audiovisual', 'museu*'],
  },
  {
    id: 'seguranca-publica-crime-organizado',
    label: 'Segurança pública e combate ao crime organizado',
    terms: ['seguranca publica', 'seguranca cidada', 'violencia', 'homicidio*', 'faccao*', 'crime organizado', 'organizacao criminosa', 'milicia*', 'trafico de drogas', 'narcotrafico', 'policia*', 'forca de seguranca', 'inteligencia policial', 'investigacao criminal', 'sistema prisional', 'penitenciari*', 'presidio*', 'ressocializacao', 'guarda municipal', 'prevencao da violencia', 'combate ao crime'],
  },
]);

const ACTION_TERMS = [
  'ampli*', 'assegur*', 'aumentar', 'capacit*', 'constru*', 'criar', 'criacao', 'defender', 'defendemos',
  'desenvolv*', 'destin*', 'estabelec*', 'estimular', 'expandir', 'fomentar', 'fortalec*',
  'garant*', 'implant*', 'implement*', 'incentiv*', 'integr*', 'invest*', 'moderniz*',
  'oferecer', 'pretend*', 'prioriz*', 'promov*', 'propomos', 'propor', 'qualific*', 'recuper*', 'reduz*',
  'reform*', 'regulament*', 'universaliz*', 'combat*', 'desarticul*', 'enfrent*', 'preven*', 'reprim*',
  'meta', 'objetivo', 'programa', 'projeto', 'proposta',
];

const LOW_VALUE_PATTERNS = [
  /\bvote\b/i,
  /\bcandidato(?:a)?\b/i,
  /\badvers[aá]ri/i,
  /\bpesquisa eleitoral\b/i,
  /\bpromessas? eleitorais\b/i,
  /\b(?:este|o presente) (?:documento|plano)\b/i,
  /\bconjunto de propostas\b/i,
  /\bsum[aá]rio\b/i,
  /\.{5,}/,
];

function searchable(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePdfText(value) {
  return String(value || '')
    .replace(/(?<![A-ZÀ-ÖØ-Ý])[A-ZÀ-ÖØ-Ý](?: [A-ZÀ-ÖØ-Ý])+(?![A-ZÀ-ÖØ-Ý])/gu, (match) => match.replace(/ /g, ''))
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/ +/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collapseDuplicatedLine(value) {
  const text = normalizePdfText(value);
  const duplicated = text.match(/^(.{4,}?)\s+\1$/iu);
  return duplicated ? duplicated[1].trim() : text;
}

function containsTerm(normalizedSentence, configuredTerm) {
  const stemmed = configuredTerm.endsWith('*');
  const term = stemmed ? configuredTerm.slice(0, -1) : configuredTerm;
  if (!term) return false;
  if (term.includes(' ')) return ` ${normalizedSentence} `.includes(` ${term} `);
  const words = normalizedSentence.split(' ');
  return stemmed ? words.some((word) => word.startsWith(term)) : words.includes(term);
}

function themeHits(normalizedSentence) {
  return THEMES.map((theme) => ({
    ...theme,
    hits: theme.terms.reduce((total, term) => total + (containsTerm(normalizedSentence, term) ? 1 : 0), 0),
  })).filter((theme) => theme.hits > 0);
}

function sentenceCandidates(text) {
  const normalizedText = normalizePdfText(text);
  if (!normalizedText) return [];
  return normalizedText.replace(/\n+/g, ' ')
    .split(/(?<=[.!?;])\s+(?=[A-ZÀ-ÖØ-Ý0-9])|\s+[•·]\s+/u)
    .map((sentence) => sentence.replace(/^[-–—•·\d.)\s]+/, '').replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 45 && sentence.length <= 520)
    .filter((sentence) => !LOW_VALUE_PATTERNS.some((pattern) => pattern.test(sentence)));
}

function cleanSectionTitle(value) {
  return normalizePdfText(value)
    .replace(/^[-–—•·\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110);
}

function pageLines(page) {
  if (Array.isArray(page.lines) && page.lines.length) {
    return page.lines
      .map((line) => ({ text: cleanSectionTitle(line.text), fontSize: Number(line.fontSize) || 0 }))
      .filter((line) => line.text);
  }
  return normalizePdfText(page.text).split(/\n+/)
    .map((text) => ({ text: cleanSectionTitle(text), fontSize: 0 }))
    .filter((line) => line.text);
}

function median(values) {
  const sorted = values.filter((value) => value > 0).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function recurringLineKeys(pages) {
  const occurrences = new Map();
  for (const page of pages) {
    const seen = new Set(pageLines(page)
      .map((line) => searchable(line.text))
      .filter((line) => line.length >= 4 && line.length <= 100));
    for (const line of seen) occurrences.set(line, (occurrences.get(line) || 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.35));
  return new Set([...occurrences.entries()].filter(([, count]) => count >= threshold).map(([line]) => line));
}

function isLikelySectionHeading(line, medianFontSize, recurring) {
  const text = cleanSectionTitle(line.text);
  const normalized = searchable(text);
  if (!normalized || text.length < 3 || text.length > 110 || recurring.has(normalized)) return false;
  if (/^(?:pagina|page)\s+\d+$/i.test(normalized) || /^\d+$/.test(normalized)) return false;
  if (/^(?:plano|programa|proposta)\s*de\s*governo(?:\s+\d{1,4})?$/i.test(normalized)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 14 || LOW_VALUE_PATTERNS.some((pattern) => pattern.test(text))) return false;
  const letters = text.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || [];
  const uppercase = text.match(/[A-ZÀ-ÖØ-Ý]/g) || [];
  const uppercaseRatio = letters.length ? uppercase.length / letters.length : 0;
  const numericPrefix = text.match(/^(\d+(?:\.\d+)*)([.):–—-]?)(?:\s+)\S+/);
  const numericSegments = numericPrefix?.[1]?.split('.') || [];
  const numberedNumeric = Boolean(numericPrefix) && (
    Boolean(numericPrefix[2])
    || (numericSegments.length > 1 && numericSegments.slice(1).every((segment) => segment.length <= 2))
  ) && Number(numericSegments[0]) <= 100;
  const numberedRoman = /^[IVXLCDM]+[.):–—-]?\s+\S+/i.test(text);
  const numbered = numberedNumeric || numberedRoman;
  if (/[.!?]\s*$/.test(text) && !numbered) return false;
  const visuallyLarger = medianFontSize > 0 && line.fontSize >= medianFontSize * 1.18;
  const exactThemeHeading = THEMES.some((theme) => {
    const label = searchable(theme.label);
    return normalized === label || (normalized.startsWith(`${label} `) && uppercaseRatio >= 0.55);
  });
  const visuallyHeadingLike = visuallyLarger && uppercaseRatio >= 0.45;
  return numbered || exactThemeHeading || visuallyHeadingLike || (uppercaseRatio >= 0.72 && words.length <= 10);
}

function sentenceRecordsForPage(page, inheritedSection, recurring) {
  const lines = pageLines(page);
  const medianFontSize = median(lines.map((line) => line.fontSize));
  let section = inheritedSection || null;
  let buffer = [];
  let headingBuffer = [];
  const records = [];
  const flush = () => {
    if (!buffer.length) return;
    for (const sentence of sentenceCandidates(buffer.join(' '))) records.push({ sentence, section });
    buffer = [];
  };
  const commitHeading = () => {
    if (!headingBuffer.length) return;
    section = cleanSectionTitle(headingBuffer.join(' '));
    headingBuffer = [];
  };
  for (const line of lines) {
    if (isLikelySectionHeading(line, medianFontSize, recurring)) {
      flush();
      headingBuffer.push(line.text);
    } else {
      commitHeading();
      buffer.push(line.text);
    }
  }
  flush();
  commitHeading();
  return { records, lastSection: section };
}

function scoreSentence(sentence, pageNumber, section) {
  const normalized = searchable(sentence);
  const actionHits = ACTION_TERMS.reduce((total, term) => total + (containsTerm(normalized, term) ? 1 : 0), 0);
  const themes = themeHits(normalized);
  if (!actionHits || !themes.length) return null;
  const numericBonus = /\b\d+[\d.,%]*\b/.test(sentence) ? 1 : 0;
  const lengthBonus = sentence.length >= 90 && sentence.length <= 380 ? 2 : 0;
  return {
    sentence,
    page: pageNumber,
    section: section || null,
    themes,
    score: actionHits * 3 + themes.reduce((sum, theme) => sum + theme.hits * 2, 0) + numericBonus + lengthBonus,
    normalized,
  };
}

function tokenSet(value) {
  return new Set(searchable(value).split(' ').filter((token) => token.length > 3));
}

function similarity(left, right) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / Math.min(leftTokens.size, rightTokens.size);
}

function displayPoint(sentence) {
  const cleaned = sentence.replace(/^(OBJETIVO|META|PROPOSTA|A[CÇ][AÃ]O)\s+/i, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 420) return cleaned;
  const shortened = cleaned.slice(0, 417);
  const boundary = Math.max(shortened.lastIndexOf(';'), shortened.lastIndexOf('.'), shortened.lastIndexOf(','));
  const finalBoundary = boundary > 240 ? boundary : shortened.lastIndexOf(' ');
  return `${shortened.slice(0, finalBoundary).trim()}…`;
}

function proposalsForTheme(theme, candidates) {
  const ranked = candidates
    .filter((candidate) => candidate.themes.some((candidateTheme) => candidateTheme.id === theme.id))
    .sort((left, right) => {
      const leftHits = left.themes.find((candidateTheme) => candidateTheme.id === theme.id)?.hits || 0;
      const rightHits = right.themes.find((candidateTheme) => candidateTheme.id === theme.id)?.hits || 0;
      return (rightHits * 10 + right.score) - (leftHits * 10 + left.score) || left.page - right.page;
    });
  const selected = [];
  for (const candidate of ranked) {
    if (selected.every((item) => similarity(item.sentence, candidate.sentence) < 0.58)) selected.push(candidate);
    if (selected.length === MAX_PROPOSALS_PER_THEME) break;
  }
  return selected.map((candidate, index) => ({
    id: `${theme.id}-${candidate.page}-${index + 1}`,
    text: displayPoint(candidate.sentence),
    page: candidate.page,
    section: candidate.section,
    extraction: 'EXTRACTIVE',
  }));
}

function summarizeExtractedPages(pages, metadata = {}) {
  const candidates = [];
  const recurring = recurringLineKeys(pages);
  for (const page of pages) {
    const parsed = sentenceRecordsForPage(page, null, recurring);
    for (const record of parsed.records) {
      const scored = scoreSentence(record.sentence, page.page, record.section);
      if (scored) candidates.push(scored);
    }
  }

  const themeSummaries = THEMES.map((theme) => {
    const proposals = proposalsForTheme(theme, candidates);
    const matching = candidates.filter((candidate) => candidate.themes.some((candidateTheme) => candidateTheme.id === theme.id));
    const pagesFound = [...new Set(proposals.map((proposal) => proposal.page))].sort((left, right) => left - right);
    const sections = [...new Set(proposals.map((proposal) => proposal.section).filter(Boolean))];
    return {
      id: theme.id,
      label: theme.label,
      status: proposals.length ? 'FOUND' : 'NOT_IDENTIFIED',
      proposalCount: proposals.length,
      mentionCount: matching.length,
      pages: pagesFound,
      sections,
      proposals,
    };
  });

  const foundThemes = themeSummaries.filter((theme) => theme.status === 'FOUND');
  const pagesWithText = pages.filter((page) => normalizePdfText(page.text).length >= 40).length;
  const mainPoints = foundThemes.map((theme) => ({
    id: theme.proposals[0].id,
    title: theme.label,
    ...theme.proposals[0],
  }));

  return {
    available: foundThemes.length > 0,
    summaryType: 'AUTOMATIC_THEMATIC_EXTRACTIVE',
    version: SUMMARY_VERSION,
    document: {
      pages: metadata.pages || pages.length,
      pagesProcessed: pages.length,
      pagesWithText,
      textCoveragePercent: pages.length ? Math.round((pagesWithText / pages.length) * 100) : 0,
    },
    taxonomy: THEMES.map(({ id, label }) => ({ id, label })),
    themeSummaries,
    areas: themeSummaries.map(({ id, label, status, proposalCount, mentionCount }) => ({ id, label, status, proposalCount, mentions: mentionCount })),
    mainPoints,
    overview: foundThemes.length
      ? `${foundThemes.length} de ${THEMES.length} temas têm trechos de proposta identificados automaticamente: ${foundThemes.map((theme) => theme.label.toLowerCase()).join(', ')}.`
      : `Nenhum trecho de proposta foi identificado automaticamente nos ${THEMES.length} temas definidos.`,
    notice: 'Trechos extraídos do próprio PDF e classificados por vocabulário temático e linguagem de ação. A ausência de trecho identificado não comprova que o tema esteja ausente do documento. O sistema não avalia viabilidade, custo, benefício, prioridade nem chance de cumprimento.',
    methodology: {
      maxProposalsPerTheme: MAX_PROPOSALS_PER_THEME,
      sectionRule: 'O capítulo ou seção só é informado quando um título reconhecível aparece antes do trecho na mesma página extraída; caso contrário, apenas a página é exibida.',
      missingRule: 'NOT_IDENTIFIED significa que o classificador não encontrou um trecho com tema e linguagem de proposta, não que o candidato não possua posição sobre o assunto.',
    },
  };
}

function linesFromTextContent(items) {
  const lines = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    const text = collapseDuplicatedLine(current.parts.join(' '));
    if (text) lines.push({ text, fontSize: current.fontSize });
    current = null;
  };
  for (const item of items) {
    const text = String(item.str || '').trim();
    if (!text) {
      if (item.hasEOL) flush();
      continue;
    }
    const y = Number(item.transform?.[5]);
    const fontSize = Math.abs(Number(item.transform?.[3])) || 0;
    if (current && Number.isFinite(y) && Number.isFinite(current.y) && Math.abs(y - current.y) > 2.5) flush();
    if (!current) current = { parts: [], fontSize: 0, y };
    current.parts.push(text);
    current.fontSize = Math.max(current.fontSize, fontSize);
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

async function extractPdfPages(buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  });
  const document = await loadingTask.promise;
  const totalPages = Math.min(document.numPages, MAX_PAGES);
  const pages = [];
  let totalCharacters = 0;
  try {
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = linesFromTextContent(content.items);
      const fallbackText = content.items.map((item) => `${item.str || ''}${item.hasEOL ? '\n' : ' '}`).join('');
      const text = lines.length ? lines.map((line) => line.text).join('\n') : fallbackText;
      totalCharacters += text.length;
      pages.push({ page: pageNumber, text: text.slice(0, 60_000), lines });
      page.cleanup();
      if (totalCharacters >= MAX_TEXT_CHARACTERS) break;
    }
    return { pages, totalPages: document.numPages };
  } finally {
    await document.destroy();
  }
}

class GovernmentPlanSummaryService {
  constructor(config, governmentPlanService) {
    this.config = config;
    this.governmentPlanService = governmentPlanService;
    this.directory = path.join(config.dataDir, 'government-plan-summaries');
    this.memory = new Map();
    this.pending = new Map();
  }

  cachePath(sha256) {
    return path.join(this.directory, `${sha256}.${SUMMARY_VERSION}.json`);
  }

  async readCache(sha256) {
    try {
      return JSON.parse(await fs.readFile(this.cachePath(sha256), 'utf8'));
    } catch {
      return null;
    }
  }

  async saveCache(sha256, data) {
    await fs.mkdir(this.directory, { recursive: true });
    const target = this.cachePath(sha256);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(data), 'utf8');
    await fs.rename(temporary, target);
  }

  async get(candidate) {
    const plan = await this.governmentPlanService.get(candidate);
    if (!plan) return null;
    if (this.memory.has(plan.sha256)) return this.memory.get(plan.sha256);
    if (this.pending.has(plan.sha256)) return this.pending.get(plan.sha256);

    const pending = (async () => {
      const cached = await this.readCache(plan.sha256);
      if (cached?.version === SUMMARY_VERSION) return cached;
      const extracted = await extractPdfPages(plan.buffer);
      const summary = {
        ...summarizeExtractedPages(extracted.pages, { pages: extracted.totalPages }),
        documentSha256: plan.sha256,
        generatedAt: new Date().toISOString(),
        source: plan.source,
      };
      await this.saveCache(plan.sha256, summary).catch(() => {});
      return summary;
    })();
    this.pending.set(plan.sha256, pending);
    try {
      const summary = await pending;
      this.memory.set(plan.sha256, summary);
      return summary;
    } finally {
      this.pending.delete(plan.sha256);
    }
  }
}

module.exports = {
  GovernmentPlanSummaryService,
  extractPdfPages,
  summarizeExtractedPages,
  normalizePdfText,
  SUMMARY_VERSION,
  THEMES,
};
