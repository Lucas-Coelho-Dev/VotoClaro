const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chunksFromPages,
  chunksFromEvidenceSummary,
  createLocalLlmSummary,
  completeGeneratedSentence,
  normalizedEvidenceText,
  validatedEvidences,
} = require('../src/plan-llm-analysis');
const { summarizeExtractedPages, normalizePdfText, THEMES } = require('../src/plan-summary');

test('divide o documento preservando todas as páginas com texto', () => {
  const pages = [
    { page: 1, text: `Educação ${'escolas e professores. '.repeat(80)}` },
    { page: 2, text: `Saúde ${'hospitais e atenção básica. '.repeat(80)}` },
    { page: 3, text: 'Página curta, mas ainda possui texto oficial suficiente para leitura.' },
  ];
  const chunks = chunksFromPages(pages, 1200, normalizePdfText);
  assert.equal(chunks.length >= 3, true);
  assert.deepEqual([...new Set(chunks.flatMap((chunk) => chunk.pages))], [1, 2, 3]);
  assert.match(chunks[0].text, /<<<PÁGINA 1>>>/);
});

test('remove cauda incompleta sem alterar a parte substantiva da síntese', () => {
  assert.equal(
    completeGeneratedSentence('Aumentar o investimento em infraestrutura e tecnologia, promovendo maior.', 240),
    'Aumentar o investimento em infraestrutura e tecnologia.',
  );
  assert.equal(
    completeGeneratedSentence('Aproveitar a base industrial de defesa e investir.', 240),
    'Aproveitar a base industrial de defesa.',
  );
});

test('aceita somente citação que existe na página indicada', () => {
  const pages = new Map([[4, normalizedEvidenceText('Vamos ampliar escolas em tempo integral e formar professores da rede pública.')]]);
  const evidences = validatedEvidences([
    { page: 4, quote: 'Vamos ampliar escolas em tempo integral e formar professores da rede pública.' },
    { page: 4, quote: 'Vamos construir cem hospitais em quatro anos.' },
    { page: 8, quote: 'Trecho associado a uma página inexistente no documento.' },
  ], pages);
  assert.equal(evidences.length, 1);
  assert.equal(evidences[0].page, 4);
});

test('valida citação quando o extrator do PDF quebrou uma palavra com hífen entre linhas', () => {
  const pages = new Map([[31, normalizedEvidenceText('uma uniformização com-\nportamental do estudante nas escolas públicas')]]);
  const evidences = validatedEvidences([{
    page: 31,
    quote: 'uma uniformização comportamental do estudante nas escolas públicas',
  }], pages);
  assert.equal(evidences.length, 1);
  assert.equal(evidences[0].page, 31);
});

test('envia à LLM somente evidências temáticas selecionadas, com página preservada', () => {
  const fallbackSummary = summarizeExtractedPages([{
    page: 6,
    text: 'A proposta pretende ampliar escolas em tempo integral e formar professores da rede pública.',
  }], { pages: 6 });
  fallbackSummary.themeSummaries.find((theme) => theme.id === 'educacao').proposals.unshift({
    page: 99,
    text: 'Explicação antiga produzida por outra execução da IA.',
    extraction: 'LOCAL_LLM_GROUNDED',
  });
  const chunks = chunksFromEvidenceSummary(fallbackSummary, 18000);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].evidenceCount, 1);
  assert.match(chunks[0].text, /PÁGINA 6 \| TEMA SUGERIDO: educacao/);
  assert.doesNotMatch(chunks[0].text, /Explicação antiga/);
  assert.doesNotMatch(chunks[0].text, /TEXTO INTEGRAL/i);
});

test('isola cada tema em uma chamada para impedir contaminação entre assuntos', () => {
  const fallbackSummary = summarizeExtractedPages([
    { page: 2, text: 'A proposta pretende ampliar escolas e formar professores da rede pública.' },
    { page: 3, text: 'O programa propõe fortalecer hospitais e ampliar a atenção básica de saúde.' },
  ], { pages: 3 });
  const chunks = chunksFromEvidenceSummary(fallbackSummary, 18000);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map((chunk) => chunk.themeIds), [['educacao'], ['saude']]);
  assert.doesNotMatch(chunks[0].text, /hospitais/i);
  assert.doesNotMatch(chunks[1].text, /escolas/i);
});

test('não publica explicação da IA em tema diferente daquele sustentado pelo trecho', async () => {
  const pages = [{
    page: 7,
    text: 'A proposta pretende ampliar escolas em tempo integral e formar professores da rede pública.',
  }];
  const fallbackSummary = summarizeExtractedPages(pages, { pages: 7 });
  const client = {
    async analyzeChunk() {
      return {
        objective: {
          summary: 'O plano pretende ampliar o atendimento educacional. Também busca atender populaçõe',
          evidenceThemes: ['educacao'],
        },
        themeDigests: [{
          theme: 'gestao-transparencia',
          summary: 'A proposta amplia escolas e fortalece a formação de professores da rede pública.',
          potentialImpact: 'Pode ampliar o atendimento educacional se houver execução.',
        }],
      };
    },
  };
  const summary = await createLocalLlmSummary({
    pages,
    fallbackSummary,
    client,
    themes: THEMES,
    config: { localLlmChunkCharacters: 18000, localLlmModel: 'qwen3-1.7b-local' },
  });
  const management = summary.themeSummaries.find((theme) => theme.id === 'gestao-transparencia');
  const education = summary.themeSummaries.find((theme) => theme.id === 'educacao');
  assert.equal(management.digest, null);
  assert.equal(education.proposalCount, 1);
  assert.equal(summary.candidateObjective.summary, 'O plano pretende ampliar o atendimento educacional.');
});

test('consolida propostas por tema, valida evidências e mantém impacto condicional', async () => {
  const pages = [
    {
      page: 4,
      text: 'EDUCAÇÃO. Vamos ampliar escolas em tempo integral e formar professores da rede pública em todas as regiões.',
    },
    {
      page: 9,
      text: 'SAÚDE. O programa propõe fortalecer a atenção básica e modernizar hospitais regionais para reduzir filas.',
    },
  ];
  const fallbackSummary = summarizeExtractedPages(pages, { pages: 9 });
  const client = {
    async analyzeChunk(chunk) {
      const themeDigests = [];
      if (chunk.pages.includes(4)) {
        themeDigests.push({
          theme: 'educacao',
          summary: 'Segundo o plano de governo, o candidato propõe ampliar escolas em tempo integral e formar professores.',
          potentialImpact: 'Pode ampliar o acesso à jornada integral, condicionado à implementação.',
        });
      }
      if (chunk.pages.includes(9)) {
        themeDigests.push({
          theme: 'saude',
          summary: 'Segundo o plano de governo, o candidato propõe fortalecer a atenção básica e modernizar hospitais regionais.',
          potentialImpact: 'Pode melhorar o atendimento se as ações forem executadas.',
        });
      }
      return {
        objective: {
          summary: 'O plano busca ampliar serviços públicos de educação e saúde com atendimento regional.',
          evidenceThemes: ['educacao', 'saude'],
        },
        themeDigests,
      };
    },
  };
  const summary = await createLocalLlmSummary({
    pages,
    fallbackSummary,
    client,
    themes: THEMES,
    config: {
      localLlmChunkCharacters: 2000,
      localLlmModel: 'qwen3-1.7b-local',
    },
  });
  assert.equal(summary.summaryType, 'AUTOMATIC_THEMATIC_LOCAL_LLM');
  assert.equal(summary.aiAnalysis.status, 'READY');
  assert.match(summary.candidateObjective.summary, /serviços públicos de educação e saúde/i);
  assert.equal(summary.candidateObjective.evidences[0].page, 4);
  assert.equal(summary.themeSummaries.find((theme) => theme.id === 'educacao').proposalCount, 1);
  assert.equal(summary.themeSummaries.find((theme) => theme.id === 'saude').proposalCount, 1);
  assert.equal(summary.themeSummaries.find((theme) => theme.id === 'educacao').digest.evidences[0].page, 4);
  assert.match(summary.themeSummaries.find((theme) => theme.id === 'educacao').digest.summary, /O plano de governo/i);
  assert.match(summary.themeSummaries.find((theme) => theme.id === 'educacao').digest.potentialImpact, /Se implementadas, essas medidas têm este impacto possível/i);
  assert.match(summary.notice, /hipótese condicionada.+não é previsão, garantia/i);
});

test('remove número inventado do cenário que não aparece na evidência', async () => {
  const pages = [{
    page: 2,
    text: 'A proposta pretende ampliar escolas e formar professores para fortalecer a educação pública.',
  }];
  const fallbackSummary = summarizeExtractedPages(pages, { pages: 2 });
  const client = {
    async analyzeChunk() {
      return { objective: {
        summary: 'O plano busca fortalecer a educação pública por meio da ampliação de escolas e formação docente.',
        evidenceThemes: ['educacao'],
      }, themeDigests: [{
        theme: 'educacao',
        summary: 'Segundo o plano de governo, o candidato propõe construir 500 escolas e formar professores.',
        potentialImpact: 'A medida atenderá 2 milhões de estudantes.',
      }] };
    },
  };
  const summary = await createLocalLlmSummary({
    pages,
    fallbackSummary,
    client,
    themes: THEMES,
    config: { localLlmChunkCharacters: 2000, localLlmModel: 'qwen3-1.7b-local' },
  });
  const digest = summary.themeSummaries.find((theme) => theme.id === 'educacao').digest;
  assert.doesNotMatch(digest.summary, /500/);
  assert.doesNotMatch(digest.potentialImpact, /2 milhões/);
});
