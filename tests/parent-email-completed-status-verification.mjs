import assert from 'node:assert/strict';
import { normaliseCsvInputRow, emailItemFromRow } from '../worker/src/admin-lesson-release-import-email.js';

const row = {
  Name:'Synthetic',
  Year:'Year 5',
  Subject:'Maths',
  Lesson:'L2T1M01 Number and Place Value I',
  LessonDated:'8th September 2026',
  LessonStatus:'Lesson Completed today',
  Mode:'Y5FM',
  Parent:'Parent',
  Email:'parent@example.com',
  Student:'Synthetic0101'
};

const normalised = normaliseCsvInputRow(row);
assert.equal(normalised.Lesson, 'Y5T1M01 Number and Place Value I');
assert.equal(normalised.LessonStatus, 'Completed');
assert.equal(emailItemFromRow(row).emailType, 'COMPLETED');

const workbookCompletedWithProgressHistory = { ...row, LessonStatus:'Completed', Remarks:'Completed till slide 10' };
assert.equal(normaliseCsvInputRow(workbookCompletedWithProgressHistory).LessonStatus, 'Completed');
assert.equal(emailItemFromRow(workbookCompletedWithProgressHistory).emailType, 'COMPLETED');

// One session may finish multiple lessons and then stop part-way through
// the next one. Email classification is per lesson row, never per session.
const sameSession = [
  { ...row, Lesson:'L2T1M01 Number and Place Value I', LessonStatus:'Completed', Remarks:'Start from Slide 20' },
  { ...row, Lesson:'L2T1M02 Number and Place Value II', LessonStatus:'Completed', Remarks:'Completed till Slide 38' },
  { ...row, Lesson:'L2T1M03 Number and Place Value III', LessonStatus:'Slide 5', Remarks:'Start from Slide 5' }
];
assert.deepEqual(
  sameSession.map(item => emailItemFromRow(item).emailType),
  ['COMPLETED','COMPLETED','ONGOING']
);

const negative = normaliseCsvInputRow({ ...row, LessonStatus:'Not Completed - Slide 18' });
assert.equal(negative.LessonStatus, 'Not Completed - Slide 18');
assert.equal(emailItemFromRow({ ...row, LessonStatus:'Not Completed - Slide 18' }).emailType, 'ONGOING');

console.log('Completed status contains-match normalisation: PASS');
