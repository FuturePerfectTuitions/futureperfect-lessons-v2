-- FPT Portal V2
-- Phase 19: one-use Trial IDs and browser-window-bound student sessions.

CREATE TABLE IF NOT EXISTS trial_login_consumptions (
  portal_user_id_norm TEXT NOT NULL PRIMARY KEY,
  consumed_at TEXT NOT NULL,
  first_session_token_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS student_session_windows (
  token_hash TEXT NOT NULL PRIMARY KEY,
  portal_user_id_norm TEXT NOT NULL,
  window_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_student_session_windows_user
  ON student_session_windows (portal_user_id_norm);
