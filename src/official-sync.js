const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');
const { SOURCES } = require('./sources');
const {
  normalizeCandidate,
  normalizeAsset,
  normalizeSocial,
  attachCandidateComplement,
  attachRelatedData,
  sourceGeneratedAt,
  checksum,
  candidateChanges,
} = require('./normalize');
const { enrichCandidatesWithLegislativeLinks } = require('./legislative');

class OfficialDataSync {
  constructor(config, store, photoSynchronizer, identityVault = null) {
    this.config = config;
    this.store = store;
    this.photoSynchronizer = photoSynchronizer;
    this.identityVault = identityVault;
    this.running = null;
  }

  isRunning() {
    return Boolean(this.running);
  }

  async synchronize(trigger = 'scheduled') {
    if (this.running) return this.running;
    this.running = this.run(trigger).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async run(trigger) {
    const startedAt = new Date().toISOString();
    const statuses = {};
    try {
      const resourceEntries = [
        ['candidates', SOURCES.tseCandidates],
        ['candidateComplement', SOURCES.tseCandidateComplement],
        ['assets', SOURCES.tseAssets],
        ['social', SOURCES.tseSocial],
        ['revenues', SOURCES.tseRevenue],
        ['expenses', SOURCES.tseExpense],
      ];

      const results = await Promise.all(resourceEntries.map(async ([key, source]) => {
        const sourceStartedAt = new Date().toISOString();
        try {
          const records = await this.downloadZipRecords(source.resourceUrl);
          statuses[source.id] = {
            state: 'OK',
            lastSuccessAt: new Date().toISOString(),
            records: records.length,
            message: `${records.length.toLocaleString('pt-BR')} registros recebidos.`,
          };
          await this.store.recordRun({
            sourceId: source.id,
            status: 'SUCCESS',
            startedAt: sourceStartedAt,
            finishedAt: new Date().toISOString(),
            recordCount: records.length,
          });
          return [key, records];
        } catch (error) {
          statuses[source.id] = {
            state: source.optional ? 'UNAVAILABLE' : 'ERROR',
            lastAttemptAt: new Date().toISOString(),
            message: source.optional
              ? 'O arquivo ainda não está disponível ou a fonte recusou a consulta.'
              : 'Falha ao consultar a fonte oficial.',
            error: error.message,
          };
          await this.store.recordRun({
            sourceId: source.id,
            status: source.optional ? 'UNAVAILABLE' : 'FAILED',
            startedAt: sourceStartedAt,
            finishedAt: new Date().toISOString(),
            error: error.message,
          });
          if (!source.optional) throw error;
          return [key, []];
        }
      }));

      const datasets = Object.fromEntries(results);
      const candidateRows = datasets.candidates || [];
      // O CPF publicado no pacote do TSE é usado somente para vínculos exatos com
      // cadastros oficiais. Ele permanece na memória e nunca entra no snapshot público.
      if (this.identityVault) this.identityVault.replace(candidateRows);
      // Alguns pacotes nacionais incluem um consolidado e arquivos por UF.
      // A chave oficial impede que a mesma candidatura ou declaração seja somada duas vezes.
      const candidates = [...new Map(
        candidateRows.map(normalizeCandidate).filter(Boolean).map((item) => [item.id, item]),
      ).values()];
      const assets = [...new Map(
        (datasets.assets || []).map(normalizeAsset).filter(Boolean).map((item) => [
          `${item.candidateId}|${item.order ?? `${item.type}|${item.description}`}`,
          item,
        ]),
      ).values()];
      const social = [...new Map(
        (datasets.social || []).map(normalizeSocial).filter(Boolean).map((item) => [
          `${item.candidateId}|${item.url}`,
          item,
        ]),
      ).values()];
      attachCandidateComplement(candidates, datasets.candidateComplement || []);
      attachRelatedData(candidates, assets, social, datasets.revenues || [], datasets.expenses || []);
      try {
        if (this.config.syncPhotos) {
          const photoResult = await this.photoSynchronizer.synchronize(candidates, trigger);
          statuses[SOURCES.tsePhotos.id] = photoResult.status;
        } else {
          const availablePhotos = await this.photoSynchronizer.hydrate(candidates);
          statuses[SOURCES.tsePhotos.id] = {
            state: 'NOT_SYNCED',
            records: availablePhotos.size,
            message: 'Sincronização de fotos desativada; usando somente o cache oficial existente.',
          };
        }
      } catch (error) {
        const availablePhotos = await this.photoSynchronizer.hydrate(candidates);
        statuses[SOURCES.tsePhotos.id] = {
          state: availablePhotos.size ? 'PARTIAL' : 'ERROR',
          lastAttemptAt: new Date().toISOString(),
          records: availablePhotos.size,
          message: availablePhotos.size
            ? 'A atualização das fotos falhou; o último cache oficial válido foi preservado.'
            : 'A fonte oficial de fotos não respondeu e ainda não há cache disponível.',
          error: error.message,
        };
      }
      const legislative = await enrichCandidatesWithLegislativeLinks(candidates, this.config);
      Object.assign(statuses, legislative.statuses);
      candidates.sort((a, b) => a.ballotName.localeCompare(b.ballotName, 'pt-BR'));

      const previous = this.store.getSnapshot();
      const importedAt = new Date().toISOString();
      const generatedDates = candidateRows.map(sourceGeneratedAt).filter(Boolean).sort();
      const sourceGeneratedAtValue = generatedDates.at(-1) || null;
      const coreChecksum = checksum(candidates);
      const changes = candidateChanges(previous?.candidates || [], candidates).map((change) => ({
        ...change,
        detectedAt: importedAt,
        sourceId: SOURCES.tseCandidates.id,
      }));
      const snapshot = {
        meta: {
          electionYear: 2026,
          importedAt,
          sourceGeneratedAt: sourceGeneratedAtValue,
          candidateCount: candidates.length,
          photoCount: candidates.filter((candidate) => candidate.photoUrl).length,
          legislativeLinks: legislative.linked,
          checksum: coreChecksum,
          trigger,
          dataPolicy: 'Somente dados oficiais publicados; ausência de dado nunca é preenchida por estimativa.',
        },
        sourceStatuses: statuses,
        changes,
        candidates,
      };
      await this.store.saveSnapshot(snapshot);
      await this.store.recordRun({
        sourceId: 'votoclaro-pipeline',
        status: 'SUCCESS',
        startedAt,
        finishedAt: importedAt,
        recordCount: candidates.length,
      });
      return snapshot.meta;
    } catch (error) {
      await this.store.recordRun({
        sourceId: 'votoclaro-pipeline',
        status: 'FAILED',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: error.message,
      });
      throw error;
    }
  }

  async downloadZipRecords(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/zip, application/octet-stream',
          'User-Agent': 'VotoClaro/2.0 (+https://votoclaro.org; dados-publicos)',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} em ${new URL(url).hostname}`);
      const declaredSize = Number.parseInt(response.headers.get('content-length') || '0', 10);
      if (declaredSize > this.config.maxDownloadBytes) throw new Error('Arquivo excede o limite de segurança configurado.');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > this.config.maxDownloadBytes) throw new Error('Arquivo excede o limite de segurança configurado.');
      return this.parseZip(buffer);
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(`Tempo limite ao consultar ${new URL(url).hostname}`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  parseZip(buffer) {
    const zip = new AdmZip(buffer);
    const records = [];
    const entries = zip.getEntries().filter((entry) => !entry.isDirectory && /\.(csv|txt)$/i.test(entry.entryName));
    if (!entries.length) throw new Error('O pacote oficial não contém arquivos CSV.');
    for (const entry of entries) {
      const csv = entry.getData().toString('latin1');
      const parsed = parse(csv, {
        columns: true,
        delimiter: ';',
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
        trim: true,
      });
      records.push(...parsed);
    }
    return records;
  }
}

module.exports = { OfficialDataSync };
