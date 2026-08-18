const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { SOURCES } = require('./sources');

const VALID_UNITS = new Set(['BR', 'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']);
const ARCHIVE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_ARCHIVE_BYTES = 75 * 1024 * 1024;
const MAX_PLAN_BYTES = 25 * 1024 * 1024;

function electionUnitForCandidate(candidate) {
  const office = String(candidate?.office || '').toUpperCase();
  if (office === 'PRESIDENTE') return 'BR';
  if (office === 'GOVERNADOR' && VALID_UNITS.has(candidate.uf)) return candidate.uf;
  return null;
}

function archiveUrl(unit) {
  return SOURCES.tseGovernmentPlans.archiveUrlTemplate.replace('{UF}', unit);
}

function candidatePlanEntry(entries, candidate, unit = electionUnitForCandidate(candidate)) {
  if (!unit || !candidate?.tseId) return null;
  const expected = `2026${unit}${String(candidate.tseId)}_`;
  return entries.find((entry) => {
    const name = String(entry.entryName || '').replace(/\\/g, '/').split('/').pop();
    return !entry.isDirectory && name.startsWith(expected) && /_\d+\.pdf$/i.test(name);
  }) || null;
}

async function downloadArchive(unit, config) {
  const url = archiveUrl(unit);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.requestTimeoutMs, 120000));
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/zip, application/octet-stream', 'User-Agent': 'VotoClaro/2.0 (dados-publicos)' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} no arquivo de propostas do TSE.`);
    const announcedSize = Number(response.headers.get('content-length') || 0);
    if (announcedSize > MAX_ARCHIVE_BYTES) throw new Error('O arquivo de propostas excedeu o limite de segurança.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_ARCHIVE_BYTES || buffer.subarray(0, 2).toString('ascii') !== 'PK') {
      throw new Error('O arquivo de propostas recebido do TSE é inválido ou excede o limite.');
    }
    return buffer;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Tempo limite ao consultar as propostas oficiais do TSE.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

class GovernmentPlanService {
  constructor(config) {
    this.config = config;
    this.directory = path.join(config.dataDir, 'government-plans');
    this.cache = new Map();
    this.pending = new Map();
  }

  async archiveFromDisk(unit, allowStale = false) {
    const filePath = path.join(this.directory, `${unit}.zip`);
    try {
      const [buffer, stat] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
      if (!allowStale && Date.now() - stat.mtimeMs > ARCHIVE_MAX_AGE_MS) return null;
      if (buffer.length > MAX_ARCHIVE_BYTES || buffer.subarray(0, 2).toString('ascii') !== 'PK') return null;
      return buffer;
    } catch {
      return null;
    }
  }

  async persistArchive(unit, buffer) {
    await fs.mkdir(this.directory, { recursive: true });
    const target = path.join(this.directory, `${unit}.zip`);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, buffer);
    await fs.rename(temporary, target);
  }

  async getArchive(unit) {
    const cached = this.cache.get(unit);
    if (cached && Date.now() - cached.savedAt < ARCHIVE_MAX_AGE_MS) return cached.zip;
    if (this.pending.has(unit)) return this.pending.get(unit);

    const pending = (async () => {
      const freshDisk = await this.archiveFromDisk(unit);
      let buffer = freshDisk;
      if (!buffer) {
        try {
          buffer = await downloadArchive(unit, this.config);
          await this.persistArchive(unit, buffer).catch(() => {});
        } catch (error) {
          buffer = await this.archiveFromDisk(unit, true);
          if (!buffer) throw error;
        }
      }
      const zip = new AdmZip(buffer);
      this.cache.set(unit, { savedAt: Date.now(), zip });
      return zip;
    })();
    this.pending.set(unit, pending);
    try {
      return await pending;
    } finally {
      this.pending.delete(unit);
    }
  }

  async get(candidate) {
    const unit = electionUnitForCandidate(candidate);
    if (!unit) return null;
    const zip = await this.getArchive(unit);
    const entry = candidatePlanEntry(zip.getEntries(), candidate, unit);
    if (!entry || entry.header.size > MAX_PLAN_BYTES) return null;
    const buffer = entry.getData();
    if (buffer.length > MAX_PLAN_BYTES || buffer.subarray(0, 4).toString('ascii') !== '%PDF') return null;
    return {
      buffer,
      contentType: 'application/pdf',
      filename: path.basename(entry.entryName),
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      source: {
        name: SOURCES.tseGovernmentPlans.name,
        url: SOURCES.tseGovernmentPlans.url,
        archiveUrl: archiveUrl(unit),
        confidence: 'OFFICIAL',
      },
    };
  }
}

module.exports = { GovernmentPlanService, candidatePlanEntry, electionUnitForCandidate, archiveUrl };
