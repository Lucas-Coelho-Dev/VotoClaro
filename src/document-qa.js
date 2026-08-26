const { searchable } = require('./normalize');

const STOP_WORDS = new Set(['qual', 'quais', 'como', 'para', 'isso', 'essa', 'esse', 'este', 'esta', 'dele', 'dela', 'candidato', 'candidata', 'propoe', 'proposta', 'sobre', 'onde', 'pagina', 'paginas']);

function tokens(value) {
  return (searchable(value).match(/[a-z0-9]+/g) || []).filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
}

function addEvidence(target, evidence) {
  const text = String(evidence.text || '').replace(/\s+/g, ' ').trim();
  if (text.length < 20) return;
  const signature = `${evidence.kind}|${evidence.page || ''}|${searchable(text).slice(0, 180)}`;
  if (target.some((item) => item.signature === signature)) return;
  target.push({ ...evidence, text: text.slice(0, 1600), signature });
}

function planEvidences(summary, candidateId) {
  if (!summary?.themeSummaries?.length) return [];
  const result = [];
  const pdfUrl = `/api/v1/candidates/${encodeURIComponent(candidateId)}/government-plan`;
  for (const theme of summary.themeSummaries) {
    for (const proposal of theme.proposals || []) {
      const nested = proposal.evidences || [];
      if (nested.length) {
        for (const evidence of nested) addEvidence(result, {
          kind: 'Plano de governo',
          label: `${theme.label} — página ${Number(evidence.page) || Number(proposal.page) || 1}`,
          text: evidence.quote || proposal.summary || proposal.text,
          page: Number(evidence.page) || Number(proposal.page) || 1,
          url: `${pdfUrl}#page=${Number(evidence.page) || Number(proposal.page) || 1}`,
        });
      } else {
        addEvidence(result, {
          kind: 'Plano de governo',
          label: `${theme.label} — página ${Number(proposal.page) || 1}`,
          text: proposal.text || proposal.summary,
          page: Number(proposal.page) || 1,
          url: `${pdfUrl}#page=${Number(proposal.page) || 1}`,
        });
      }
    }
  }
  return result;
}

function legislativeEvidences(data) {
  const result = [];
  for (const item of data?.laws || []) addEvidence(result, {
    kind: item.evidence?.stage === 'ENACTED' ? 'Norma jurídica' : 'Proposição legislativa',
    label: item.lawTitle || item.title || 'Item legislativo',
    text: [item.summary, item.status, item.authorship?.label].filter(Boolean).join(' '),
    page: null,
    url: item.normOfficialUrl || item.officialUrl,
  });
  return result;
}

function selectEvidence(question, evidences, limit = 8) {
  const queryTokens = tokens(question);
  const scored = evidences.map((evidence, index) => {
    const haystack = new Set(tokens(`${evidence.kind} ${evidence.label} ${evidence.text}`));
    const hits = queryTokens.filter((token) => haystack.has(token)).length;
    const themeBonus = queryTokens.some((token) => searchable(evidence.label).includes(token)) ? 3 : 0;
    return { ...evidence, score: hits * 4 + themeBonus, themeMatch: themeBonus > 0, originalIndex: index };
  }).filter((evidence) => evidence.score > 0);
  const focused = scored.some((evidence) => evidence.themeMatch)
    ? scored.filter((evidence) => evidence.themeMatch)
    : scored;
  return focused
    .sort((left, right) => right.score - left.score || left.originalIndex - right.originalIndex)
    .slice(0, limit)
    .map((evidence, index) => {
      const { signature, score, themeMatch, originalIndex, ...publicEvidence } = evidence;
      return { id: `F${index + 1}`, ...publicEvidence };
    });
}

function buildOfficialEvidence(question, summary, legislative, candidateId) {
  const all = [...planEvidences(summary, candidateId), ...legislativeEvidences(legislative)];
  return selectEvidence(question, all);
}

module.exports = { buildOfficialEvidence, selectEvidence, planEvidences, legislativeEvidences, tokens };
