const test = require('node:test');
const assert = require('node:assert/strict');
const { categoryComposition, electionRecord, withChanges } = require('../src/asset-history');

test('agrupa composição patrimonial e calcula variação entre eleições', () => {
  const earlier = electionRecord(2022, [{ type: 'Imóvel', value: 100 }, { type: 'Veículo', value: 50 }], 'https://tse.example/2022');
  const current = electionRecord(2026, [{ type: 'Imóvel', value: 180 }, { type: 'Aplicação', value: 20 }], 'https://tse.example/2026');
  const history = withChanges([current, earlier]);
  assert.equal(history[1].changeFromPrevious.absolute, 50);
  assert.equal(history[1].changeFromPrevious.percentage, 50 / 150 * 100);
  assert.deepEqual(categoryComposition([{ type: 'Imóvel', value: 2 }, { type: 'Imóvel', value: 3 }]), [{ category: 'Imóvel', value: 5, count: 2 }]);
});
