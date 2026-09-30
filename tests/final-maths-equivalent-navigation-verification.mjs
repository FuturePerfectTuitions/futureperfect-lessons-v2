import assert from 'node:assert/strict';
import {
  hasReleasedSats,
  nativeCurrentMathsAuthority,
  reconcileNativeMathsHome,
  suppressUnreleasedL3Sats,
  suppressUnpairedL3Sats
} from '../worker/src/index-maths-equivalent-navigation-final.js';

const mathsBody = views => ({
  ok:true,
  subjects:[{ subject:'maths', views }]
});

const current = (viewId, label, extra = {}) => ({
  viewId,
  label,
  subject:'maths',
  current:true,
  group:'current',
  lockedPreview:false,
  ...extra
});

const noReleasedSats = {
  sats:Array.from({ length:19 }, (_, index) => ({
    lessonId:`Y6M${51 + index}`,
    displayLessonId:`Y6SM${index + 1}`,
    locked:true
  }))
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
assert.equal(hasReleasedSats(noReleasedSats), false);
assert.equal(hasReleasedSats(oneReleasedSat), true);

// Compatibility helpers no longer make programme/SATS decisions.
assert.equal(suppressUnreleasedL3Sats(mathsBody([]), true, noReleasedSats), false);
assert.equal(suppressUnpairedL3Sats(mathsBody([]), true, false), false);

// L3 without a native SATS view must remain L3 only even when the older
// composed layer manufactured a SATS card.
{
  const body = mathsBody([
    current('maths-level1','L1'),
    current('maths-level2','L2'),
    current('maths-level3','L3'),
    current('maths-sats','SATS')
  ]);
  const native = mathsBody([current('maths-level3','L3')]);
  assert.equal(reconcileNativeMathsHome(body, native), true);
  assert.deepEqual(body.subjects[0].views.map(v => [v.viewId,v.label]), [
    ['maths-level1','L1'],
    ['maths-level2','L2'],
    ['maths-level3','L3']
  ]);
}

// L3 with an entitlement-driven native SATS view gets the separate SATS card.
{
  const body = mathsBody([current('maths-level3','L3')]);
  const native = mathsBody([
    current('maths-level3','Level 3 (11+)'),
    current('maths-sats','SATS',{visibleLessonCount:19,openLessonCount:1,lockedLessonCount:18})
  ]);
  assert.equal(reconcileNativeMathsHome(body, native), true);
  assert.deepEqual(body.subjects[0].views.map(v => [v.viewId,v.label]), [
    ['maths-level3','L3'],
    ['maths-sats','SATS']
  ]);
}

// Ordinary Year 6 without SATS must be one native curriculum card labelled
// Year 6. The old synthetic maths-year6-lessons + SATS shape is removed.
{
  const body = mathsBody([
    current('maths-year6-lessons','Lessons'),
    current('maths-sats','SATS')
  ]);
  const native = mathsBody([
    current('maths-year6','Year 6',{visibleLessonCount:50,openLessonCount:3,lockedLessonCount:47})
  ]);
  assert.equal(reconcileNativeMathsHome(body, native), true);
  assert.deepEqual(body.subjects[0].views.map(v => [v.viewId,v.label]), [
    ['maths-year6','Year 6']
  ]);
}

// Ordinary Year 6 with native SATS keeps two isolated presentation cards.
{
  const body = mathsBody([
    current('maths-year6-lessons','Lessons'),
    current('maths-sats','SATS')
  ]);
  const native = mathsBody([
    current('maths-year6','Year 6',{visibleLessonCount:50,openLessonCount:3,lockedLessonCount:47}),
    current('maths-sats','SATS',{visibleLessonCount:19,openLessonCount:1,lockedLessonCount:18})
  ]);
  assert.equal(reconcileNativeMathsHome(body, native), true);
  assert.deepEqual(body.subjects[0].views.map(v => [v.viewId,v.label]), [
    ['maths-year6','Year 6'],
    ['maths-sats','SATS']
  ]);
}

// Historical/full-library cards are not removed merely because the current
// programme is reconciled.
{
  const previous = { viewId:'maths-year6', label:'Year 6', subject:'maths', current:false, group:'previous' };
  const body = mathsBody([previous,current('maths-level3','L3'),current('maths-sats','SATS')]);
  const native = mathsBody([current('maths-level3','L3')]);
  assert.equal(reconcileNativeMathsHome(body, native), true);
  assert.equal(body.subjects[0].views.includes(previous), true);
  assert.deepEqual(body.subjects[0].views.filter(v => v.current).map(v => v.viewId), ['maths-level3']);
}

// A contradictory raw prepared model is not guessed around at the response
// boundary. Production publication must fix it first.
{
  const native = mathsBody([current('maths-year6','Year 6'),current('maths-level3','L3')]);
  const authority = nativeCurrentMathsAuthority(native);
  assert.equal(authority.valid, false);
  assert.equal(authority.collision, true);
  const body = mathsBody([current('maths-level3','L3'),current('maths-sats','SATS')]);
  const before = JSON.stringify(body);
  assert.equal(reconcileNativeMathsHome(body, native), false);
  assert.equal(JSON.stringify(body), before);
}

console.log('FINAL_MATHS_EQUIVALENT_NAVIGATION_VERIFICATION_PASS');
