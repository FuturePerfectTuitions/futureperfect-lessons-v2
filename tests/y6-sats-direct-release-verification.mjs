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
      lessonCount: 4,
      lessons: [
        { lessonId: 'Y6M50' },
        { lessonId: 'Y6M51' },
        { lessonId: 'Y6M52' },
        { lessonId: 'Y6M69' }
      ]
    }
  },
  lessonToViews: {
    Y6M50: ['maths-year6'],
    Y6M51: ['maths-year6'],
    Y6M52: ['maths-year6'],
    Y6M69: ['maths-year6']
  }
};

const base = {
  asOfDate: '2026-09-26',
  user: { firstName: 'Fixture', fullLibraries: ['MATHS_Y6_FULL'] },
  batchAssignments: [],
  entitlements: [],
  onlinePreLessonEntitlements: []
};

const inherited = compileAccessSnapshot(base, catalogue, { asOfDate: base.asOfDate });
assert.equal(inherited.lessonAccess.Y6M50?.core, true, 'ordinary Year 6 lesson must retain full-library access');
assert.equal(inherited.lessonAccess.Y6M51, undefined, 'SAT lesson must not inherit Year 6 full-library access');
assert.equal(inherited.lessonAccess.Y6M69, undefined, 'last SAT lesson must not inherit Year 6 full-library access');

const released = compileAccessSnapshot({
  ...base,
  entitlements: [{ lesson_id: 'Y6M51', core_access: 1 }]
}, catalogue, { asOfDate: base.asOfDate });
assert.equal(released.lessonAccess.Y6M51?.core, true, 'individually released SAT lesson must open FULL');
assert.equal(released.lessonAccess.Y6M51?.sources.includes('earned'), true);

const prelesson = compileAccessSnapshot({
  ...base,
  onlinePreLessonEntitlements: [{ lesson_id: 'Y6M52', vr_access: 0 }]
}, catalogue, { asOfDate: base.asOfDate });
assert.equal(prelesson.lessonAccess.Y6M52?.core, false);
assert.equal(prelesson.lessonAccess.Y6M52?.preLessonOnly, true, 'SAT lesson must support normal PreLesson-only release');

console.log('Y6_SATS_DIRECT_RELEASE_VERIFICATION_PASS');
