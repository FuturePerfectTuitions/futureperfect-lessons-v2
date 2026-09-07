import assert from 'node:assert/strict';
import { expandYear4ElevenPlusMathsBaselineRows } from '../worker/src/index-phase20-change14.js';

const env = {
  LESSONS_KV: {
    async get(key) {
      if (key === 'curriculum:MATHS_L1') {
        return { lessonIds:['Y4M1','Y4M2','Y4M3'] };
      }
      return null;
    }
  }
};

const rows = [
  {
    Name:'Student A', Year:'Year 4 11+', Subject:'Maths',
    Lesson:'L2T1M01 Number and Place Value I', LessonDated:'7th September 2026',
    LessonStatus:'completed', Mode:'Y411FM', Student:'StuA'
  },
  {
    Name:'Student B', Year:'Year 4 11+', Subject:'Maths',
    Lesson:'L2T1M01 Number and Place Value I', LessonDated:'7th September 2026',
    LessonStatus:'Ready', Mode:'Y411OM', Student:'StuB'
  },
  {
    Name:'Student A', Year:'Year 4 11+', Subject:'Maths',
    Lesson:'L2T1M02 Addition', LessonDated:'14th September 2026',
    LessonStatus:'Ready', Mode:'Y411FM', Student:'StuA'
  },
  {
    Name:'Normal Student', Year:'Year 4', Subject:'Maths',
    Lesson:'Y4T1M01 Number and Place Value I', LessonDated:'7th September 2026',
    LessonStatus:'completed', Mode:'Y4FM', Student:'Normal'
  }
];

const expanded = await expandYear4ElevenPlusMathsBaselineRows(rows, env);
assert.equal(expanded.length, rows.length + 6, 'Each unique Y411 Maths student should receive one full L1 baseline expansion');

const extras = expanded.slice(rows.length);
assert.deepEqual([...new Set(extras.map(row => row.Student))].sort(), ['StuA','StuB']);
assert.equal(extras.every(row => row.Subject === 'Maths'), true);
assert.equal(extras.every(row => row.LessonStatus === 'completed'), true, 'Baseline rows must grant full access');
assert.deepEqual(
  extras.filter(row => row.Student === 'StuA').map(row => row.Lesson.split(' ')[0]),
  ['Y4M1','Y4M2','Y4M3']
);
assert.deepEqual(
  extras.filter(row => row.Student === 'StuB').map(row => row.Lesson.split(' ')[0]),
  ['Y4M1','Y4M2','Y4M3']
);
assert.equal(extras.some(row => row.Student === 'Normal'), false, 'Normal Year 4 Maths must not receive 11+ baseline access');

const untouched = await expandYear4ElevenPlusMathsBaselineRows([
  { Subject:'Maths', Mode:'Y5FM', Student:'X', Lesson:'Y5T1M01 Topic' }
], env);
assert.equal(untouched.length, 1);

await assert.rejects(
  () => expandYear4ElevenPlusMathsBaselineRows([
    { Subject:'Maths', Mode:'Y411FM', Student:'X', Lesson:'L2T1M01 Topic' }
  ], { LESSONS_KV:{ async get(){ return null; } } }),
  error => error?.code === 'MATHS_L1_BASELINE_UNAVAILABLE'
);

console.log('Year 4 11+ admin-import L1 baseline verification: PASS');
