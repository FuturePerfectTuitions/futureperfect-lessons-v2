CREATE TABLE IF NOT EXISTS curriculum_start_points (
  portal_user_id_norm TEXT NOT NULL,
  curriculum_code TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  lesson_order INTEGER NOT NULL,
  established_at TEXT NOT NULL,
  PRIMARY KEY (portal_user_id_norm, curriculum_code)
);

CREATE INDEX IF NOT EXISTS idx_curriculum_start_points_user
  ON curriculum_start_points (portal_user_id_norm);
