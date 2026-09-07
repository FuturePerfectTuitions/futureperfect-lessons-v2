import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normaliseVr } from '../worker/src/index-phase9.js';

const nested = normaliseVr({ vr:{ preLesson:[{ sheet:{ displayName:'Nested VR sheet', r2Key:'english/year5/lesson/vr-sheet.pdf' }, answerKey:{ displayName:'Nested VR answer', r2Key:'english/year5/lesson/vr-answer.pdf' } }] } });
assert.equal(nested.preLesson[0].sheet.displayName, 'Nested VR sheet');
assert.equal(nested.preLesson[0].sheet.r2Key, 'english/year5/lesson/vr-sheet.pdf');
assert.equal(nested.preLesson[0].answerKey.r2Key, 'english/year5/lesson/vr-answer.pdf');

const legacy = normaliseVr({ vr:{ preLesson:[{ displayName:'Legacy VR sheet', r2Key:'legacy-sheet.pdf', answerKey:{ displayName:'Legacy VR answer', r2Key:'legacy-answer.pdf' } }] } });
assert.equal(legacy.preLesson[0].sheet.r2Key, 'legacy-sheet.pdf');
assert.equal(legacy.preLesson[0].answerKey.r2Key, 'legacy-answer.pdf');

const phase18 = readFileSync(new URL('../worker/src/index-phase18-online-prelesson.js', import.meta.url), 'utf8');
const change8 = readFileSync(new URL('../worker/src/index-phase20-change8.js', import.meta.url), 'utf8');
assert.match(phase18, /PHASE20_DISABLE_LEGACY_PRELESSON_OVERLAY/);
assert.match(change8, /withoutLegacyPrelessonOverlay/);
assert.match(change8, /handleHome\(request, releaseEnv, ctx\)/);
assert.match(change8, /handleLessonList\(request, releaseEnv, ctx, viewId\)/);
assert.match(change8, /handleLessonDetail\(request, releaseEnv, ctx, lessonId, viewId\)/);
assert.match(change8, /handleResource\(request, releaseEnv, ctx, parsed, viewId\)/);
console.log('PreLesson 11+ regression verification: PASS');
