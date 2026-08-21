-- Phase 4: enforce one active browser/device session per Portal User ID.
-- Any new successful login inserts a new student_sessions row; this trigger
-- revokes all older active sessions for that student immediately before the
-- new row is inserted. The newest login therefore wins.

-- Clear all existing development/test sessions so the new rule starts from a
-- known state when this migration is applied.
UPDATE student_sessions
SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE revoked_at IS NULL;

CREATE TRIGGER IF NOT EXISTS trg_student_sessions_single_active
BEFORE INSERT ON student_sessions
FOR EACH ROW
BEGIN
  UPDATE student_sessions
  SET revoked_at = NEW.created_at
  WHERE portal_user_id_norm = NEW.portal_user_id_norm
    AND revoked_at IS NULL;
END;
