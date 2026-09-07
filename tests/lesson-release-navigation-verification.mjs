import assert from 'node:assert/strict';
import {
  viewIdForAccess,
  fullLibraryForView,
  academicYearStart
} from '../worker/src/index-phase20-change8.js';

const englishY5 = {
  lessonId:'Y5E2',
  subject:'English',
  active:true,
  displayIds:{
    'english-year5':'Y5T1E01',
    'english-year5-11plus':'Y5T1EE01'
  }
};
const englishY4 = {
  lessonId:'Y4E1',
  subject:'English',
  active:true,
  displayIds:{
    'english-year4':'Y4T1E01',
    'english-year4-11plus':'Y4T1EE01'
  }
};
const mathsShared = {
  lessonId:'Y5M1',
  subject:'Maths',
  active:true,
  displayIds:{
    'maths-year5':'Y5T1M01',
    'maths-level2':'L2T1M01'
  }
};

assert.equal(viewIdForAccess(englishY5, 'Y511OE1'), 'english-year5-11plus');
assert.equal(viewIdForAccess(englishY5, 'Y5OE'), 'english-year5');
assert.equal(viewIdForAccess(englishY4, 'Y411OE'), 'english-year4-11plus');
assert.equal(viewIdForAccess(mathsShared, 'Y511OM1'), 'maths-level2');
assert.equal(viewIdForAccess(mathsShared, 'Y5FM'), 'maths-year5');

assert.equal(fullLibraryForView('english-year5-11plus'), 'ENGLISH_Y5_11PLUS_FULL');
assert.equal(fullLibraryForView('english-year5'), 'ENGLISH_Y5_FULL');
assert.equal(fullLibraryForView('maths-level2'), 'MATHS_L2_FULL');
assert.equal(fullLibraryForView('maths-year5'), 'MATHS_Y5_FULL');
assert.equal(academicYearStart('2026-09-07'), '2026-09-01');
assert.equal(academicYearStart('2027-04-30'), '2026-09-01');

console.log('Lesson release navigation verification: PASS');
