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
  validBundledManifest,
  phase11NavigationEnv,
  shouldPrefetchPhase11Navigation
} = navigation;

assert.equal(PHASE11_CURRICULUM_CODES.length, 11);
assert.equal(PHASE11_CATALOGUE_SHA256, manifest.catalogueSha256);
assert.equal(validBundledManifest(manifest), true);
assert.equal(validBundledManifest(null), false);
assert.equal(validBundledManifest({ ...manifest, catalogueSha256: 'wrong' }), false);

const y5Ids = manifest.curricula.MATHS_L2.lessonIds;
const y2Ids = manifest.curricula.MATHS_Y2.lessonIds;
assert.ok(y5Ids.includes('Y5M1'));
assert.ok(y2Ids.includes('Y2M1'));

function makeEnv() {
  const stats = { reads: 0, keys: [] };
  const store = new Map([
    ['lesson:Y5M1', {
      ...manifest.lessons.Y5M1,
      title: 'Real Y5M1',
      description: 'Real detail description',
      core: { homeworks: [] }
    }]
  ]);
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
  return { env: { LESSONS_KV: namespace, marker: 'keep' }, stats };
}

async function accelerated(url) {
  const { env, stats } = makeEnv();
  const cachedEnv = await phase11NavigationEnv(env, new Request(url));
  assert.equal(cachedEnv.marker, 'keep');
  return { cachedEnv, stats };
}

// Core Phase 11 performance invariant: home and catalogue-list navigation use
// the canonical Worker-bundled manifest and consume zero LESSONS_KV gets.
const home = await accelerated('https://example.test/api/v1/student/home');
assert.equal(home.stats.reads, 0, 'Home navigation must use zero LESSONS_KV gets.');
const homeCurriculum = await home.cachedEnv.LESSONS_KV.get('curriculum:MATHS_L2', { type: 'json' });
const homeLesson = await home.cachedEnv.LESSONS_KV.get('lesson:Y5M1', { type: 'json' });
assert.equal(home.stats.reads, 0);
assert.equal(homeCurriculum.curriculumCode, 'MATHS_L2');
assert.equal(homeLesson.title, manifest.lessons.Y5M1.title);
assert.equal(homeLesson.order, manifest.lessons.Y5M1.order);

const y5 = await accelerated('https://example.test/api/v1/student/views/maths-year5/lessons');
assert.equal(y5.stats.reads, 0, 'Known Year/Level catalogue navigation must use zero LESSONS_KV gets.');
const y5Lesson = await y5.cachedEnv.LESSONS_KV.get('lesson:Y5M1', { type: 'json' });
assert.equal(y5.stats.reads, 0);
assert.deepEqual(y5Lesson.displayIds, manifest.lessons.Y5M1.displayIds);

// An unknown view is still safe: the complete immutable Phase 11 navigation
// manifest is bundled, so no full-catalogue KV fallback is required.
const unknown = await accelerated('https://example.test/api/v1/student/views/future-view/lessons');
assert.equal(unknown.stats.reads, 0, 'Unknown view probes must not fan out across catalogue KV.');

// Opening a real lesson/resource loads exactly that target full record once;
// all downstream repeated JSON gets for that target are served from request cache.
const detail = await accelerated('https://example.test/api/v1/student/lessons/Y5M1?viewId=maths-year5');
assert.equal(detail.stats.reads, 1);
assert.deepEqual(detail.stats.keys, ['lesson:Y5M1']);
const detailTarget = await detail.cachedEnv.LESSONS_KV.get('lesson:Y5M1', { type: 'json' });
assert.equal(detailTarget.title, 'Real Y5M1');
assert.equal(detailTarget.description, 'Real detail description');
assert.equal(detail.stats.reads, 1);

const video = await accelerated('https://example.test/api/v1/student/resources/Y5M1~video~1/video?viewId=maths-level2');
assert.equal(video.stats.reads, 1);
assert.deepEqual(video.stats.keys, ['lesson:Y5M1']);

const other = await accelerated('https://example.test/api/v1/student/resources/Y5M1~p11elevenother~1?viewId=maths-level2');
assert.equal(other.stats.reads, 1);
assert.deepEqual(other.stats.keys, ['lesson:Y5M1']);

// Cached values remain isolated from downstream mutation. Non-JSON reads keep
// original KV semantics and therefore count as a real read by design.
const mutable = await y5.cachedEnv.LESSONS_KV.get('lesson:Y5M1', { type: 'json' });
mutable.title = 'Mutated';
const again = await y5.cachedEnv.LESSONS_KV.get('lesson:Y5M1', { type: 'json' });
assert.equal(again.title, manifest.lessons.Y5M1.title);
assert.equal(y5.stats.reads, 0);
await y5.cachedEnv.LESSONS_KV.get('lesson:Y5M1');
assert.equal(y5.stats.reads, 1);

assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/home')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/views/maths-year5/lessons')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/lessons/Y5M1?viewId=maths-year5')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/resources/Y5M1~video~1/video?viewId=maths-year5')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/resources/Y5M1~p11elevenother~1?viewId=maths-level2')), true);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/session')), false);
assert.equal(shouldPrefetchPhase11Navigation(new Request('https://example.test/api/v1/student/home', { method: 'POST' })), false);

console.log('Phase 11 bundled navigation manifest static verification: PASS');
