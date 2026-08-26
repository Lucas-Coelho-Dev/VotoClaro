require('../src/install-safe-console').installSafeConsole();
const fs = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');
const { config, store, initializeRuntime } = require('../src/runtime');
const { electionRecord, HISTORY_VERSION } = require('../src/asset-history');

const YEARS = [2018, 2022];

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function decimal(value) {
  const text = String(value || '').trim().replace(/\./g, '').replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function downloadRecords(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/zip, application/octet-stream', 'User-Agent': 'VotoClaro/2.0 (historico-patrimonial-oficial)' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ao consultar ${url}`);
    const announced = Number(response.headers.get('content-length') || 0);
    if (announced > config.maxDownloadBytes) throw new Error('Arquivo histórico excede o limite de segurança.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > config.maxDownloadBytes || buffer.subarray(0, 2).toString('ascii') !== 'PK') {
      throw new Error('Pacote histórico inválido ou acima do limite de segurança.');
    }
    const zip = new AdmZip(buffer);
    const rows = [];
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !/\.(csv|txt)$/i.test(entry.entryName)) continue;
      rows.push(...parse(entry.getData().toString('latin1'), {
        columns: true,
        delimiter: ';',
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
        trim: true,
      }));
    }
    return rows;
  } finally {
    clearTimeout(timeout);
  }
}

function candidateUrl(year) {
  return `https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_${year}.zip`;
}

function assetsUrl(year) {
  return `https://cdn.tse.jus.br/estatistica/sead/odsele/bem_candidato/bem_candidato_${year}.zip`;
}

function uniqueAssets(rows) {
  const unique = new Map();
  for (const row of rows) {
    const candidateId = String(row.SQ_CANDIDATO || '').trim();
    if (!candidateId) continue;
    const asset = {
      type: String(row.DS_TIPO_BEM_CANDIDATO || '').trim(),
      description: String(row.DS_BEM_CANDIDATO || '').trim(),
      value: decimal(row.VR_BEM_CANDIDATO),
      order: Number(row.NR_ORDEM_CANDIDATO) || 0,
    };
    unique.set(`${candidateId}|${asset.order}|${asset.type}|${asset.description}|${asset.value}`, { candidateId, ...asset });
  }
  return [...unique.values()];
}

async function synchronizeAssetHistory() {
  const snapshot = store.getSnapshot();
  if (!snapshot?.candidates?.length) throw new Error('A base atual precisa estar sincronizada antes do histórico patrimonial.');

  const currentByTseId = new Map(snapshot.candidates.map((candidate) => [String(candidate.tseId || candidate.id), candidate.id]));
  const currentRows = await downloadRecords(candidateUrl(2026));
  const currentCpfToIds = new Map();
  for (const row of currentRows) {
    const publicId = currentByTseId.get(String(row.SQ_CANDIDATO || '').trim());
    const cpf = digits(row.NR_CPF_CANDIDATO);
    if (!publicId || cpf.length !== 11) continue;
    if (!currentCpfToIds.has(cpf)) currentCpfToIds.set(cpf, new Set());
    currentCpfToIds.get(cpf).add(publicId);
  }

  const output = {};
  for (const year of YEARS) {
    console.log(`Cruzando declarações oficiais de ${year}...`);
    const [candidateRows, assetRows] = await Promise.all([
      downloadRecords(candidateUrl(year)),
      downloadRecords(assetsUrl(year)),
    ]);
    const previousToCurrent = new Map();
    for (const row of candidateRows) {
      const cpf = digits(row.NR_CPF_CANDIDATO);
      const currentIds = currentCpfToIds.get(cpf);
      const previousId = String(row.SQ_CANDIDATO || '').trim();
      if (previousId && currentIds) previousToCurrent.set(previousId, currentIds);
    }
    const assetsByPreviousId = new Map();
    for (const asset of uniqueAssets(assetRows)) {
      if (!previousToCurrent.has(asset.candidateId)) continue;
      if (!assetsByPreviousId.has(asset.candidateId)) assetsByPreviousId.set(asset.candidateId, []);
      assetsByPreviousId.get(asset.candidateId).push(asset);
    }
    for (const [previousId, currentIds] of previousToCurrent) {
      const assets = assetsByPreviousId.get(previousId) || [];
      for (const currentId of currentIds) {
        if (!output[currentId]) output[currentId] = [];
        if (output[currentId].some((item) => item.year === year)) continue;
        output[currentId].push(electionRecord(
          year,
          assets,
          `https://dadosabertos.tse.jus.br/dataset/candidatos-${year}`,
          previousId,
        ));
      }
    }
  }

  const payload = {
    version: HISTORY_VERSION,
    generatedAt: new Date().toISOString(),
    matching: 'CPF exato consultado em memória e descartado antes da gravação.',
    candidates: output,
  };
  await fs.mkdir(config.dataDir, { recursive: true });
  const target = path.join(config.dataDir, 'historical-assets.json');
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(payload), 'utf8');
  await fs.rename(temporary, target);
  console.log(`Histórico patrimonial salvo para ${Object.keys(output).length} candidaturas atuais.`);
  return { generatedAt: payload.generatedAt, candidates: Object.keys(output).length };
}

async function main() {
  await initializeRuntime();
  await synchronizeAssetHistory();
  await store.close();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { synchronizeAssetHistory };
