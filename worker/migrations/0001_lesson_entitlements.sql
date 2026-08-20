-- FPT Portal V2
-- Migration 0001: Excel-earned Student + Lesson entitlements
-- Phase 2 foundation

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

CREATE INDEX IF NOT EXISTS idx_lesson_entitlements_lesson_id
  ON lesson_entitlements (lesson_id);

-- Important V1 semantics:
-- 1. portal_user_id_norm is always the lowercase Portal User ID.
-- 2. A duplicate Student + Lesson Excel sync confirms the existing row;
--    it does NOT create a duplicate entitlement.
-- 3. vr_access is fixed by the student's VR Eligible state when the lesson
--    is FIRST earned through Excel. A later duplicate sync must not silently
--    upgrade an old core-only lesson to VR.
-- 4. Manual lesson access and Full Library access are intentionally stored
--    outside this table so independent access sources remain separate.
