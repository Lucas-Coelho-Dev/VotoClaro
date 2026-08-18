const fs = require('fs/promises');
const path = require('path');
const { Pool } = require('pg');

class SnapshotStore {
  constructor(config) {
    this.config = config;
    this.pool = null;
    this.latest = null;
    this.runs = [];
    this.photoStates = new Map();
    this.candidateViews = new Map();
    this.fileWriteChain = Promise.resolve();
    this.backend = config.databaseUrl ? 'postgresql' : 'filesystem';
  }

  async initialize() {
    if (this.config.databaseUrl) {
      this.pool = new Pool({
        connectionString: this.config.databaseUrl,
        ssl: this.config.databaseSsl ? { rejectUnauthorized: false } : false,
        max: 5,
      });
      await this.pool.query('SELECT 1');
      await this.migrate();
      const snapshotResult = await this.pool.query(
        'SELECT payload FROM data_snapshots ORDER BY imported_at DESC LIMIT 1',
      );
      this.latest = snapshotResult.rows[0]?.payload || null;
      const runResult = await this.pool.query(
        'SELECT source_id AS "sourceId", status, started_at AS "startedAt", finished_at AS "finishedAt", record_count AS "recordCount", error_message AS "error" FROM sync_runs ORDER BY started_at DESC LIMIT 30',
      );
      this.runs = runResult.rows;
      const photoStateResult = await this.pool.query(
        'SELECT unit, source_url AS "sourceUrl", etag, last_modified AS "lastModified", checked_at AS "checkedAt", updated_at AS "updatedAt", record_count AS "recordCount" FROM photo_sync_state',
      );
      this.photoStates = new Map(photoStateResult.rows.map((state) => [state.unit, state]));
      return;
    }

    await fs.mkdir(this.config.dataDir, { recursive: true });
    await fs.mkdir(this.config.photoDir, { recursive: true });
    try {
      this.latest = JSON.parse(await fs.readFile(path.join(this.config.dataDir, 'latest.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      this.runs = JSON.parse(await fs.readFile(path.join(this.config.dataDir, 'runs.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      const states = JSON.parse(await fs.readFile(path.join(this.config.dataDir, 'photo-manifest.json'), 'utf8'));
      this.photoStates = new Map(Object.entries(states));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      const stored = JSON.parse(await fs.readFile(path.join(this.config.dataDir, 'candidate-views.json'), 'utf8'));
      const entries = Object.entries(stored?.candidates || {}).filter(([candidateId, aggregate]) => (
        /^\d{1,32}$/.test(candidateId)
        && Number.isSafeInteger(aggregate?.viewCount)
        && aggregate.viewCount > 0
      ));
      this.candidateViews = new Map(entries);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS data_snapshots (
        id BIGSERIAL PRIMARY KEY,
        checksum TEXT NOT NULL UNIQUE,
        source_generated_at TIMESTAMPTZ,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        record_count INTEGER NOT NULL,
        payload JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS data_snapshots_imported_at_idx
        ON data_snapshots (imported_at DESC);

      CREATE TABLE IF NOT EXISTS sync_runs (
        id BIGSERIAL PRIMARY KEY,
        source_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ,
        record_count INTEGER,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS sync_runs_started_at_idx
        ON sync_runs (started_at DESC);

      CREATE TABLE IF NOT EXISTS candidate_photos (
        candidate_id TEXT PRIMARY KEY,
        content_type TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        image_data BYTEA NOT NULL,
        source_unit TEXT NOT NULL,
        source_updated_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS candidate_photos_source_unit_idx
        ON candidate_photos (source_unit);

      CREATE TABLE IF NOT EXISTS photo_sync_state (
        unit TEXT PRIMARY KEY,
        source_url TEXT NOT NULL,
        etag TEXT,
        last_modified TEXT,
        checked_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ,
        record_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS candidate_view_counts (
        candidate_id TEXT PRIMARY KEY,
        view_count BIGINT NOT NULL DEFAULT 0 CHECK (view_count >= 0),
        last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS candidate_view_counts_ranking_idx
        ON candidate_view_counts (view_count DESC, last_viewed_at DESC);
    `);
  }

  getSnapshot() {
    return this.latest;
  }

  getRuns() {
    return this.runs.slice(0, 30);
  }

  async saveSnapshot(snapshot) {
    this.latest = snapshot;
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO data_snapshots (checksum, source_generated_at, imported_at, record_count, payload)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (checksum) DO NOTHING`,
        [snapshot.meta.checksum, snapshot.meta.sourceGeneratedAt, snapshot.meta.importedAt, snapshot.meta.candidateCount, snapshot],
      );
      await this.pool.query(
        `DELETE FROM data_snapshots WHERE id NOT IN (
           SELECT id FROM data_snapshots ORDER BY imported_at DESC LIMIT $1
         )`,
        [this.config.snapshotRetention],
      );
      return;
    }

    await this.queuedJsonWrite(path.join(this.config.dataDir, 'latest.json'), snapshot);
  }

  async recordRun(run) {
    this.runs.unshift(run);
    this.runs = this.runs.slice(0, 30);
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO sync_runs (source_id, status, started_at, finished_at, record_count, error_message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [run.sourceId, run.status, run.startedAt, run.finishedAt, run.recordCount || null, run.error || null],
      );
      return;
    }
    await this.queuedJsonWrite(path.join(this.config.dataDir, 'runs.json'), this.runs);
  }

  getPhotoSyncState(unit) {
    return this.photoStates.get(unit) || null;
  }

  async savePhotoSyncState(unit, state) {
    this.photoStates.set(unit, state);
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO photo_sync_state (unit, source_url, etag, last_modified, checked_at, updated_at, record_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (unit) DO UPDATE SET
           source_url = EXCLUDED.source_url,
           etag = EXCLUDED.etag,
           last_modified = EXCLUDED.last_modified,
           checked_at = EXCLUDED.checked_at,
           updated_at = EXCLUDED.updated_at,
           record_count = EXCLUDED.record_count`,
        [unit, state.sourceUrl, state.etag || null, state.lastModified || null, state.checkedAt, state.updatedAt || null, state.recordCount || 0],
      );
      return;
    }
    await this.queuedJsonWrite(
      path.join(this.config.dataDir, 'photo-manifest.json'),
      Object.fromEntries(this.photoStates),
    );
  }

  async saveCandidatePhotos(photos) {
    if (!photos.length) return;
    if (this.pool) {
      const rows = photos.map((photo) => ({
        candidate_id: photo.candidateId,
        content_type: photo.contentType,
        sha256: photo.sha256,
        encoded: photo.buffer.toString('base64'),
        source_unit: photo.sourceUnit,
        source_updated_at: photo.sourceUpdatedAt || '',
      }));
      await this.pool.query(
        `WITH incoming AS (
           SELECT
             item.candidate_id,
             item.content_type,
             item.sha256,
             decode(item.encoded, 'base64') AS image_data,
             item.source_unit,
             NULLIF(item.source_updated_at, '')::timestamptz AS source_updated_at
           FROM jsonb_to_recordset($1::jsonb) AS item(
             candidate_id TEXT,
             content_type TEXT,
             sha256 TEXT,
             encoded TEXT,
             source_unit TEXT,
             source_updated_at TEXT
           )
         )
         INSERT INTO candidate_photos (candidate_id, content_type, sha256, image_data, source_unit, source_updated_at)
         SELECT candidate_id, content_type, sha256, image_data, source_unit, source_updated_at FROM incoming
         ON CONFLICT (candidate_id) DO UPDATE SET
           content_type = EXCLUDED.content_type,
           sha256 = EXCLUDED.sha256,
           image_data = EXCLUDED.image_data,
           source_unit = EXCLUDED.source_unit,
           source_updated_at = EXCLUDED.source_updated_at,
           updated_at = NOW()
         WHERE candidate_photos.sha256 IS DISTINCT FROM EXCLUDED.sha256`,
        [JSON.stringify(rows)],
      );
      return;
    }

    await Promise.all(photos.map(async (photo) => {
      if (!/^\d+$/.test(photo.candidateId)) return;
      const target = path.join(this.config.photoDir, `${photo.candidateId}.jpg`);
      const temporary = path.join(this.config.photoDir, `.${photo.candidateId}.${process.pid}.tmp`);
      await fs.writeFile(temporary, photo.buffer);
      await fs.rename(temporary, target);
    }));
  }

  async availablePhotoIds(candidateIds) {
    const wanted = new Set(candidateIds.filter((id) => /^\d+$/.test(String(id))));
    if (!wanted.size) return new Set();
    if (this.pool) {
      const result = await this.pool.query(
        'SELECT candidate_id FROM candidate_photos WHERE candidate_id = ANY($1::text[])',
        [[...wanted]],
      );
      return new Set(result.rows.map((row) => row.candidate_id));
    }
    const entries = await fs.readdir(this.config.photoDir, { withFileTypes: true });
    return new Set(entries
      .filter((entry) => entry.isFile() && /^\d+\.jpg$/.test(entry.name))
      .map((entry) => entry.name.slice(0, -4))
      .filter((id) => wanted.has(id)));
  }

  async getCandidatePhoto(candidateId) {
    if (!/^\d+$/.test(String(candidateId))) return null;
    if (this.pool) {
      const result = await this.pool.query(
        'SELECT content_type AS "contentType", sha256, image_data AS buffer, source_updated_at AS "sourceUpdatedAt" FROM candidate_photos WHERE candidate_id = $1',
        [candidateId],
      );
      return result.rows[0] || null;
    }
    try {
      const buffer = await fs.readFile(path.join(this.config.photoDir, `${candidateId}.jpg`));
      return { contentType: 'image/jpeg', buffer, sha256: null, sourceUpdatedAt: null };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async recordCandidateView(candidateId) {
    const normalizedId = String(candidateId || '');
    if (!/^\d{1,32}$/.test(normalizedId)) throw new Error('INVALID_CANDIDATE_ID');
    if (this.pool) {
      const result = await this.pool.query(
        `INSERT INTO candidate_view_counts (candidate_id, view_count, last_viewed_at)
         VALUES ($1, 1, NOW())
         ON CONFLICT (candidate_id) DO UPDATE SET
           view_count = candidate_view_counts.view_count + 1,
           last_viewed_at = NOW()
         RETURNING view_count AS "viewCount", last_viewed_at AS "lastViewedAt"`,
        [normalizedId],
      );
      return {
        candidateId: normalizedId,
        viewCount: Number(result.rows[0].viewCount),
        lastViewedAt: result.rows[0].lastViewedAt,
      };
    }

    const current = this.candidateViews.get(normalizedId);
    const aggregate = {
      viewCount: (current?.viewCount || 0) + 1,
      lastViewedAt: new Date().toISOString(),
    };
    this.candidateViews.set(normalizedId, aggregate);
    await this.queuedJsonWrite(path.join(this.config.dataDir, 'candidate-views.json'), {
      version: 1,
      candidates: Object.fromEntries(this.candidateViews),
    });
    return { candidateId: normalizedId, ...aggregate };
  }

  async getPopularCandidateViews(limit = 100) {
    const safeLimit = Math.max(1, Math.min(1000, Number.parseInt(limit, 10) || 100));
    if (this.pool) {
      const result = await this.pool.query(
        `SELECT candidate_id AS "candidateId", view_count AS "viewCount", last_viewed_at AS "lastViewedAt"
         FROM candidate_view_counts
         ORDER BY view_count DESC, last_viewed_at DESC, candidate_id ASC
         LIMIT $1`,
        [safeLimit],
      );
      return result.rows.map((row) => ({ ...row, viewCount: Number(row.viewCount) }));
    }
    return [...this.candidateViews.entries()]
      .map(([candidateId, aggregate]) => ({ candidateId, ...aggregate }))
      .sort((left, right) => (
        right.viewCount - left.viewCount
        || String(right.lastViewedAt).localeCompare(String(left.lastViewedAt))
        || left.candidateId.localeCompare(right.candidateId)
      ))
      .slice(0, safeLimit);
  }

  async queuedJsonWrite(target, value) {
    const content = JSON.stringify(value);
    const write = () => fs.writeFile(target, content, 'utf8');
    this.fileWriteChain = this.fileWriteChain.then(write, write);
    await this.fileWriteChain;
  }

  async close() {
    if (this.pool) await this.pool.end();
  }
}

module.exports = { SnapshotStore };
