-- Portal V2 Performance Rebuild — Checkpoint 4
-- Isolated staging-only compatibility schema.
-- Additive CREATE-only migration: no production table is altered or dropped.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS lesson_entitlements (
  portal_user_id_norm TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  core_access INTEGER NOT NULL DEFAULT 1 CHECK (core_access IN (0, 1)),
  vr_access INTEGER NOT NULL DEFAULT 0 CHECK (vr_access IN (0, 1)),
  source TEXT NOT NULL DEFAULT 'excel' CHECK (source = 'excel'),
  first_granted_at TEXT NOT NULL,
  last_confirmed_at TEXT NOT NULL,
  source_batch_code TEXT,
  source_lesson_date TEXT,
  PRIMARY KEY (portal_user_id_norm, lesson_id)
);

CREATE TABLE IF NOT EXISTS online_prelesson_entitlements (
  portal_user_id_norm TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  batch_key TEXT NOT NULL,
  lesson_date TEXT NOT NULL,
  vr_access INTEGER NOT NULL DEFAULT 0 CHECK (vr_access IN (0, 1)),
  source_row_id TEXT NOT NULL,
  first_granted_at TEXT NOT NULL,
  last_confirmed_at TEXT NOT NULL,
  PRIMARY KEY (portal_user_id_norm, lesson_id, batch_key)
);

CREATE TABLE IF NOT EXISTS batch_definitions (
  batch_key TEXT PRIMARY KEY NOT NULL,
  academic_year TEXT NOT NULL,
  subject TEXT NOT NULL CHECK (subject IN ('maths', 'english')),
  school_year INTEGER NOT NULL CHECK (school_year BETWEEN 2 AND 6),
  stream TEXT NOT NULL CHECK (stream IN ('normal', '11plus')),
  maths_level INTEGER,
  active_from TEXT,
  active_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS student_batch_assignments (
  assignment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  portal_user_id_norm TEXT NOT NULL,
  batch_key TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (batch_key) REFERENCES batch_definitions(batch_key),
  UNIQUE (portal_user_id_norm, batch_key, effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cp4_open_batch_assignment
  ON student_batch_assignments (portal_user_id_norm, batch_key)
  WHERE effective_to IS NULL;

CREATE TABLE IF NOT EXISTS compat_synthetic_users (
  portal_user_id_norm TEXT PRIMARY KEY NOT NULL,
  user_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rebuild_shadow_reconciliation (
  operation_id TEXT PRIMARY KEY NOT NULL,
  portal_user_id_norm TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SYNCED', 'RECONCILE_REQUIRED')),
  shadow_scope TEXT,
  shadow_version TEXT,
  shadow_sha256 TEXT,
  error_message TEXT,
  first_seen_at TEXT NOT NULL,
  last_updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cp4_reconciliation_status
  ON rebuild_shadow_reconciliation (status, last_updated_at);
