export const version = 2
export const name = 'app-local-feature-permissions'

export const sql = `
CREATE TABLE app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO app_metadata(key, value) VALUES
  ('application_id', 'marquee'),
  ('schema_contract', 'marquee.sqlite.v2');

CREATE TABLE app_feature_permissions (
  tenant_id TEXT NOT NULL,
  oid TEXT NOT NULL,
  feature TEXT NOT NULL CHECK (feature IN ('plex-library','plex-command-center','sonarr-dashboard')),
  can_edit INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0,1)),
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0,1)),
  PRIMARY KEY (tenant_id, oid, feature),
  FOREIGN KEY (tenant_id, oid) REFERENCES app_identities(tenant_id, oid) ON DELETE CASCADE
);

CREATE TABLE runtime_instance_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE plex_delete_locks (
  lock_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_plex_delete_locks_expires ON plex_delete_locks(expires_at);
`
