const test = require('node:test');
const assert = require('node:assert/strict');
const { effectEvidence, selectLatestLegislativeItems } = require('../src/legislative');

test('não transforma uma proposição em impacto real sem norma', () => {
  const evidence = effectEvidence('Aguardando parecer do relator');
  assert.equal(evidence.stage, 'PROPOSAL');
  assert.match(evidence.explanation, /não produz, por si só, efeito real/i);
});

test('reconhece conversão em norma sem inventar resultado social', () => {
  const evidence = effectEvidence('Transformado em Norma Jurídica');
  assert.equal(evidence.stage, 'ENACTED');
  assert.match(evidence.explanation, /não é estimado/i);
});

test('seleciona projetos e exclui requerimentos procedimentais', () => {
  const selected = selectLatestLegislativeItems([
    { Sigla: 'RQS', Data: '2026-08-16', Codigo: '3' },
    { Sigla: 'PL', Data: '2026-08-15', Codigo: '2' },
    { Sigla: 'PEC', Data: '2026-08-17', Codigo: '4' },
  ]);
  assert.deepEqual(selected.map((item) => item.Sigla), ['PEC', 'PL']);
});
