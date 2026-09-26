import assert from 'node:assert/strict';
import { liveCatalogueForView } from '../worker/src/live-student-catalogue-overlay.js';

const records = new Map([
  ['curriculum:MATHS_L3', {
    curriculumCode:'MATHS_L3',
    lessonIds:['Y6M21','Y6M40','Y6M20','Y6M22','Y6M23','Y6M41']
  }],
  ['curriculum:MATHS_Y6_EXTRA', {
    curriculumCode:'MATHS_Y6_EXTRA',
    lessonIds:['Y6M60','Y6M51','Y6M52','Y6M42']
  }]
]);

const displays = {
  Y6M20:'Y6T1M20',
  Y6M21:'Y6T1M21',
  Y6M22:'Y6T2M1',
  Y6M23:'Y6T2M2',
  Y6M40:'Y6T2M17',
  Y6M41:'Y6T3M1',
  Y6M42:'Y6T3M2',
  Y6M51:'Y6MS1',
  Y6M52:'Y6MS2',
  Y6M60:'Y6MS10'
};

for (const [lessonId, shownId] of Object.entries(displays)) {
  records.set(`lesson:${lessonId}`, {
    lessonId,
    title:`${shownId} Test lesson`,
    subject:'maths',
    active:true,
    displayIds:{ 'maths-year6':shownId }
  });
}

const env = {
  LESSONS_KV:{
    async get(key, options) {
      const value = records.get(String(key)) ?? null;
      if (options?.type === 'json') return value == null ? null : structuredClone(value);
      return value == null ? null : JSON.stringify(value);
    }
  }
};

const rows = await liveCatalogueForView(env, 'maths-year6');
assert.deepEqual(
  rows.map(row => row.displayLessonId),
  [
    'Y6T1M20',
    'Y6T1M21',
    'Y6T2M1',
    'Y6T2M2',
    'Y6T2M17',
    'Y6T3M1',
    'Y6T3M2',
    'Y6MS1',
    'Y6MS2',
    'Y6MS10'
  ],
  'Year 6 must be ordered numerically by student-facing display code, with SAT lessons after the normal term sequence.'
);

assert.equal(rows[0].title, 'Test lesson', 'Display-code prefixes should still be stripped from student titles.');
console.log('Year 6 sequential catalogue order verification: PASS');
