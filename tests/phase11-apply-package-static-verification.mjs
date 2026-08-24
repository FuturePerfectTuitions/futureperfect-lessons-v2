import assert from 'node:assert/strict';
import { buildPhase11ApplyPackage } from '../scripts/phase11-apply-package.mjs';

const pkg = buildPhase11ApplyPackage();
assert.equal(pkg.summary.phase, 11);
assert.equal(pkg.summary.catalogueLessons, 369);
assert.equal(pkg.summary.catalogueCurricula, 11);
assert.equal(pkg.summary.lessonsKvWrites, 380);
assert.equal(pkg.summary.r2References, 1669);
assert.equal(pkg.summary.testPersonas, 9);
assert.equal(pkg.summary.testPersonaEntitlementRows, 447);
assert.equal(pkg.summary.testPersonaVrRows, 64);
assert.equal(pkg.summary.historyRegressionRows, 5);
assert.equal(pkg.summary.developmentAllowlistCount, 16);
assert.equal(pkg.catalogueKvRows.length, 380);
assert.equal(pkg.testStudentKvRows.length, 9);
assert.equal(new Set(pkg.catalogueKvRows.map(row => row.key)).size, 380);
assert.equal(new Set(pkg.testStudentKvRows.map(row => row.key)).size, 9);
assert.ok(pkg.allowlist.includes('test0707'));
for (const id of ['testy2e','testy2m','testy2em','testy4em','testy411m','testy511e','testy5em','testy5e','testy511em']) {
  assert.ok(pkg.allowlist.includes(id), `development allowlist missing ${id}`);
}
for (const lessonId of ['Y3M1','Y4M2','Y5M1','Y4E1','Y5E2']) {
  assert.ok(pkg.historyEntitlementsSql.includes(`'${lessonId}'`), `history SQL missing ${lessonId}`);
}
console.log('Phase 11 apply-package static verification: PASS');
console.log(JSON.stringify(pkg.summary, null, 2));
