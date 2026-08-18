const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { SOURCES } = require('./sources');

const PHOTO_UNITS = Object.freeze([
  'AC', 'AL', 'AM', 'AP', 'BA', 'BR', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]);

function photoArchiveUrl(unit) {
  return SOURCES.tsePhotos.archiveUrlTemplate.replace('{UF}', encodeURIComponent(unit));
}

function candidateIdFromPhotoEntry(entryName, unit) {
  if (!entryName || /[\\/]/.test(entryName)) return null;
  const escapedUnit = String(unit).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(entryName).match(new RegExp(`^F${escapedUnit}(\\d+)_div\\.jpe?g$`, 'i'));
  return match?.[1] || null;
}

function imageSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isJpeg(buffer) {
  return buffer.length >= 4
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer.at(-2) === 0xff
    && buffer.at(-1) === 0xd9;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}

class CandidatePhotoSync {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.running = null;
  }

  isRunning() {
    return Boolean(this.running);
  }

  async synchronize(candidates, trigger = 'official-pipeline') {
    if (this.running) return this.running;
    this.running = this.run(candidates, trigger).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async run(candidates, trigger) {
    const startedAt = new Date().toISOString();
    const idsByUnit = new Map();
    for (const candidate of candidates) {
      const unit = PHOTO_UNITS.includes(candidate.uf) ? candidate.uf : candidate.electionUnit;
      if (!PHOTO_UNITS.includes(unit)) continue;
      if (!idsByUnit.has(unit)) idsByUnit.set(unit, new Set());
      idsByUnit.get(unit).add(candidate.id);
    }

    const candidateIds = candidates.map((candidate) => candidate.id);
    const existingBefore = await this.store.availablePhotoIds(candidateIds);
    const units = PHOTO_UNITS.filter((unit) => idsByUnit.has(unit));
    const unitResults = await mapWithConcurrency(
      units,
      this.config.photoSyncConcurrency,
      async (unit) => this.synchronizeUnit(unit, idsByUnit.get(unit), existingBefore),
    );

    const failures = unitResults.filter((result) => result.status === 'FAILED');
    const available = await this.hydrate(candidates);
    const finishedAt = new Date().toISOString();
    const status = {
      state: failures.length ? (available.size ? 'PARTIAL' : 'ERROR') : 'OK',
      lastSuccessAt: available.size ? finishedAt : null,
      lastAttemptAt: finishedAt,
      records: available.size,
      message: failures.length
        ? `${available.size.toLocaleString('pt-BR')} fotos oficiais disponíveis; ${failures.length} arquivo(s) por UF falharam nesta tentativa.`
        : `${available.size.toLocaleString('pt-BR')} fotos oficiais associadas pelo identificador único da candidatura.`,
      failedUnits: failures.map((result) => result.unit),
    };

    await this.store.recordRun({
      sourceId: SOURCES.tsePhotos.id,
      status: failures.length ? (available.size ? 'PARTIAL' : 'FAILED') : 'SUCCESS',
      startedAt,
      finishedAt,
      recordCount: available.size,
      error: failures.length ? failures.map((result) => `${result.unit}: ${result.error}`).join('; ') : null,
      trigger,
    });

    return { status, availableCount: available.size, unitResults, finishedAt };
  }

  async synchronizeUnit(unit, candidateIds, existingBefore) {
    const sourceUrl = photoArchiveUrl(unit);
    const previousState = this.store.getPhotoSyncState(unit) || {};
    const existingForUnit = [...candidateIds].filter((id) => existingBefore.has(id)).length;
    const mayUseConditional = existingForUnit > 0 && existingForUnit >= (previousState.recordCount || 0);
    const headers = {
      Accept: 'application/zip, application/octet-stream',
      'User-Agent': 'VotoClaro/2.0 (+https://votoclaro.org; dados-publicos)',
    };
    if (mayUseConditional && previousState.etag) headers['If-None-Match'] = previousState.etag;
    if (mayUseConditional && previousState.lastModified) headers['If-Modified-Since'] = previousState.lastModified;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await fetch(sourceUrl, { signal: controller.signal, headers });
      if (response.status === 304) {
        await this.store.savePhotoSyncState(unit, {
          ...previousState,
          unit,
          sourceUrl,
          checkedAt: new Date().toISOString(),
        });
        return { unit, status: 'NOT_MODIFIED', records: previousState.recordCount || existingForUnit };
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declaredSize = Number.parseInt(response.headers.get('content-length') || '0', 10);
      if (declaredSize > this.config.maxDownloadBytes) throw new Error('Arquivo de fotos excede o limite configurado.');
      const archiveBuffer = Buffer.from(await response.arrayBuffer());
      if (archiveBuffer.length > this.config.maxDownloadBytes) throw new Error('Arquivo de fotos excede o limite configurado.');

      const sourceUpdatedAt = (() => {
        const lastModified = response.headers.get('last-modified');
        const parsed = lastModified ? new Date(lastModified) : new Date();
        return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
      })();
      const zip = new AdmZip(archiveBuffer);
      const photos = [];
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory || entry.header.size > this.config.maxCandidatePhotoBytes) continue;
        const candidateId = candidateIdFromPhotoEntry(entry.entryName, unit);
        if (!candidateId || !candidateIds.has(candidateId)) continue;
        const buffer = entry.getData();
        if (!isJpeg(buffer) || buffer.length > this.config.maxCandidatePhotoBytes) continue;
        photos.push({
          candidateId,
          buffer,
          contentType: 'image/jpeg',
          sha256: imageSha256(buffer),
          sourceUnit: unit,
          sourceUpdatedAt,
        });
        if (photos.length >= 250) {
          await this.store.saveCandidatePhotos(photos.splice(0));
        }
      }
      if (photos.length) await this.store.saveCandidatePhotos(photos);

      const availableAfterUnit = await this.store.availablePhotoIds([...candidateIds]);
      const state = {
        unit,
        sourceUrl,
        etag: response.headers.get('etag') || null,
        lastModified: response.headers.get('last-modified') || null,
        checkedAt: new Date().toISOString(),
        updatedAt: sourceUpdatedAt,
        recordCount: availableAfterUnit.size,
      };
      await this.store.savePhotoSyncState(unit, state);
      return { unit, status: 'UPDATED', records: availableAfterUnit.size, bytes: archiveBuffer.length };
    } catch (error) {
      const message = error.name === 'AbortError' ? 'Tempo limite na fonte oficial.' : error.message;
      return { unit, status: 'FAILED', error: message };
    } finally {
      clearTimeout(timeout);
    }
  }

  async hydrate(candidates) {
    const available = await this.store.availablePhotoIds(candidates.map((candidate) => candidate.id));
    for (const candidate of candidates) {
      if (!available.has(candidate.id)) {
        candidate.photoUrl = null;
        candidate.photo = null;
        continue;
      }
      const unit = PHOTO_UNITS.includes(candidate.uf) ? candidate.uf : candidate.electionUnit;
      const state = this.store.getPhotoSyncState(unit) || {};
      candidate.photoUrl = `/api/v1/candidates/${encodeURIComponent(candidate.id)}/photo`;
      candidate.photo = {
        sourceId: SOURCES.tsePhotos.id,
        sourceUrl: SOURCES.tsePhotos.url,
        sourceUnit: unit,
        updatedAt: state.updatedAt || state.checkedAt || null,
      };
      if (!candidate.sources.some((source) => source.id === SOURCES.tsePhotos.id)) {
        candidate.sources.push({
          id: SOURCES.tsePhotos.id,
          name: SOURCES.tsePhotos.name,
          authority: SOURCES.tsePhotos.authority,
          url: SOURCES.tsePhotos.url,
          confidence: 'OFFICIAL',
          generatedAt: candidate.photo.updatedAt,
        });
      }
    }
    return available;
  }
}

module.exports = {
  CandidatePhotoSync,
  PHOTO_UNITS,
  candidateIdFromPhotoEntry,
  imageSha256,
  isJpeg,
  photoArchiveUrl,
};
