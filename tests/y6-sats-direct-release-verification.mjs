import assert from 'node:assert/strict';
import {
  Y6_SATS_DIRECT_RELEASE_MARKER,
  isYear6SatsLessonId,
  compileAccessSnapshot
} from '../worker/src/access-read-model-sync.js';

assert.equal(Y6_SATS_DIRECT_RELEASE_MARKER, 'y6-sats-direct-release-v1');
assert.equal(isYear6SatsLessonId('Y6M50'), false);
for (let n = 51; n <= 69; n += 1) assert.equal(isYear6SatsLessonId(`Y6M${n}`), true);
assert.equal(isYear6SatsLessonId('Y6M70'), false);

const catalogue = {
  schemaVersion: 1,
  kind: 'prepared-catalogue',
  views: {
    'maths-year6': {
      viewId: 'maths-year6',
      lessonCount: 1,
      lessons: [{ lessonId: 'Y6M50' }]
    },
    'maths-level3': {
      viewId: 'maths-level3',
      lessonCount: 1,
      lessons: [{ lessonId: 'Y6M50' }]
    },
    'maths-sats': {
      viewId: 'maths-sats',
      lessonCount: 3,
      lessons: [
        { lessonId: 'Y6M51' },
        { lessonId: 'Y6M52' },
        { lessonId: 'Y6M69' }
      ]
    }
  },
  lessonToViews: {
    Y6M50: ['maths-year6', 'maths-level3'],
    Y6M51: ['maths-sats'],
    Y6M52: ['maths-sats'],
    Y6M69: ['maths-sats']
  }
};

const year6Assignment = {
  batch_key: 'Y6M_FIXTURE',
  subject: 'maths',
  school_year: 6,
  stream: 'normal',
  maths_level: null,
  effective_from: '2026-09-01',
  effective_to: null,
  batch_active_from: '2026-09-01',
  batch_active_to: null
};

const l3Assignment = {
  batch_key: 'Y611M_FIXTURE',
  subject: 'maths',
  school_year: 6,
  stream: '11plus',
  maths_level: 3,
  effective_from: '2026-09-01',
  effective_to: null,
  batch_active_from: '2026-09-01',
  batch_active_to: null
};

const base = {
  asOfDate: '2026-09-26',
  user: { firstName: 'Fixture', fullLibraries: ['MATHS_Y6_FULL'] },
  batchAssignments: [year6Assignment],
  entitlements: [],
  onlinePreLessonEntitlements: []
};

const inherited = compileAccessSnapshot(base, catalogue, { asOfDate: base.asOfDate });
assert.equal(inherited.lessonAccess.Y6M50?.core, true, 'ordinary Year 6 lesson must retain full-library access');
assert.equal(inherited.lessonAccess.Y6M51, undefined, 'SAT lesson must not inherit Year 6 full-library access');
assert.equal(inherited.lessonAccess.Y6M69, undefined, 'last SAT lesson must not inherit Year 6 full-library access');

const inheritedYear6 = inherited.views.find(view => view.viewId === 'maths-year6');
const inheritedSats = inherited.views.find(view => view.viewId === 'maths-sats');
assert.ok(inheritedYear6, 'current Year 6 teaching view must remain visible');
assert.ok(inheritedSats, 'current Year 6 must receive a separate SATS surface');
assert.equal(inheritedSats.current, true);
assert.equal(inheritedSats.group, 'current');
assert.equal(inheritedSats.visibleLessonCount, 3);
assert.equal(inheritedSats.openLessonCount, 0, 'SATS surface visibility must not auto-open SAT lessons');
assert.equal(inheritedSats.lockedLessonCount, 3);

const released = compileAccessSnapshot({
  ...base,
  entitlements: [{ lesson_id: 'Y6M51', core_access: 1 }]
}, catalogue, { asOfDate: base.asOfDate });
assert.equal(released.lessonAccess.Y6M51?.core, true, 'individually released SAT lesson must open FULL');
assert.equal(released.lessonAccess.Y6M51?.sources.includes('earned'), true);
assert.equal(released.views.find(view => view.viewId === 'maths-sats')?.openLessonCount, 1);

const prelesson = compileAccessSnapshot({
  ...base,
  onlinePreLessonEntitlements: [{ lesson_id: 'Y6M52', vr_access: 0 }]
}, catalogue, { asOfDate: base.asOfDate });
assert.equal(prelesson.lessonAccess.Y6M52?.core, false);
assert.equal(prelesson.lessonAccess.Y6M52?.preLessonOnly, true, 'SAT lesson must support normal PreLesson-only release');
assert.equal(prelesson.views.find(view => view.viewId === 'maths-sats')?.openLessonCount, 1);

const ownerManual = compileAccessSnapshot({
  ...base,
  user: {
    ...base.user,
    manualAccess: {
      coreLessons: ['Y6M51', 'Y6M52', 'Y6M69'],
      vrLessons: [],
      specialBuckets: []
    }
  }
}, catalogue, { asOfDate: base.asOfDate });
const ownerSats = ownerManual.views.find(view => view.viewId === 'maths-sats');
assert.equal(ownerSats?.openLessonCount, 3, 'manual SATS grants must project into the SATS surface');
assert.equal(ownerSats?.lockedLessonCount, 0);

// L3 retains the existing stricter SATS rule: no separate SATS surface until
// there is genuine released/PreLesson/manual SATS access.
const l3NoSats = compileAccessSnapshot({
  ...base,
  user: { firstName: 'L3 Fixture', fullLibraries: ['MATHS_L3_FULL'] },
  batchAssignments: [l3Assignment]
}, catalogue, { asOfDate: base.asOfDate });
assert.ok(l3NoSats.views.some(view => view.viewId === 'maths-level3' && view.current === true));
assert.equal(l3NoSats.views.some(view => view.viewId === 'maths-sats'), false, 'L3 without genuine SATS access must not receive SATS');

const l3Released = compileAccessSnapshot({
  ...base,
  user: { firstName: 'L3 Fixture', fullLibraries: ['MATHS_L3_FULL'] },
  batchAssignments: [l3Assignment],
  entitlements: [{ lesson_id: 'Y6M51', core_access: 1 }]
}, catalogue, { asOfDate: base.asOfDate });
const l3Sats = l3Released.views.find(view => view.viewId === 'maths-sats');
assert.ok(l3Sats, 'L3 with a genuine SATS release must receive the SATS surface');
assert.equal(l3Sats.current, true);
assert.equal(l3Sats.openLessonCount, 1);

console.log('Y6_SATS_DIRECT_RELEASE_VERIFICATION_PASS');
