import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  viewForBatch,
  overlayUserForView,
  highestBySubject,
  targetViewIdForRequest
} from '../worker/src/index-phase12.js';

const normalMaths4 = viewForBatch({
  batch_key: 'Owner supplied exact name A',
  subject: 'maths',
  school_year: 4,
  stream: 'normal',
  maths_level: null
});
assert.equal(normalMaths4.viewId, 'maths-year4');
assert.equal(normalMaths4.rank, 40);

const mathsLevel1 = viewForBatch({
  batch_key: 'Any exact Column C value 1',
  subject: 'maths',
  school_year: 4,
  stream: '11plus',
  maths_level: 1
});
const mathsLevel2 = viewForBatch({
  batch_key: 'Any exact Column C value 2',
  subject: 'maths',
  school_year: 4,
  stream: '11plus',
  maths_level: 2
});
const mathsLevel3 = viewForBatch({
  batch_key: 'Any exact Column C value 3',
  subject: 'maths',
  school_year: 5,
  stream: '11plus',
  maths_level: 3
});
assert.equal(mathsLevel1.viewId, 'maths-level1');
assert.equal(mathsLevel2.viewId, 'maths-level2');
assert.equal(mathsLevel3.viewId, 'maths-level3');
assert.deepEqual([mathsLevel1.rank, mathsLevel2.rank, mathsLevel3.rank], [41, 51, 61]);

const englishNormal5 = viewForBatch({
  batch_key: 'English normal exact name',
  subject: 'english',
  school_year: 5,
  stream: 'normal'
});
const englishEleven5 = viewForBatch({
  batch_key: 'English eleven plus exact name',
  subject: 'english',
  school_year: 5,
  stream: '11plus'
});
assert.equal(englishNormal5.viewId, 'english-year5');
assert.equal(englishEleven5.viewId, 'english-year5-11plus');
assert.equal(englishNormal5.rank, 50);
assert.equal(englishEleven5.rank, 51);
assert.equal(viewForBatch({ subject: 'english', school_year: 3, stream: '11plus' }), null);
assert.equal(viewForBatch({ subject: 'english', school_year: 5, stream: 'unexpected' }), null);
assert.equal(viewForBatch({ subject: 'maths', school_year: 5, stream: '11plus', maths_level: null }), null);

const rows = [
  { batch_key: 'M normal 4', subject: 'maths', school_year: 4, stream: 'normal', maths_level: null },
  { batch_key: 'M plus level 2', subject: 'maths', school_year: 4, stream: '11plus', maths_level: 2 },
  { batch_key: 'M plus level 3', subject: 'maths', school_year: 5, stream: '11plus', maths_level: 3 },
  { batch_key: 'E normal 5', subject: 'english', school_year: 5, stream: 'normal', maths_level: null },
  { batch_key: 'E plus 5', subject: 'english', school_year: 5, stream: '11plus', maths_level: null }
];
const highest = highestBySubject(rows);
assert.equal(highest.get('maths').view.viewId, 'maths-level3');
assert.equal(highest.get('english').view.viewId, 'english-year5-11plus');

const originalUser = {
  firstName: 'Fixture',
  p: 'Te12',
  answerPassword: 'An34',
  schoolYear: 4,
  batches: ['legacy-placeholder'],
  fullLibraries: ['MATHS_L1_FULL'],
  manualAccess: { coreLessons: ['Y4M1'] },
  status: 'active'
};
const overlaid = overlayUserForView(originalUser, rows, 'maths-level3');
assert.equal(overlaid.schoolYear, 5);
assert.deepEqual(overlaid.batches, ['Y5M11']);
assert.equal(overlaid.p, originalUser.p);
assert.equal(overlaid.answerPassword, originalUser.answerPassword);
assert.deepEqual(overlaid.fullLibraries, originalUser.fullLibraries);
assert.deepEqual(overlaid.manualAccess, originalUser.manualAccess);
assert.equal(originalUser.schoolYear, 4);
assert.deepEqual(originalUser.batches, ['legacy-placeholder']);
assert.equal(overlayUserForView(originalUser, rows, 'maths-level9'), originalUser);

assert.equal(
  targetViewIdForRequest(new Request('https://example.test/api/v1/student/views/maths-level2/lessons')),
  'maths-level2'
);
assert.equal(
  targetViewIdForRequest(new Request('https://example.test/api/v1/student/lessons/Y4M1?viewId=english-year4-11plus')),
  'english-year4-11plus'
);
assert.equal(
  targetViewIdForRequest(new Request('https://example.test/api/v1/student/home')),
  ''
);

const source = fs.readFileSync(new URL('../worker/src/index-phase12.js', import.meta.url), 'utf8');
assert.ok(source.includes("import phase11EfficientWorker from './index-phase11-efficient.js'"));
assert.ok(source.includes('student_batch_assignments'));
assert.ok(source.includes('batch_definitions'));
assert.ok(source.includes('effective_from <= ?'));
assert.ok(source.includes('effective_to IS NULL'));
assert.ok(source.includes('PHASE12_BYPASS_SESSION_PROFILE'));
assert.ok(!source.includes('INSERT INTO lesson_entitlements'));
assert.ok(!source.includes('DELETE FROM lesson_entitlements'));
assert.ok(!source.includes('UPDATE lesson_entitlements'));

const sessionSource = fs.readFileSync(new URL('../worker/src/phase11-session-profile.js', import.meta.url), 'utf8');
assert.ok(sessionSource.includes('PHASE12_BYPASS_SESSION_PROFILE'));

console.log('Phase 12 batch-aware Worker verification: PASS');