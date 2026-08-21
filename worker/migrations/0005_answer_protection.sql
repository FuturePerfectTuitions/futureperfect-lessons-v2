-- Phase 8: short-lived protected-answer authorization state.
-- Stores opaque-token hashes only; no Answer Pack passwords are written to D1.

CREATE TABLE IF NOT EXISTS answer_view_tokens (
  token_hash TEXT PRIMARY KEY,
  session_token_hash TEXT NOT NULL,
  portal_user_id_norm TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  view_id TEXT NOT NULL,
  password_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  content_expires_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_answer_view_tokens_session
  ON answer_view_tokens(session_token_hash);

CREATE INDEX IF NOT EXISTS idx_answer_view_tokens_lease
  ON answer_view_tokens(lease_expires_at);

CREATE TABLE IF NOT EXISTS answer_password_rate_limits (
  session_token_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)
);
