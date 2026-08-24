const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chunksFromPages,
  chunksFromEvidenceSummary,
  createLocalLlmSummary,
  buildGeneralObjective,
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
          conditionsAndLimits: 'Os trechos não detalham o orçamento nem o cronograma de execução.',
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
  assert.equal(summary.candidateObjective, null);
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
          summary: 'Ampliar escolas em tempo integral e formar professores para modificar a oferta educacional da rede pública.',
          potentialImpact: 'A jornada integral pode aumentar o tempo de permanência dos estudantes na escola e mudar a rotina das famílias, se houver vagas e profissionais.',
          conditionsAndLimits: 'Os trechos não indicam quantas escolas seriam atendidas, quanto custaria a expansão nem como a aprendizagem seria medida.',
        });
      }
      if (chunk.pages.includes(9)) {
        themeDigests.push({
          theme: 'saude',
          summary: 'Fortalecer a atenção básica e modernizar hospitais regionais para modificar a organização do atendimento de saúde.',
          potentialImpact: 'A reorganização pode aproximar o primeiro atendimento da população e mudar o fluxo até os hospitais, se as ações forem executadas.',
          conditionsAndLimits: 'Os trechos não detalham o orçamento, as unidades alcançadas nem os indicadores usados para acompanhar as filas.',
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
  assert.match(summary.candidateObjective.summary, /2 temas: educação e saúde/i);
  assert.deepEqual(summary.candidateObjective.priorities.map((item) => item.id), ['educacao', 'saude']);
  assert.equal(summary.candidateObjective.evidences[0].page, 4);
  assert.equal(summary.themeSummaries.find((theme) => theme.id === 'educacao').proposalCount, 1);
  assert.equal(summary.themeSummaries.find((theme) => theme.id === 'saude').proposalCount, 1);
  assert.equal(summary.themeSummaries.find((theme) => theme.id === 'educacao').digest.evidences[0].page, 4);
  assert.match(summary.themeSummaries.find((theme) => theme.id === 'educacao').digest.summary, /Ampliar escolas/i);
  assert.match(summary.themeSummaries.find((theme) => theme.id === 'educacao').digest.potentialImpact, /rotina das famílias/i);
  assert.match(summary.themeSummaries.find((theme) => theme.id === 'educacao').digest.conditionsAndLimits, /quanto custaria/i);
  assert.match(summary.notice, /hipótese causal condicionada.+não é previsão, garantia/i);
});

test('visão geral percorre todos os nove temas antes das análises separadas', () => {
  const themeSummaries = THEMES.map((theme, index) => ({
    ...theme,
    status: 'FOUND',
    digest: {
      summary: `Prioridade principal de ${theme.label} com mudança prevista no serviço público. Detalhes adicionais.`,
      evidences: [{ page: index + 2, quote: `Trecho oficial sobre ${theme.label}.` }],
    },
  }));
  const objective = buildGeneralObjective(themeSummaries);
  assert.equal(objective.priorities.length, 9);
  assert.equal(objective.evidences.length, 9);
  assert.deepEqual(objective.pages, [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.match(objective.summary, /9 temas/i);
  THEMES.forEach((theme) => assert.match(objective.summary, new RegExp(theme.label.split(',')[0], 'i')));
});

test('explica o caminho social e as lacunas sem repetir a proposta de cultura', async () => {
  const pages = [{
    page: 28,
    text: 'Não devemos optar por eliminar o fomento à cultura, porque isso pode prejudicar artistas, grupos culturais e associações. Propomos fundir o Ministério da Cultura com o Ministério da Educação para integrar essas dimensões da formação.',
  }];
  const fallbackSummary = summarizeExtractedPages(pages, { pages: 28 });
  const client = {
    async analyzeChunk() {
      return {
        objective: {
          summary: 'O plano pretende reorganizar áreas do governo e preservar políticas públicas consideradas prioritárias.',
          evidenceThemes: ['cultura-esporte-turismo'],
        },
        themeDigests: [{
          theme: 'cultura-esporte-turismo',
          summary: 'Manter o fomento cultural e reunir Cultura e Educação em um mesmo ministério. A mudança concentraria a gestão dessas políticas em uma única estrutura federal.',
          potentialImpact: 'Artistas, grupos culturais e associações poderiam continuar disputando apoio público, enquanto escolas e políticas culturais poderiam ser coordenadas pela mesma administração. O efeito cotidiano dependeria dos programas preservados e da prioridade dada a cada área.',
          conditionsAndLimits: 'Os trechos não explicam como seria a transição entre ministérios, qual orçamento permaneceria reservado à cultura nem quais critérios definiriam o acesso ao fomento.',
        }],
      };
    },
  };
  const summary = await createLocalLlmSummary({
    pages,
    fallbackSummary,
    client,
    themes: THEMES,
    candidateName: 'RENAN SANTOS',
    config: { localLlmChunkCharacters: 2000, localLlmModel: 'qwen3-1.7b-local' },
  });
  const digest = summary.themeSummaries.find((theme) => theme.id === 'cultura-esporte-turismo').digest;
  assert.match(digest.summary, /Manter o fomento cultural/i);
  assert.match(digest.potentialImpact, /Artistas, grupos culturais e associações/i);
  assert.match(digest.conditionsAndLimits, /transição entre ministérios/i);
  assert.doesNotMatch(`${digest.summary} ${digest.potentialImpact}`, /promovendo desenvolvimento/i);
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
        conditionsAndLimits: 'Os trechos não detalham o custo nem o cronograma da implementação.',
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
