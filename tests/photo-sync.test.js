const test = require('node:test');
const assert = require('node:assert/strict');
const {
  candidateIdFromPhotoEntry,
  isJpeg,
  photoArchiveUrl,
} = require('../src/photo-sync');

test('associa a foto somente pelo identificador oficial e pela UF correta', () => {
  assert.equal(candidateIdFromPhotoEntry('FAC10002544107_div.jpg', 'AC'), '10002544107');
  assert.equal(candidateIdFromPhotoEntry('FBR280002548868_div.jpeg', 'BR'), '280002548868');
  assert.equal(candidateIdFromPhotoEntry('FAC10002544107_div.jpg', 'AL'), null);
  assert.equal(candidateIdFromPhotoEntry('../FAC10002544107_div.jpg', 'AC'), null);
});

test('aceita apenas conteúdo JPEG completo', () => {
  assert.equal(isJpeg(Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9])), true);
  assert.equal(isJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47])), false);
  assert.equal(isJpeg(Buffer.from([0xff, 0xd8, 0x00, 0x00])), false);
});

test('gera a URL oficial diária da unidade eleitoral', () => {
  assert.equal(
    photoArchiveUrl('SP'),
    'https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2026/fotos/foto_cand2026_SP_div.zip',
  );
});
