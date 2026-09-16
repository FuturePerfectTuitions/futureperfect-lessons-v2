import assert from 'node:assert/strict';
import { compileCatalogueReadModel } from '../rebuild/shared/read-models/catalogue.mjs';

const input = {
  sourceType: 'catalogue-order-regression-fixture',
  sourceRevision: 'v2',
  curricula: {
    MATHS_L3: { lessonIds: ['L3A', 'L3B', 'L3C', 'L3D'] },
    MATHS_Y6_EXTRA: { lessonIds: ['Y6X17', 'Y6X18', 'Y6S1'] },
    ENGLISH_Y4: { lessonIds: ['E4_11', 'E4_12', 'E4_13', 'E4_14'] }
  },
  lessons: {
    L3A: {
      lessonId: 'L3A', title: 'Number and Place Value I', order: 1, active: true,
      displayIds: { 'maths-year6': 'Y6T1M01', 'maths-level3': 'L3T1M01' }
    },
    L3B: {
      lessonId: 'L3B', title: 'Number and Place Value II', order: 2, active: true,
      displayIds: { 'maths-year6': 'Y6T1M02', 'maths-level3': 'L3T1M02' }
    },
    L3C: {
      lessonId: 'L3C', title: 'Number and Place Value III', order: 3, active: true,
      displayIds: { 'maths-year6': 'Y6T1M03', 'maths-level3': 'L3T1M03' }
    },
    L3D: {
      lessonId: 'L3D', title: 'Late main curriculum lesson', order: 43, active: true,
      displayIds: { 'maths-year6': 'Y6T3M43', 'maths-level3': 'L3T3M43' }
    },
    Y6X17: {
      lessonId: 'Y6X17', title: 'Ratio and Proportion 1', order: 1, active: true,
      displayIds: { 'maths-year6': 'Y6T1M17' }
    },
    Y6X18: {
      lessonId: 'Y6X18', title: 'Ratio and Proportion 2', order: 2, active: true,
      displayIds: { 'maths-year6': 'Y6T1M18' }
    },
    Y6S1: {
      lessonId: 'Y6S1', title: 'SATs Preparation Measurement', order: 6, active: true,
      displayIds: { 'maths-year6': 'Y6MS1' }
    },
    E4_11: {
      lessonId: 'E4_11', title: 'Term Starter', order: 12, active: true,
      displayIds: { 'english-year4': 'Y4T2E11', 'english-year4-11plus': 'Y4T2EE11' }
    },
    E4_12: {
      lessonId: 'E4_12', title: 'Lesson 12', order: 13, active: true,
      displayIds: { 'english-year4': 'Y4T2E12', 'english-year4-11plus': 'Y4T2EE12' }
    },
    E4_13: {
      lessonId: 'E4_13', title: 'Lesson 13', order: 14, active: true,
      displayIds: { 'english-year4': 'Y4T2E13', 'english-year4-11plus': 'Y4T2EE13' }
    },
    E4_14: {
      lessonId: 'E4_14', title: 'Verb Inflections', order: 11, active: true,
      displayIds: { 'english-year4': 'Y4T2E14', 'english-year4-11plus': 'Y4T2EE14' }
    }
  }
};

const catalogue = compileCatalogueReadModel(input);

assert.deepEqual(
  catalogue.views['maths-year6'].lessons.map(row => row.displayLessonId),
  ['Y6T1M01', 'Y6T1M02', 'Y6T1M03', 'Y6T1M17', 'Y6T1M18', 'Y6T3M43', 'Y6MS1'],
  'Year 6 Maths must merge ordinary lessons from multiple curricula by displayed term/lesson chronology and keep special IDs after the ordinary chronology.'
);
assert.deepEqual(
  catalogue.views['maths-year6'].lessons.map(row => row.order),
  [1, 2, 3, 4, 5, 6, 7],
  'Published order must be normalized to the final merged chronology.'
);
assert.deepEqual(
  catalogue.views['maths-level3'].lessons.map(row => row.displayLessonId),
  ['L3T1M01', 'L3T1M02', 'L3T1M03', 'L3T3M43'],
  'Level 3 must retain its single authoritative MATHS_L3 source sequence without Year 6 extras.'
);
assert.deepEqual(
  catalogue.views['english-year4'].lessons.map(row => row.displayLessonId),
  ['Y4T2E11', 'Y4T2E12', 'Y4T2E13', 'Y4T2E14'],
  'Year 4 English must follow ENGLISH_Y4 curriculum sequence even when lesson record orders are stale.'
);
assert.deepEqual(
  catalogue.views['english-year4-11plus'].lessons.map(row => row.displayLessonId),
  ['Y4T2EE11', 'Y4T2EE12', 'Y4T2EE13', 'Y4T2EE14'],
  'Year 4 11+ English must use the same authoritative ENGLISH_Y4 curriculum sequence.'
);
for (const viewId of ['maths-year6', 'maths-level3', 'english-year4', 'english-year4-11plus']) {
  assert.deepEqual(
    catalogue.views[viewId].lessons.map(row => row.order),
    catalogue.views[viewId].lessons.map((_, index) => index + 1),
    `${viewId} order metadata must be contiguous and sequence-aligned.`
  );
}

console.log(JSON.stringify({
  marker: 'CATALOGUE_CURRICULUM_ORDER_VERIFICATION_PASS',
  mathsYear6: catalogue.views['maths-year6'].lessons.map(row => row.displayLessonId),
  englishYear4: catalogue.views['english-year4'].lessons.map(row => row.displayLessonId)
}));
