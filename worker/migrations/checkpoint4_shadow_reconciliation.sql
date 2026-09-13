-- Checkpoint 4 production-shadow operational database.
-- Additive CREATE-only schema. No pupil entitlement data is stored here.

CREATE TABLE IF NOT EXISTS rebuild_shadow_reconciliation (
  operation_id TEXT PRIMARY KEY NOT NULL,
  user_scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SYNCED', 'RECONCILE_REQUIRED')),
  shadow_scope TEXT,
  shadow_version TEXT,
  shadow_sha256 TEXT,
  error_message TEXT,
  source_route TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rebuild_shadow_reconciliation_status
  ON rebuild_shadow_reconciliation (status, last_updated_at);

CREATE INDEX IF NOT EXISTS idx_rebuild_shadow_reconciliation_scope
  ON rebuild_shadow_reconciliation (user_scope, last_updated_at);
