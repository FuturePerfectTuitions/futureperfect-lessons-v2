-- FPT Portal V2
-- Migration 0002: opaque authenticated student sessions
-- Phase 4 secure authentication foundation

CREATE TABLE IF NOT EXISTS student_sessions (
  token_hash TEXT NOT NULL PRIMARY KEY,
  portal_user_id_norm TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_student_sessions_user
  ON student_sessions (portal_user_id_norm);

CREATE INDEX IF NOT EXISTS idx_student_sessions_idle_expiry
  ON student_sessions (idle_expires_at);

-- Phase 4 semantics:
-- 1. The browser receives only an opaque random session token.
-- 2. Only the SHA-256 hash of that token is stored in D1.
-- 3. Sessions are independent, so simultaneous devices are supported.
-- 4. A session becomes invalid when revoked or when idle_expires_at is reached.
-- 5. Successful authenticated activity refreshes last_activity_at and
--    idle_expires_at according to the 2-hour inactivity rule.
-- 6. Student identity is always derived from the verified session record,
--    never from a client-supplied Portal User ID.
