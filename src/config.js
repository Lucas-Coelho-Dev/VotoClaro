const path = require('path');

function integerFromEnv(name, fallback, minimum = 1) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function booleanFromEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function numberFromEnv(name, fallback, minimum = 0, maximum = Number.POSITIVE_INFINITY) {
  const parsed = Number.parseFloat(process.env[name] || '');
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

const rootDir = path.resolve(__dirname, '..');

module.exports = Object.freeze({
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  dataDir: process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(rootDir, 'data'),
  photoDir: process.env.PHOTO_DIR
    ? path.resolve(process.env.PHOTO_DIR)
    : path.join(process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(rootDir, 'data'), 'photos'),
  port: integerFromEnv('PORT', 3000),
  environment: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: booleanFromEnv('DATABASE_SSL', process.env.NODE_ENV === 'production'),
  // SYNC_ON_START faz apenas a carga inicial de um armazenamento vazio.
  // Se já existe uma base persistida, o servidor a utiliza imediatamente.
  syncOnStart: booleanFromEnv('SYNC_ON_START', true),
  syncPhotos: booleanFromEnv('SYNC_PHOTOS', true),
  photoSyncConcurrency: integerFromEnv('PHOTO_SYNC_CONCURRENCY', 3, 1),
  maxCandidatePhotoBytes: integerFromEnv('MAX_CANDIDATE_PHOTO_BYTES', 5 * 1024 * 1024, 32 * 1024),
  syncIntervalMinutes: integerFromEnv('SYNC_INTERVAL_MINUTES', 360, 15),
  requestTimeoutMs: integerFromEnv('SOURCE_TIMEOUT_MS', 120000, 5000),
  maxDownloadBytes: integerFromEnv('MAX_DOWNLOAD_BYTES', 250 * 1024 * 1024, 1024 * 1024),
  snapshotRetention: integerFromEnv('SNAPSHOT_RETENTION', 10, 2),
  syncSecret: process.env.SYNC_SECRET || process.env.CRON_SECRET || '',
  portalUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
  integrityTimeoutMs: integerFromEnv('INTEGRITY_TIMEOUT_MS', 30000, 1000),
  integrityRetryCount: integerFromEnv('INTEGRITY_RETRY_COUNT', 1, 0),
  integrityRetryDelayMs: integerFromEnv('INTEGRITY_RETRY_DELAY_MS', 500, 100),
  integrityCacheTtlMinutes: integerFromEnv('INTEGRITY_CACHE_TTL_MINUTES', 360, 5),
  integrityErrorCacheTtlSeconds: integerFromEnv('INTEGRITY_ERROR_CACHE_TTL_SECONDS', 300, 15),
  integrityMaxResponseBytes: integerFromEnv('INTEGRITY_MAX_RESPONSE_BYTES', 1024 * 1024, 64 * 1024),
  portalTransparenciaToken: process.env.PORTAL_TRANSPARENCIA_TOKEN || '',
  localLlmEnabled: booleanFromEnv('LOCAL_LLM_ENABLED', false),
  localLlmBaseUrl: process.env.LOCAL_LLM_BASE_URL || 'http://llm:8080/v1',
  localLlmModel: process.env.LOCAL_LLM_MODEL || 'qwen3-4b-local',
  localLlmTimeoutMs: integerFromEnv('LOCAL_LLM_TIMEOUT_MS', 20 * 60 * 1000, 5000),
  localLlmStartupWaitMs: integerFromEnv('LOCAL_LLM_STARTUP_WAIT_MS', 30 * 60 * 1000, 30_000),
  localLlmChunkCharacters: integerFromEnv('LOCAL_LLM_CHUNK_CHARACTERS', 18000, 2000),
  localLlmMaxOutputTokens: integerFromEnv('LOCAL_LLM_MAX_OUTPUT_TOKENS', 1600, 256),
  localLlmTemperature: numberFromEnv('LOCAL_LLM_TEMPERATURE', 0.1, 0, 0.4),
  localLlmPrecomputeOnStart: booleanFromEnv('LOCAL_LLM_PRECOMPUTE_ON_START', true),
  localLlmPrecomputeLimit: integerFromEnv('LOCAL_LLM_PRECOMPUTE_LIMIT', 200, 1),
});
