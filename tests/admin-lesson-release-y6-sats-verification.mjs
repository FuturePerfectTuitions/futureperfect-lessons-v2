import assert from 'node:assert/strict';
import {
  extractLessonId,
  normaliseCsvRow
} from '../worker/src/admin-lesson-release-import.js';

for (let sats = 1; sats <= 19; sats += 1) {
  assert.equal(
    extractLessonId(`Y6MS${sats} SATs lesson`),
    `Y6M${50 + sats}`,
    `Y6MS${sats} must resolve to canonical Y6M${50 + sats}`
  );
}

assert.equal(
  extractLessonId('Y6MS20 Out of configured SATs range'),
  'Y6MS20',
  'Only the confirmed Y6MS1-Y6MS19 series may be canonicalised'
);

const baseRow = {
  Name: 'Synthetic Year 6',
  Subject: 'Maths',
  Lesson: 'Y6MS19 End of SATs Games',
  LessonDated: '11th May 2027',
  Mode: 'Y6O_SYNTHETIC',
  Student: 'Synthetic0606'
};

assert.equal(
  normaliseCsvRow({ ...baseRow, LessonStatus: 'Ready' }, 0).releaseType,
  'PRELESSON_ONLY',
  'Online SATs Ready rows retain normal PreLesson-only semantics'
);
assert.equal(
  normaliseCsvRow({ ...baseRow, LessonStatus: 'Completed' }, 1).releaseType,
  'FULL',
  'Completed SATs rows release the full lesson'
);
assert.equal(
  normaliseCsvRow({ ...baseRow, LessonStatus: 'Continuing' }, 2).releaseType,
  'FULL',
  'Continuing SATs rows release the full lesson'
);
assert.equal(
  normaliseCsvRow({ ...baseRow, LessonStatus: 'Ready', Mode: 'Y6FM_SYNTHETIC' }, 3).releaseType,
  'SKIP',
  'Face-to-face SATs Ready rows retain normal no-release semantics'
);

console.log('Y6MS1-Y6MS19 canonical mapping and normal SATs CSV release semantics: PASS');
