const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const config = require('../src/config');
const { SnapshotStore } = require('../src/persistence');

const BATCH_SIZE = 200;

async function main() {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL é obrigatório para importar o cache de fotos.');
  }

  const entries = await fs.readdir(config.photoDir, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && /^\d+\.jpg$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const store = new SnapshotStore(config);
  await store.initialize();
  let imported = 0;
  let ignored = 0;
  let batch = [];

  try {
    for (const filename of filenames) {
      const candidateId = filename.slice(0, -4);
      const sourcePath = path.join(config.photoDir, filename);
      const stat = await fs.stat(sourcePath);
      if (!stat.size || stat.size > config.maxCandidatePhotoBytes) {
        ignored += 1;
        continue;
      }
      const buffer = await fs.readFile(sourcePath);
      batch.push({
        candidateId,
        contentType: 'image/jpeg',
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        buffer,
        sourceUnit: 'LOCAL-CACHE-IMPORT',
        sourceUpdatedAt: stat.mtime.toISOString(),
      });
      if (batch.length < BATCH_SIZE) continue;
      await store.saveCandidatePhotos(batch);
      imported += batch.length;
      console.log(`Fotos importadas: ${imported.toLocaleString('pt-BR')}/${filenames.length.toLocaleString('pt-BR')}`);
      batch = [];
    }
    if (batch.length) {
      await store.saveCandidatePhotos(batch);
      imported += batch.length;
    }
  } finally {
    await store.close();
  }

  console.log(`Importação concluída: ${imported.toLocaleString('pt-BR')} fotos; ${ignored.toLocaleString('pt-BR')} ignoradas.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
