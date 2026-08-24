import assert from 'node:assert/strict';
import {
  PHASE11_CURRICULUM_CODES,
  HOME_ORDER_SENSITIVE_CURRICULA,
  PREFETCH_CONCURRENCY,
  phase11NavigationEnv,
  shouldPrefetchPhase11Navigation
} from '../worker/src/phase11-navigation-cache.js';

const store = new Map();
const idsByCurriculum = new Map();
const lessonIds = Array.from({ length: 369 }, (_, index) => `L${index + 1}`);
let cursor = 0;
for (let index = 0; index < PHASE11_CURRICULUM_CODES.length; index += 1) {
  const remainingCurricula = PHASE11_CURRICULUM_CODES.length - index;
  const remainingLessons = lessonIds.length - cursor;
  const take = Math.ceil(remainingLessons / remainingCurricula);
  const ids = lessonIds.slice(cursor, cursor + take);
  cursor += ids.length;
  const code = PHASE11_CURRICULUM_CODES[index];
  idsByCurriculum.set(code, ids);
  store.set(`curriculum:${code}`, { curriculumCode: code, lessonIds: ids });
}
for (const lessonId of lessonIds) {
  store.set(`lesson:${lessonId}`, {
    lessonId,
    title: `Real ${lessonId}`,
    description: `Description ${lessonId}`,
    active: true,
    order: Number(lessonId.slice(1))
  });
}

function makeEnv() {
  const stats = { reads: 0, active: 0, peak: 0, keys: [] };
  const namespace = {
    async get(key, options) {
      stats.reads += 1;
      stats.keys.push(key);
      stats.active += 1;
      stats.peak = Math.max(stats.peak, stats.active);
      await new Promise(resolve => setTimeout(resolve, 1));
      stats.active -= 1;
      const value = store.get(key) ?? null;
      if (options?.type === 'json') return value == null ? null : structuredClone(value);
      return value == null ? null : JSON.stringify(value);
    },
    async list() { return { keys: [] }; }
  };
  return { env: { LESSONS_KV: namespace, marker: 'keep' }, stats };
}

function countFor(codes) {
  return codes.reduce((sum, code) => sum + (idsByCurriculum.get(code)?.length || 0), 0);
}

async function prefetch(url) {
  const { env, stats } = makeEnv();
  const request = new Request(url);
  const cachedEnv = await phase11NavigationEnv(env, request);
  assert.ok(stats.peak <= PREFETCH_CONCURRENCY, `Prefetch concurrency exceeded ${PREFETCH_CONCURRENCY}.`);
  assert.equal(cachedEnv.marker, 'keep');
  return { cachedEnv, stats };
}

// /home needs only the 11 curriculum indexes plus real order-sensitive L2/L3
// records. The other 288-ish lessons are represented by request-local synthetic
// membership records and therefore never hit KV during downstream home probes.
const home = await prefetch('https://example.test/api/v1/student/home');
assert.equal(
  home.stats.reads,
  PHASE11_CURRICULUM_CODES.length + countFor(HOME_ORDER_SENSITIVE_CURRICULA)
);
assert.ok(home.stats.reads < 120, `Home prefetch unexpectedly used ${home.stats.reads} KV reads.`);

const y5Ids = idsByCurriculum.get('MATHS_L2');
const y5 = await prefetch('https://example.test/api/v1/student/views/maths-year5/lessons');
assert.equal(y5.stats.reads, PHASE11_CURRICULUM_CODES.length + y5Ids.length);
assert.ok(y5.stats.reads < 60, `Year 5 prefetch unexpectedly used ${y5.stats.reads} KV reads.`);

const selectedReal = await y5.cachedEnv.LESSONS_KV.get(`lesson:${y5Ids[0]}`, { type: 'json' });
assert.equal(selectedReal.title, `Real ${y5Ids[0]}`);
assert.equal(y5.stats.reads, PHASE11_CURRICULUM_CODES.length + y5Ids.length);

const y2Id = idsByCurriculum.get('MATHS_Y2')[0];
const nonSelectedSynthetic = await y5.cachedEnv.LESSONS_KV.get(`lesson:${y2Id}`, { type: 'json' });
assert.deepEqual(nonSelectedSynthetic, { lessonId: y2Id, title: y2Id, active: true });
assert.equal(y5.stats.reads, PHASE11_CURRICULUM_CODES.length + y5Ids.length);

// Detail and resource requests load only their selected view's real curriculum,
// while always ensuring the target lesson itself is real.
const target = y5Ids[1];
const detail = await prefetch(`https://example.test/api/v1/student/lessons/${target}?viewId=maths-year5`);
assert.equal(detail.stats.reads, PHASE11_CURRICULUM_CODES.length + y5Ids.length);
const detailTarget = await detail.cachedEnv.LESSONS_KV.get(`lesson:${target}`, { type: 'json' });
assert.equal(detailTarget.description, `Description ${target}`);

const video = await prefetch(`https://example.test/api/v1/student/resources/${target}~video~1/video?viewId=maths-level2`);
assert.equal(video.stats.reads, PHASE11_CURRICULUM_CODES.length + y5Ids.length);

const other = await prefetch(`https://example.test/api/v1/student/resources/${target}~p11elevenother~1?viewId=maths-level2`);
assert.equal(other.stats.reads, PHASE11_CURRICULUM_CODES.length + y5Ids.length);

// Unknown future views deliberately fall back to the complete real catalogue so
// acceleration can never change correctness for an unrecognised route.
const unknown = await prefetch('https://example.test/api/v1/student/views/future-view/lessons');
assert.equal(unknown.stats.reads, 380);

// Cached values remain isolated from downstream mutation, and non-JSON reads
// preserve the original namespace semantics.
const mutable = await y5.cachedEnv.LESSONS_KV.get(`lesson:${target}`, { type: 'json' });
mutable.title = 'Mutated';
const again = await y5.cachedEnv.LESSONS_KV.get(`lesson:${target}`, { type: 'json' });
assert.equal(again.title, `Real ${target}`);
const beforeRaw = y5.stats.reads;
await y5.cachedEnv.LESSONS_KV.get(`lesson:${target}`);
assert.equal(y5.stats.reads, beforeRaw + 1);

assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/home')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/views/maths-year5/lessons')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/lessons/Y5M1?viewId=maths-year5')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/resources/Y5M1~video~1/video?viewId=maths-year5')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/resources/Y5M1~p11elevenother~1?viewId=maths-level2')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/session')), false);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/home', { method: 'POST' })), false);

console.log('Phase 11 targeted navigation cache static verification: PASS');
