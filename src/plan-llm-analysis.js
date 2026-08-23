const crypto = require('crypto');
const {
  LOCAL_LLM_ANALYSIS_VERSION,
  LOCAL_LLM_PROMPT_VERSION,
} = require('./local-llm');

const MAX_PUBLIC_PROPOSALS_PER_THEME = 30;

function cleanText(value, maximum = 700) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function uniqueStrings(values, maximumItems = 6, maximumLength = 180) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const cleaned = cleanText(value, maximumLength);
    const key = cleaned.toLocaleLowerCase('pt-BR');
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length === maximumItems) break;
  }
  return result;
}

function normalizedEvidenceText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLongText(value, maximumCharacters) {
  const text = String(value || '').trim();
  if (!text) return [];
  const pieces = [];
  let remaining = text;
  while (remaining.length > maximumCharacters) {
    const window = remaining.slice(0, maximumCharacters + 1);
    const minimumBoundary = Math.floor(maximumCharacters * 0.6);
    const candidates = [window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf('; '), window.lastIndexOf(' ')];
    const boundary = Math.max(...candidates.filter((index) => index >= minimumBoundary));
    const splitAt = boundary >= minimumBoundary ? boundary + 1 : maximumCharacters;
    pieces.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

function chunksFromPages(pages, maximumCharacters, normalizeText) {
  const chunks = [];
  let parts = [];
  let size = 0;
  let pageNumbers = new Set();
  const flush = () => {
    if (!parts.length) return;
    chunks.push({
      text: parts.join('\n\n'),
      pages: [...pageNumbers].sort((left, right) => left - right),
    });
    parts = [];
    size = 0;
    pageNumbers = new Set();
  };

  for (const page of pages) {
    const normalized = normalizeText(page.text);
    if (normalized.length < 20) continue;
    const available = Math.max(1000, maximumCharacters - 40);
    for (const piece of splitLongText(normalized, available)) {
      const marked = `<<<PÁGINA ${page.page}>>>\n${piece}`;
      if (parts.length && size + marked.length > maximumCharacters) flush();
      parts.push(marked);
      size += marked.length;
      pageNumbers.add(Number(page.page));
    }
  }
  flush();
  return chunks;
}

function numberTokens(value) {
  return new Set(String(value || '').match(/\b\d+(?:[.,]\d+)*(?:%|º|ª)?\b/g) || []);
}

function hasUnsupportedNumber(value, evidences) {
  const allowed = new Set();
  for (const evidence of evidences) {
    for (const token of numberTokens(evidence.quote)) allowed.add(token);
  }
  for (const token of numberTokens(value)) if (!allowed.has(token)) return true;
  return false;
}

function safeGeneratedText(value, evidences, fallback, maximum) {
  const cleaned = cleanText(value, maximum);
  if (!cleaned || hasUnsupportedNumber(cleaned, evidences)) return fallback;
  return cleaned;
}

function safeGeneratedStrings(values, evidences, maximumItems = 6, maximumLength = 180) {
  return uniqueStrings(values, maximumItems, maximumLength)
    .filter((value) => !hasUnsupportedNumber(value, evidences));
}

function validatedEvidences(rawEvidences, pagesByNumber) {
  const found = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawEvidences) ? rawEvidences : []) {
    const page = Number(raw.page);
    const pageText = pagesByNumber.get(page);
    const quote = cleanText(raw.quote, 700);
    const normalizedQuote = normalizedEvidenceText(quote);
    if (!pageText || normalizedQuote.length < 20 || !pageText.includes(normalizedQuote)) continue;
    const key = `${page}:${normalizedQuote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ page, quote });
    if (found.length === 6) break;
  }
  return found;
}

function tokenSet(value) {
  return new Set(normalizedEvidenceText(value).split(' ').filter((token) => token.length > 3));
}

function similarity(left, right) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / Math.min(leftTokens.size, rightTokens.size);
}

function mergeUniqueEvidences(left, right) {
  const seen = new Set();
  return [...left, ...right].filter((evidence) => {
    const key = `${evidence.page}:${normalizedEvidenceText(evidence.quote)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function intersection(left, right) {
  if (!left.length || !right.length) return [];
  const rightKeys = new Set(right.map((item) => normalizedEvidenceText(item)));
  return left.filter((item) => rightKeys.has(normalizedEvidenceText(item)));
}

function mergeProposal(target, incoming) {
  target.evidences = mergeUniqueEvidences(target.evidences, incoming.evidences);
  target.pages = [...new Set(target.evidences.map((evidence) => evidence.page))].sort((a, b) => a - b);
  if (incoming.summary.length > target.summary.length) target.summary = incoming.summary;
  if (incoming.title.length > target.title.length && incoming.title.length <= 120) target.title = incoming.title;
  target.audience = uniqueStrings([...target.audience, ...incoming.audience]);
  target.requirements = uniqueStrings([...target.requirements, ...incoming.requirements]);
  target.risks = uniqueStrings([...target.risks, ...incoming.risks]);
  target.indicators = uniqueStrings([...target.indicators, ...incoming.indicators]);
  target.missingInformation = intersection(target.missingInformation, incoming.missingInformation);
  if (incoming.detailScore > target.detailScore) {
    target.fourYearScenario = incoming.fourYearScenario;
    target.detailScore = incoming.detailScore;
  }
}

function detailScore(proposal) {
  const evidenceNumbers = proposal.evidences.reduce((total, evidence) => total + numberTokens(evidence.quote).size, 0);
  return proposal.evidences.length * 4
    + Math.min(4, evidenceNumbers) * 2
    + proposal.audience.length
    + proposal.requirements.length
    + proposal.indicators.length;
}

function sectionForProposal(theme, proposal, fallbackSummary) {
  const fallbackTheme = fallbackSummary.themeSummaries?.find((item) => item.id === theme.id);
  const match = fallbackTheme?.proposals?.find((item) => (
    proposal.pages.includes(Number(item.page))
    && similarity(item.text, `${proposal.title} ${proposal.summary}`) >= 0.3
  ));
  return match?.section || null;
}

function sanitizeProposal(raw, theme, pagesByNumber, fallbackSummary) {
  const evidences = validatedEvidences(raw.evidences, pagesByNumber);
  if (!evidences.length) return null;
  const evidenceFallback = cleanText(evidences[0].quote, 520);
  const genericScenario = 'O plano não fornece elementos suficientes para detalhar esta etapa sem acrescentar suposições.';
  const summary = safeGeneratedText(raw.summary, evidences, evidenceFallback, 620);
  const title = safeGeneratedText(raw.title, evidences, `Proposta sobre ${theme.label}`, 120);
  const proposal = {
    title,
    summary,
    text: summary,
    evidences,
    pages: [...new Set(evidences.map((evidence) => evidence.page))].sort((a, b) => a - b),
    page: evidences[0].page,
    section: null,
    audience: safeGeneratedStrings(raw.audience, evidences, 6, 120),
    requirements: safeGeneratedStrings(raw.requirements, evidences),
    risks: safeGeneratedStrings(raw.risks, evidences),
    indicators: safeGeneratedStrings(raw.indicators, evidences, 6, 160),
    missingInformation: safeGeneratedStrings(raw.missingInformation, evidences, 6, 160),
    fourYearScenario: {
      firstYear: safeGeneratedText(raw.fourYearScenario?.firstYear, evidences, genericScenario, 380),
      yearsTwoAndThree: safeGeneratedText(raw.fourYearScenario?.yearsTwoAndThree, evidences, genericScenario, 380),
      fourthYear: safeGeneratedText(raw.fourYearScenario?.fourthYear, evidences, genericScenario, 380),
      potentialImpact: safeGeneratedText(
        raw.fourYearScenario?.potentialImpact,
        evidences,
        'O efeito ao final do mandato depende de execução, recursos e condições que o documento pode não detalhar.',
        480,
      ),
    },
    extraction: 'LOCAL_LLM_GROUNDED',
    grounding: 'QUOTES_VALIDATED_AGAINST_PDF_TEXT',
  };
  proposal.section = sectionForProposal(theme, proposal, fallbackSummary);
  proposal.detailScore = detailScore(proposal);
  return proposal;
}

function consolidateByTheme(rawProposals, themes, pagesByNumber, fallbackSummary) {
  return themes.map((theme) => {
    const proposals = [];
    for (const raw of rawProposals.filter((item) => item.theme === theme.id)) {
      const proposal = sanitizeProposal(raw, theme, pagesByNumber, fallbackSummary);
      if (!proposal) continue;
      const duplicate = proposals.find((item) => similarity(
        `${item.title} ${item.summary}`,
        `${proposal.title} ${proposal.summary}`,
      ) >= 0.58);
      if (duplicate) mergeProposal(duplicate, proposal);
      else proposals.push(proposal);
    }
    proposals.sort((left, right) => right.detailScore - left.detailScore || left.page - right.page);
    const publicProposals = proposals.slice(0, MAX_PUBLIC_PROPOSALS_PER_THEME).map((proposal, index) => {
      const { detailScore: ignored, ...publicProposal } = proposal;
      const digest = crypto.createHash('sha256')
        .update(`${theme.id}:${proposal.evidences.map((item) => `${item.page}:${item.quote}`).join('|')}`)
        .digest('hex')
        .slice(0, 12);
      return { id: `${theme.id}-${digest}-${index + 1}`, ...publicProposal };
    });
    const pages = [...new Set(publicProposals.flatMap((proposal) => proposal.pages))].sort((a, b) => a - b);
    return {
      id: theme.id,
      label: theme.label,
      status: publicProposals.length ? 'FOUND' : 'NOT_IDENTIFIED',
      proposalCount: publicProposals.length,
      mentionCount: publicProposals.reduce((total, proposal) => total + proposal.evidences.length, 0),
      pages,
      sections: [...new Set(publicProposals.map((proposal) => proposal.section).filter(Boolean))],
      proposals: publicProposals,
    };
  });
}

async function createLocalLlmSummary({ pages, fallbackSummary, client, themes, config }) {
  const chunks = chunksFromPages(pages, config.localLlmChunkCharacters, (value) => cleanText(value, 60_000));
  if (!chunks.length) throw new Error('O PDF não contém texto suficiente para a análise local.');
  const rawProposals = [];
  for (const chunk of chunks) {
    const result = await client.analyzeChunk(chunk);
    rawProposals.push(...result.proposals);
  }
  const pagesByNumber = new Map(pages.map((page) => [Number(page.page), normalizedEvidenceText(page.text)]));
  const themeSummaries = consolidateByTheme(rawProposals, themes, pagesByNumber, fallbackSummary);
  const foundThemes = themeSummaries.filter((theme) => theme.status === 'FOUND');
  const generatedAt = new Date().toISOString();
  return {
    ...fallbackSummary,
    available: foundThemes.length > 0 || fallbackSummary.available,
    summaryType: 'AUTOMATIC_THEMATIC_LOCAL_LLM',
    themeSummaries,
    areas: themeSummaries.map(({ id, label, status, proposalCount, mentionCount }) => ({
      id, label, status, proposalCount, mentions: mentionCount,
    })),
    mainPoints: foundThemes.map((theme) => ({
      id: theme.proposals[0].id,
      title: theme.label,
      ...theme.proposals[0],
    })),
    overview: foundThemes.length
      ? `${foundThemes.length} de ${themes.length} temas possuem propostas consolidadas a partir do texto integral processado.`
      : fallbackSummary.overview,
    notice: 'A IA local organiza trechos do PDF oficial e apresenta cenários condicionais para quatro anos. Citações e páginas são conferidas no texto extraído; públicos afetados, dependências, efeitos, riscos e etapas são inferências, não previsões nem garantias. Números só podem ser reproduzidos quando constam nas evidências.',
    generatedAt,
    aiAnalysis: {
      status: 'READY',
      local: true,
      model: config.localLlmModel,
      analysisVersion: LOCAL_LLM_ANALYSIS_VERSION,
      promptVersion: LOCAL_LLM_PROMPT_VERSION,
      chunksProcessed: chunks.length,
      textPagesProcessed: pagesByNumber.size,
      generatedAt,
    },
    methodology: {
      ...fallbackSummary.methodology,
      pageReadingRule: 'Todas as páginas com texto extraível são processadas em blocos preservando o número da página.',
      consolidationRule: 'Trechos semelhantes do mesmo tema são reunidos; cada proposta pública mantém ao menos uma citação validada no texto extraído.',
      impactRule: 'O cenário de quatro anos é condicional e qualitativo. Não representa previsão, promessa de resultado, avaliação de viabilidade ou recomendação eleitoral.',
      displayRule: 'A interface apresenta três propostas por vez, sem limitar a leitura das demais propostas consolidadas.',
    },
  };
}

module.exports = {
  chunksFromPages,
  createLocalLlmSummary,
  normalizedEvidenceText,
  validatedEvidences,
  consolidateByTheme,
};
