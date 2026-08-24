const fs = require('fs/promises');
const path = require('path');
const { createLocalLlmSummary, completeGeneratedSentence, buildGeneralObjective } = require('./plan-llm-analysis');
const {
  LOCAL_LLM_ANALYSIS_VERSION,
  LOCAL_LLM_PROMPT_VERSION,
} = require('./local-llm');

const SUMMARY_VERSION = 'thematic-v8';
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
  'garant*', 'implant*', 'implement*', 'incentiv*', 'institu*', 'integr*', 'invest*', 'moderniz*',
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

// Prefixes and first terms that normally keep a real hyphen in Portuguese.
// Everything else separated specifically by a PDF line break is treated as a
// word interrupted by layout (for example, "infraestru-\ntura").
const PRESERVED_HYPHEN_PREFIXES = new Set([
  'afro', 'agro', 'alem', 'alto', 'anglo', 'anti', 'auto', 'baixo', 'bem', 'co', 'contra',
  'curto', 'extra', 'franco', 'greco', 'guarda', 'ibero', 'infra', 'inter', 'intra',
  'latino', 'livre', 'longo', 'luso', 'macro', 'mais', 'materia', 'materias', 'meio', 'micro',
  'mini', 'multi', 'nao', 'neo', 'pos', 'pre', 'pro', 'pseudo', 'publico', 'recem', 'salario',
  'semi', 'sem', 'socio', 'social', 'sub', 'super', 'supra', 'tecnico', 'ultra', 'vice',
]);

const PRESERVED_HYPHEN_CLITICS = new Set([
  'a', 'as', 'la', 'las', 'lhe', 'lhes', 'lo', 'los', 'me', 'na', 'nas', 'no', 'nos', 'o', 'os', 'se', 'te', 'vos',
]);

const PRESERVED_EX_HYPHEN_TARGETS = new Set([
  'aluno', 'aluna', 'candidato', 'candidata', 'companheiro', 'companheira', 'deputado', 'deputada',
  'diretor', 'diretora', 'governador', 'governadora', 'marido', 'ministro', 'ministra', 'mulher',
  'prefeito', 'prefeita', 'presidente', 'secretario', 'secretaria', 'senador', 'senadora', 'socio', 'socia',
]);

// PDF font maps sometimes split the first letter from a proposal verb. We
// only join known words so ordinary phrases such as "A proposta" remain
// untouched.
const PDF_SPLIT_INITIAL_WORDS = new Set([
  'implementar', 'implantacao', 'implantacoes', 'implantar', 'incentivar', 'integrar', 'investir',
  'instituicao', 'instituicoes', 'instituir',
]);

function searchable(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedWord(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function joinPdfHyphenatedWord(left, right) {
  const preserveHyphen = PRESERVED_HYPHEN_PREFIXES.has(normalizedWord(left))
    || PRESERVED_HYPHEN_CLITICS.has(normalizedWord(right))
    || (normalizedWord(left) === 'ex' && PRESERVED_EX_HYPHEN_TARGETS.has(normalizedWord(right)));
  return preserveHyphen ? `${left}-${right}` : `${left}${right}`;
}

function joinKnownSplitInitialWord(match, initial, remainder) {
  const joined = `${initial}${remainder}`;
  return PDF_SPLIT_INITIAL_WORDS.has(normalizedWord(joined)) ? joined : match;
}

function normalizePdfText(value) {
  return String(value || '')
    .normalize('NFC')
    // Keep line breaks, but discard codes that cannot represent visible text.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
    // Embedded icon fonts can be decoded as a short false token such as
    // "Co☼" before the actual text. Remove the complete malformed token at a
    // sentence/line boundary instead of leaving its letters in the proposal.
    .replace(/(^|[\n.!?;]\s*)[\p{L}\p{N}]{0,4}[\p{So}\p{Co}\uFFFD][\p{L}\p{N}\p{So}\p{Co}\uFFFD]{0,4}\s*/gu, '$1')
    .replace(/[\p{Cf}\p{Co}\uFFFD\uFFF0-\uFFFF]/gu, ' ')
    // Other pictographic glyphs are layout markers, not proposal content.
    .replace(/\p{So}/gu, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/(\p{Lu}{2,})-[ \t]*\n[ \t]*(\p{Lu}{2,})/gu, '$1$2')
    .replace(/(\p{L}[\p{L}\p{M}]{1,})-[ \t]*\n[ \t]*(\p{Ll}[\p{L}\p{M}]*)/gu,
      (match, left, right) => joinPdfHyphenatedWord(left, right))
    .replace(/(?<![A-ZÀ-ÖØ-Ý])[A-ZÀ-ÖØ-Ý](?: [A-ZÀ-ÖØ-Ý])+(?![A-ZÀ-ÖØ-Ý])/gu, (match) => match.replace(/ /g, ''))
    .replace(/\b(\p{Lu})[ \t]+(\p{Ll}[\p{L}\p{M}]{2,})\b/gu, joinKnownSplitInitialWord)
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/ +/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizePublicProposal(proposal) {
  if (!proposal || typeof proposal !== 'object') return proposal;
  const normalized = { ...proposal };
  for (const field of ['text', 'title', 'summary', 'potentialImpact', 'conditionsAndLimits', 'section']) {
    if (typeof normalized[field] === 'string') normalized[field] = normalizePdfText(normalized[field]);
  }
  for (const field of ['audience', 'requirements', 'indicators']) {
    if (Array.isArray(normalized[field])) normalized[field] = normalized[field].map(normalizePdfText).filter(Boolean);
  }
  if (Array.isArray(normalized.evidences)) {
    normalized.evidences = normalized.evidences.map((evidence) => ({
      ...evidence,
      quote: typeof evidence?.quote === 'string' ? normalizePdfText(evidence.quote) : evidence?.quote,
    }));
  }
  return normalized;
}

function cleanSentenceStart(value) {
  return String(value || '')
    .replace(/^\s*(?:(?:[-–—•·▪◦●■□]+)|(?:\(?\d{1,3}(?:(?:[.)]|[-–—])\s*|\s+(?=[A-ZÀ-ÖØ-Ý]))))+\s*/u, '')
    .replace(/^\d{1,2}\s+(?!(?:anos?|bilh(?:ão|ões)|dias?|meses?|mil|milh(?:ão|ões)|por cento|reais?)\b)/iu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function startsAtCompletePoint(value) {
  const significant = String(value || '').replace(/^[\s\p{P}\p{S}]+/u, '');
  if (!significant) return false;
  if (/^\p{N}/u.test(significant) || /^e-[A-ZÀ-ÖØ-Ý]/u.test(significant)) return true;
  const firstLetter = significant.match(/\p{L}/u)?.[0];
  return Boolean(firstLetter) && firstLetter === firstLetter.toLocaleUpperCase('pt-BR');
}

function endsAtCompletePoint(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return !/\b(?:a|as|com|da|das|de|do|dos|e|em|entre|o|os|para|pela|pelas|pelo|pelos|por|que|um|uma)$/iu.test(text);
}

function capitalizeInitial(value) {
  const text = String(value || '');
  const match = text.match(/\p{L}/u);
  if (!match || match.index === undefined) return text;
  const initial = match[0].toLocaleUpperCase('pt-BR');
  return `${text.slice(0, match.index)}${initial}${text.slice(match.index + match[0].length)}`;
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
  return normalizedText
    .split(/(?<=[.!?;])\s+(?=[A-ZÀ-ÖØ-Ý0-9])|\n+(?=\s*\d{1,3}\s+[A-ZÀ-ÖØ-Ý])|\s+[•·]\s+/u)
    .map((sentence) => cleanSentenceStart(sentence.replace(/\n+/g, ' ')))
    .filter((sentence) => sentence.length >= 45 && sentence.length <= 520)
    // A lowercase beginning usually means the page started in the middle of a sentence.
    .filter(startsAtCompletePoint)
    // A connector left at the end usually means the sentence continued on the next page.
    .filter(endsAtCompletePoint)
    .filter((sentence) => !LOW_VALUE_PATTERNS.some((pattern) => pattern.test(sentence)));
}

function cleanPdfLine(value) {
  return normalizePdfText(value)
    .replace(/^[-–—•·\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSectionTitle(value) {
  return cleanPdfLine(value).slice(0, 110);
}

function removePageNumberSuffix(value, pageNumber) {
  const text = cleanPdfLine(value);
  const digits = String(Number(pageNumber) || '').split('').filter(Boolean);
  if (!digits.length) return text;
  const spacedPageNumber = digits.join('\\s*');
  return text.replace(new RegExp(`\\s+${spacedPageNumber}\\s*$`, 'u'), '').trim();
}

function pageLines(page) {
  let lines;
  if (Array.isArray(page.lines) && page.lines.length) {
    lines = page.lines
      .map((line) => ({ text: removePageNumberSuffix(line.text, page.page), fontSize: Number(line.fontSize) || 0 }))
      .filter((line) => line.text);
  } else {
    lines = normalizePdfText(page.text).split(/\n+/)
      .map((text) => ({ text: cleanPdfLine(text), fontSize: 0 }))
      .filter((line) => line.text);
  }
  return lines.filter((line, index) => !(
    /^\d{1,3}$/.test(line.text)
    && (index < 2 || index >= lines.length - 2)
  ));
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
    for (const sentence of sentenceCandidates(buffer.join('\n'))) records.push({ sentence, section });
    buffer = [];
  };
  const commitHeading = () => {
    if (!headingBuffer.length) return;
    section = cleanSectionTitle(headingBuffer.join(' '));
    headingBuffer = [];
  };
  for (const line of lines) {
    if (recurring.has(searchable(line.text))) {
      flush();
      headingBuffer = [];
      continue;
    }
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
  const withoutLabel = sentence.replace(/^(OBJETIVO|META|PROPOSTA|A[CÇ][AÃ]O)\s+(?!(?:da|das|de|do|dos)\b)/i, '');
  const cleaned = capitalizeInitial(cleanSentenceStart(withoutLabel));
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
      textNormalizationRule: 'A exibição remove códigos inválidos de fonte, recompõe palavras interrompidas por quebra de linha e descarta fragmentos que começam no meio de uma frase. O conteúdo político não é reescrito.',
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
  constructor(config, governmentPlanService, store, localLlmClient) {
    this.config = config;
    this.governmentPlanService = governmentPlanService;
    this.store = store;
    this.localLlmClient = localLlmClient;
    this.directory = path.join(config.dataDir, 'government-plan-summaries');
    this.memory = new Map();
    this.pending = new Map();
    this.llmQueue = [];
    this.queuedLlmDocuments = new Set();
    this.llmWorkerRunning = false;
    this.precomputeRunning = false;
    this.precomputeScannedCandidates = 0;
    this.precomputeEligibleCandidates = 0;
    this.precomputeCompletedAt = null;
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

  publicAnalysisPayload(payload) {
    const themeSummaries = (payload?.themeSummaries || []).map((theme) => ({
      ...theme,
      proposals: (theme.proposals || []).map(normalizePublicProposal),
      sections: (theme.sections || []).map(normalizePdfText).filter(Boolean),
      digest: theme.digest ? normalizePublicProposal({
        ...theme.digest,
        summary: completeGeneratedSentence(theme.digest.summary, 540),
        potentialImpact: completeGeneratedSentence(theme.digest.potentialImpact, 560),
        conditionsAndLimits: completeGeneratedSentence(theme.digest.conditionsAndLimits, 420),
      }) : theme.digest,
    }));
    return {
      ...payload,
      candidateObjective: buildGeneralObjective(themeSummaries) || payload?.candidateObjective,
      themeSummaries,
    };
  }

  async withAnalysisState(sha256, summary, storedAnalysis = undefined) {
    if (!summary) return null;
    if (!this.localLlmClient?.isEnabled()) {
      return { ...this.publicAnalysisPayload(summary), aiAnalysis: { status: 'DISABLED', local: true } };
    }
    const stored = storedAnalysis === undefined
      ? await this.store?.getGovernmentPlanAnalysis?.(sha256, LOCAL_LLM_ANALYSIS_VERSION)
      : storedAnalysis;
    if (stored?.status === 'READY' && stored.payload?.aiAnalysis?.analysisVersion === LOCAL_LLM_ANALYSIS_VERSION) {
      return this.publicAnalysisPayload(stored.payload);
    }
    if (summary.aiAnalysis?.status === 'READY'
      && summary.aiAnalysis?.analysisVersion === LOCAL_LLM_ANALYSIS_VERSION) return this.publicAnalysisPayload(summary);
    const progress = stored?.payload?.aiAnalysis || {};
    return {
      ...this.publicAnalysisPayload(summary),
      aiAnalysis: {
        status: stored?.status || 'QUEUED',
        local: true,
        model: stored?.model || this.config.localLlmModel,
        analysisVersion: LOCAL_LLM_ANALYSIS_VERSION,
        promptVersion: stored?.promptVersion || LOCAL_LLM_PROMPT_VERSION,
        stage: progress.stage || (stored?.status === 'PROCESSING' ? 'PREPARING' : 'WAITING'),
        completed: Number(progress.completed) || 0,
        total: Number(progress.total) || 1,
        attempts: Number(stored?.attempts) || 0,
        updatedAt: stored?.updatedAt || null,
      },
    };
  }

  async readReadyAnalysis(sha256) {
    const stored = await this.store?.getGovernmentPlanAnalysis?.(sha256, LOCAL_LLM_ANALYSIS_VERSION);
    if (stored?.status === 'READY' && stored.payload?.aiAnalysis?.analysisVersion === LOCAL_LLM_ANALYSIS_VERSION) {
      return this.publicAnalysisPayload(stored.payload);
    }
    const cached = await this.readCache(sha256);
    if (cached?.version !== SUMMARY_VERSION) return null;
    return this.withAnalysisState(sha256, cached, stored);
  }

  async analysisAttempts(sha256) {
    const stored = await this.store?.getGovernmentPlanAnalysis?.(sha256, LOCAL_LLM_ANALYSIS_VERSION);
    return Number(stored?.attempts) || 0;
  }

  queueLocalAnalysis(candidate, sha256, fallbackSummary, priority = 'interactive') {
    if (!this.localLlmClient?.isEnabled()) return;
    if (this.queuedLlmDocuments.has(sha256)) {
      if (priority === 'interactive') {
        const index = this.llmQueue.findIndex((job) => job.sha256 === sha256);
        if (index > 0) this.llmQueue.unshift(...this.llmQueue.splice(index, 1));
      }
      return;
    }
    if (fallbackSummary.aiAnalysis?.status === 'READY'
      && fallbackSummary.aiAnalysis?.analysisVersion === LOCAL_LLM_ANALYSIS_VERSION) return;
    this.queuedLlmDocuments.add(sha256);
    const job = { candidate, sha256, fallbackSummary };
    if (priority === 'background') this.llmQueue.push(job);
    else this.llmQueue.unshift(job);
    setImmediate(() => this.runLlmQueue());
  }

  async runLlmQueue() {
    if (this.llmWorkerRunning || !this.localLlmClient?.isEnabled()) return;
    this.llmWorkerRunning = true;
    try {
      while (this.llmQueue.length) {
        const job = this.llmQueue.shift();
        try {
          await this.processLocalAnalysis(job);
        } catch (error) {
          console.error(`Falha na análise local do plano ${job.sha256.slice(0, 12)}:`, error.message);
          if (error.code === 'LOCAL_LLM_NOT_READY') {
            this.llmQueue.length = 0;
            this.queuedLlmDocuments.clear();
            break;
          }
        } finally {
          this.queuedLlmDocuments.delete(job.sha256);
        }
      }
    } finally {
      this.llmWorkerRunning = false;
    }
  }

  async processLocalAnalysis(job) {
    await this.localLlmClient.waitUntilReady();
    const attempts = await this.analysisAttempts(job.sha256);
    if (attempts >= 3) {
      await this.store?.saveGovernmentPlanAnalysis?.({
        documentSha256: job.sha256,
        analysisVersion: LOCAL_LLM_ANALYSIS_VERSION,
        status: 'FAILED',
        model: this.config.localLlmModel,
        promptVersion: LOCAL_LLM_PROMPT_VERSION,
        error: 'Limite de três tentativas atingido. Os trechos oficiais permanecem disponíveis.',
        attempts,
      });
      return;
    }
    const saveProgress = async ({ stage, completed = 0, total = 1 }) => this.store?.saveGovernmentPlanAnalysis?.({
      documentSha256: job.sha256,
      analysisVersion: LOCAL_LLM_ANALYSIS_VERSION,
      status: 'PROCESSING',
      model: this.config.localLlmModel,
      promptVersion: LOCAL_LLM_PROMPT_VERSION,
      payload: {
        aiAnalysis: {
          status: 'PROCESSING',
          local: true,
          model: this.config.localLlmModel,
          analysisVersion: LOCAL_LLM_ANALYSIS_VERSION,
          promptVersion: LOCAL_LLM_PROMPT_VERSION,
          stage,
          completed,
          total,
        },
      },
      attempts: attempts + 1,
    });
    await saveProgress({ stage: 'PREPARING' });
    try {
      const plan = await this.governmentPlanService.get(job.candidate);
      if (!plan || plan.sha256 !== job.sha256) throw new Error('O documento oficial mudou antes da análise local.');
      const extracted = await extractPdfPages(plan.buffer);
      const analysisFallback = {
        ...summarizeExtractedPages(extracted.pages, { pages: extracted.totalPages }),
        documentSha256: plan.sha256,
        generatedAt: new Date().toISOString(),
        source: plan.source,
      };
      await saveProgress({ stage: 'SELECTING_EVIDENCE' });
      const enhanced = {
        ...await createLocalLlmSummary({
          pages: extracted.pages,
          fallbackSummary: analysisFallback,
          client: this.localLlmClient,
          themes: THEMES,
          config: this.config,
          candidateName: job.candidate.ballotName || job.candidate.name,
          onProgress: saveProgress,
        }),
        documentSha256: plan.sha256,
        source: plan.source,
      };
      await Promise.all([
        this.saveCache(plan.sha256, enhanced),
        this.store?.saveGovernmentPlanAnalysis?.({
          documentSha256: plan.sha256,
          analysisVersion: LOCAL_LLM_ANALYSIS_VERSION,
          status: 'READY',
          model: this.config.localLlmModel,
          promptVersion: LOCAL_LLM_PROMPT_VERSION,
          payload: enhanced,
          attempts: attempts + 1,
        }),
      ]);
      this.memory.set(plan.sha256, enhanced);
    } catch (error) {
      await this.store?.saveGovernmentPlanAnalysis?.({
        documentSha256: job.sha256,
        analysisVersion: LOCAL_LLM_ANALYSIS_VERSION,
        status: 'FAILED',
        model: this.config.localLlmModel,
        promptVersion: LOCAL_LLM_PROMPT_VERSION,
        error: String(error.message || error).slice(0, 1000),
        attempts: attempts + 1,
      });
      throw error;
    }
  }

  async precomputeCandidates(candidates) {
    if (!this.config.localLlmPrecomputeOnStart || !this.localLlmClient?.isEnabled() || this.precomputeRunning) return;
    this.precomputeRunning = true;
    try {
      const eligible = (Array.isArray(candidates) ? candidates : [])
        .filter((candidate) => ['PRESIDENTE', 'GOVERNADOR'].includes(String(candidate.office || '').toUpperCase()))
        .slice(0, this.config.localLlmPrecomputeLimit);
      this.precomputeEligibleCandidates = eligible.length;
      this.precomputeScannedCandidates = 0;
      for (const candidate of eligible) {
        try {
          await this.get(candidate, { background: true });
        } catch (error) {
          console.error(`Plano não preparado para ${candidate.id}:`, error.message);
        } finally {
          this.precomputeScannedCandidates += 1;
        }
      }
      await this.runLlmQueue();
      this.precomputeCompletedAt = new Date().toISOString();
    } finally {
      this.precomputeRunning = false;
    }
  }

  getStatus() {
    return {
      ...this.localLlmClient?.getStatus(),
      queuedDocuments: this.llmQueue.length,
      workerRunning: this.llmWorkerRunning,
      precomputeRunning: this.precomputeRunning,
      scannedCandidates: this.precomputeScannedCandidates,
      eligibleCandidates: this.precomputeEligibleCandidates,
      precomputeCompletedAt: this.precomputeCompletedAt,
    };
  }

  async get(candidate, options = {}) {
    const priority = options.background ? 'background' : 'interactive';
    const plan = await this.governmentPlanService.get(candidate);
    if (!plan) return null;
    if (this.memory.has(plan.sha256)) {
      const remembered = this.memory.get(plan.sha256);
      const current = await this.withAnalysisState(plan.sha256, remembered);
      this.queueLocalAnalysis(candidate, plan.sha256, current, priority);
      return current;
    }
    if (this.pending.has(plan.sha256)) return this.pending.get(plan.sha256);

    const pending = (async () => {
      const cached = await this.readReadyAnalysis(plan.sha256);
      if (cached?.version === SUMMARY_VERSION) {
        this.queueLocalAnalysis(candidate, plan.sha256, cached, priority);
        return cached;
      }
      const extracted = await extractPdfPages(plan.buffer);
      const summary = {
        ...summarizeExtractedPages(extracted.pages, { pages: extracted.totalPages }),
        documentSha256: plan.sha256,
        generatedAt: new Date().toISOString(),
        source: plan.source,
        aiAnalysis: this.localLlmClient?.isEnabled() ? {
          status: 'QUEUED',
          local: true,
          model: this.config.localLlmModel,
          analysisVersion: LOCAL_LLM_ANALYSIS_VERSION,
          promptVersion: LOCAL_LLM_PROMPT_VERSION,
          stage: 'WAITING',
          completed: 0,
          total: 1,
        } : {
          status: 'DISABLED',
          local: true,
        },
      };
      await this.saveCache(plan.sha256, summary).catch(() => {});
      this.queueLocalAnalysis(candidate, plan.sha256, summary, priority);
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
