const fs = require('fs/promises');
const path = require('path');
const { SOURCES } = require('./sources');

const STATE_CODE_TO_UF = Object.freeze({
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL',
  28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR',
  42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
});

const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_GEOJSON_BYTES = 8 * 1024 * 1024;

function normalizeBoundaries(payload) {
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw new Error('A resposta do IBGE não é uma coleção geográfica válida.');
  }

  const seen = new Set();
  const features = payload.features.map((feature) => {
    const ibgeCode = String(feature?.properties?.codarea || '').slice(0, 2);
    const uf = STATE_CODE_TO_UF[ibgeCode];
    const geometry = feature?.geometry;
    if (!uf || !geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type) || !Array.isArray(geometry.coordinates)) {
      throw new Error('A malha estadual do IBGE contém uma feição inválida.');
    }
    if (seen.has(uf)) throw new Error(`A malha do IBGE repetiu a UF ${uf}.`);
    seen.add(uf);
    return {
      type: 'Feature',
      properties: { uf, ibgeCode },
      geometry: { type: geometry.type, coordinates: geometry.coordinates },
    };
  });

  if (features.length !== 27 || seen.size !== 27) {
    throw new Error(`A malha do IBGE retornou ${features.length} UFs; eram esperadas 27.`);
  }
  return { type: 'FeatureCollection', features };
}

async function fetchOfficialBoundaries(config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.requestTimeoutMs, 30000));
  try {
    const response = await fetch(SOURCES.ibgeBoundaries.resourceUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.geo+json, application/json',
        'User-Agent': 'VotoClaro/2.0 (dados-publicos)',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} na API de malhas do IBGE.`);
    const announcedSize = Number(response.headers.get('content-length') || 0);
    if (announcedSize > MAX_GEOJSON_BYTES) throw new Error('A malha do IBGE excedeu o limite de segurança.');
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_GEOJSON_BYTES) throw new Error('A malha do IBGE excedeu o limite de segurança.');
    return normalizeBoundaries(JSON.parse(body.toString('utf8')));
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Tempo limite ao consultar a malha oficial do IBGE.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

class GeographyService {
  constructor(config) {
    this.config = config;
    this.cachePath = path.join(config.dataDir, 'states.geojson');
    this.memory = null;
    this.pending = null;
  }

  async readFreshCache() {
    try {
      const [raw, stat] = await Promise.all([fs.readFile(this.cachePath, 'utf8'), fs.stat(this.cachePath)]);
      if (Date.now() - stat.mtimeMs > CACHE_MAX_AGE_MS) return null;
      return normalizeBoundaries(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async saveCache(data) {
    await fs.mkdir(this.config.dataDir, { recursive: true });
    const temporary = `${this.cachePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(data), 'utf8');
    await fs.rename(temporary, this.cachePath);
  }

  async getStates() {
    if (this.memory) return this.memory;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const cached = await this.readFreshCache();
      if (cached) return cached;
      const fresh = await fetchOfficialBoundaries(this.config);
      await this.saveCache(fresh).catch(() => {});
      return fresh;
    })();
    try {
      this.memory = await this.pending;
      return this.memory;
    } finally {
      this.pending = null;
    }
  }
}

module.exports = { GeographyService, normalizeBoundaries, STATE_CODE_TO_UF };
