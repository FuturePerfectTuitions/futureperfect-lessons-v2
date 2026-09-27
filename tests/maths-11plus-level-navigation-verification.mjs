import assert from 'node:assert/strict';
import {
  normaliseMathsEquivalentHome,
  normaliseMathsElevenPlusHome,
  splitYear6Lessons
} from '../worker/src/index-phase20-change15.js';

const year6Rows = Array.from({ length: 69 }, (_, index) => {
  const number = index + 1;
  const sats = number >= 51;
  return {
    lessonId:`Y6M${number}`,
    displayLessonId:sats ? `Y6SM${number - 50}` : `Y6T1M${String(number).padStart(2, '0')}`,
    locked:number !== 51
  };
});
const year6Split = splitYear6Lessons(year6Rows);
assert.equal(year6Split.lessons.length, 50);
assert.equal(year6Split.sats.length, 19);
assert.equal(year6Split.sats.filter(row => row.locked === false).length, 1);

const kiaan = {
  ok:true,
  student:{ portalUserId:'kiaan' },
  subjects:[{
    subject:'maths',
    views:[
      { viewId:'maths-year4', label:'Year 4', visibleLessonCount:35, openLessonCount:35, lockedLessonCount:0, current:true, group:'current' },
      { viewId:'maths-level1', label:'L1', visibleLessonCount:35, openLessonCount:35, lockedLessonCount:0, current:true, group:'current' },
      { viewId:'maths-year5', label:'Year 5', visibleLessonCount:38, openLessonCount:38, lockedLessonCount:0, current:true, group:'current' },
      { viewId:'maths-level2', label:'L2', visibleLessonCount:38, openLessonCount:38, lockedLessonCount:0, current:true, group:'current' },
      { viewId:'maths-level3', label:'L3', visibleLessonCount:43, openLessonCount:5, lockedLessonCount:38, current:true, group:'current' }
    ]
  }]
};
normaliseMathsEquivalentHome(kiaan, year6Split);
assert.deepEqual(
  kiaan.subjects[0].views.map(view => view.viewId),
  ['maths-level1','maths-level2','maths-level3','maths-sats']
);
assert.deepEqual(
  kiaan.subjects[0].views.map(view => view.label),
  ['L1','L2','L3','SATS']
);

const devansh = {
  ok:true,
  student:{ portalUserId:'dev2608' },
  subjects:[{
    subject:'maths',
    views:[
      { viewId:'maths-year6', label:'Year 6', visibleLessonCount:69, openLessonCount:1, lockedLessonCount:68, current:true, group:'current' },
      { viewId:'maths-level3', label:'L3', visibleLessonCount:43, openLessonCount:0, lockedLessonCount:43, current:true, group:'current' }
    ]
  }]
};
normaliseMathsEquivalentHome(devansh, year6Split);
assert.deepEqual(
  devansh.subjects[0].views.map(view => view.viewId),
  ['maths-level3','maths-sats']
);
assert.deepEqual(
  devansh.subjects[0].views.map(view => view.label),
  ['L3','SATS']
);
assert.equal(devansh.subjects[0].views[1].visibleLessonCount, 19);
assert.equal(devansh.subjects[0].views[1].openLessonCount, 1);
assert.equal(devansh.subjects[0].views[1].lockedLessonCount, 18);

const ordinaryYear6 = {
  ok:true,
  student:{ portalUserId:'ordinary0606' },
  subjects:[{
    subject:'maths',
    views:[
      { viewId:'maths-year6', label:'Year 6', visibleLessonCount:69, openLessonCount:1, lockedLessonCount:68, current:true, group:'current' }
    ]
  }]
};
normaliseMathsEquivalentHome(ordinaryYear6, year6Split);
assert.deepEqual(
  ordinaryYear6.subjects[0].views.map(view => view.viewId),
  ['maths-year6-lessons','maths-sats']
);
assert.deepEqual(
  ordinaryYear6.subjects[0].views.map(view => view.label),
  ['Lessons','SATS']
);
assert.equal(ordinaryYear6.subjects[0].views[0].visibleLessonCount, 50);
assert.equal(ordinaryYear6.subjects[0].views[1].visibleLessonCount, 19);

const normalYear4 = {
  ok:true,
  student:{ portalUserId:'normal0404' },
  subjects:[{ subject:'maths', views:[{ viewId:'maths-year4', label:'Year 4' }] }]
};
normaliseMathsEquivalentHome(normalYear4);
assert.equal(normalYear4.subjects[0].views[0].viewId, 'maths-year4', 'A normal student with no L1 duplicate remains Year 4.');

const trial = {
  ok:true,
  student:{ portalUserId:'TrialEva' },
  subjects:[{ subject:'maths', views:[
    { viewId:'maths-year5', label:'Year 5' },
    { viewId:'maths-level2', label:'L2' }
  ] }]
};
normaliseMathsEquivalentHome(trial);
assert.deepEqual(trial.subjects[0].views.map(view => view.viewId), ['maths-year5','maths-level2'], 'Trial selection semantics remain untouched.');

const list = { ok:true, view:{ viewId:'maths-level2', label:'Level 2 11+' } };
normaliseMathsElevenPlusHome(list, false);
assert.equal(list.view.label, 'L2');

console.log('Maths equivalent navigation verification: PASS');
