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

const workbookOngoing = { ...row, LessonStatus:'Completed', Remarks:'Completed till slide 10' };
assert.equal(normaliseCsvInputRow(workbookOngoing).LessonStatus, 'Completed');
assert.equal(emailItemFromRow(workbookOngoing).emailType, 'ONGOING');

const negative = normaliseCsvInputRow({ ...row, LessonStatus:'Not Completed - Slide 18' });
assert.equal(negative.LessonStatus, 'Not Completed - Slide 18');
assert.equal(emailItemFromRow({ ...row, LessonStatus:'Not Completed - Slide 18' }).emailType, 'ONGOING');

console.log('Completed status contains-match normalisation: PASS');
