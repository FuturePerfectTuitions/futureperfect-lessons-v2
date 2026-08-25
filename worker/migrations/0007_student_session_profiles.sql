-- Phase 11: quota-safe authenticated-session student profile projection.
-- Passwords remain authoritative in STUDENTS_KV and are deliberately excluded
-- from this table. Protected Answer Pack validation continues to re-read the
-- current answer password from STUDENTS_KV.

CREATE TABLE IF NOT EXISTS student_session_profiles (
  token_hash TEXT NOT NULL PRIMARY KEY,
  portal_user_id_norm TEXT NOT NULL,
  user_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_student_session_profiles_user
  ON student_session_profiles (portal_user_id_norm);

-- Any session revocation (including the existing single-device trigger and an
-- administrative account/password reset operation) invalidates its projection.
CREATE TRIGGER IF NOT EXISTS trg_student_session_profile_delete_on_revoke
AFTER UPDATE OF revoked_at ON student_sessions
FOR EACH ROW
WHEN NEW.revoked_at IS NOT NULL
BEGIN
  DELETE FROM student_session_profiles WHERE token_hash = NEW.token_hash;
END;
