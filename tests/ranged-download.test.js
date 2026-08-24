const test = require('node:test');
const assert = require('node:assert/strict');
const { downloadByRanges } = require('../src/ranged-download');

test('recompõe arquivo oficial por faixas e valida a posição de cada bloco', async (t) => {
  const originalFetch = global.fetch;
  const source = Buffer.from('PK-ARQUIVO-OFICIAL');
  global.fetch = async (url, options) => {
    assert.equal(options.headers['User-Agent'], undefined);
    const match = String(options.headers.Range).match(/bytes=(\d+)-(\d+)/);
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), source.length - 1);
    return new Response(source.subarray(start, end + 1), {
      status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${source.length}` },
    });
  };
  t.after(() => { global.fetch = originalFetch; });

  const result = await downloadByRanges('https://fonte-oficial.example/arquivo.zip', {
    headers: { Accept: 'application/zip', 'User-Agent': 'VotoClaro/teste' },
    maxBytes: 100,
    chunkSize: 5,
  });
  assert.deepEqual(result, source);
});

test('interrompe download quando o tamanho oficial excede o limite', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(Buffer.from('PK'), {
    status: 206,
    headers: { 'Content-Range': 'bytes 0-1/1000' },
  });
  t.after(() => { global.fetch = originalFetch; });

  await assert.rejects(downloadByRanges('https://fonte-oficial.example/grande.zip', {
    maxBytes: 100,
    chunkSize: 2,
  }), /limite de segurança/);
});
