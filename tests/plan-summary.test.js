const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeExtractedPages, normalizePdfText, THEMES } = require('../src/plan-summary');

const pages = [
  { page: 3, text: '1. EDUCAÇÃO\nA proposta estabelece a criação de novas escolas de ensino integral e a formação continuada de professores da rede pública.' },
  { page: 7, text: '2. EMPREGO E ECONOMIA\nA meta é promover emprego e renda com apoio ao empreendedor, simplificação de empresas e qualificação para o trabalho.' },
  { page: 11, text: '3. TECNOLOGIA E INOVAÇÃO\nO programa pretende ampliar a conectividade, apoiar a inovação e oferecer internet nas regiões ainda não atendidas.' },
  { page: 16, text: '4. GESTÃO E TRANSPARÊNCIA\nO projeto propõe fortalecer a transparência e a eficiência administrativa com dados abertos e auditoria permanente.' },
  { page: 21, text: '5. SAÚDE\nO programa propõe ampliar a atenção básica de saúde e modernizar hospitais regionais para reduzir filas de atendimento.' },
  { page: 27, text: '6. MOBILIDADE E INFRAESTRUTURA\nO plano propõe investir em transporte público, modernizar trens e ampliar obras de infraestrutura e saneamento.' },
  { page: 31, text: '7. PROTEÇÃO SOCIAL\nA proposta pretende fortalecer a assistência social, reduzir a fome e garantir proteção às famílias em vulnerabilidade.' },
  { page: 35, text: '8. CULTURA, ESPORTE E TURISMO\nO programa pretende fomentar a cultura, ampliar espaços de esporte e desenvolver o turismo regional.' },
  { page: 39, text: '9. SEGURANÇA PÚBLICA E COMBATE AO CRIME ORGANIZADO\nO programa propõe integrar as forças de segurança, fortalecer a inteligência policial e desarticular facções criminosas.' },
];

test('organiza propostas nos nove temas fixos e preserva capítulo e página', () => {
  const summary = summarizeExtractedPages(pages, { pages: 40 });
  assert.equal(summary.available, true);
  assert.equal(summary.version, 'thematic-v8');
  assert.equal(summary.themeSummaries.length, 9);
  assert.deepEqual(summary.themeSummaries.map((theme) => theme.label), THEMES.map((theme) => theme.label));
  assert.equal(summary.themeSummaries.every((theme) => theme.status === 'FOUND'), true);
  assert.equal(summary.themeSummaries.every((theme) => theme.proposalCount >= 1 && theme.proposalCount <= 3), true);
  assert.equal(summary.themeSummaries[0].proposals[0].section, '1. EDUCAÇÃO');
  assert.equal(summary.themeSummaries[0].proposals[0].page, 3);
  assert.match(summary.notice, /ausência de trecho identificado não comprova/i);
  assert.equal(summary.document.pages, 40);
});

test('mantém os nove temas e marca com cautela o que não foi identificado', () => {
  const summary = summarizeExtractedPages([pages[0]], { pages: 1 });
  const education = summary.themeSummaries.find((theme) => theme.id === 'educacao');
  const health = summary.themeSummaries.find((theme) => theme.id === 'saude');
  assert.equal(education.status, 'FOUND');
  assert.equal(health.status, 'NOT_IDENTIFIED');
  assert.deepEqual(health.proposals, []);
  assert.match(summary.methodology.missingRule, /não que o candidato/i);
});

test('não classifica mera menção temática sem linguagem de proposta', () => {
  const summary = summarizeExtractedPages([{ page: 1, text: 'A saúde pública é mencionada neste breve histórico sobre o estado e seus municípios.' }], { pages: 1 });
  assert.equal(summary.available, false);
  assert.equal(summary.themeSummaries.find((theme) => theme.id === 'saude').status, 'NOT_IDENTIFIED');
});

test('identifica proposta de enfrentamento a facções e preserva sua localização', () => {
  const summary = summarizeExtractedPages([{
    page: 12,
    text: 'CAPÍTULO VI — SEGURANÇA PÚBLICA E COMBATE AO CRIME ORGANIZADO\nVamos criar uma força integrada para combater o tráfico de drogas e desarticular facções criminosas com inteligência policial.',
  }], { pages: 12 });
  const security = summary.themeSummaries.find((theme) => theme.id === 'seguranca-publica-crime-organizado');
  assert.equal(security.status, 'FOUND');
  assert.equal(security.proposals[0].page, 12);
  assert.equal(security.proposals[0].section, 'CAPÍTULO VI — SEGURANÇA PÚBLICA E COMBATE AO CRIME ORGANIZADO');
});

test('não transforma diagnóstico sobre facções em proposta de segurança', () => {
  const summary = summarizeExtractedPages([{
    page: 5,
    text: 'O diagnóstico estadual registra violência, tráfico de drogas e presença de facções criminosas em algumas regiões.',
  }], { pages: 5 });
  const security = summary.themeSummaries.find((theme) => theme.id === 'seguranca-publica-crime-organizado');
  assert.equal(security.status, 'NOT_IDENTIFIED');
});

test('não herda capítulo entre páginas quando a associação seria ambígua', () => {
  const summary = summarizeExtractedPages([
    { page: 4, text: 'CAPÍTULO IV — SAÚDE\nO programa pretende ampliar a atenção básica de saúde em todas as regiões.' },
    { page: 5, text: 'Também propomos modernizar hospitais e reduzir a fila de atendimento do sistema de saúde.' },
  ], { pages: 5 });
  const health = summary.themeSummaries.find((theme) => theme.id === 'saude');
  assert.equal(health.proposalCount, 2);
  assert.equal(health.proposals.find((proposal) => proposal.page === 4).section, 'CAPÍTULO IV — SAÚDE');
  assert.equal(health.proposals.find((proposal) => proposal.page === 5).section, null);
});

test('não confunde estatística ou início de proposta com título de seção', () => {
  const summary = summarizeExtractedPages([
    { page: 8, text: '1.396 pessoas participaram do levantamento publicado.\nEducação pública verdadeiramente inclusiva para todos.\nA proposta pretende ampliar escolas e garantir professores na rede pública.' },
  ], { pages: 8 });
  const education = summary.themeSummaries.find((theme) => theme.id === 'educacao');
  assert.equal(education.status, 'FOUND');
  assert.equal(education.proposals[0].section, null);
});

test('informa ausência quando não existe texto suficiente', () => {
  const summary = summarizeExtractedPages([{ page: 1, text: 'Capa' }], { pages: 1 });
  assert.equal(summary.available, false);
  assert.equal(summary.mainPoints.length, 0);
  assert.equal(summary.themeSummaries.length, 9);
});

test('corrige títulos extraídos com letras artificialmente espaçadas', () => {
  assert.equal(normalizePdfText('P L A N O   D E   G O V E R N O'), 'PLANO DE GOVERNO');
});

test('remove códigos de fonte inválidos sem apagar o texto legível', () => {
  assert.equal(
    normalizePdfText('\u001f\u001e\u001d\u001c Bolsa Família para crianças e adolescentes.'),
    'Bolsa Família para crianças e adolescentes.',
  );
});

test('remove número de página isolado antes do primeiro parágrafo', () => {
  const summary = summarizeExtractedPages([{
    page: 24,
    text: '24\n\u001f\u001e\u001d\nBolsa Família para crianças e adolescentes, com proposta de ampliar creches, fortalecer a educação e a proteção social.',
  }], { pages: 24 });
  const protection = summary.themeSummaries.find((theme) => theme.id === 'protecao-social');
  assert.equal(protection.proposalCount, 1);
  assert.match(protection.proposals[0].text, /^Bolsa Família/);
});

test('recompõe palavras quebradas entre linhas e preserva hífens semânticos', () => {
  assert.equal(
    normalizePdfText('Modernizar a infraestru-\ntura, apoiar pré-\nescolas e parcerias público-\nprivadas.'),
    'Modernizar a infraestrutura, apoiar pré-escolas e parcerias público-privadas.',
  );
  assert.equal(normalizePdfText('Vamos empregá-\nlas com responsabilidade.'), 'Vamos empregá-las com responsabilidade.');
});

test('não publica fragmento iniciado no meio da frase e capitaliza o ponto exibido', () => {
  const summary = summarizeExtractedPages([
    { page: 1, text: 'de longo prazo, vamos ampliar hospitais, modernizar a saúde e reduzir a fila de atendimento em todo o estado.' },
    { page: 2, text: 'PROPOSTA ampliar hospitais, fortalecer a saúde e reduzir a fila de atendimento em todas as regiões.' },
  ], { pages: 2 });
  const health = summary.themeSummaries.find((theme) => theme.id === 'saude');
  assert.equal(health.proposalCount, 1);
  assert.equal(health.proposals[0].page, 2);
  assert.match(health.proposals[0].text, /^Ampliar hospitais/);
  assert.match(summary.methodology.textNormalizationRule, /conteúdo político não é reescrito/i);
});

test('não publica frase interrompida no fim da página', () => {
  const summary = summarizeExtractedPages([
    { page: 10, text: 'Vamos ampliar obras de infraestrutura, transporte público, saneamento, escolas e' },
    { page: 11, text: 'Vamos ampliar obras de infraestrutura, transporte público e saneamento em todas as regiões.' },
  ], { pages: 11 });
  const mobility = summary.themeSummaries.find((theme) => theme.id === 'mobilidade-infraestrutura');
  assert.equal(mobility.proposalCount, 1);
  assert.equal(mobility.proposals[0].page, 11);
});

test('remove numeração simples de proposta e rodapé recorrente com número da página', () => {
  const footer = (page) => ({ text: `LIVROAMARELO - MISSÃO 2 0 2 6 ${String(page).split('').join(' ')}`, fontSize: 7 });
  const summary = summarizeExtractedPages([
    { page: 44, lines: [footer(44), { text: 'Texto histórico sem linguagem de proposta suficiente para classificação.', fontSize: 10.5 }] },
    { page: 45, lines: [footer(45), { text: 'Outro registro contextual sem uma proposta temática identificável.', fontSize: 10.5 }] },
    { page: 46, lines: [
      footer(46),
      { text: '10 Proteção das fronteiras propõe uma estratégia integrada com presença estatal permanente, cooperação internacional e proteção social nas regiões fronteiriças.', fontSize: 10.5 },
    ] },
  ], { pages: 46 });
  const protection = summary.themeSummaries.find((theme) => theme.id === 'protecao-social');
  assert.equal(protection.proposalCount, 1);
  assert.match(protection.proposals[0].text, /^Proteção das fronteiras/);
  assert.equal(protection.proposals[0].section, null);
});

test('recompõe acrônimo e diferencia ex-presidente de palavra quebrada', () => {
  assert.equal(normalizePdfText('tecnologia SIS-\nFRON'), 'tecnologia SISFRON');
  assert.equal(
    normalizePdfText('o poder ex-\necutivo e o ex-\npresidente'),
    'o poder executivo e o ex-presidente',
  );
});

test('remove numeração que aparece depois do rótulo proposta', () => {
  const summary = summarizeExtractedPages([{
    page: 35,
    text: 'PROPOSTA 15 déficit habitacional e informalidade do trabalho exigem criar um programa de infraestrutura e geração de emprego.',
  }], { pages: 35 });
  const economy = summary.themeSummaries.find((theme) => theme.id === 'emprego-economia');
  assert.equal(economy.proposalCount, 1);
  assert.match(economy.proposals[0].text, /^Déficit habitacional/);
});

test('separa item numerado que vem depois de uma introdução terminada em dois-pontos', () => {
  const summary = summarizeExtractedPages([{
    page: 46,
    text: 'A recuperação da soberania passa por alguns pilares. São eles:\n6 Proposta de retomada territorial pretende fortalecer a segurança pública e combater o crime organizado.',
  }], { pages: 46 });
  const security = summary.themeSummaries.find((theme) => theme.id === 'seguranca-publica-crime-organizado');
  assert.equal(security.proposalCount, 1);
  assert.match(security.proposals[0].text, /^Proposta de retomada territorial/);
});
