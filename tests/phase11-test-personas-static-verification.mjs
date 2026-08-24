import assert from 'node:assert/strict';
import { loadPhase11Catalogue } from '../scripts/phase11-catalogue.mjs';
import {
  loadPhase11TestPersonas,
  validatePhase11TestPersonas,
  buildPhase11TestSeed
} from '../scripts/phase11-test-personas.mjs';

const catalogue = loadPhase11Catalogue();
const manifest = loadPhase11TestPersonas();
const result = validatePhase11TestPersonas(catalogue, manifest);
const seed = buildPhase11TestSeed(catalogue, manifest);

assert.equal(result.personas, 9);
assert.equal(result.entitlementRows, 447);
assert.equal(result.vrRows, 64);
assert.equal(seed.studentKvRows.length, 9);
assert.equal(seed.entitlements.length, 447);
assert.equal(new Set(seed.studentKvRows.map(row => row.key)).size, 9);
assert.equal(new Set(seed.entitlements.map(row => `${row.portalUserIdNorm}|${row.lessonId}`)).size, 447);
assert.ok(seed.studentKvRows.every(row => row.key.startsWith('user:testy')));
assert.ok(seed.studentKvRows.every(row => JSON.parse(row.value).p === 'Te12'));
assert.ok(seed.studentKvRows.every(row => JSON.parse(row.value).answerPassword === 'Te12'));
assert.ok(seed.d1Sql.includes("'testy411m'"));
assert.ok(seed.d1Sql.includes("'testy511e'"));
assert.ok(seed.d1Sql.includes("'testy511em'"));

const byId = new Map(manifest.personas.map(persona => [persona.portalUserIdNorm, persona]));
assert.deepEqual(byId.get('testy2e').coreCurricula, ['ENGLISH_Y2']);
assert.deepEqual(byId.get('testy2m').coreCurricula, ['MATHS_Y2']);
assert.deepEqual(byId.get('testy2em').coreCurricula, ['ENGLISH_Y2', 'MATHS_Y2']);
assert.deepEqual(byId.get('testy4em').coreCurricula, ['ENGLISH_Y4', 'MATHS_L1']);
assert.deepEqual(byId.get('testy411m').coreCurricula, ['MATHS_L2']);
assert.deepEqual(byId.get('testy511e').vrCurricula, ['ENGLISH_Y5']);
assert.deepEqual(byId.get('testy5em').coreCurricula, ['ENGLISH_Y5', 'MATHS_L2']);
assert.deepEqual(byId.get('testy5e').coreCurricula, ['ENGLISH_Y5']);
assert.deepEqual(byId.get('testy511em').coreCurricula, ['ENGLISH_Y5', 'MATHS_L3']);
assert.deepEqual(byId.get('testy511em').vrCurricula, ['ENGLISH_Y5']);

console.log('Phase 11 owner test-persona static verification: PASS');
console.log(JSON.stringify(result, null, 2));
