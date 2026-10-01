import assert from 'node:assert/strict';
import {
  filterYear6TeachingRows,
  isYear6ElevenPlusOnlyLesson,
  isYear6TeachingListRequest
} from '../worker/src/index-step11-year6-catalogue-boundary.js';

const ordinary = { lessonId:'Y6M50', displayLessonId:'Y6T3M13', locked:false };
const sats = { lessonId:'Y6M51', displayLessonId:'Y6SM1', locked:true };
const meanMedianMode = { lessonId:'MATHS_L3_11P_T2M25_2026', displayLessonId:'MATHS_L3_11P_T2M25_2026', locked:false };
const advancedStatistics = { lessonId:'MATHS_L3_11P_T3M43_2026', displayLessonId:'MATHS_L3_11P_T3M43_2026', locked:false };

assert.equal(isYear6ElevenPlusOnlyLesson(meanMedianMode), true);
assert.equal(isYear6ElevenPlusOnlyLesson(advancedStatistics), true);
assert.equal(isYear6ElevenPlusOnlyLesson(ordinary), false);
assert.deepEqual(
  filterYear6TeachingRows([ordinary, sats, meanMedianMode, advancedStatistics]).map(row => row.lessonId),
  ['Y6M50']
);

assert.equal(
  isYear6TeachingListRequest(new Request('https://example.test/api/v1/student/views/maths-year6/lessons')),
  true
);
assert.equal(
  isYear6TeachingListRequest(new Request('https://example.test/api/v1/student/views/maths-year6-lessons/lessons')),
  true
);
assert.equal(
  isYear6TeachingListRequest(new Request('https://example.test/api/v1/student/views/maths-level3/lessons')),
  false
);
assert.equal(
  isYear6TeachingListRequest(new Request('https://example.test/api/v1/student/views/maths-sats/lessons')),
  false
);

console.log('YEAR6_CATALOGUE_BOUNDARY_VERIFICATION_PASS');
