-- Step 10: short-lived, single-use launch codes for standalone 11+ Practice.
CREATE TABLE IF NOT EXISTS quiz_launch_codes (
  code_hash TEXT PRIMARY KEY,
  portal_user_id_norm TEXT NOT NULL,
  portal_session_token_hash TEXT NOT NULL,
  release_context_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_quiz_launch_expiry ON quiz_launch_codes(expires_at, used_at);
CREATE INDEX IF NOT EXISTS idx_quiz_launch_user ON quiz_launch_codes(portal_user_id_norm, created_at DESC);
