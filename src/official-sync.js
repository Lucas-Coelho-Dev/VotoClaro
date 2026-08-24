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
  attachRunningMates,
  isVoterFacingOffice,
} = require('./normalize');
const { enrichCandidatesWithLegislativeLinks } = require('./legislative');
const { downloadByRanges } = require('./ranged-download');

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
    const previous = this.store.getSnapshot();
    const previousStatuses = previous?.sourceStatuses || {};
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
          const finishedAt = new Date().toISOString();
          statuses[source.id] = {
            state: 'OK',
            lastAttemptAt: finishedAt,
            lastSuccessAt: finishedAt,
            records: records.length,
            consecutiveFailures: 0,
            alert: false,
            message: `${records.length.toLocaleString('pt-BR')} registros recebidos.`,
          };
          await this.store.recordRun({
            sourceId: source.id,
            status: 'SUCCESS',
            startedAt: sourceStartedAt,
            finishedAt,
            recordCount: records.length,
          });
          return [key, records];
        } catch (error) {
          const lastStatus = previousStatuses[source.id] || {};
          const consecutiveFailures = Number(lastStatus.consecutiveFailures || 0) + 1;
          statuses[source.id] = {
            state: source.optional ? 'UNAVAILABLE' : 'ERROR',
            lastAttemptAt: new Date().toISOString(),
            lastSuccessAt: lastStatus.lastSuccessAt || null,
            consecutiveFailures,
            alert: true,
            message: source.optional
              ? 'A fonte não respondeu nesta tentativa. A última versão válida deste conjunto foi preservada quando disponível.'
              : 'Falha ao consultar a fonte oficial.',
            error: error.message,
          };
          console.error(`[ALERTA DE FONTE] ${source.id} falhou pela ${consecutiveFailures}ª vez consecutiva: ${error.message}`);
          await this.store.recordRun({
            sourceId: source.id,
            status: source.optional ? 'UNAVAILABLE' : 'FAILED',
            startedAt: sourceStartedAt,
            finishedAt: new Date().toISOString(),
            error: error.message,
          });
          return [key, null];
        }
      }));

      const datasets = Object.fromEntries(results);
      if (!datasets.candidates) {
        throw new Error(statuses[SOURCES.tseCandidates.id]?.error || 'A fonte principal de candidaturas não respondeu.');
      }
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
      const previousById = new Map((previous?.candidates || []).map((candidate) => [candidate.id, candidate]));
      if (datasets.candidateComplement) {
        attachCandidateComplement(candidates, datasets.candidateComplement);
      } else {
        const complementFields = [
          'judgmentStatus', 'electionStatus', 'ballotStatus', 'registrationProcess', 'acceptedAt',
          'maximumCampaignExpense', 'declaredAssets', 'insertedInBallot', 'replaced',
          'nationality', 'birthplace',
        ];
        for (const candidate of candidates) {
          const old = previousById.get(candidate.id);
          if (!old) continue;
          for (const field of complementFields) {
            if (old[field] !== undefined) candidate[field] = old[field];
          }
        }
      }
      attachRelatedData(
        candidates,
        datasets.assets ? assets : [],
        datasets.social ? social : [],
        datasets.revenues || [],
        datasets.expenses || [],
      );
      for (const candidate of candidates) {
        const old = previousById.get(candidate.id);
        if (!old) continue;
        if (!datasets.assets) {
          candidate.assets = old.assets || [];
          candidate.assetTotal = Number(old.assetTotal) || 0;
        }
        if (!datasets.social) candidate.socialLinks = old.socialLinks || [];
        if (!datasets.revenues || !datasets.expenses) {
          const currentFinance = candidate.finance || {};
          const oldFinance = old.finance || {};
          const totalRevenue = datasets.revenues
            ? Number(currentFinance.totalRevenue || 0)
            : Number(oldFinance.totalRevenue || 0);
          const totalExpense = datasets.expenses
            ? Number(currentFinance.totalExpense || 0)
            : Number(oldFinance.totalExpense || 0);
          const revenueRecords = datasets.revenues
            ? Number(currentFinance.revenueRecords || 0)
            : Number(oldFinance.revenueRecords || 0);
          const expenseRecords = datasets.expenses
            ? Number(currentFinance.expenseRecords || 0)
            : Number(oldFinance.expenseRecords || 0);
          candidate.finance = (revenueRecords || expenseRecords || old.finance) ? {
            totalRevenue,
            totalExpense,
            revenueRecords,
            expenseRecords,
            balance: totalRevenue - totalExpense,
            note: 'Valores publicados pela Justiça Eleitoral; conjuntos temporariamente indisponíveis mantêm a última versão oficial válida.',
          } : null;
        }
        const preservedSourceIds = [
          !datasets.candidateComplement && SOURCES.tseCandidateComplement.id,
          !datasets.assets && SOURCES.tseAssets.id,
          !datasets.social && SOURCES.tseSocial.id,
          (!datasets.revenues || !datasets.expenses) && SOURCES.tseRevenue.id,
          (!datasets.revenues || !datasets.expenses) && SOURCES.tseExpense.id,
        ].filter(Boolean);
        for (const source of old.sources || []) {
          if (preservedSourceIds.includes(source.id) && !candidate.sources.some((item) => item.id === source.id)) {
            candidate.sources.push(source);
          }
        }
      }
      try {
        if (this.config.syncPhotos) {
          const photoResult = await this.photoSynchronizer.synchronize(candidates, trigger);
          statuses[SOURCES.tsePhotos.id] = {
            ...photoResult.status,
            lastAttemptAt: photoResult.status?.updatedAt || new Date().toISOString(),
            lastSuccessAt: photoResult.status?.updatedAt || new Date().toISOString(),
            consecutiveFailures: 0,
            alert: false,
          };
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
        const previousPhotoStatus = previousStatuses[SOURCES.tsePhotos.id] || {};
        statuses[SOURCES.tsePhotos.id] = {
          state: availablePhotos.size ? 'PARTIAL' : 'ERROR',
          lastAttemptAt: new Date().toISOString(),
          lastSuccessAt: previousPhotoStatus.lastSuccessAt || previousPhotoStatus.updatedAt || null,
          records: availablePhotos.size,
          consecutiveFailures: Number(previousPhotoStatus.consecutiveFailures || 0) + 1,
          alert: true,
          message: availablePhotos.size
            ? 'A atualização das fotos falhou; o último cache oficial válido foi preservado.'
            : 'A fonte oficial de fotos não respondeu e ainda não há cache disponível.',
          error: error.message,
        };
      }
      const voterCandidates = attachRunningMates(candidates);
      const legislative = await enrichCandidatesWithLegislativeLinks(voterCandidates, this.config);
      Object.assign(statuses, legislative.statuses);
      voterCandidates.sort((a, b) => a.ballotName.localeCompare(b.ballotName, 'pt-BR'));

      const importedAt = new Date().toISOString();
      const generatedDates = candidateRows.map(sourceGeneratedAt).filter(Boolean).sort();
      const sourceGeneratedAtValue = generatedDates.at(-1) || null;
      const coreChecksum = checksum(voterCandidates);
      const previousVoterCandidates = (previous?.candidates || []).filter(isVoterFacingOffice);
      const changes = candidateChanges(previousVoterCandidates, voterCandidates).map((change) => ({
        ...change,
        detectedAt: importedAt,
        sourceId: SOURCES.tseCandidates.id,
      }));
      const snapshot = {
        meta: {
          electionYear: 2026,
          importedAt,
          sourceGeneratedAt: sourceGeneratedAtValue,
          candidateCount: voterCandidates.length,
          relatedCandidateCount: voterCandidates.reduce((total, candidate) => total + candidate.runningMates.length, 0),
          photoCount: voterCandidates.filter((candidate) => candidate.photoUrl).length,
          legislativeLinks: legislative.linked,
          checksum: coreChecksum,
          trigger,
          dataPolicy: 'Somente dados oficiais publicados; ausência de dado nunca é preenchida por estimativa.',
        },
        sourceStatuses: statuses,
        changes,
        candidates: voterCandidates,
      };
      await this.store.saveSnapshot(snapshot);
      await this.store.recordRun({
        sourceId: 'votoclaro-pipeline',
        status: 'SUCCESS',
        startedAt,
        finishedAt: importedAt,
        recordCount: voterCandidates.length,
      });
      return snapshot.meta;
    } catch (error) {
      await this.store.updateSourceStatuses(statuses, new Date().toISOString());
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
      const headers = {
        Accept: 'application/zip, application/octet-stream',
        'User-Agent': 'VotoClaro/2.0 (+https://github.com/Lucas-Coelho-Dev/VotoClaro; dados-publicos)',
      };
      const response = await fetch(url, {
        signal: controller.signal,
        headers,
      });
      let buffer;
      if (response.status === 403) {
        await response.arrayBuffer();
        buffer = await downloadByRanges(url, {
          signal: controller.signal,
          headers,
          maxBytes: this.config.maxDownloadBytes,
        });
      } else {
        if (!response.ok) throw new Error(`HTTP ${response.status} em ${new URL(url).hostname}`);
        const declaredSize = Number.parseInt(response.headers.get('content-length') || '0', 10);
        if (declaredSize > this.config.maxDownloadBytes) throw new Error('Arquivo excede o limite de segurança configurado.');
        buffer = Buffer.from(await response.arrayBuffer());
      }
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
