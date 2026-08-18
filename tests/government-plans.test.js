const test = require('node:test');
const assert = require('node:assert/strict');
const { candidatePlanEntry, electionUnitForCandidate, archiveUrl } = require('../src/government-plans');

test('associa proposta somente pelo identificador exato da candidatura', () => {
  const candidate = { office: 'GOVERNADOR', uf: 'RJ', tseId: '190002537524' };
  const entries = [
    { entryName: 'RJ/2026RJ190002537524_01.pdf', isDirectory: false },
    { entryName: 'RJ/2026RJ190002537525_01.pdf', isDirectory: false },
  ];
  assert.equal(candidatePlanEntry(entries, candidate), entries[0]);
  assert.equal(electionUnitForCandidate(candidate), 'RJ');
});

test('usa BR para presidente e não cria plano para cargo sem pacote do TSE', () => {
  assert.equal(electionUnitForCandidate({ office: 'PRESIDENTE', uf: 'BR' }), 'BR');
  assert.equal(electionUnitForCandidate({ office: 'SENADOR', uf: 'RJ' }), null);
  assert.match(archiveUrl('BR'), /proposta_governo_2026_BR\.zip$/);
});
