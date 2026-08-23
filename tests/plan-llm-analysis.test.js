const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chunksFromPages,
  createLocalLlmSummary,
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
      const proposals = [];
      if (chunk.pages.includes(4)) {
        proposals.push({
          theme: 'educacao',
          title: 'Expansão do ensino em tempo integral',
          summary: 'Ampliação das escolas em tempo integral e formação de professores da rede pública.',
          evidences: [{ page: 4, quote: 'Vamos ampliar escolas em tempo integral e formar professores da rede pública em todas as regiões.' }],
          audience: ['estudantes da rede pública'],
          requirements: ['infraestrutura escolar'],
          risks: ['execução sem profissionais suficientes'],
          indicators: ['matrículas em tempo integral'],
          missingInformation: ['custo total'],
          fourYearScenario: {
            firstYear: 'Planejamento e preparação da rede escolar.',
            yearsTwoAndThree: 'Possível expansão gradual das escolas e da formação.',
            fourthYear: 'A cobertura poderá crescer se houver execução e recursos.',
            potentialImpact: 'Pode ampliar o acesso à jornada integral, condicionado à implementação.',
          },
        });
      }
      if (chunk.pages.includes(9)) {
        proposals.push({
          theme: 'saude',
          title: 'Atenção básica e hospitais regionais',
          summary: 'Fortalecimento da atenção básica e modernização de hospitais regionais.',
          evidences: [{ page: 9, quote: 'O programa propõe fortalecer a atenção básica e modernizar hospitais regionais para reduzir filas.' }],
          audience: ['usuários da rede pública de saúde'],
          requirements: ['equipes e estrutura de atendimento'],
          risks: [],
          indicators: ['tempo de espera'],
          missingInformation: ['fonte dos recursos'],
          fourYearScenario: {
            firstYear: 'Organização das prioridades de atendimento.',
            yearsTwoAndThree: 'Execução condicionada à capacidade da rede.',
            fourthYear: 'Consolidação condicionada à continuidade das ações.',
            potentialImpact: 'Pode melhorar o atendimento se as ações forem executadas.',
          },
        });
      }
      return { proposals };
    },
  };
  const summary = await createLocalLlmSummary({
    pages,
    fallbackSummary,
    client,
    themes: THEMES,
    config: {
      localLlmChunkCharacters: 2000,
      localLlmModel: 'qwen3-4b-local',
    },
  });
  assert.equal(summary.summaryType, 'AUTOMATIC_THEMATIC_LOCAL_LLM');
  assert.equal(summary.aiAnalysis.status, 'READY');
  assert.equal(summary.themeSummaries.find((theme) => theme.id === 'educacao').proposalCount, 1);
  assert.equal(summary.themeSummaries.find((theme) => theme.id === 'saude').proposalCount, 1);
  assert.equal(summary.themeSummaries.find((theme) => theme.id === 'educacao').proposals[0].evidences[0].page, 4);
  assert.match(summary.notice, /inferências, não previsões nem garantias/i);
});

test('remove número inventado do cenário que não aparece na evidência', async () => {
  const pages = [{
    page: 2,
    text: 'A proposta pretende ampliar escolas e formar professores para fortalecer a educação pública.',
  }];
  const fallbackSummary = summarizeExtractedPages(pages, { pages: 2 });
  const client = {
    async analyzeChunk() {
      return { proposals: [{
        theme: 'educacao',
        title: 'Fortalecimento da educação pública',
        summary: 'Ampliação das escolas e formação de professores.',
        evidences: [{ page: 2, quote: 'A proposta pretende ampliar escolas e formar professores para fortalecer a educação pública.' }],
        audience: ['2 milhões de estudantes'],
        requirements: ['orçamento de 900 milhões'],
        risks: [], indicators: [], missingInformation: [],
        fourYearScenario: {
          firstYear: 'Construção de 500 escolas.',
          yearsTwoAndThree: '', fourthYear: '', potentialImpact: 'Atenderá 2 milhões de estudantes.',
        },
      }] };
    },
  };
  const summary = await createLocalLlmSummary({
    pages,
    fallbackSummary,
    client,
    themes: THEMES,
    config: { localLlmChunkCharacters: 2000, localLlmModel: 'qwen3-4b-local' },
  });
  const proposal = summary.themeSummaries.find((theme) => theme.id === 'educacao').proposals[0];
  assert.doesNotMatch(proposal.fourYearScenario.firstYear, /500/);
  assert.doesNotMatch(proposal.fourYearScenario.potentialImpact, /2 milhões/);
  assert.deepEqual(proposal.audience, []);
  assert.deepEqual(proposal.requirements, []);
});
