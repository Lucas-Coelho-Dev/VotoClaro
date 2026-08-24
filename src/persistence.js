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
    this.analysisReports = new Map();
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
        'SELECT payload FROM data_snapshots ORDER BY imported_at DESC, id DESC LIMIT 1',
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
    try {
      const stored = JSON.parse(await fs.readFile(path.join(this.config.dataDir, 'analysis-reports.json'), 'utf8'));
      this.analysisReports = new Map((stored?.reports || []).map((report) => [report.trackingCode, report]));
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

      CREATE TABLE IF NOT EXISTS government_plan_analyses (
        document_sha256 TEXT NOT NULL,
        analysis_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'READY', 'FAILED')),
        model TEXT,
        prompt_version TEXT,
        payload JSONB,
        error_message TEXT,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (document_sha256, analysis_version)
      );
      CREATE INDEX IF NOT EXISTS government_plan_analyses_status_idx
        ON government_plan_analyses (status, updated_at);

      CREATE TABLE IF NOT EXISTS legislative_profile_cache (
        chamber TEXT NOT NULL,
        member_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (chamber, member_id)
      );
      CREATE INDEX IF NOT EXISTS legislative_profile_cache_fetched_idx
        ON legislative_profile_cache (fetched_at DESC);

      CREATE TABLE IF NOT EXISTS legislative_item_analyses (
        item_key TEXT NOT NULL,
        analysis_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'READY', 'FAILED')),
        model TEXT,
        prompt_version TEXT,
        payload JSONB,
        error_message TEXT,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (item_key, analysis_version)
      );
      CREATE INDEX IF NOT EXISTS legislative_item_analyses_status_idx
        ON legislative_item_analyses (status, updated_at);

      CREATE TABLE IF NOT EXISTS analysis_reports (
        id BIGSERIAL PRIMARY KEY,
        tracking_code TEXT NOT NULL UNIQUE,
        candidate_id TEXT NOT NULL,
        subject_type TEXT NOT NULL CHECK (subject_type IN ('GOVERNMENT_PLAN', 'LEGISLATIVE_ITEM')),
        subject_key TEXT,
        category TEXT NOT NULL,
        page_number INTEGER,
        details TEXT NOT NULL,
        analysis_version TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED')),
        resolution_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS analysis_reports_status_idx
        ON analysis_reports (status, created_at DESC);
    `);
  }

  getSnapshot() {
    return this.latest;
  }

  getRuns() {
    return this.runs.slice(0, 30);
  }

  async refreshSnapshot() {
    let snapshot = null;
    if (this.pool) {
      const [snapshotResult, runResult] = await Promise.all([
        this.pool.query('SELECT payload FROM data_snapshots ORDER BY imported_at DESC, id DESC LIMIT 1'),
        this.pool.query(
          'SELECT source_id AS "sourceId", status, started_at AS "startedAt", finished_at AS "finishedAt", record_count AS "recordCount", error_message AS "error" FROM sync_runs ORDER BY started_at DESC LIMIT 30',
        ),
      ]);
      snapshot = snapshotResult.rows[0]?.payload || null;
      this.runs = runResult.rows;
    } else {
      try {
        snapshot = JSON.parse(await fs.readFile(path.join(this.config.dataDir, 'latest.json'), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (!snapshot) return false;
    const previousIdentity = `${this.latest?.meta?.checksum || ''}:${this.latest?.meta?.lastSyncAttemptAt || ''}`;
    const currentIdentity = `${snapshot.meta?.checksum || ''}:${snapshot.meta?.lastSyncAttemptAt || ''}`;
    const changed = previousIdentity !== currentIdentity;
    if (changed) this.latest = snapshot;
    return changed;
  }

  async saveSnapshot(snapshot) {
    this.latest = snapshot;
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO data_snapshots (checksum, source_generated_at, imported_at, record_count, payload)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (checksum) DO UPDATE SET
           source_generated_at = EXCLUDED.source_generated_at,
           imported_at = EXCLUDED.imported_at,
           record_count = EXCLUDED.record_count,
           payload = EXCLUDED.payload`,
        [snapshot.meta.checksum, snapshot.meta.sourceGeneratedAt, snapshot.meta.importedAt, snapshot.meta.candidateCount, snapshot],
      );
      await this.pool.query(
        `DELETE FROM data_snapshots WHERE id NOT IN (
           SELECT id FROM data_snapshots ORDER BY imported_at DESC, id DESC LIMIT $1
         )`,
        [this.config.snapshotRetention],
      );
      return;
    }

    await this.queuedJsonWrite(path.join(this.config.dataDir, 'latest.json'), snapshot);
  }

  async updateSourceStatuses(statuses, attemptedAt = new Date().toISOString()) {
    if (!this.latest) return null;
    const snapshot = {
      ...this.latest,
      meta: { ...this.latest.meta, lastSyncAttemptAt: attemptedAt },
      sourceStatuses: { ...(this.latest.sourceStatuses || {}), ...statuses },
    };
    this.latest = snapshot;
    if (this.pool) {
      await this.pool.query(
        'UPDATE data_snapshots SET payload = $2 WHERE checksum = $1',
        [snapshot.meta.checksum, snapshot],
      );
      return snapshot;
    }
    await this.queuedJsonWrite(path.join(this.config.dataDir, 'latest.json'), snapshot);
    return snapshot;
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
    const available = new Set();
    if (this.pool) {
      const result = await this.pool.query(
        'SELECT candidate_id FROM candidate_photos WHERE candidate_id = ANY($1::text[])',
        [[...wanted]],
      );
      for (const row of result.rows) available.add(row.candidate_id);
    }
    try {
      const entries = await fs.readdir(this.config.photoDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !/^\d+\.jpg$/.test(entry.name)) continue;
        const candidateId = entry.name.slice(0, -4);
        if (wanted.has(candidateId)) available.add(candidateId);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return available;
  }

  async getCandidatePhoto(candidateId) {
    if (!/^\d+$/.test(String(candidateId))) return null;
    if (this.pool) {
      const result = await this.pool.query(
        'SELECT content_type AS "contentType", sha256, image_data AS buffer, source_updated_at AS "sourceUpdatedAt" FROM candidate_photos WHERE candidate_id = $1',
        [candidateId],
      );
      if (result.rows[0]) return result.rows[0];
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

  async getGovernmentPlanAnalysis(documentSha256, analysisVersion) {
    if (!this.pool) return null;
    const result = await this.pool.query(
      `SELECT document_sha256 AS "documentSha256", analysis_version AS "analysisVersion",
              status, model, prompt_version AS "promptVersion", payload,
              error_message AS "error", attempts, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM government_plan_analyses
       WHERE document_sha256 = $1 AND analysis_version = $2`,
      [documentSha256, analysisVersion],
    );
    return result.rows[0] || null;
  }

  async saveGovernmentPlanAnalysis(record) {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO government_plan_analyses (
         document_sha256, analysis_version, status, model, prompt_version,
         payload, error_message, attempts, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, NOW()), NOW())
       ON CONFLICT (document_sha256, analysis_version) DO UPDATE SET
         status = EXCLUDED.status,
         model = EXCLUDED.model,
         prompt_version = EXCLUDED.prompt_version,
         payload = EXCLUDED.payload,
         error_message = EXCLUDED.error_message,
         attempts = EXCLUDED.attempts,
         updated_at = NOW()`,
      [
        record.documentSha256,
        record.analysisVersion,
        record.status,
        record.model || null,
        record.promptVersion || null,
        record.payload || null,
        record.error || null,
        Number(record.attempts) || 0,
        record.createdAt || null,
      ],
    );
  }

  async getLegislativeProfileCache(chamber, memberId, maxAgeMs) {
    if (!this.pool) return null;
    const result = await this.pool.query(
      `SELECT payload, fetched_at AS "fetchedAt"
       FROM legislative_profile_cache
       WHERE chamber = $1 AND member_id = $2
         AND fetched_at >= NOW() - ($3::double precision * INTERVAL '1 millisecond')`,
      [String(chamber), String(memberId), Math.max(0, Number(maxAgeMs) || 0)],
    );
    return result.rows[0] || null;
  }

  async saveLegislativeProfileCache(chamber, memberId, payload) {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO legislative_profile_cache (chamber, member_id, payload, fetched_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (chamber, member_id) DO UPDATE SET
         payload = EXCLUDED.payload,
         fetched_at = NOW()`,
      [String(chamber), String(memberId), payload],
    );
  }

  async getLegislativeItemAnalysis(itemKey, analysisVersion) {
    if (!this.pool) return null;
    const result = await this.pool.query(
      `SELECT item_key AS "itemKey", analysis_version AS "analysisVersion",
              status, model, prompt_version AS "promptVersion", payload,
              error_message AS "error", attempts, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM legislative_item_analyses
       WHERE item_key = $1 AND analysis_version = $2`,
      [String(itemKey), String(analysisVersion)],
    );
    return result.rows[0] || null;
  }

  async saveLegislativeItemAnalysis(record) {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO legislative_item_analyses (
         item_key, analysis_version, status, model, prompt_version,
         payload, error_message, attempts, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, NOW()), NOW())
       ON CONFLICT (item_key, analysis_version) DO UPDATE SET
         status = EXCLUDED.status,
         model = EXCLUDED.model,
         prompt_version = EXCLUDED.prompt_version,
         payload = EXCLUDED.payload,
         error_message = EXCLUDED.error_message,
         attempts = EXCLUDED.attempts,
         updated_at = NOW()`,
      [
        record.itemKey,
        record.analysisVersion,
        record.status,
        record.model || null,
        record.promptVersion || null,
        record.payload || null,
        record.error || null,
        Number(record.attempts) || 0,
        record.createdAt || null,
      ],
    );
  }

  async createAnalysisReport(report) {
    const stored = {
      ...report,
      status: 'OPEN',
      createdAt: report.createdAt || new Date().toISOString(),
      updatedAt: report.createdAt || new Date().toISOString(),
    };
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO analysis_reports (
           tracking_code, candidate_id, subject_type, subject_key, category,
           page_number, details, analysis_version, status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'OPEN', $9, $9)`,
        [
          stored.trackingCode,
          stored.candidateId,
          stored.subjectType,
          stored.subjectKey || null,
          stored.category,
          stored.pageNumber || null,
          stored.details,
          stored.analysisVersion || null,
          stored.createdAt,
        ],
      );
      return stored;
    }
    this.analysisReports.set(stored.trackingCode, stored);
    const reports = [...this.analysisReports.values()].slice(-1000);
    await this.queuedJsonWrite(path.join(this.config.dataDir, 'analysis-reports.json'), { version: 1, reports });
    return stored;
  }

  async getAnalysisReport(trackingCode) {
    if (this.pool) {
      const result = await this.pool.query(
        `SELECT tracking_code AS "trackingCode", candidate_id AS "candidateId",
                subject_type AS "subjectType", category, page_number AS "pageNumber",
                analysis_version AS "analysisVersion", status,
                resolution_note AS "resolutionNote", created_at AS "createdAt", updated_at AS "updatedAt"
         FROM analysis_reports WHERE tracking_code = $1`,
        [String(trackingCode)],
      );
      return result.rows[0] || null;
    }
    const report = this.analysisReports.get(String(trackingCode));
    if (!report) return null;
    const { details, subjectKey, ...publicReport } = report;
    return publicReport;
  }

  async updateAnalysisReport(trackingCode, update) {
    const updatedAt = new Date().toISOString();
    if (this.pool) {
      const result = await this.pool.query(
        `UPDATE analysis_reports
         SET status = $2, resolution_note = $3, updated_at = $4
         WHERE tracking_code = $1
         RETURNING tracking_code AS "trackingCode", candidate_id AS "candidateId",
                   subject_type AS "subjectType", category, page_number AS "pageNumber",
                   analysis_version AS "analysisVersion", status,
                   resolution_note AS "resolutionNote", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [String(trackingCode), update.status, update.resolutionNote, updatedAt],
      );
      return result.rows[0] || null;
    }
    const report = this.analysisReports.get(String(trackingCode));
    if (!report) return null;
    const stored = { ...report, ...update, updatedAt };
    this.analysisReports.set(stored.trackingCode, stored);
    await this.queuedJsonWrite(path.join(this.config.dataDir, 'analysis-reports.json'), {
      version: 1,
      reports: [...this.analysisReports.values()].slice(-1000),
    });
    const { details, subjectKey, ...publicReport } = stored;
    return publicReport;
  }

  async getAiAuditStats() {
    if (!this.pool) {
      const reportCounts = new Map();
      for (const report of this.analysisReports.values()) {
        reportCounts.set(report.status, (reportCounts.get(report.status) || 0) + 1);
      }
      return {
        governmentPlans: [],
        legislativeItems: [],
        correctionReports: [...reportCounts].map(([status, count]) => ({ status, count })),
      };
    }
    const [plans, legislative, reports] = await Promise.all([
      this.pool.query(
        `SELECT analysis_version AS "analysisVersion", prompt_version AS "promptVersion", model,
                status, COUNT(*)::integer AS count, MAX(updated_at) AS "lastUpdatedAt"
         FROM government_plan_analyses
         GROUP BY analysis_version, prompt_version, model, status
         ORDER BY "lastUpdatedAt" DESC`,
      ),
      this.pool.query(
        `SELECT analysis_version AS "analysisVersion", prompt_version AS "promptVersion", model,
                status, COUNT(*)::integer AS count, MAX(updated_at) AS "lastUpdatedAt"
         FROM legislative_item_analyses
         GROUP BY analysis_version, prompt_version, model, status
         ORDER BY "lastUpdatedAt" DESC`,
      ),
      this.pool.query(
        `SELECT status, COUNT(*)::integer AS count, MAX(updated_at) AS "lastUpdatedAt"
         FROM analysis_reports GROUP BY status ORDER BY status`,
      ),
    ]);
    return {
      governmentPlans: plans.rows,
      legislativeItems: legislative.rows,
      correctionReports: reports.rows,
    };
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
