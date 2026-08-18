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

-- A contagem acima é agregada por candidatura e não guarda identificador do visitante.
-- Intencionalmente não existem tabelas de usuário ou voto/colinha.
-- Opinião política é dado pessoal sensível e não é necessária ao portal público.
