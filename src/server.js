const app = require('./app');
const { config, store, synchronizer, initializeRuntime } = require('./runtime');

let server;
let timer;

async function start() {
  await initializeRuntime();
  server = app.listen(config.port, () => {
    console.log(`VotoClaro 2.0 disponível em http://localhost:${config.port}`);
    console.log(`Persistência: ${store.backend}`);
  });

  if (config.syncOnStart) {
    synchronizer.synchronize('startup').then((meta) => {
      console.log(`Sincronização concluída: ${meta.candidateCount} candidaturas oficiais.`);
    }).catch((error) => {
      console.error('Falha na sincronização inicial:', error.message);
    });
  }

  timer = setInterval(() => {
    synchronizer.synchronize('scheduled').catch((error) => {
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
