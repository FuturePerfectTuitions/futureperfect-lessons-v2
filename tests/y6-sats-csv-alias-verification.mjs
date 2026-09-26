import assert from 'node:assert/strict';
import { normaliseY6SatsPortalAlias } from '../worker/src/admin-y6-sats-csv-alias.js';

// Production regression: FuturePerfectLive emits Y6SM1..Y6SM19.
const row = {
  Student:'Devansh2806',
  Lesson:'Y6SM1 SATs Preparation Measurement',
  LessonStatus:'Completed'
};
const converted = normaliseY6SatsPortalAlias(row);
assert.equal(converted.Lesson, 'Y6MS1 SATs Preparation Measurement');
assert.equal(row.Lesson, 'Y6SM1 SATs Preparation Measurement', 'parent-facing CSV row must remain unchanged');

for (let n = 1; n <= 19; n += 1) {
  const result = normaliseY6SatsPortalAlias({ Lesson:`Y6SM${n} SATs lesson ${n}` });
  assert.equal(result.Lesson, `Y6MS${n} SATs lesson ${n}`);
}

assert.equal(normaliseY6SatsPortalAlias({ Lesson:'Y6T1M01 Ordinary lesson' }).Lesson, 'Y6T1M01 Ordinary lesson');
assert.equal(normaliseY6SatsPortalAlias({ Lesson:'Y5T1M01 Ordinary lesson' }).Lesson, 'Y5T1M01 Ordinary lesson');

console.log('Y6_SATS_CSV_ALIAS_VERIFICATION_PASS');
