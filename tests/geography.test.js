const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBoundaries, STATE_CODE_TO_UF } = require('../src/geography');
const { stateFromCoordinates } = require('../public/geolocation');

function officialShape(count = 27) {
  return {
    type: 'FeatureCollection',
    features: Object.keys(STATE_CODE_TO_UF).slice(0, count).map((code, index) => ({
      type: 'Feature',
      properties: { codarea: code },
      geometry: {
        type: 'Polygon',
        coordinates: [[[index, 0], [index + 0.5, 0], [index + 0.5, 0.5], [index, 0]]],
      },
    })),
  };
}

test('normaliza somente as 27 UFs e remove propriedades desnecessárias', () => {
  const normalized = normalizeBoundaries(officialShape());
  assert.equal(normalized.features.length, 27);
  assert.deepEqual(normalized.features[0].properties, { uf: 'RO', ibgeCode: '11' });
});

test('rejeita uma malha incompleta', () => {
  assert.throws(() => normalizeBoundaries(officialShape(26)), /esperadas 27/);
});

test('identifica a UF no navegador sem transmitir coordenadas', () => {
  const boundaries = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { uf: 'RJ' },
      geometry: { type: 'Polygon', coordinates: [[[-44, -24], [-41, -24], [-41, -20], [-44, -20], [-44, -24]]] },
    }],
  };
  assert.equal(stateFromCoordinates(-43.1729, -22.9068, boundaries), 'RJ');
  assert.equal(stateFromCoordinates(-46.6333, -23.5505, boundaries), null);
});
