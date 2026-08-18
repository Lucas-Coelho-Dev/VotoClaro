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
