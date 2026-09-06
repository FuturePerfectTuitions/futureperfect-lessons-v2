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

CREATE INDEX IF NOT EXISTS idx_online_prelesson_user_lesson
  ON online_prelesson_entitlements (portal_user_id_norm, lesson_id);
