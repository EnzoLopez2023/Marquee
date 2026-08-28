export const version = 1
export const name = 'initial-marquee-schema'

export const sql = `
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE app_identities (
  tenant_id TEXT NOT NULL,
  oid TEXT NOT NULL,
  email_snapshot TEXT,
  display_name_snapshot TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, oid)
);

CREATE TABLE app_role_grants (
  tenant_id TEXT NOT NULL,
  oid TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer','duplicate_delete','admin')),
  granted_at INTEGER NOT NULL,
  granted_by_tenant_id TEXT,
  granted_by_oid TEXT,
  PRIMARY KEY (tenant_id, oid, role),
  FOREIGN KEY (tenant_id, oid) REFERENCES app_identities(tenant_id, oid) ON DELETE CASCADE
);

CREATE TABLE app_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_id INTEGER UNIQUE,
  ts INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  tenant_id TEXT,
  user_oid TEXT,
  user_email_snapshot TEXT,
  user_name_snapshot TEXT,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  authoritative INTEGER NOT NULL DEFAULT 1 CHECK (authoritative IN (0,1)),
  source TEXT NOT NULL DEFAULT 'server' CHECK (source IN ('server','client','legacy_client')),
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  view TEXT,
  method TEXT,
  path TEXT,
  status INTEGER,
  detail TEXT,
  ip TEXT
);
CREATE INDEX idx_app_audit_ts ON app_audit_log(ts DESC);
CREATE INDEX idx_app_audit_actor ON app_audit_log(tenant_id, user_oid, ts DESC);

CREATE TABLE plex_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  correlation_id TEXT,
  ts INTEGER NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  rating_key TEXT,
  library_id TEXT,
  library_title TEXT,
  movie_guid TEXT,
  title TEXT,
  year INTEGER,
  file_path TEXT,
  file_size INTEGER,
  duration_ms INTEGER,
  bitrate_kbps INTEGER,
  resolution TEXT,
  video_codec TEXT,
  audio_codec TEXT,
  audio_channels INTEGER,
  container TEXT,
  kept_rating_key TEXT,
  kept_file_path TEXT,
  snapshot_json TEXT,
  error_message TEXT,
  user_email TEXT,
  tenant_id TEXT,
  user_oid TEXT
);
CREATE INDEX idx_plex_action_ts ON plex_action_log(ts DESC);
CREATE INDEX idx_plex_action_rating_key ON plex_action_log(rating_key);
CREATE INDEX idx_plex_action_correlation ON plex_action_log(correlation_id);

CREATE TABLE sonarr_latest (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sampled_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  payload BLOB NOT NULL
);

CREATE TABLE sonarr_summary (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sampled_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  poll_minutes INTEGER NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE sonarr_metric_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sampled_at INTEGER NOT NULL UNIQUE,
  received_at INTEGER NOT NULL,
  series_count INTEGER,
  monitored_series_count INTEGER,
  episode_count INTEGER,
  episode_file_count INTEGER,
  monitored_episode_count INTEGER,
  missing_count INTEGER,
  cutoff_unmet_count INTEGER,
  queue_count INTEGER,
  health_issue_count INTEGER,
  library_size_bytes INTEGER,
  free_space_bytes INTEGER
);
CREATE INDEX idx_sonarr_metrics_sampled ON sonarr_metric_samples(sampled_at DESC);

CREATE TABLE sonarr_agent_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_id INTEGER UNIQUE,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX idx_sonarr_agent_logs_ts ON sonarr_agent_logs(ts DESC);

CREATE TABLE sonarr_ingest_receipts (
  delivery_id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX idx_sonarr_receipts_at ON sonarr_ingest_receipts(received_at);

CREATE TABLE provider_health (
  provider TEXT PRIMARY KEY CHECK (provider IN ('plex','tautulli','omdb','anthropic','playlist_model','sonarr')),
  observed_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','error')),
  latency_ms INTEGER,
  sanitized_error TEXT
);

CREATE TABLE contract_mutation_intents (
  id TEXT PRIMARY KEY,
  consumer TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  confirmation_phrase TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared','executing','succeeded','failed','unknown','expired')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  idempotency_key TEXT,
  result_json TEXT,
  error_message TEXT,
  UNIQUE (consumer, idempotency_key)
);

CREATE TRIGGER app_audit_immutable_update
BEFORE UPDATE ON app_audit_log BEGIN
  SELECT RAISE(ABORT, 'app_audit_log is append-only');
END;
CREATE TRIGGER app_audit_immutable_delete
BEFORE DELETE ON app_audit_log BEGIN
  SELECT RAISE(ABORT, 'app_audit_log is append-only');
END;
CREATE TRIGGER plex_action_immutable_update
BEFORE UPDATE ON plex_action_log BEGIN
  SELECT RAISE(ABORT, 'plex_action_log is append-only');
END;
CREATE TRIGGER plex_action_immutable_delete
BEFORE DELETE ON plex_action_log BEGIN
  SELECT RAISE(ABORT, 'plex_action_log is append-only');
END;
`
