import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const migrationPath = 'worker/migrations/0008_phase12_batch_configuration.sql';
const sql = fs.readFileSync(migrationPath, 'utf8');

const required = [
  'CREATE TABLE IF NOT EXISTS batch_definitions',
  'CREATE TABLE IF NOT EXISTS student_batch_assignments',
  'CREATE TABLE IF NOT EXISTS batch_lesson_releases',
  'PRIMARY KEY (batch_key, lesson_id)',
  'WHERE effective_to IS NULL',
  "subject IN ('maths', 'english')",
  "stream IN ('normal', '11plus')",
  'ON UPDATE RESTRICT ON DELETE RESTRICT'
];

for (const marker of required) {
  if (!sql.includes(marker)) throw new Error(`Missing required Phase 12 batch schema marker: ${marker}`);
}

if (/INSERT\s+INTO\s+lesson_entitlements/i.test(sql)) {
  throw new Error('Phase 12 batch migration must not grant lesson entitlements.');
}
if (/DELETE\s+FROM\s+lesson_entitlements/i.test(sql) || /UPDATE\s+lesson_entitlements/i.test(sql)) {
  throw new Error('Phase 12 batch migration must not mutate lesson entitlements.');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fpt-phase12-batch-'));
const db = path.join(tmp, 'schema.sqlite');
try {
  execFileSync('sqlite3', [db], { input: sql, stdio: ['pipe', 'pipe', 'pipe'] });

  const now = '2026-08-25T22:00:00Z';
  const statements = `
PRAGMA foreign_keys=ON;
INSERT INTO batch_definitions(batch_key,academic_year,subject,school_year,stream,maths_level,active_from,active_to,created_at,updated_at)
VALUES('EXACT MATHS BATCH','2026-27','maths',5,'11plus',3,'2026-09-01',NULL,'${now}','${now}');
INSERT INTO batch_definitions(batch_key,academic_year,subject,school_year,stream,maths_level,active_from,active_to,created_at,updated_at)
VALUES('EXACT ENGLISH BATCH','2026-27','english',5,'11plus',NULL,'2026-09-01',NULL,'${now}','${now}');
INSERT INTO student_batch_assignments(portal_user_id_norm,batch_key,effective_from,effective_to,created_at,updated_at)
VALUES('studentone','EXACT MATHS BATCH','2026-09-01',NULL,'${now}','${now}');
INSERT INTO student_batch_assignments(portal_user_id_norm,batch_key,effective_from,effective_to,created_at,updated_at)
VALUES('studentone','EXACT ENGLISH BATCH','2026-09-01',NULL,'${now}','${now}');
INSERT INTO batch_lesson_releases(batch_key,lesson_id,lesson_date,source_row_id,first_completed_at,last_confirmed_at)
VALUES('EXACT MATHS BATCH','Y5M01','2026-09-10','row-1','${now}','${now}');
SELECT COUNT(*) FROM batch_definitions;
SELECT COUNT(*) FROM student_batch_assignments;
SELECT COUNT(*) FROM batch_lesson_releases;
`;
  const output = execFileSync('sqlite3', [db], { input: statements, encoding: 'utf8' }).trim().split(/\r?\n/);
  if (output.at(-3) !== '2' || output.at(-2) !== '2' || output.at(-1) !== '1') {
    throw new Error(`Unexpected Phase 12 schema smoke-test counts: ${output.slice(-3).join(',')}`);
  }

  let duplicateOpenRejected = false;
  try {
    execFileSync('sqlite3', [db], {
      input: `PRAGMA foreign_keys=ON; INSERT INTO student_batch_assignments(portal_user_id_norm,batch_key,effective_from,effective_to,created_at,updated_at) VALUES('studentone','EXACT MATHS BATCH','2026-10-01',NULL,'${now}','${now}');`,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch {
    duplicateOpenRejected = true;
  }
  if (!duplicateOpenRejected) throw new Error('Open duplicate assignment must be rejected.');

  let badCaseRejected = false;
  try {
    execFileSync('sqlite3', [db], {
      input: `PRAGMA foreign_keys=ON; INSERT INTO student_batch_assignments(portal_user_id_norm,batch_key,effective_from,effective_to,created_at,updated_at) VALUES('StudentTwo','EXACT MATHS BATCH','2026-09-01','2026-10-01','${now}','${now}');`,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch {
    badCaseRejected = true;
  }
  if (!badCaseRejected) throw new Error('Portal user ID normalization constraint must be enforced.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('Phase 12 batch schema static verification passed.');
