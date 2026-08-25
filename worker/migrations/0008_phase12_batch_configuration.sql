-- Phase 12: real batch configuration foundation.
-- This migration is intentionally data-free. It must not create lesson entitlements.
-- Batch keys are stored exactly as supplied by the owner / Excel Column C.
-- Assignment effective_from is inclusive; effective_to is exclusive.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS batch_definitions (
  batch_key TEXT PRIMARY KEY NOT NULL
    CHECK (length(trim(batch_key)) > 0 AND batch_key = trim(batch_key)),
  academic_year TEXT NOT NULL
    CHECK (academic_year GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  subject TEXT NOT NULL
    CHECK (subject IN ('maths', 'english')),
  school_year INTEGER NOT NULL
    CHECK (school_year BETWEEN 2 AND 6),
  stream TEXT NOT NULL
    CHECK (stream IN ('normal', '11plus')),
  maths_level INTEGER
    CHECK (maths_level IS NULL OR maths_level BETWEEN 1 AND 3),
  active_from TEXT
    CHECK (active_from IS NULL OR active_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  active_to TEXT
    CHECK (active_to IS NULL OR active_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (active_to IS NULL OR active_from IS NULL OR active_to > active_from),
  CHECK (
    (
      subject = 'maths'
      AND (
        (stream = 'normal' AND maths_level IS NULL)
        OR
        (stream = '11plus' AND school_year IN (4, 5) AND maths_level IS NOT NULL)
      )
    )
    OR
    (
      subject = 'english'
      AND maths_level IS NULL
      AND (
        stream = 'normal'
        OR (stream = '11plus' AND school_year IN (4, 5))
      )
    )
  )
);

CREATE TABLE IF NOT EXISTS student_batch_assignments (
  assignment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  portal_user_id_norm TEXT NOT NULL
    CHECK (
      length(trim(portal_user_id_norm)) > 0
      AND portal_user_id_norm = lower(trim(portal_user_id_norm))
    ),
  batch_key TEXT NOT NULL,
  effective_from TEXT NOT NULL
    CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  effective_to TEXT
    CHECK (effective_to IS NULL OR effective_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (batch_key) REFERENCES batch_definitions(batch_key)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE (portal_user_id_norm, batch_key, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_student_batch_assignments_user_dates
  ON student_batch_assignments (portal_user_id_norm, effective_from, effective_to);

CREATE INDEX IF NOT EXISTS idx_student_batch_assignments_batch_dates
  ON student_batch_assignments (batch_key, effective_from, effective_to);

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_batch_assignments_open_unique
  ON student_batch_assignments (portal_user_id_norm, batch_key)
  WHERE effective_to IS NULL;

-- Operational Batch + Lesson mapping. This records when a lesson became a batch release.
-- It does not itself grant Student + Lesson entitlement.
CREATE TABLE IF NOT EXISTS batch_lesson_releases (
  batch_key TEXT NOT NULL,
  lesson_id TEXT NOT NULL
    CHECK (length(trim(lesson_id)) > 0 AND lesson_id = trim(lesson_id)),
  lesson_date TEXT
    CHECK (lesson_date IS NULL OR lesson_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source_row_id TEXT,
  first_completed_at TEXT NOT NULL,
  last_confirmed_at TEXT NOT NULL,
  FOREIGN KEY (batch_key) REFERENCES batch_definitions(batch_key)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  PRIMARY KEY (batch_key, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_batch_lesson_releases_lesson
  ON batch_lesson_releases (lesson_id, batch_key);
