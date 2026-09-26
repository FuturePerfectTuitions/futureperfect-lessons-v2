import assert from 'node:assert/strict';
import {
  YEAR6_STANDARD_LESSON_IDS,
  expectedYear6DisplayId,
  expectedYear6StandardDisplaySequence
} from '../ops/year6-display-id-policy.mjs';

const expected = [
  ...Array.from({ length: 21 }, (_, i) => `Y6T1M${i + 1}`),
  ...Array.from({ length: 14 }, (_, i) => `Y6T2M${i + 1}`),
  ...Array.from({ length: 13 }, (_, i) => `Y6T3M${i + 1}`)
];

assert.equal(YEAR6_STANDARD_LESSON_IDS.length, 48, 'Real Year 6 standard catalogue must contain 48 lessons.');
assert.deepEqual(expectedYear6StandardDisplaySequence(), expected, 'Canonical Year 6 display IDs must restart at M1 for each term.');
assert.equal(new Set(expected).size, expected.length, 'Year 6 standard display IDs must be unique.');

const boundary = expected.indexOf('Y6T1M21');
assert.notEqual(boundary, -1, 'Y6T1M21 must exist.');
assert.equal(expected[boundary + 1], 'Y6T2M1', 'Required Year 6 boundary is Y6T1M21 -> Y6T2M1.');
assert.equal(expected[35], 'Y6T3M1', 'Term 3 must restart at Y6T3M1 after Y6T2M14.');

assert.equal(expectedYear6DisplayId('M3.L21'), 'Y6T1M21');
assert.equal(expectedYear6DisplayId('M3.L22'), 'Y6T2M1');
assert.equal(expectedYear6DisplayId('M3.L35'), 'Y6T2M14');
assert.equal(expectedYear6DisplayId('Y6.EXTRA.L1'), 'Y6T3M1');
assert.equal(expectedYear6DisplayId('Y6.EXTRA.L13'), 'Y6T3M13');

for (const satsId of ['Y6.SATS.L1', 'Y6.SATS.L10', 'Y6.SATS.P1']) {
  assert.equal(expectedYear6DisplayId(satsId), null, `SATS lesson ${satsId} must be outside this migration policy.`);
}
assert.equal(expectedYear6DisplayId('M2.L22'), null, 'Other 11+ levels must remain outside this Year 6 policy.');

console.log('Year 6 real-structure regression: PASS');
console.log(`Boundary: ${expected[boundary]} -> ${expected[boundary + 1]}`);
console.log(`Standard lessons: ${expected.length}`);
