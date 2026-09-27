import assert from 'node:assert/strict';
import {
  hasReleasedSats,
  suppressUnreleasedL3Sats
} from '../worker/src/index-maths-equivalent-navigation-final.js';

const kiaan = {
  ok:true,
  subjects:[{
    subject:'maths',
    views:[
      { viewId:'maths-level1', label:'L1', current:true, group:'current' },
      { viewId:'maths-level2', label:'L2', current:true, group:'current' },
      { viewId:'maths-level3', label:'L3', current:true, group:'current' },
      { viewId:'maths-sats', label:'SATS', current:true, group:'current' }
    ]
  }]
};

const noReleasedSats = {
  sats:Array.from({ length:19 }, (_, index) => ({
    lessonId:`Y6M${51 + index}`,
    displayLessonId:`Y6SM${index + 1}`,
    locked:true
  }))
};

assert.equal(hasReleasedSats(noReleasedSats), false);
assert.equal(suppressUnreleasedL3Sats(kiaan, true, noReleasedSats), true);
assert.deepEqual(
  kiaan.subjects[0].views.map(view => view.viewId),
  ['maths-level1','maths-level2','maths-level3'],
  'An L3 student with no released SATS must not receive a SATS card.'
);

const devansh = {
  ok:true,
  subjects:[{
    subject:'maths',
    views:[
      { viewId:'maths-level3', label:'L3', current:true, group:'current' },
      { viewId:'maths-sats', label:'SATS', current:true, group:'current' }
    ]
  }]
};
const oneReleasedSat = {
  sats:[
    { lessonId:'Y6M51', displayLessonId:'Y6SM1', locked:false },
    ...Array.from({ length:18 }, (_, index) => ({
      lessonId:`Y6M${52 + index}`,
      displayLessonId:`Y6SM${index + 2}`,
      locked:true
    }))
  ]
};

assert.equal(hasReleasedSats(oneReleasedSat), true);
assert.equal(suppressUnreleasedL3Sats(devansh, true, oneReleasedSat), false);
assert.deepEqual(
  devansh.subjects[0].views.map(view => view.viewId),
  ['maths-level3','maths-sats'],
  'An L3 student with real SATS access keeps the separate SATS card.'
);

const ordinaryYear6 = {
  ok:true,
  subjects:[{
    subject:'maths',
    views:[
      { viewId:'maths-year6-lessons', label:'Lessons', current:true, group:'current' },
      { viewId:'maths-sats', label:'SATS', current:true, group:'current' }
    ]
  }]
};

assert.equal(suppressUnreleasedL3Sats(ordinaryYear6, false, noReleasedSats), false);
assert.deepEqual(
  ordinaryYear6.subjects[0].views.map(view => view.viewId),
  ['maths-year6-lessons','maths-sats'],
  'Ordinary Year 6 keeps Lessons + SATS even before a SATS release.'
);

console.log('FINAL_MATHS_EQUIVALENT_NAVIGATION_VERIFICATION_PASS');
