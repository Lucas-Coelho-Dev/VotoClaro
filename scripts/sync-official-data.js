require('../src/install-safe-console').installSafeConsole();
const { store, synchronizer, initializeRuntime } = require('../src/runtime');

async function main() {
  await initializeRuntime();
  const meta = await synchronizer.synchronize('manual-cli');
  console.log(JSON.stringify(meta, null, 2));
  await store.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
