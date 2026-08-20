const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const snapshotPath = path.join(rootDir, 'data', 'latest.json');
const seedPath = path.join(rootDir, 'seed', 'codespaces-data.tar.gz');

function validSnapshot() {
  try {
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    return Number.isInteger(snapshot?.meta?.candidateCount)
      && snapshot.meta.candidateCount > 0
      && Array.isArray(snapshot?.candidates)
      && snapshot.candidates.length > 0;
  } catch {
    return false;
  }
}

if (validSnapshot()) {
  console.log('Base persistida já está disponível no Codespace.');
  process.exit(0);
}

if (!fs.existsSync(seedPath)) {
  console.error('Pacote inicial do Codespaces não foi encontrado.');
  process.exit(1);
}

const extraction = spawnSync('tar', ['-xzf', seedPath, '-C', rootDir], {
  cwd: rootDir,
  stdio: 'inherit',
});

if (extraction.status !== 0 || !validSnapshot()) {
  console.error('Não foi possível preparar a base inicial do Codespaces.');
  process.exit(1);
}

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
console.log(`Base inicial pronta: ${snapshot.meta.candidateCount.toLocaleString('pt-BR')} candidaturas.`);
