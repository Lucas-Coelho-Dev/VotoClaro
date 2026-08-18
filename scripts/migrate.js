const { store, initializeRuntime } = require('../src/runtime');

initializeRuntime()
  .then(async () => {
    console.log(`Persistência inicializada: ${store.backend}`);
    await store.close();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
