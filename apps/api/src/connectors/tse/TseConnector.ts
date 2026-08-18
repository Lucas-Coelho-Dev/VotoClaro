// apps/api/src/connectors/tse/TseConnector.ts
// Conector oficial com Portal de Dados Abertos do TSE (CKAN + CDN)
// Usa padrão Adapter: fácil trocar por outro conector sem quebrar o sistema.

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse';
import pino from 'pino';

const logger = pino({ name: 'tse-connector' });

// ── Configuração base do TSE ────────────────────────────────────────────────

const TSE_CDN_BASE = 'https://cdn.tse.jus.br/estatistica/sead/odsele';
const TSE_CKAN_BASE = 'https://dadosabertos.tse.jus.br/api/3/action';

// Datasets disponíveis por tipo e ano
const TSE_DATASETS: Record<string, (year: number, uf?: string) => string> = {
  candidates:     (y, uf) => uf
    ? `${TSE_CDN_BASE}/consulta_cand/consulta_cand_${y}_${uf}.zip`
    : `${TSE_CDN_BASE}/consulta_cand/consulta_cand_${y}.zip`,
  assets:         (y, uf) => uf
    ? `${TSE_CDN_BASE}/bem_candidato/bem_candidato_${y}_${uf}.zip`
    : `${TSE_CDN_BASE}/bem_candidato/bem_candidato_${y}.zip`,
  revenues:       (y, uf) => `${TSE_CDN_BASE}/prestacao_contas/receitas_candidatos_${y}${uf ? '_' + uf : ''}.zip`,
  expenses:       (y, uf) => `${TSE_CDN_BASE}/prestacao_contas/despesas_candidatos_${y}${uf ? '_' + uf : ''}.zip`,
  socialMedia:    (y)     => `${TSE_CDN_BASE}/redes_sociais_candidatos/redes_sociais_candidatos_${y}.zip`,
  results:        (y, uf) => `${TSE_CDN_BASE}/votacao_candidato_munzona/votacao_candidato_munzona_${y}${uf ? '_' + uf : ''}.zip`,
};

// ── Tipos internos do conector ──────────────────────────────────────────────

export interface TseCandidateRaw {
  DT_GERACAO: string;
  HH_GERACAO: string;
  ANO_ELEICAO: string;
  CD_TIPO_ELEICAO: string;
  NM_TIPO_ELEICAO: string;
  NR_TURNO: string;
  CD_ELEICAO: string;
  DS_ELEICAO: string;
  DT_ELEICAO: string;
  TP_ABRANGENCIA: string;
  SG_UF: string;
  SG_UE: string;
  NM_UE: string;
  CD_CARGO: string;
  DS_CARGO: string;
  SQ_CANDIDATO: string;
  NR_CANDIDATO: string;
  NM_CANDIDATO: string;
  NM_URNA_CANDIDATO: string;
  NM_SOCIAL_CANDIDATO: string;
  NR_CPF_CANDIDATO: string; // Tratamos: nunca armazenamos em claro
  NM_EMAIL: string;          // Não exibimos
  NR_IDADE_DATA_POSSE: string;
  NR_CPF_VICE_CANDIDATO: string; // Nunca armazenamos
  NM_VICE_CANDIDATO: string;
  SQ_COLIGACAO: string;
  NM_COLIGACAO: string;
  DS_COMPOSICAO_COLIGACAO: string;
  CD_NACIONALIDADE: string;
  DS_NACIONALIDADE: string;
  SG_UF_NASCIMENTO: string;
  CD_MUNICIPIO_NASCIMENTO: string;
  NM_MUNICIPIO_NASCIMENTO: string;
  DT_NASCIMENTO: string;
  NR_TITULO_ELEITORAL_CANDIDATO: string; // Nunca armazenamos
  CD_GENERO: string;
  DS_GENERO: string;
  CD_GRAU_INSTRUCAO: string;
  DS_GRAU_INSTRUCAO: string;
  CD_ESTADO_CIVIL: string;
  DS_ESTADO_CIVIL: string;
  CD_COR_RACA: string;
  DS_COR_RACA: string;
  CD_OCUPACAO: string;
  DS_OCUPACAO: string;
  NR_DESPESA_MAX_CAMPANHA: string;
  CD_SIT_TOT_TURNO: string;
  DS_SIT_TOT_TURNO: string;
  ST_REELEICAO: string;
  ST_DECLARAR_BENS: string;
  NR_PROTOCOLO_CANDIDATURA: string;
  NR_PROCESSO: string;
  CD_SITUACAO_CANDIDATURA: string;
  DS_SITUACAO_CANDIDATURA: string;
  CD_DETALHE_SITUACAO_CAND: string;
  DS_DETALHE_SITUACAO_CAND: string;
  TP_AGREMIACAO: string;
  NR_PARTIDO: string;
  SG_PARTIDO: string;
  NM_PARTIDO: string;
  SQ_COLIGACAO2: string;
  NM_FEDERACAO: string;
  NR_FEDERACAO: string;
  ST_PREST_CONTAS: string;
  [key: string]: string;
}

export interface TseAssetRaw {
  SQ_CANDIDATO: string;
  ANO_ELEICAO: string;
  CD_TIPO_BEM_CANDIDATO: string;
  DS_TIPO_BEM_CANDIDATO: string;
  DS_BEM_CANDIDATO: string;
  VR_BEM_CANDIDATO: string;
  NR_ORDEM_CANDIDATO: string;
  [key: string]: string;
}

export interface TseRevenueRaw {
  SQ_CANDIDATO: string;
  ANO_ELEICAO: string;
  NR_TURNO: string;
  DT_RECEITA: string;
  DS_RECEITA: string;
  VR_RECEITA: string;
  CD_TIPO_RECEITA_ORIGEM: string;
  DS_ORIGEM_RECEITA: string;
  NM_DOADOR: string;
  CD_CNPJ_DOADOR: string;
  NR_CPF_DOADOR: string; // Nunca armazenamos em claro – hash somente
  [key: string]: string;
}

export interface TseExpenseRaw {
  SQ_CANDIDATO: string;
  ANO_ELEICAO: string;
  NR_TURNO: string;
  DT_DESPESA: string;
  DS_DESPESA: string;
  VR_DESPESA_CONTRATADA: string;
  CD_TIPO_DESPESA: string;
  DS_TIPO_DESPESA: string;
  NM_FORNECEDOR: string;
  CD_CNPJ_FORNECEDOR: string;
  [key: string]: string;
}

// ── TseConnector ─────────────────────────────────────────────────────────────

export class TseConnector {
  private tmpDir: string;

  constructor(tmpDir = '/tmp/tse-data') {
    this.tmpDir = tmpDir;
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // ── Download helpers ──────────────────────────────────────────────────────

  private async downloadFile(url: string, dest: string): Promise<void> {
    logger.info({ url }, 'Baixando arquivo TSE');
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(dest);
      const req = client.get(url, { timeout: 120_000 }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          return this.downloadFile(res.headers.location!, dest).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          return reject(new Error(`HTTP ${res.statusCode} ao baixar ${url}`));
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      });
      req.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
      req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout ao baixar ${url}`)); });
    });
  }

  private async extractCsv(zipPath: string, outDir: string): Promise<string[]> {
    const zip = new AdmZip(zipPath);
    const csvFiles: string[] = [];
    zip.getEntries().forEach((entry) => {
      if (entry.entryName.endsWith('.csv') || entry.entryName.endsWith('.txt')) {
        const outPath = path.join(outDir, path.basename(entry.entryName));
        zip.extractEntryTo(entry, outDir, false, true);
        csvFiles.push(outPath);
      }
    });
    return csvFiles;
  }

  private async parseCsv<T extends Record<string, string>>(filePath: string): Promise<T[]> {
    const records: T[] = [];
    await new Promise<void>((resolve, reject) => {
      createReadStream(filePath, { encoding: 'latin1' })
        .pipe(parse({
          delimiter: ';',
          columns: true,
          skip_empty_lines: true,
          trim: true,
          bom: true,
          relax_column_count: true,
        }))
        .on('data', (row: T) => records.push(row))
        .on('error', reject)
        .on('end', resolve);
    });
    return records;
  }

  // ── Fetch de candidatos ──────────────────────────────────────────────────

  async fetchCandidates(year: number, uf?: string): Promise<TseCandidateRaw[]> {
    const url = TSE_DATASETS.candidates(year, uf);
    const zipDest = path.join(this.tmpDir, `cand_${year}${uf ?? ''}.zip`);
    const extractDir = path.join(this.tmpDir, `cand_${year}${uf ?? ''}`);
    fs.mkdirSync(extractDir, { recursive: true });

    await this.downloadFile(url, zipDest);
    const csvFiles = await this.extractCsv(zipDest, extractDir);
    const allRecords: TseCandidateRaw[] = [];

    for (const f of csvFiles) {
      const records = await this.parseCsv<TseCandidateRaw>(f);
      allRecords.push(...records);
    }

    logger.info({ count: allRecords.length, year, uf }, 'Candidatos carregados do TSE');
    return allRecords;
  }

  async fetchAssets(year: number, uf?: string): Promise<TseAssetRaw[]> {
    const url = TSE_DATASETS.assets(year, uf);
    const zipDest = path.join(this.tmpDir, `bens_${year}${uf ?? ''}.zip`);
    const extractDir = path.join(this.tmpDir, `bens_${year}${uf ?? ''}`);
    fs.mkdirSync(extractDir, { recursive: true });

    await this.downloadFile(url, zipDest);
    const csvFiles = await this.extractCsv(zipDest, extractDir);
    const allRecords: TseAssetRaw[] = [];
    for (const f of csvFiles) {
      allRecords.push(...await this.parseCsv<TseAssetRaw>(f));
    }
    return allRecords;
  }

  async fetchRevenues(year: number, uf?: string): Promise<TseRevenueRaw[]> {
    const url = TSE_DATASETS.revenues(year, uf);
    const zipDest = path.join(this.tmpDir, `rec_${year}${uf ?? ''}.zip`);
    const extractDir = path.join(this.tmpDir, `rec_${year}${uf ?? ''}`);
    fs.mkdirSync(extractDir, { recursive: true });

    await this.downloadFile(url, zipDest);
    const csvFiles = await this.extractCsv(zipDest, extractDir);
    const allRecords: TseRevenueRaw[] = [];
    for (const f of csvFiles) {
      allRecords.push(...await this.parseCsv<TseRevenueRaw>(f));
    }
    return allRecords;
  }

  async fetchExpenses(year: number, uf?: string): Promise<TseExpenseRaw[]> {
    const url = TSE_DATASETS.expenses(year, uf);
    const zipDest = path.join(this.tmpDir, `desp_${year}${uf ?? ''}.zip`);
    const extractDir = path.join(this.tmpDir, `desp_${year}${uf ?? ''}`);
    fs.mkdirSync(extractDir, { recursive: true });

    await this.downloadFile(url, zipDest);
    const csvFiles = await this.extractCsv(zipDest, extractDir);
    const allRecords: TseExpenseRaw[] = [];
    for (const f of csvFiles) {
      allRecords.push(...await this.parseCsv<TseExpenseRaw>(f));
    }
    return allRecords;
  }

  // ── Health check ─────────────────────────────────────────────────────────

  async healthCheck(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      await new Promise<void>((resolve, reject) => {
        https.get(`${TSE_CKAN_BASE}/site_read`, { timeout: 5000 }, (res) => {
          if (res.statusCode === 200) resolve();
          else reject(new Error(`Status ${res.statusCode}`));
        }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
      });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
}

// ── Normalização ─────────────────────────────────────────────────────────────
// Converte dados brutos do TSE para o formato canônico da aplicação

import crypto from 'crypto';
import { CandidateStatus } from '@votoclaro/shared';

export function normalizeCandidateStatus(ds: string): CandidateStatus {
  const map: Record<string, CandidateStatus> = {
    'DEFERIDA': 'DEFERIDA',
    'DEFERIDO': 'DEFERIDA',
    'INDEFERIDA': 'INDEFERIDA',
    'INDEFERIDO': 'INDEFERIDA',
    'CASSADA': 'CASSADA',
    'CASSADO': 'CASSADA',
    'RENÚNCIA': 'RENUNCIADA',
    'RENUNCIADA': 'RENUNCIADA',
    'FALECIDA': 'FALECIDA',
    'FALECIDO': 'FALECIDA',
  };
  return map[ds?.toUpperCase()?.trim()] ?? 'PENDENTE';
}

export function hashCpf(cpf: string): string | undefined {
  if (!cpf || cpf === '#NULO#' || cpf === 'NULO' || cpf.length < 11) return undefined;
  // Removemos dígitos extras, guardamos apenas hash SHA-256
  const clean = cpf.replace(/\D/g, '');
  return crypto.createHash('sha256').update(clean + process.env.CPF_HASH_SALT ?? '').digest('hex');
}

export function maskDocument(doc: string): string {
  if (!doc || doc === '#NULO#') return '';
  const clean = doc.replace(/\D/g, '');
  if (clean.length === 11) {
    // CPF: mostra apenas ***.***.***-XX
    return `***.***.***.${clean.slice(9)}`;
  }
  if (clean.length === 14) {
    // CNPJ: XX.XXX.XXX/XXXX-XX – CNPJ é dado público, mostramos completo
    return doc;
  }
  return '****';
}

export function parseDecimal(value: string): number {
  if (!value || value === '#NULO#') return 0;
  return parseFloat(value.replace(/\./g, '').replace(',', '.')) || 0;
}

export function normalizePartyFromRaw(raw: TseCandidateRaw) {
  return {
    acronym: raw.SG_PARTIDO?.trim() || 'SEM PARTIDO',
    name: raw.NM_PARTIDO?.trim() || 'Sem partido',
    number: parseInt(raw.NR_PARTIDO) || 0,
  };
}

export function normalizeCandidateFromRaw(raw: TseCandidateRaw, electionId: string, partyId?: string) {
  return {
    tseId: raw.SQ_CANDIDATO?.trim(),
    sequentialCode: raw.NR_PROTOCOLO_CANDIDATURA?.trim() || raw.SQ_CANDIDATO?.trim(),
    ballotNumber: parseInt(raw.NR_CANDIDATO) || 0,
    fullName: raw.NM_CANDIDATO?.trim(),
    ballotName: raw.NM_URNA_CANDIDATO?.trim(),
    cpfHash: hashCpf(raw.NR_CPF_CANDIDATO),
    // NÃO armazenamos: NR_CPF_CANDIDATO, NR_TITULO_ELEITORAL, NM_EMAIL, NR_CPF_VICE
    birthYear: raw.DT_NASCIMENTO
      ? new Date(raw.DT_NASCIMENTO.split('/').reverse().join('-')).getFullYear()
      : undefined,
    gender: raw.DS_GENERO?.trim() || undefined,
    occupation: raw.DS_OCUPACAO?.trim() || undefined,
    educationLevel: raw.DS_GRAU_INSTRUCAO?.trim() || undefined,
    maritalStatus: raw.DS_ESTADO_CIVIL?.trim() || undefined,
    nationality: raw.DS_NACIONALIDADE?.trim() || undefined,
    cityOfBirth: raw.NM_MUNICIPIO_NASCIMENTO?.trim() || undefined,
    stateOfBirth: raw.SG_UF_NASCIMENTO?.trim() || undefined,
    position: raw.DS_CARGO?.trim(),
    state: raw.SG_UF?.trim(),
    city: raw.NM_UE?.trim() || undefined,
    status: normalizeCandidateStatus(raw.DS_SITUACAO_CANDIDATURA),
    coalition: raw.NM_COLIGACAO?.trim() || undefined,
    federationName: raw.NM_FEDERACAO?.trim() || undefined,
    isReelectionCandidate: raw.ST_REELEICAO === 'S',
    electionId,
    partyId,
    sourceUrl: `https://dadosabertos.tse.jus.br/dataset/candidatos-${raw.ANO_ELEICAO}`,
    dataConfidence: 'OFFICIAL' as const,
    lastSyncAt: new Date(),
  };
}
