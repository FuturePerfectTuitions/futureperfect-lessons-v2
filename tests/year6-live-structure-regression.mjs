import assert from 'node:assert/strict';
import {
  YEAR6_TERM1_LESSON_IDS,
  YEAR6_TERM2_LESSON_IDS,
  YEAR6_TERM3_LESSON_IDS,
  YEAR6_STANDARD_LESSON_IDS,
  YEAR6_DISPLAY_ID_MIGRATIONS,
  expectedYear6DisplayId,
  expectedYear6StandardDisplaySequence
} from '../ops/year6-display-id-policy.mjs';

const expected = [
  ...Array.from({ length: 21 }, (_, i) => `Y6T1M${i + 1}`),
  ...Array.from({ length: 14 }, (_, i) => `Y6T2M${i + 1}`),
  ...Array.from({ length: 13 }, (_, i) => `Y6T3M${i + 1}`)
];

assert.equal(YEAR6_TERM1_LESSON_IDS.length, 21);
assert.equal(YEAR6_TERM2_LESSON_IDS.length, 14);
assert.equal(YEAR6_TERM3_LESSON_IDS.length, 13);
assert.equal(YEAR6_STANDARD_LESSON_IDS.length, 48, 'Actual live Year 6 standard catalogue must contain 48 displayed lessons.');
assert.equal(new Set(YEAR6_STANDARD_LESSON_IDS).size, 48, 'Actual live canonical lesson IDs must be unique.');
assert.deepEqual(expectedYear6StandardDisplaySequence(), expected, 'Year 6 display IDs must restart at M1 for every term.');
assert.equal(new Set(expected).size, expected.length, 'Year 6 standard display IDs must be unique.');

const boundary = expected.indexOf('Y6T1M21');
assert.equal(expected[boundary + 1], 'Y6T2M1', 'Required boundary is Y6T1M21 -> Y6T2M1.');
assert.equal(expected[35], 'Y6T3M1', 'Term 3 must restart at Y6T3M1 after Y6T2M14.');

assert.equal(expectedYear6DisplayId('Y6M50'), 'Y6T1M21');
assert.equal(expectedYear6DisplayId('Y6M17'), 'Y6T2M1');
assert.equal(expectedYear6DisplayId('Y6M38'), 'Y6T2M14');
assert.equal(expectedYear6DisplayId('Y6M3'), 'Y6T3M1');
assert.equal(expectedYear6DisplayId('Y6M45'), 'Y6T3M13');

assert.equal(YEAR6_DISPLAY_ID_MIGRATIONS.length, 27, 'Only the 14 Term 2 + 13 Term 3 display IDs may be migrated.');
assert.deepEqual(YEAR6_DISPLAY_ID_MIGRATIONS[0], { id:'Y6M17', from:'Y6T2M22', to:'Y6T2M1' });
assert.deepEqual(YEAR6_DISPLAY_ID_MIGRATIONS.at(-1), { id:'Y6M45', from:'Y6T3M48', to:'Y6T3M13' });

for (const satsId of Array.from({length:19},(_,i)=>`Y6M${i+51}`)) {
  assert.equal(expectedYear6DisplayId(satsId), null, `SATS lesson ${satsId} must remain outside this migration policy.`);
}
for (const noYear6Display of ['MATHS_L3_11P_T2M25_2026','MATHS_L3_11P_T3M43_2026']) {
  assert.equal(expectedYear6DisplayId(noYear6Display), null, `${noYear6Display} must retain its current absence of a Year 6 display ID.`);
}

console.log('Year 6 real live-structure regression: PASS');
console.log(`Boundary: ${expected[boundary]} -> ${expected[boundary + 1]}`);
console.log(`Standard lessons: ${expected.length}; migration records: ${YEAR6_DISPLAY_ID_MIGRATIONS.length}; SATS excluded: 19`);
