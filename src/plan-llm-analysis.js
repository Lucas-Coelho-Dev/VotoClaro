const crypto = require('crypto');
const {
  LOCAL_LLM_ANALYSIS_VERSION,
  LOCAL_LLM_PROMPT_VERSION,
} = require('./local-llm');

const MAX_PUBLIC_PROPOSALS_PER_THEME = 30;
const MAX_EVIDENCES_PER_THEME = 3;

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
    .replace(/([A-Za-zÀ-ÖØ-öø-ÿ])-\s+([a-zà-öø-ÿ])/g, '$1$2')
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

function chunksFromEvidenceSummary(fallbackSummary, maximumCharacters) {
  const chunks = [];
  let parts = [];
  let size = 0;
  let pageNumbers = new Set();
  let evidenceCount = 0;
  let themeIds = new Set();
  const flush = () => {
    if (!parts.length) return;
    chunks.push({
      text: parts.join('\n\n'),
      pages: [...pageNumbers].sort((left, right) => left - right),
      evidenceCount,
      themeIds: [...themeIds],
    });
    parts = [];
    size = 0;
    pageNumbers = new Set();
    evidenceCount = 0;
    themeIds = new Set();
  };

  for (const theme of fallbackSummary.themeSummaries || []) {
    const extractiveProposals = (theme.proposals || [])
      .filter((proposal) => proposal.extraction !== 'LOCAL_LLM_GROUNDED');
    const themeParts = [];
    const themePages = new Set();
    for (const proposal of extractiveProposals.slice(0, MAX_EVIDENCES_PER_THEME)) {
      const page = Number(proposal.page);
      const text = cleanText(proposal.text, 680);
      if (!page || text.length < 20) continue;
      const section = cleanText(proposal.section, 120);
      const marked = [
        `<<<PÁGINA ${page} | TEMA SUGERIDO: ${theme.id}>>>`,
        section ? `Seção extraída: ${section}` : '',
        text,
      ].filter(Boolean).join('\n');
      themeParts.push(marked);
      themePages.add(page);
    }
    if (!themeParts.length) continue;
    const themeBlock = themeParts.join('\n\n');
    if (parts.length && size + themeBlock.length > maximumCharacters) flush();
    parts.push(themeBlock);
    size += themeBlock.length;
    evidenceCount += themeParts.length;
    themeIds.add(theme.id);
    for (const page of themePages) pageNumbers.add(page);
    flush();
  }
  flush();
  return chunks;
}

function rawThemeEvidences(theme, fallbackSummary, pagesByNumber) {
  const fallbackTheme = fallbackSummary.themeSummaries?.find((item) => item.id === theme.id);
  return validatedEvidences((fallbackTheme?.proposals || [])
    .filter((proposal) => proposal.extraction !== 'LOCAL_LLM_GROUNDED')
    .slice(0, MAX_EVIDENCES_PER_THEME)
    .map((proposal) => ({ page: proposal.page, quote: proposal.text })), pagesByNumber);
}

function sanitizeThemeDigest(raw, theme, pagesByNumber, fallbackSummary, candidateName) {
  const evidences = rawThemeEvidences(theme, fallbackSummary, pagesByNumber);
  if (!evidences.length) return null;
  const publicName = cleanText(candidateName, 100) || 'a candidatura';
  const stripLead = (value) => cleanText(value, 300)
    .replace(/^(?:segundo o plano de governo[, :]*)?/iu, '')
    .replace(new RegExp(`^(?:${publicName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|NOME|o candidato|a candidatura)\\s+(?:pretende|propõe|quer)\\s+`, 'iu'), '')
    .replace(/^(?:pretende|propõe|quer)\s+/iu, '')
    .replace(/[.!?…]+$/u, '')
    .trim();
  const action = stripLead(raw?.summary) || 'executar as ações descritas nos três trechos oficiais deste tema';
  const rawEffect = stripLead(raw?.potentialImpact)
    .replace(/^(?:se implementadas[, ]*)?(?:essas|as) medidas podem\s+/iu, '');
  const themeEffects = {
    educacao: 'alterar a disciplina escolar, o financiamento e a oferta educacional',
    'emprego-economia': 'estimular atividade econômica, investimento e geração de trabalho',
    'tecnologia-inovacao': 'ampliar a capacidade tecnológica e produtiva do país',
    'gestao-transparencia': 'mudar a organização do Estado e o controle da gestão pública',
    saude: 'ampliar o acesso e a capacidade de atendimento em saúde',
    'mobilidade-infraestrutura': 'melhorar deslocamentos, logística e infraestrutura disponível',
    'protecao-social': 'alterar a proteção e o atendimento de grupos vulneráveis',
    'cultura-esporte-turismo': 'ampliar acesso, atividade econômica e participação nessas áreas',
    'seguranca-publica': 'reforçar prevenção, investigação e resposta ao crime organizado',
  };
  const fallbackEffect = themeEffects[theme.id] || 'produzir mudanças neste tema ao longo do mandato';
  const effect = !rawEffect || similarity(action, rawEffect) >= 0.72 ? fallbackEffect : rawEffect;
  const evidenceText = evidences.map((evidence) => evidence.quote).join(' ');
  const groundedAction = similarity(action, evidenceText) >= 0.1
    ? action
    : completeGeneratedSentence(evidences[0].quote, 190);
  const summaryText = completeGeneratedSentence(
    `O plano de governo de ${publicName} apresenta esta direção: ${groundedAction}`,
    390,
  );
  const impactText = completeGeneratedSentence(
    `Se implementadas, essas medidas têm este impacto possível: ${effect}`,
    260,
  );
  return {
    summary: safeGeneratedText(
      summaryText,
      evidences,
      'Os trechos oficiais deste tema foram preservados abaixo, mas a síntese da IA não pôde ser validada com segurança.',
      420,
    ),
    potentialImpact: safeGeneratedText(
      impactText,
      evidences,
      'Os possíveis efeitos dependem da execução, dos recursos disponíveis e de decisões que o documento pode não detalhar.',
      240,
    ),
    evidences,
    pages: [...new Set(evidences.map((evidence) => evidence.page))].sort((left, right) => left - right),
    grounding: 'THREE_THEME_EXCERPTS_VALIDATED_AGAINST_PDF_TEXT',
  };
}

function attachThemeDigests(rawDigests, themes, pagesByNumber, fallbackSummary, candidateName) {
  return (fallbackSummary.themeSummaries || []).map((fallbackTheme) => {
    const theme = themes.find((item) => item.id === fallbackTheme.id);
    if (!theme) return fallbackTheme;
    const candidates = rawDigests
      .filter((item) => item?.theme === theme.id)
      .map((item) => sanitizeThemeDigest(item, theme, pagesByNumber, fallbackSummary, candidateName))
      .filter(Boolean)
      .sort((left, right) => right.summary.length - left.summary.length);
    return { ...fallbackTheme, digest: candidates[0] || null };
  });
}

function sanitizeObjectiveFromThemes(raw, themes, pagesByNumber, fallbackSummary) {
  const evidences = (Array.isArray(raw?.evidenceThemes) ? raw.evidenceThemes : [])
    .map((themeId) => themes.find((theme) => theme.id === themeId))
    .filter(Boolean)
    .flatMap((theme) => rawThemeEvidences(theme, fallbackSummary, pagesByNumber).slice(0, 1));
  const uniqueEvidences = mergeUniqueEvidences([], evidences).slice(0, 2);
  if (!uniqueEvidences.length) return null;
  return {
    summary: safeGeneratedText(
      raw?.summary,
      uniqueEvidences,
      'O objetivo central não pôde ser explicado sem acrescentar informações que não constam nos trechos validados.',
      420,
    ),
    evidences: uniqueEvidences,
    pages: [...new Set(uniqueEvidences.map((evidence) => evidence.page))].sort((left, right) => left - right),
    grounding: 'THEME_EXCERPTS_VALIDATED_AGAINST_PDF_TEXT',
  };
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

function completeGeneratedSentence(value, maximum) {
  const cleaned = cleanText(value, maximum);
  if (!cleaned) return cleaned;
  const withoutDanglingEnd = cleaned
    .replace(/,\s*(?:ampliando|aumentando|fortalecendo|integrando|promovendo|reduzindo)\s+(?:maior|mais|a|o|as|os)?\s*([.!?…])$/iu, '$1')
    .replace(/\s+e\s+(?:ampliar|aumentar|fortalecer|integrar|investir|promover|reduzir)\s*([.!?…])$/iu, '$1')
    .replace(/\s+(?:a|ao|aos|as|com|da|das|de|do|dos|e|em|na|nas|no|nos|o|os|para|por)\s*([.!?…])$/iu, '$1');
  if (/[.!?…]$/u.test(withoutDanglingEnd)) return withoutDanglingEnd;
  const lastBoundary = Math.max(withoutDanglingEnd.lastIndexOf('.'), withoutDanglingEnd.lastIndexOf('!'), withoutDanglingEnd.lastIndexOf('?'));
  if (lastBoundary >= Math.floor(withoutDanglingEnd.length * 0.35)) return withoutDanglingEnd.slice(0, lastBoundary + 1).trim();
  const withoutPartialWord = withoutDanglingEnd.replace(/\s+\S*$/u, '').trim();
  return withoutPartialWord ? `${withoutPartialWord}.` : cleaned;
}

function safeGeneratedText(value, evidences, fallback, maximum, completeSentence = true) {
  const cleaned = completeSentence
    ? completeGeneratedSentence(value, maximum)
    : cleanText(value, maximum);
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
  const fallbackTheme = fallbackSummary.themeSummaries?.find((item) => item.id === theme.id);
  const groundedInTheme = evidences.some((evidence) => (fallbackTheme?.proposals || []).some((proposal) => (
    Number(proposal.page) === evidence.page && similarity(proposal.text, evidence.quote) >= 0.32
  )));
  if (!groundedInTheme) return null;
  const evidenceFallback = cleanText(evidences[0].quote, 520);
  const summary = safeGeneratedText(raw.summary, evidences, evidenceFallback, 620);
  const title = safeGeneratedText(raw.title, evidences, `Proposta sobre ${theme.label}`, 120, false);
  const proposal = {
    title,
    summary,
    text: summary,
    evidences,
    pages: [...new Set(evidences.map((evidence) => evidence.page))].sort((a, b) => a - b),
    page: evidences[0].page,
    section: null,
    audience: safeGeneratedStrings(raw.audience, evidences, 2, 100),
    requirements: safeGeneratedStrings(raw.requirements, evidences, 2, 140),
    risks: [],
    indicators: [],
    missingInformation: safeGeneratedStrings(raw.missingInformation, evidences, 2, 120),
    fourYearScenario: {
      firstYear: '',
      yearsTwoAndThree: '',
      fourthYear: '',
      potentialImpact: safeGeneratedText(
        raw.potentialImpact || raw.fourYearScenario?.potentialImpact,
        evidences,
        'O efeito ao final do mandato depende de execução, recursos e condições que o documento pode não detalhar.',
        280,
      ),
    },
    extraction: 'LOCAL_LLM_GROUNDED',
    grounding: 'QUOTES_VALIDATED_AGAINST_PDF_TEXT',
  };
  proposal.section = sectionForProposal(theme, proposal, fallbackSummary);
  proposal.detailScore = detailScore(proposal);
  return proposal;
}

function sanitizeObjective(raw, pagesByNumber) {
  const evidences = validatedEvidences(raw?.evidences, pagesByNumber);
  if (!evidences.length) return null;
  const summary = safeGeneratedText(
    raw?.summary,
    evidences,
    'O objetivo central não pôde ser explicado sem acrescentar informações que não constam nos trechos validados.',
    520,
  );
  return {
    summary,
    evidences,
    pages: [...new Set(evidences.map((evidence) => evidence.page))].sort((left, right) => left - right),
    grounding: 'QUOTES_VALIDATED_AGAINST_PDF_TEXT',
  };
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

function mergeFallbackThemes(explainedThemes, fallbackSummary) {
  return explainedThemes.map((theme) => {
    const fallbackTheme = fallbackSummary.themeSummaries?.find((item) => item.id === theme.id);
    const proposals = [...theme.proposals];
    for (const fallbackProposal of (fallbackTheme?.proposals || [])
      .filter((proposal) => proposal.extraction !== 'LOCAL_LLM_GROUNDED')) {
      const duplicate = proposals.some((proposal) => (
        Number(proposal.page) === Number(fallbackProposal.page)
        && similarity(`${proposal.title || ''} ${proposal.summary || proposal.text || ''}`, fallbackProposal.text) >= 0.28
      ));
      if (!duplicate) proposals.push(fallbackProposal);
    }
    const pages = [...new Set(proposals.flatMap((proposal) => (
      proposal.pages?.length ? proposal.pages : [proposal.page]
    )).map(Number).filter(Boolean))].sort((left, right) => left - right);
    return {
      ...theme,
      status: proposals.length ? 'FOUND' : 'NOT_IDENTIFIED',
      proposalCount: proposals.length,
      mentionCount: proposals.reduce((total, proposal) => total + (proposal.evidences?.length || 1), 0),
      pages,
      sections: [...new Set(proposals.map((proposal) => proposal.section).filter(Boolean))],
      proposals,
    };
  });
}

async function createLocalLlmSummary({ pages, fallbackSummary, client, themes, config, candidateName, onProgress }) {
  const chunks = chunksFromEvidenceSummary(fallbackSummary, config.localLlmChunkCharacters);
  if (!chunks.length) throw new Error('O PDF não contém texto suficiente para a análise local.');
  const rawThemeDigests = [];
  const rawObjectives = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    await onProgress?.({ stage: 'EXPLAINING', completed: index, total: chunks.length });
    let result;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await client.analyzeChunk(chunk, { candidateName });
        break;
      } catch (error) {
        const transient = /fetch failed|econnreset|socket|network|conexão|connection/iu.test(String(error?.message || error));
        if (!transient || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
      }
    }
    rawThemeDigests.push(...result.themeDigests);
    rawObjectives.push(result.objective);
    await onProgress?.({ stage: 'EXPLAINING', completed: index + 1, total: chunks.length });
  }
  const pagesByNumber = new Map(pages.map((page) => [Number(page.page), normalizedEvidenceText(page.text)]));
  const themeSummaries = attachThemeDigests(rawThemeDigests, themes, pagesByNumber, fallbackSummary, candidateName);
  const explainedThemeCount = themeSummaries.filter((theme) => theme.digest).length;
  const foundThemes = themeSummaries.filter((theme) => theme.status === 'FOUND');
  const candidateObjective = rawObjectives
    .map((objective) => sanitizeObjectiveFromThemes(objective, themes, pagesByNumber, fallbackSummary))
    .filter(Boolean)
    .sort((left, right) => right.evidences.length - left.evidences.length)[0] || null;
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
      id: theme.proposals[0]?.id || theme.id,
      title: theme.label,
      ...(theme.digest || theme.proposals[0]),
    })),
    candidateObjective,
    overview: explainedThemeCount
      ? `A IA resumiu os três trechos mais representativos em ${explainedThemeCount} de ${themes.length} temas. As páginas oficiais usadas continuam disponíveis para conferência.`
      : fallbackSummary.overview,
    notice: 'A IA local resume até três trechos selecionados em cada tema e apresenta um impacto possível para quatro anos. As páginas e os trechos oficiais permanecem visíveis. O impacto é uma hipótese condicionada à execução, aos recursos e à regulamentação; não é previsão, garantia nem avaliação de viabilidade.',
    generatedAt,
    aiAnalysis: {
      status: 'READY',
      local: true,
      model: config.localLlmModel,
      analysisVersion: LOCAL_LLM_ANALYSIS_VERSION,
      promptVersion: LOCAL_LLM_PROMPT_VERSION,
      chunksProcessed: chunks.length,
      evidencePacksProcessed: chunks.length,
      evidenceExcerpts: chunks.reduce((total, chunk) => total + chunk.evidenceCount, 0),
      textPagesProcessed: pagesByNumber.size,
      generatedAt,
    },
    methodology: {
      ...fallbackSummary.methodology,
      pageReadingRule: 'A leitura determinística percorre o PDF e seleciona até três trechos representativos por tema. A IA processa um tema por vez e recebe somente os trechos daquele assunto, sempre com o número da página.',
      consolidationRule: 'A IA produz uma síntese por tema a partir de até três trechos selecionados pelo extrator. Os três trechos continuam visíveis e ligados às respectivas páginas do PDF.',
      impactRule: 'O cenário de quatro anos é condicional e qualitativo. Não representa previsão, promessa de resultado, avaliação de viabilidade ou recomendação eleitoral.',
      displayRule: 'A interface apresenta três propostas por vez, sem limitar a leitura das demais propostas consolidadas.',
    },
  };
}

module.exports = {
  chunksFromPages,
  chunksFromEvidenceSummary,
  createLocalLlmSummary,
  normalizedEvidenceText,
  validatedEvidences,
  consolidateByTheme,
  completeGeneratedSentence,
};
