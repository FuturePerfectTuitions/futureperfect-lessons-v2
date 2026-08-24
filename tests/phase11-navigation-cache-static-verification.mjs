import assert from 'node:assert/strict';
import {
  PHASE11_CURRICULUM_CODES,
  PREFETCH_CONCURRENCY,
  phase11NavigationEnv,
  shouldPrefetchPhase11Navigation
} from '../worker/src/phase11-navigation-cache.js';

const store = new Map();
const lessonIds = Array.from({ length: 369 }, (_, index) => `L${index + 1}`);
let cursor = 0;
for (let index = 0; index < PHASE11_CURRICULUM_CODES.length; index += 1) {
  const remainingCurricula = PHASE11_CURRICULUM_CODES.length - index;
  const remainingLessons = lessonIds.length - cursor;
  const take = Math.ceil(remainingLessons / remainingCurricula);
  const ids = lessonIds.slice(cursor, cursor + take);
  cursor += ids.length;
  store.set(`curriculum:${PHASE11_CURRICULUM_CODES[index]}`, {
    curriculumCode: PHASE11_CURRICULUM_CODES[index],
    lessonIds: ids
  });
}
for (const lessonId of lessonIds) store.set(`lesson:${lessonId}`, { lessonId, active: true });

let reads = 0;
let active = 0;
let peak = 0;
const namespace = {
  async get(key, options) {
    reads += 1;
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active -= 1;
    const value = store.get(key) ?? null;
    if (options?.type === 'json') return value == null ? null : structuredClone(value);
    return value == null ? null : JSON.stringify(value);
  },
  async list() { return { keys: [] }; }
};

const env = { LESSONS_KV: namespace, marker: 'keep' };
const cachedEnv = await phase11NavigationEnv(env);
assert.equal(reads, 380, 'Phase 11 prefetch should read 11 curricula + 369 lessons once.');
assert.ok(peak <= PREFETCH_CONCURRENCY, `Prefetch concurrency exceeded ${PREFETCH_CONCURRENCY}.`);
assert.equal(cachedEnv.marker, 'keep');

const beforeCachedReads = reads;
const curriculum = await cachedEnv.LESSONS_KV.get('curriculum:MATHS_Y2', { type: 'json' });
const lesson = await cachedEnv.LESSONS_KV.get('lesson:L1', { type: 'json' });
assert.equal(reads, beforeCachedReads, 'Cached JSON reads must not hit KV again.');
assert.equal(curriculum.curriculumCode, 'MATHS_Y2');
assert.equal(lesson.lessonId, 'L1');

lesson.lessonId = 'mutated';
const lessonAgain = await cachedEnv.LESSONS_KV.get('lesson:L1', { type: 'json' });
assert.equal(lessonAgain.lessonId, 'L1', 'Cached objects must be cloned for downstream callers.');

await cachedEnv.LESSONS_KV.get('lesson:L1');
assert.equal(reads, beforeCachedReads + 1, 'Non-JSON reads must preserve the original namespace behavior.');

assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/home')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/views/maths-year5/lessons')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/lessons/Y5M1?viewId=maths-year5')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/resources/Y5M1~video~1/video?viewId=maths-year5')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/session')), false);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/home', { method: 'POST' })), false);

console.log('Phase 11 navigation cache static verification: PASS');
