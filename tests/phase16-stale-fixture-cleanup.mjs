import assert from 'node:assert/strict';
import { d1Exec, assertExactBaseline } from './phase16-runtime.mjs';

const KNOWN_BATCHES = ['P16_M3_CURRENT', 'P16_M4_CURRENT'];

function count(sql) {
  const result = d1Exec(sql);
  const row = result[0]?.results?.[0] || {};
  return Number(Object.values(row)[0] || 0);
}

const p16Batches = count("SELECT COUNT(*) AS c FROM batch_definitions WHERE batch_key LIKE 'P16_%';");
const p16Assignments = count("SELECT COUNT(*) AS c FROM student_batch_assignments WHERE batch_key LIKE 'P16_%';");
const p16Releases = count("SELECT COUNT(*) AS c FROM batch_lesson_releases WHERE batch_key LIKE 'P16_%';");
const p16Entitlements = count("SELECT COUNT(*) AS c FROM lesson_entitlements WHERE source_batch_code LIKE 'P16_%';");

if (p16Batches === 0 && p16Assignments === 0 && p16Releases === 0 && p16Entitlements === 0) {
  assertExactBaseline('Phase 16 stale-fixture preflight');
  console.log('PHASE16_STALE_FIXTURE_CLEANUP_NOT_NEEDED');
  process.exit(0);
}

// Recovery is intentionally narrower than the normal Phase 16 cleanup. It is
// allowed only for the two disposable navigation fixtures created by
// insertNavigationFixtures(), assigned only to the controlled TestY5E persona.
// Any other P16_* residue is treated as an unexpected state and blocks the run.
assert.equal(p16Batches, 2, 'Unexpected number of stale Phase 16 batch fixtures.');
assert.equal(p16Assignments, 2, 'Unexpected number of stale Phase 16 assignment fixtures.');
assert.equal(p16Releases, 0, 'Stale Phase 16 release fixtures exist; refusing automatic cleanup.');
assert.equal(p16Entitlements, 0, 'Stale Phase 16 entitlement fixtures exist; refusing automatic cleanup.');

const exactBatches = count("SELECT COUNT(*) AS c FROM batch_definitions WHERE batch_key IN ('P16_M3_CURRENT','P16_M4_CURRENT');");
const otherP16Batches = count("SELECT COUNT(*) AS c FROM batch_definitions WHERE batch_key LIKE 'P16_%' AND batch_key NOT IN ('P16_M3_CURRENT','P16_M4_CURRENT');");
const exactAssignments = count("SELECT COUNT(*) AS c FROM student_batch_assignments WHERE portal_user_id_norm='testy5e' AND batch_key IN ('P16_M3_CURRENT','P16_M4_CURRENT');");
const otherP16Assignments = count("SELECT COUNT(*) AS c FROM student_batch_assignments WHERE batch_key LIKE 'P16_%' AND NOT (portal_user_id_norm='testy5e' AND batch_key IN ('P16_M3_CURRENT','P16_M4_CURRENT')); ");
assert.equal(exactBatches, KNOWN_BATCHES.length, 'Known Phase 16 batch fixture signature does not match.');
assert.equal(otherP16Batches, 0, 'Unknown Phase 16 batch fixture found; refusing automatic cleanup.');
assert.equal(exactAssignments, KNOWN_BATCHES.length, 'Known Phase 16 assignment fixture signature does not match.');
assert.equal(otherP16Assignments, 0, 'Unknown Phase 16 assignment fixture found; refusing automatic cleanup.');

const totals = d1Exec(
  'SELECT COUNT(*) AS entitlements FROM lesson_entitlements; ' +
  'SELECT COUNT(*) AS batches FROM batch_definitions; ' +
  'SELECT COUNT(*) AS assignments FROM student_batch_assignments; ' +
  'SELECT COUNT(*) AS releases FROM batch_lesson_releases;'
);
assert.equal(Number(totals[0]?.results?.[0]?.entitlements), 632, 'Entitlement total is not the locked Phase 15 baseline.');
assert.equal(Number(totals[1]?.results?.[0]?.batches), 6, 'Batch total is not baseline plus the two known Phase 16 fixtures.');
assert.equal(Number(totals[2]?.results?.[0]?.assignments), 6, 'Assignment total is not baseline plus the two known Phase 16 fixtures.');
assert.equal(Number(totals[3]?.results?.[0]?.releases), 0, 'Release total is not the locked Phase 15 baseline.');

d1Exec(`
  DELETE FROM student_batch_assignments
   WHERE portal_user_id_norm='testy5e'
     AND batch_key IN ('P16_M3_CURRENT','P16_M4_CURRENT');
  DELETE FROM batch_definitions
   WHERE batch_key IN ('P16_M3_CURRENT','P16_M4_CURRENT');
`);

assertExactBaseline('Phase 16 stale-fixture cleanup');
console.log('PHASE16_STALE_FIXTURE_CLEANUP_PASS exact_batches=2 exact_assignments=2');
