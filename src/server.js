const app = require('./app');
const {
  config,
  store,
  synchronizer,
  legislativeService,
  governmentPlanSummaryService,
  initializeRuntime,
} = require('./runtime');

let server;
let timer;

function precomputeLatestGovernmentPlans() {
  const snapshot = store.getSnapshot();
  if (!snapshot?.candidates?.length) return;
  setImmediate(() => {
    governmentPlanSummaryService.precomputeCandidates(snapshot.candidates).catch((error) => {
      console.error('Falha na preparação local dos planos de governo:', error.message);
    });
    legislativeService.precomputeCandidates(snapshot.candidates).catch((error) => {
      console.error('Falha na preparação das explicações legislativas:', error.message);
    });
  });
}

async function start() {
  await initializeRuntime();
  server = app.listen(config.port, () => {
    console.log(`VotoClaro 2.0 disponível em http://localhost:${config.port}`);
    console.log(`Persistência: ${store.backend}`);
  });

  const hasPersistedSnapshot = Boolean(store.getSnapshot());
  if (config.syncOnStart && !hasPersistedSnapshot) {
    synchronizer.synchronize('startup').then((meta) => {
      console.log(`Sincronização concluída: ${meta.candidateCount} candidaturas oficiais.`);
      precomputeLatestGovernmentPlans();
    }).catch((error) => {
      console.error('Falha na sincronização inicial:', error.message);
    });
  } else if (hasPersistedSnapshot) {
    console.log('Base persistida carregada; nenhuma sincronização de inicialização foi necessária.');
    precomputeLatestGovernmentPlans();
  }

  timer = setInterval(() => {
    synchronizer.synchronize('scheduled')
      .then(() => precomputeLatestGovernmentPlans())
      .catch((error) => {
        console.error('Falha na sincronização agendada:', error.message);
      });
  }, config.syncIntervalMinutes * 60 * 1000);
  timer.unref();
}

async function shutdown(signal) {
  console.log(`Encerrando por ${signal}...`);
  if (timer) clearInterval(timer);
  if (server) await new Promise((resolve) => server.close(resolve));
  await store.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((error) => {
  console.error('Não foi possível iniciar o VotoClaro:', error);
  process.exit(1);
});
