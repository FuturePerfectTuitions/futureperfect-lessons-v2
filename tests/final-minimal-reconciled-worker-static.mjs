import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PHASE11_NAVIGATION_MANIFEST } from '../worker/src/phase11-navigation-manifest.generated.js';
import { validBundledManifest } from '../worker/src/phase11-navigation-cache.js';
import {
  normaliseDisplayNameForView,
  isDisplayNameRewriteView
} from '../worker/src/phase11-view-display-names.js';

assert.equal(validBundledManifest(PHASE11_NAVIGATION_MANIFEST), true);
assert.equal(Object.keys(PHASE11_NAVIGATION_MANIFEST.curricula).length, 11);
assert.equal(Object.keys(PHASE11_NAVIGATION_MANIFEST.lessons).length, 372);
assert.equal(PHASE11_NAVIGATION_MANIFEST.curricula.MATHS_L1.lessonIds.length, 35);
assert.equal(PHASE11_NAVIGATION_MANIFEST.curricula.MATHS_L2.lessonIds.length, 38);
assert.equal(PHASE11_NAVIGATION_MANIFEST.curricula.MATHS_L3.lessonIds.length, 43);
assert.equal(PHASE11_NAVIGATION_MANIFEST.curricula.ENGLISH_Y5.lessonIds.length, 36);

const y6last = PHASE11_NAVIGATION_MANIFEST.lessons.Y6M45;
assert.equal(y6last.displayIds['maths-level3'], 'L3T3M43');
assert.equal(y6last.displayIds['maths-year6'], 'Y6T3M43');

for (const lid of PHASE11_NAVIGATION_MANIFEST.curricula.ENGLISH_Y5.lessonIds) {
  const r = PHASE11_NAVIGATION_MANIFEST.lessons[lid];
  assert.match(r.displayIds['english-year5'], /^Y5T[123]E\d{2}$/);
  assert.equal(
    r.displayIds['english-year5-11plus'],
    r.displayIds['english-year5'].replace(/E(\d{2})$/, 'EE$1')
  );
}

assert.equal(isDisplayNameRewriteView('english-year5-11plus'), true);
assert.equal(
  normaliseDisplayNameForView('Y5T2E16 Homework Example.pdf', 'Y5T2EE16', 'english-year5-11plus'),
  'Y5T2EE16 Homework Example.pdf'
);
assert.equal(
  normaliseDisplayNameForView('L1T3M26 Homework Time 1.pdf', 'Y4T3M26', 'maths-year4'),
  'Y4T3M26 Homework Time 1.pdf'
);

const efficient = fs.readFileSync(new URL('../worker/src/index-phase11-efficient.js', import.meta.url), 'utf8');
assert.match(efficient, /explicitElevenPlusHomework/);
assert.match(efficient, /body\.lesson\.homeworks = \[\]/);
assert.match(efficient, /isDisplayNameRewriteView/);
assert.match(efficient, /vr\.preLessonVideo = null/);
assert.match(efficient, /vr\.homeworkVideo = null/);

console.log('FINAL_MINIMAL_RECONCILED_WORKER_STATIC_PASS');
