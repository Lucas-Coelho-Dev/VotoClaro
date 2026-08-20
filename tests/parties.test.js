const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalParty,
  PARTY_DATA,
  PARTY_PALETTES,
  broadBucket,
  getPartyIdeology,
  partyVisual,
  partyMarkSvg,
} = require('../src/parties');

test('classifica as três faixas amplas sem rotular a candidatura', () => {
  assert.equal(getPartyIdeology('PT').bucket, 'ESQUERDA');
  assert.equal(getPartyIdeology('MDB').bucket, 'CENTRO');
  assert.equal(getPartyIdeology('PL').bucket, 'DIREITA');
  assert.match(getPartyIdeology('PT').candidateCaveat, /partido/i);
});

test('usa limites explícitos da classificação ampla', () => {
  assert.equal(broadBucket(3), 'ESQUERDA');
  assert.equal(broadBucket(3.01), 'CENTRO');
  assert.equal(broadBucket(7), 'CENTRO');
  assert.equal(broadBucket(7.01), 'DIREITA');
  assert.equal(broadBucket(null), 'NAO_CLASSIFICADO');
});

test('preserva continuidade documentada apenas em mudanças de nome', () => {
  assert.equal(canonicalParty('Mobiliza'), 'MOBILIZA');
  assert.equal(canonicalParty('PMN'), 'MOBILIZA');
  assert.equal(getPartyIdeology('MOBILIZA').sourceParty, 'PMN');
  assert.equal(canonicalParty('PMB'), 'DEMOCRATA');
  assert.equal(getPartyIdeology('DEMOCRATA').sourceParty, 'PMB');
});

test('não inventa nota para partidos sem avaliação própria', () => {
  assert.equal(getPartyIdeology('PRD').bucket, 'NAO_CLASSIFICADO');
  assert.equal(getPartyIdeology('MISSÃO').bucket, 'NAO_CLASSIFICADO');
  assert.equal(getPartyIdeology('PARTIDO FUTURO').score, null);
});

test('gera uma imagem SVG colorida com sigla e número oficiais', () => {
  assert.deepEqual(partyVisual('União'), {
    sigla: 'UNIAO',
    number: 44,
    name: 'União Brasil',
    palette: PARTY_PALETTES.UNIAO,
  });
  const svg = partyMarkSvg('PT');
  assert.match(svg, /^<svg/);
  assert.match(svg, />PT<\/text>/);
  assert.match(svg, />13<\/text>/);
  assert.match(svg, /#C8102E/);
});

test('todos os partidos catalogados têm paleta própria de identificação', () => {
  assert.deepEqual(Object.keys(PARTY_PALETTES).sort(), Object.keys(PARTY_DATA).sort());
  assert.equal(partyVisual('PT').palette.primary, '#C8102E');
  assert.equal(partyVisual('NOVO').palette.primary, '#D85B00');
  assert.equal(partyVisual('PV').palette.primary, '#087A3D');
});

test('a imagem SVG elimina marcação injetada', () => {
  const svg = partyMarkSvg('<script>alert(1)</script>');
  assert.doesNotMatch(svg, /<script>/i);
  assert.doesNotMatch(svg, /alert\(1\)/i);
});
