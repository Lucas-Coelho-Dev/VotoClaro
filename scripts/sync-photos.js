const { checksum } = require('../src/normalize');
const { SOURCES } = require('../src/sources');
const { store, photoSynchronizer, initializeRuntime } = require('../src/runtime');

async function main() {
  await initializeRuntime();
  const snapshot = store.getSnapshot();
  if (!snapshot) throw new Error('Sincronize as candidaturas antes das fotos.');
  const result = await photoSynchronizer.synchronize(snapshot.candidates, 'manual-photo-cli');
  snapshot.sourceStatuses = snapshot.sourceStatuses || {};
  snapshot.sourceStatuses[SOURCES.tsePhotos.id] = result.status;
  snapshot.meta.photoCount = result.availableCount;
  snapshot.meta.photoImportedAt = result.finishedAt;
  snapshot.meta.checksum = checksum(snapshot.candidates);
  await store.saveSnapshot(snapshot);
  console.log(JSON.stringify({
    photoCount: result.availableCount,
    finishedAt: result.finishedAt,
    units: result.unitResults,
  }, null, 2));
  await store.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
