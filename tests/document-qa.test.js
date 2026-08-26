const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOfficialEvidence, selectEvidence } = require('../src/document-qa');

test('seleciona apenas evidências relacionadas à pergunta', () => {
  const selected = selectEvidence('O que propõe para educação?', [
    { kind: 'Plano', label: 'Educação', text: 'Construir escolas de ensino médio.', url: '/a' },
    { kind: 'Plano', label: 'Saúde', text: 'Construir hospitais regionais.', url: '/b' },
  ]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].label, 'Educação');
  assert.equal(selected[0].id, 'F1');
});
test('preserva página e URL oficial do plano', () => {
  const evidences = buildOfficialEvidence('educação escolas', {
    themeSummaries: [{ id: 'educacao', label: 'Educação', proposals: [{ text: 'Ampliar escolas de tempo integral.', page: 12 }] }],
  }, null, '123');
  assert.equal(evidences[0].page, 12);
  assert.match(evidences[0].url, /government-plan#page=12$/);
});
