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
  syncOnStart: booleanFromEnv('SYNC_ON_START', true),
  syncPhotos: booleanFromEnv('SYNC_PHOTOS', true),
  photoSyncConcurrency: integerFromEnv('PHOTO_SYNC_CONCURRENCY', 3, 1),
  maxCandidatePhotoBytes: integerFromEnv('MAX_CANDIDATE_PHOTO_BYTES', 5 * 1024 * 1024, 32 * 1024),
  syncIntervalMinutes: integerFromEnv('SYNC_INTERVAL_MINUTES', 120, 15),
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
});
