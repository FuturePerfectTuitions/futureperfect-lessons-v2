const YEAR5_MATHS_VIEW = 'maths-year5';
const TARGET_LESSON_ID = 'Y5M1';
const TARGET_ANSWER_INDEX = 1;

const SHARED_LEVEL2_R2_KEY =
  'maths/level2/Y5M1/homework/answers/L2T1M01 Answer Pack Homework Number and Place Value I.pdf';

const YEAR5_R2_KEY =
  'phase11/view-overrides/maths-year5/Y5M1/homework/answers/Y5T1M01 Answer Pack Homework Number and Place Value I.pdf';

function answerR2KeyForView({ viewId, lessonId, answerIndex, defaultR2Key }) {
  const fallback = String(defaultR2Key || '').trim();
  if (
    String(viewId || '').trim() === YEAR5_MATHS_VIEW &&
    String(lessonId || '').trim() === TARGET_LESSON_ID &&
    Number(answerIndex) === TARGET_ANSWER_INDEX &&
    fallback === SHARED_LEVEL2_R2_KEY
  ) {
    return YEAR5_R2_KEY;
  }
  return fallback;
}

export {
  YEAR5_MATHS_VIEW,
  TARGET_LESSON_ID,
  TARGET_ANSWER_INDEX,
  SHARED_LEVEL2_R2_KEY,
  YEAR5_R2_KEY,
  answerR2KeyForView
};
