CREATE TABLE IF NOT EXISTS mock_password_rate_limits (
  portal_user_id_norm TEXT NOT NULL,
  mock_day INTEGER NOT NULL CHECK (mock_day > 0),
  window_started_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  PRIMARY KEY (portal_user_id_norm, mock_day)
);

CREATE INDEX IF NOT EXISTS idx_mock_password_rate_limits_window
  ON mock_password_rate_limits(window_started_at);
