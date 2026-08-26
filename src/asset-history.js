const fs = require('fs/promises');
const path = require('path');

const HISTORY_VERSION = 1;
const cents = (value) => Math.round((Number(value) || 0) * 100) / 100;

function categoryComposition(assets = []) {
  const grouped = new Map();
  for (const asset of assets) {
    const category = String(asset?.type || 'Não informado').trim() || 'Não informado';
    const value = Number(asset?.value) || 0;
    const current = grouped.get(category) || { category, value: 0, count: 0 };
    current.value = cents(current.value + value);
    current.count += 1;
    grouped.set(category, current);
  }
  return [...grouped.values()].sort((left, right) => right.value - left.value || left.category.localeCompare(right.category, 'pt-BR'));
}

function electionRecord(year, assets, sourceUrl, candidateId = null) {
  return {
    year: Number(year),
    candidateId: candidateId ? String(candidateId) : null,
    total: cents(assets.reduce((sum, asset) => sum + (Number(asset?.value) || 0), 0)),
    count: assets.length,
    composition: categoryComposition(assets),
    source: {
      name: `TSE — Bens de candidatos ${year}`,
      url: sourceUrl,
      confidence: 'OFFICIAL',
    },
  };
}

function withChanges(records = []) {
  const ordered = [...records].sort((left, right) => left.year - right.year);
  return ordered.map((record, index) => {
    const previous = ordered[index - 1];
    if (!previous) return { ...record, changeFromPrevious: null };
    const absolute = cents(record.total - previous.total);
    const percentage = previous.total > 0 ? (absolute / previous.total) * 100 : null;
    return {
      ...record,
      changeFromPrevious: {
        previousYear: previous.year,
        absolute,
        percentage,
        comparable: true,
      },
    };
  });
}

class AssetHistoryService {
  constructor(config) {
    this.config = config;
    this.filePath = path.join(config.dataDir, 'historical-assets.json');
    this.loaded = false;
    this.data = { version: HISTORY_VERSION, generatedAt: null, candidates: {} };
  }

  async load() {
    if (this.loaded) return;
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (parsed?.version === HISTORY_VERSION && parsed?.candidates) this.data = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    this.loaded = true;
  }

  async get(candidate) {
    await this.load();
    const stored = (this.data.candidates[String(candidate.id)] || []).map((record) => ({
      ...record,
      total: cents(record.total),
      composition: (record.composition || []).map((item) => ({ ...item, value: cents(item.value) })),
    }));
    const current = electionRecord(
      candidate.electionYear || 2026,
      candidate.assets || [],
      'https://dadosabertos.tse.jus.br/dataset/candidatos-2026',
      candidate.id,
    );
    const byYear = new Map(stored.map((record) => [Number(record.year), record]));
    byYear.set(Number(current.year), current);
    const elections = withChanges([...byYear.values()]);
    return {
      status: elections.length > 1 ? 'HISTORY_AVAILABLE' : 'CURRENT_ELECTION_ONLY',
      generatedAt: this.data.generatedAt,
      matching: 'CPF oficial usado apenas durante o cruzamento; o identificador pessoal não é armazenado no arquivo público.',
      elections,
      caveats: [
        'Os valores são os declarados à Justiça Eleitoral e podem representar valor de aquisição, não o preço de mercado atual.',
        'Diferenças entre eleições podem refletir compra, venda, herança, dívida, mudança de critério ou atualização da declaração.',
        'Crescimento patrimonial isolado não comprova irregularidade. Qualquer conclusão exige documentos e apuração próprios.',
      ],
    };
  }
}

module.exports = { AssetHistoryService, HISTORY_VERSION, categoryComposition, electionRecord, withChanges };
