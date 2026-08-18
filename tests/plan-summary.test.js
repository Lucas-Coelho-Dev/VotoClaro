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
  assert.equal(summary.version, 'thematic-v5');
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
