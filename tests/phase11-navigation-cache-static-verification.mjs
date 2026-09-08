import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_NAVIGATION_SHA256,
  writePhase11NavigationManifest
} from '../scripts/phase11-navigation-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedPath = path.join(root, 'worker', 'src', 'phase11-navigation-manifest.generated.js');
const generated = writePhase11NavigationManifest(generatedPath);
assert.equal(generated.catalogueSha256, '7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663');
assert.equal(generated.navigationSha256, EXPECTED_NAVIGATION_SHA256);
assert.equal(generated.curricula, 11);
assert.equal(generated.lessons, 369);
assert.ok(generated.bytes < 70000, `Navigation manifest unexpectedly large: ${generated.bytes} bytes.`);

const generatedSource = fs.readFileSync(generatedPath, 'utf8');
assert.ok(generatedSource.includes(EXPECTED_NAVIGATION_SHA256));
assert.ok(generatedSource.includes('const PHASE11_NAVIGATION_MANIFEST = {'));

const manifestModule = await import(`../worker/src/phase11-navigation-manifest.generated.js?test=${Date.now()}`);
const manifest = manifestModule.PHASE11_NAVIGATION_MANIFEST;
assert.equal(Object.keys(manifest.curricula).length, 11);
assert.equal(Object.keys(manifest.lessons).length, 369);

const navigation = await import(`../worker/src/phase11-navigation-cache.js?test=${Date.now()}`);
const {
  PHASE11_CURRICULUM_CODES,
  PHASE11_CATALOGUE_SHA256,
  LIVE_CURRICULUM_AUTHORITY_MARKER,
  LIVE_LESSON_METADATA_AUTHORITY_MARKER,
  validBundledManifest,
  phase11NavigationEnv,
  shouldPrefetchPhase11Navigation
} = navigation;

assert.equal(PHASE11_CURRICULUM_CODES.length, 11);
assert.equal(PHASE11_CATALOGUE_SHA256, manifest.catalogueSha256);
assert.equal(LIVE_CURRICULUM_AUTHORITY_MARKER, 'LIVE_CURRICULUM_AUTHORITY_V1');
assert.equal(LIVE_LESSON_METADATA_AUTHORITY_MARKER, 'LIVE_LESSON_METADATA_AUTHORITY_V1');
assert.equal(validBundledManifest(manifest), true);
assert.equal(validBundledManifest(null), false);
assert.equal(validBundledManifest({ ...manifest, catalogueSha256: 'wrong' }), false);

const y5Ids = manifest.curricula.MATHS_L2.lessonIds;
const y2Ids = manifest.curricula.MATHS_Y2.lessonIds;
assert.ok(y5Ids.includes('Y5M1'));
assert.ok(y2Ids.includes('Y2M1'));
assert.ok(manifest.curricula.MATHS_L1.lessonIds.length > 1);

function makeEnv() {
  const stats = { reads: 0, keys: [] };
  const store = new Map();

  // Simulate current live KV curricula. Deliberately make L1 and L2 membership
  // differ from the bundled manifest: live curriculum membership must win.
  for (const [code, curriculum] of Object.entries(manifest.curricula)) {
    store.set(`curriculum:${code}`, structuredClone(curriculum));
  }
  const liveL1Ids = manifest.curricula.MATHS_L1.lessonIds.slice(1);
  store.set('curriculum:MATHS_L1', {
    ...structuredClone(manifest.curricula.MATHS_L1),
    lessonIds: liveL1Ids
  });
  store.set('curriculum:MATHS_L2', {
    ...structuredClone(manifest.curricula.MATHS_L2),
    lessonIds: ['Y5M1']
  });

  // Deliberately make the live lesson metadata differ from the bundled record.
  // Known catalogue lists must show/access the live record, not stale bundled
  // title/display metadata for the same canonical key.
  store.set('lesson:Y5M1', {
    ...manifest.lessons.Y5M1,
    lessonId: 'Y5M1',
    title: 'Real Y5M1',
    displayIds: {
      ...(manifest.lessons.Y5M1.displayIds || {}),
      'maths-level2': 'LIVE-L2-M01'
    },
    description: 'Real detail description',
    core: { homeworks: [] }
  });

  const namespace = {
    async get(key, options) {
      stats.reads += 1;
      stats.keys.push(key);
      const value = store.get(key) ?? null;
      if (options?.type === 'json') return value == null ? null : structuredClone(value);
      return value == null ? null : JSON.stringify(value);
    },
    async list() { return { keys: [] }; }
  };
  return { env: { LESSONS_KV: namespace, marker: 'keep' }, stats, liveL1Ids };
}

async function accelerated(url) {
  const { env, stats, liveL1Ids } = makeEnv();
  const cachedEnv = await phase11NavigationEnv(env, new Request(url));
  assert.equal(cachedEnv.marker, 'keep');
  return { cachedEnv, stats, liveL1Ids };
}

// Home reads only the 11 live curriculum records. Lesson metadata can remain
// bundled on home because this route needs current membership/counts, not a full
// per-view list of current lesson titles/display IDs.
const home = await accelerated('https://example.test/api/v1/student/home');
assert.equal(home.stats.reads, 11, 'Home must read the 11 live curriculum records.');
const homeL1 = await home.cachedEnv.LESSONS_KV.get('curriculum:MATHS_L1', { type: 'json' });
const homeL2 = await home.cachedEnv.LESSONS_KV.get('curriculum:MATHS_L2', { type: 'json' });
const homeLesson = await home.cachedEnv.LESSONS_KV.get('lesson:Y5M1', { type: 'json' });
assert.equal(home.stats.reads, 11, 'Cached live curricula and bundled home metadata must add no further reads.');
assert.deepEqual(homeL1.lessonIds, home.liveL1Ids, 'Live L1 membership must override bundled L1 membership.');
assert.deepEqual(homeL2.lessonIds, ['Y5M1'], 'Live L2 membership must override bundled L2 membership.');
assert.equal(homeLesson.title, manifest.lessons.Y5M1.title);
assert.equal(homeLesson.order, manifest.lessons.Y5M1.order);

// A known catalogue view reads its selected live curriculum and the live lesson
// records within that curriculum. This prevents stale bundled metadata from
// showing a renamed/removed lesson or causing a false locked state.
const y5 = await accelerated('https://example.test/api/v1/student/views/maths-year5/lessons');
assert.equal(y5.stats.reads, 2);
assert.deepEqual(y5.stats.keys, ['curriculum:MATHS_L2', 'lesson:Y5M1']);
const y5Curriculum = await y5.cachedEnv.LESSONS_KV.get('curriculum:MATHS_L2', { type: 'json' });
const y5Lesson = await y5.cachedEnv.LESSONS_KV.get('lesson:Y5M1', { type: 'json' });
assert.deepEqual(y5Curriculum.lessonIds, ['Y5M1']);
assert.equal(y5.stats.reads, 2);
assert.equal(y5Lesson.title, 'Real Y5M1');
assert.equal(y5Lesson.displayIds['maths-level2'], 'LIVE-L2-M01');

// Unknown views safely read all live curriculum records while retaining bundled
// lesson metadata; this prevents a broad, unbounded live-lesson fanout for an
// unrecognised future view ID.
const unknown = await accelerated('https://example.test/api/v1/student/views/future-view/lessons');
assert.equal(unknown.stats.reads, 11);

// Opening a real lesson/resource reads its live curriculum plus the target full
// lesson record. Repeated target reads are served from the request cache.
const detail = await accelerated('https://example.test/api/v1/student/lessons/Y5M1?viewId=maths-year5');
assert.equal(detail.stats.reads, 2);
assert.deepEqual(detail.stats.keys, ['curriculum:MATHS_L2', 'lesson:Y5M1']);
const detailTarget = await detail.cachedEnv.LESSONS_KV.get('lesson:Y5M1', { type: 'json' });
assert.equal(detailTarget.title, 'Real Y5M1');
assert.equal(detailTarget.description, 'Real detail description');
assert.equal(detail.stats.reads, 2);

const video = await accelerated('https://example.test/api/v1/student/resources/Y5M1~video~1/video?viewId=maths-level2');
assert.equal(video.stats.reads, 2);
assert.deepEqual(video.stats.keys, ['curriculum:MATHS_L2', 'lesson:Y5M1']);

const other = await accelerated('https://example.test/api/v1/student/resources/Y5M1~p11elevenother~1?viewId=maths-level2');
assert.equal(other.stats.reads, 2);
assert.deepEqual(other.stats.keys, ['curriculum:MATHS_L2', 'lesson:Y5M1']);

// Cached values remain isolated from downstream mutation. Non-JSON reads retain
// original KV semantics and therefore add one real read by design.
const mutable = await y5.cachedEnv.LESSONS_KV.get('lesson:Y5M1', { type: 'json' });
mutable.title = 'Mutated';
const again = await y5.cachedEnv.LESSONS_KV.get('lesson:Y5M1', { type: 'json' });
assert.equal(again.title, 'Real Y5M1');
assert.equal(y5.stats.reads, 2);
await y5.cachedEnv.LESSONS_KV.get('lesson:Y5M1');
assert.equal(y5.stats.reads, 3);

assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/home')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/views/maths-year5/lessons')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/lessons/Y5M1?viewId=maths-year5')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/resources/Y5M1~video~1/video?viewId=maths-year5')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/resources/Y5M1~p11elevenother~1?viewId=maths-level2')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/session')), false);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/home', { method: 'POST' })), false);

console.log('Phase 11 live curriculum + lesson metadata authority verification: PASS');
