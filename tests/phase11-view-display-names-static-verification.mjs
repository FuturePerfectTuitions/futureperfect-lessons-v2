import assert from 'node:assert/strict';
import {
  YEAR5_MATHS_VIEW,
  displayLessonIdForLesson,
  rewriteLegacyLevel2Code,
  normaliseLessonDisplayNamesForView,
  normaliseDisplayNameForView
} from '../worker/src/phase11-view-display-names.js';

assert.equal(displayLessonIdForLesson('Y5M1', YEAR5_MATHS_VIEW), 'Y5T1M01');
assert.equal(displayLessonIdForLesson('Y5M10', YEAR5_MATHS_VIEW), 'Y5T2M14');
assert.equal(
  rewriteLegacyLevel2Code('L2T1M01 Homework Number and Place Value I.pdf', 'Y5T1M01'),
  'Y5T1M01 Homework Number and Place Value I.pdf'
);
assert.equal(
  rewriteLegacyLevel2Code('11+ Homework L2T2M02 Fractions 2.pdf', 'Y5T2M14'),
  '11+ Homework Y5T2M14 Fractions 2.pdf'
);

const year5Lesson = {
  displayName: 'L2T1M01 top',
  homeworks: [{
    homework: { displayName: 'L2T1M01 Homework.pdf', resourceKey: 'Y5M1~homework~1' },
    answerPack: { displayName: 'L2T1M01 Answer Pack.pdf', resourceKey: 'Y5M1~answer~1' }
  }],
  preLessonSheets: [{ displayName: 'L2T1M01 PreLesson.pdf', resourceKey: 'Y5M1~prelesson~1' }]
};
normaliseLessonDisplayNamesForView(year5Lesson, 'Y5T1M01', YEAR5_MATHS_VIEW);
assert.equal(year5Lesson.homeworks[0].homework.displayName, 'Y5T1M01 Homework.pdf');
assert.equal(year5Lesson.homeworks[0].answerPack.displayName, 'Y5T1M01 Answer Pack.pdf');
assert.equal(year5Lesson.preLessonSheets[0].displayName, 'Y5T1M01 PreLesson.pdf');
assert.equal(year5Lesson.homeworks[0].homework.resourceKey, 'Y5M1~homework~1');

const level2Lesson = { displayName: 'L2T1M01 Homework.pdf' };
normaliseLessonDisplayNamesForView(level2Lesson, 'L2T1M01', 'maths-level2');
assert.equal(level2Lesson.displayName, 'L2T1M01 Homework.pdf');

assert.equal(
  normaliseDisplayNameForView('attachment; filename="L2T1M01 Homework.pdf"', 'Y5T1M01', YEAR5_MATHS_VIEW),
  'attachment; filename="Y5T1M01 Homework.pdf"'
);

console.log('Phase 11 view-specific resource display-name verification: PASS');
