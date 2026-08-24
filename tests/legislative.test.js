const test = require('node:test');
const assert = require('node:assert/strict');
const {
  effectEvidence,
  isEnactedStatus,
  authorshipFromDeputyAuthors,
  authorshipFromSenate,
  generatedNorm,
  selectLatestLegislativeItems,
} = require('../src/legislative');

test('não transforma uma proposição em impacto real sem norma', () => {
  const evidence = effectEvidence('Aguardando parecer do relator');
  assert.equal(evidence.stage, 'PROPOSAL');
  assert.match(evidence.explanation, /não produz, por si só, efeito real/i);
});

test('reconhece conversão em norma sem inventar resultado social', () => {
  const evidence = effectEvidence('Transformado em Norma Jurídica');
  assert.equal(evidence.stage, 'ENACTED');
  assert.equal(evidence.impactStatus, 'NOT_MEASURED');
  assert.match(evidence.impactExplanation, /não transforma expectativa/i);
});

test('exige confirmação detalhada da conversão em norma', () => {
  assert.equal(isEnactedStatus({ codSituacao: 1140, descricaoSituacao: 'Transformado em Norma Jurídica' }), true);
  assert.equal(isEnactedStatus({ codSituacao: 1201, descricaoSituacao: 'Aguardando despacho' }), false);
});

test('diferencia primeira assinatura, coautoria e autoria principal', () => {
  const authors = [
    { uri: 'https://dadosabertos.camara.leg.br/api/v2/deputados/10', ordemAssinatura: 1 },
    { uri: 'https://dadosabertos.camara.leg.br/api/v2/deputados/20', ordemAssinatura: 7 },
  ];
  assert.equal(authorshipFromDeputyAuthors(authors, '10').role, 'FIRST_SIGNATORY');
  assert.equal(authorshipFromDeputyAuthors(authors, '20').role, 'COAUTHOR');
  assert.equal(authorshipFromSenate({ IndicadorAutorPrincipal: 'Sim' }).role, 'PRIMARY_AUTHOR');
});

test('só aceita processo do Senado quando há norma gerada', () => {
  assert.equal(generatedNorm({ normaGerada: {} }), null);
  assert.deepEqual(generatedNorm({ normaGerada: { id: 123, identificacao: 'Lei 1/2026' } }), { id: 123, identificacao: 'Lei 1/2026' });
});

test('seleciona projetos e exclui requerimentos procedimentais', () => {
  const selected = selectLatestLegislativeItems([
    { Sigla: 'RQS', Data: '2026-08-16', Codigo: '3' },
    { Sigla: 'PL', Data: '2026-08-15', Codigo: '2' },
    { Sigla: 'PEC', Data: '2026-08-17', Codigo: '4' },
  ]);
  assert.deepEqual(selected.map((item) => item.Sigla), ['PEC', 'PL']);
});
