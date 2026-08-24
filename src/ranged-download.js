async function downloadByRanges(url, { signal, headers = {}, maxBytes, chunkSize = 4 * 1024 * 1024 }) {
  const rangeHeaders = { ...headers };
  // O CDN do TSE aceita Range, mas em alguns pontos de presença recusa o
  // identificador personalizado no pedido parcial. O cliente HTTP ainda envia
  // seu User-Agent padrão; retiramos apenas a personalização que dispara o 403.
  delete rangeHeaders['User-Agent'];
  delete rangeHeaders['user-agent'];
  delete rangeHeaders['If-None-Match'];
  delete rangeHeaders['if-none-match'];
  delete rangeHeaders['If-Modified-Since'];
  delete rangeHeaders['if-modified-since'];
  const chunks = [];
  let offset = 0;
  let totalSize = null;
  while (totalSize === null || offset < totalSize) {
    const response = await fetch(url, {
      signal,
      headers: {
        ...rangeHeaders,
        Range: `bytes=${offset}-${offset + chunkSize - 1}`,
        'Accept-Encoding': 'identity',
      },
    });
    if (response.status !== 206) throw new Error(`HTTP ${response.status} ao baixar faixa oficial.`);
    const contentRange = String(response.headers.get('content-range') || '');
    const match = contentRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
    if (!match || Number(match[1]) !== offset) throw new Error('O servidor oficial devolveu uma faixa de bytes inválida.');
    totalSize = Number(match[3]);
    if (!Number.isSafeInteger(totalSize) || totalSize <= 0 || totalSize > maxBytes) {
      throw new Error('Arquivo excede o limite de segurança configurado.');
    }
    const chunk = Buffer.from(await response.arrayBuffer());
    const expectedLength = Number(match[2]) - Number(match[1]) + 1;
    if (chunk.length !== expectedLength) throw new Error('O servidor oficial interrompeu uma faixa do arquivo.');
    chunks.push(chunk);
    offset += chunk.length;
  }
  const buffer = Buffer.concat(chunks, totalSize);
  if (buffer.length !== totalSize) throw new Error('O download oficial por faixas ficou incompleto.');
  return buffer;
}

module.exports = { downloadByRanges };
