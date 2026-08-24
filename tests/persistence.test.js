const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SnapshotStore } = require('../src/persistence');

async function temporaryStore(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'votoclaro-views-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = {
    databaseUrl: '',
    dataDir: root,
    photoDir: path.join(root, 'photos'),
  };
  const store = new SnapshotStore(config);
  await store.initialize();
  return { store, config };
}

test('persiste apenas totais agregados e ordena candidaturas por consultas', async (t) => {
  const { store, config } = await temporaryStore(t);

  await Promise.all([
    store.recordCandidateView('101'),
    store.recordCandidateView('202'),
    store.recordCandidateView('202'),
  ]);

  assert.deepEqual(
    (await store.getPopularCandidateViews()).map(({ candidateId, viewCount }) => ({ candidateId, viewCount })),
    [
      { candidateId: '202', viewCount: 2 },
      { candidateId: '101', viewCount: 1 },
    ],
  );

  const persisted = JSON.parse(await fs.readFile(path.join(config.dataDir, 'candidate-views.json'), 'utf8'));
  assert.deepEqual(Object.keys(persisted).sort(), ['candidates', 'version']);
  assert.equal(persisted.candidates['202'].viewCount, 2);
  assert.equal(JSON.stringify(persisted).includes('visitor'), false);
  assert.equal(JSON.stringify(persisted).includes('location'), false);

  const restarted = new SnapshotStore(config);
  await restarted.initialize();
  assert.equal((await restarted.getPopularCandidateViews(1))[0].viewCount, 2);
});

test('rejeita identificador que não pertence ao formato público do TSE', async (t) => {
  const { store } = await temporaryStore(t);
  await assert.rejects(store.recordCandidateView('../visitante'), /INVALID_CANDIDATE_ID/);
});

test('usa o cache local de foto quando o PostgreSQL ainda não possui a imagem', async (t) => {
  const { store, config } = await temporaryStore(t);
  const candidateId = '280002542548';
  const expected = Buffer.from('foto-oficial');
  await fs.writeFile(path.join(config.photoDir, `${candidateId}.jpg`), expected);
  store.pool = {
    query: async () => ({ rows: [] }),
  };

  const photo = await store.getCandidatePhoto(candidateId);

  assert.deepEqual(photo.buffer, expected);
  assert.equal(photo.contentType, 'image/jpeg');
  assert.deepEqual([...await store.availablePhotoIds([candidateId])], [candidateId]);
});

test('registra relato de análise e permite acompanhar sem publicar o texto enviado', async (t) => {
  const { store, config } = await temporaryStore(t);
  await store.createAnalysisReport({
    trackingCode: 'VC-1234ABCDEF56',
    candidateId: '280002542548',
    subjectType: 'GOVERNMENT_PLAN',
    subjectKey: 'educacao',
    category: 'WRONG_PAGE',
    pageNumber: 12,
    details: 'O trecho indicado aparece em outra página do documento oficial.',
    analysisVersion: 'local-llm-v16',
    createdAt: '2026-08-24T12:00:00.000Z',
  });

  const publicReport = await store.getAnalysisReport('VC-1234ABCDEF56');
  assert.equal(publicReport.status, 'OPEN');
  assert.equal(publicReport.category, 'WRONG_PAGE');
  assert.equal('details' in publicReport, false);
  assert.equal('subjectKey' in publicReport, false);
  assert.deepEqual((await store.getAiAuditStats()).correctionReports, [{ status: 'OPEN', count: 1 }]);

  const updated = await store.updateAnalysisReport('VC-1234ABCDEF56', {
    status: 'RESOLVED',
    resolutionNote: 'Página corrigida após conferência do PDF oficial.',
  });
  assert.equal(updated.status, 'RESOLVED');
  assert.match(updated.resolutionNote, /Página corrigida/);

  const restarted = new SnapshotStore(config);
  await restarted.initialize();
  assert.equal((await restarted.getAnalysisReport('VC-1234ABCDEF56')).status, 'RESOLVED');
});

test('publica alerta operacional sem alterar a data da última versão oficial', async (t) => {
  const { store } = await temporaryStore(t);
  const importedAt = '2026-08-18T11:17:22.218Z';
  await store.saveSnapshot({
    meta: { checksum: 'snapshot-1', importedAt, sourceGeneratedAt: importedAt, candidateCount: 1 },
    sourceStatuses: {},
    candidates: [{ id: '1' }],
  });
  await store.updateSourceStatuses({
    'tse-candidates-2026': { state: 'ERROR', alert: true, consecutiveFailures: 1 },
  }, '2026-08-24T15:00:00.000Z');

  assert.equal(store.getSnapshot().meta.importedAt, importedAt);
  assert.equal(store.getSnapshot().meta.lastSyncAttemptAt, '2026-08-24T15:00:00.000Z');
  assert.equal(store.getSnapshot().sourceStatuses['tse-candidates-2026'].alert, true);
});
