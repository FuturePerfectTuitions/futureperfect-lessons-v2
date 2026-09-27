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

// Preserve the valid lower-year equivalent-card normalisation. Final Year 6/L3
// programme identity and SATS presentation are now owned by the native prepared
// model and verified in final-maths-equivalent-navigation-verification.mjs.
const kiaan = {
  ok:true,
  student:{ portalUserId:'kiaan' },
  subjects:[{
    subject:'maths',
    views:[
      { viewId:'maths-year4', label:'Year 4', visibleLessonCount:35, openLessonCount:35, lockedLessonCount:0, current:true, group:'current' },
      { viewId:'maths-level1', label:'L1', visibleLessonCount:35, openLessonCount:35, lockedLessonCount:0, current:true, group:'current' },
      { viewId:'maths-year5', label:'Year 5', visibleLessonCount:38, openLessonCount:38, lockedLessonCount:0, current:true, group:'current' },
      { viewId:'maths-level2', label:'L2', visibleLessonCount:38, openLessonCount:38, lockedLessonCount:0, current:true, group:'current' }
    ]
  }]
};
normaliseMathsEquivalentHome(kiaan);
assert.deepEqual(
  kiaan.subjects[0].views.map(view => view.viewId),
  ['maths-level1','maths-level2']
);
assert.deepEqual(
  kiaan.subjects[0].views.map(view => view.label),
  ['L1','L2']
);

// Presentation aliases must still collapse even when prepared/live layers use
// different internal IDs but the stable labels identify the same lower level.
const liveAliasIds = {
  ok:true,
  student:{ portalUserId:'alias-student' },
  subjects:[{
    subject:'maths',
    views:[
      { viewId:'live-y4-alias', label:'Year 4', visibleLessonCount:35, openLessonCount:35, current:true, group:'current' },
      { viewId:'live-l1-alias', label:'L1', visibleLessonCount:35, openLessonCount:35, current:true, group:'current' },
      { viewId:'live-y5-alias', label:'Year 5', visibleLessonCount:38, openLessonCount:38, current:true, group:'current' },
      { viewId:'live-l2-alias', label:'L2', visibleLessonCount:38, openLessonCount:38, current:true, group:'current' }
    ]
  }]
};
normaliseMathsEquivalentHome(liveAliasIds);
assert.deepEqual(
  liveAliasIds.subjects[0].views.map(view => [view.viewId, view.label]),
  [['live-l1-alias','L1'],['live-l2-alias','L2']]
);

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