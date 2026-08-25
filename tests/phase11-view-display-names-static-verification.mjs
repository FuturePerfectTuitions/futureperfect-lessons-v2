import assert from 'node:assert/strict';
import {
  YEAR4_MATHS_VIEW,
  YEAR5_MATHS_VIEW,
  YEAR6_MATHS_VIEW,
  displayLessonIdForLesson,
  pairedLevelDisplayIdForLesson,
  rewriteLegacyLevel2Code,
  rewriteLegacyLevelCode,
  normaliseLessonDisplayNamesForView,
  normaliseDisplayNameForView,
  isNormalMathsYearView
} from '../worker/src/phase11-view-display-names.js';

assert.equal(displayLessonIdForLesson('Y4M1', YEAR4_MATHS_VIEW), 'Y4T3M23');
assert.equal(pairedLevelDisplayIdForLesson('Y4M1', YEAR4_MATHS_VIEW), 'L1T3M23');
assert.equal(displayLessonIdForLesson('Y5M1', YEAR5_MATHS_VIEW), 'Y5T1M01');
assert.equal(displayLessonIdForLesson('Y5M10', YEAR5_MATHS_VIEW), 'Y5T2M14');
assert.equal(pairedLevelDisplayIdForLesson('Y5M1', YEAR5_MATHS_VIEW), 'L2T1M01');
assert.equal(displayLessonIdForLesson('Y6M1', YEAR6_MATHS_VIEW), 'Y6T2M26');
assert.equal(pairedLevelDisplayIdForLesson('Y6M1', YEAR6_MATHS_VIEW), 'L3T2M21');

assert.equal(
  rewriteLegacyLevelCode('L1T3M23 Homework Money.pdf', 'Y4T3M23', YEAR4_MATHS_VIEW),
  'Y4T3M23 Homework Money.pdf'
);
assert.equal(
  rewriteLegacyLevel2Code('L2T1M01 Homework Number and Place Value I.pdf', 'Y5T1M01'),
  'Y5T1M01 Homework Number and Place Value I.pdf'
);
assert.equal(
  rewriteLegacyLevelCode('L3T2M21 Answer Pack Homework Algebra Warm Up.pdf', 'Y6T2M26', YEAR6_MATHS_VIEW),
  'Y6T2M26 Answer Pack Homework Algebra Warm Up.pdf'
);
assert.equal(
  rewriteLegacyLevelCode('11+ Homework L2T2M02 Fractions 2.pdf', 'Y5T2M14', YEAR5_MATHS_VIEW),
  '11+ Homework Y5T2M14 Fractions 2.pdf'
);

for (const [viewId, yearCode, legacyCode] of [
  [YEAR4_MATHS_VIEW, 'Y4T3M23', 'L1T3M23'],
  [YEAR5_MATHS_VIEW, 'Y5T1M01', 'L2T1M01'],
  [YEAR6_MATHS_VIEW, 'Y6T2M26', 'L3T2M21']
]) {
  const lesson = {
    displayName: `${legacyCode} top`,
    homeworks: [{
      homework: { displayName: `${legacyCode} Homework.pdf`, resourceKey: 'lesson~homework~1' },
      answerPack: { displayName: `${legacyCode} Answer Pack.pdf`, resourceKey: 'lesson~answer~1' }
    }],
    preLessonSheets: [{ displayName: `${legacyCode} PreLesson.pdf`, resourceKey: 'lesson~prelesson~1' }]
  };
  normaliseLessonDisplayNamesForView(lesson, yearCode, viewId);
  assert.equal(lesson.homeworks[0].homework.displayName, `${yearCode} Homework.pdf`);
  assert.equal(lesson.homeworks[0].answerPack.displayName, `${yearCode} Answer Pack.pdf`);
  assert.equal(lesson.preLessonSheets[0].displayName, `${yearCode} PreLesson.pdf`);
  assert.equal(lesson.homeworks[0].homework.resourceKey, 'lesson~homework~1');
}

for (const levelView of ['maths-level1','maths-level2','maths-level3']) {
  const levelLesson = { displayName: 'L1T1M01 Homework.pdf' };
  normaliseLessonDisplayNamesForView(levelLesson, 'L1T1M01', levelView);
  assert.equal(levelLesson.displayName, 'L1T1M01 Homework.pdf');
  assert.equal(isNormalMathsYearView(levelView), false);
}

assert.equal(
  normaliseDisplayNameForView('attachment; filename="L3T2M21 Homework.pdf"', 'Y6T2M26', YEAR6_MATHS_VIEW),
  'attachment; filename="Y6T2M26 Homework.pdf"'
);
assert.equal(isNormalMathsYearView(YEAR4_MATHS_VIEW), true);
assert.equal(isNormalMathsYearView(YEAR5_MATHS_VIEW), true);
assert.equal(isNormalMathsYearView(YEAR6_MATHS_VIEW), true);

console.log('Phase 11 view-specific resource display-name verification: PASS');
