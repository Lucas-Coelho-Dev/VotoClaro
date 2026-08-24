const {
  config,
  store,
  governmentPlanSummaryService,
  legislativeService,
  initializeRuntime,
} = require('../src/runtime');

let timer;
let stopping = false;
let running = false;

async function processQueues() {
  if (running) return;
  await store.refreshSnapshot();
  const snapshot = store.getSnapshot();
  if (!snapshot?.candidates?.length) {
    console.log('Trabalhador da IA aguardando a primeira base oficial.');
    return;
  }
  running = true;
  try {
    await Promise.all([
      governmentPlanSummaryService.precomputeCandidates(snapshot.candidates),
      legislativeService.precomputeCandidates(snapshot.candidates),
    ]);
  } catch (error) {
    console.error('Falha no ciclo do trabalhador da IA:', error.message);
  } finally {
    running = false;
  }
}

async function start() {
  await initializeRuntime();
  setImmediate(processQueues);
  timer = setInterval(processQueues, config.aiWorkerIntervalMinutes * 60 * 1000);
  console.log(`Trabalhador dedicado da IA ativo a cada ${config.aiWorkerIntervalMinutes} minutos.`);
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  console.log(`Encerrando trabalhador da IA por ${signal}.`);
  await store.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
start().catch((error) => {
  console.error('Não foi possível iniciar o trabalhador dedicado da IA:', error);
  process.exit(1);
});
