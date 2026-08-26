require('../src/install-safe-console').installSafeConsole();
const { config, store, synchronizer, initializeRuntime } = require('../src/runtime');
const { synchronizeAssetHistory } = require('./sync-asset-history');
const fs = require('fs/promises');
const path = require('path');

let timer;
let stopping = false;

async function synchronize(trigger) {
  try {
    const meta = await synchronizer.synchronize(trigger);
    console.log(`Sincronização oficial concluída: ${meta.candidateCount} candidaturas, importadas em ${meta.importedAt}.`);
    const historyPath = path.join(config.dataDir, 'historical-assets.json');
    const historyAge = await fs.stat(historyPath).then((stat) => Date.now() - stat.mtimeMs).catch(() => Number.POSITIVE_INFINITY);
    if (historyAge >= 24 * 60 * 60 * 1000) {
      await synchronizeAssetHistory().catch((error) => {
        console.error(`Histórico patrimonial não atualizado; a versão anterior foi preservada: ${error.message}`);
      });
    }
  } catch (error) {
    console.error(`Sincronização oficial falhou; a versão anterior continua publicada: ${error.message}`);
  }
}

async function start() {
  await initializeRuntime();
  await synchronize('dedicated-sync-worker-startup');
  timer = setInterval(() => synchronize('dedicated-sync-worker-scheduled'), config.syncIntervalMinutes * 60 * 1000);
  console.log(`Sincronizador dedicado ativo a cada ${config.syncIntervalMinutes} minutos.`);
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  console.log(`Encerrando sincronizador por ${signal}.`);
  await store.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
start().catch((error) => {
  console.error('Não foi possível iniciar o sincronizador dedicado:', error);
  process.exit(1);
});
