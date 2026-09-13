import assert from 'node:assert/strict';
import {
  compileGlobalScope,
  compileAccessScope,
  compileLessonDetail,
  globalToCatalogue
} from '../rebuild/adminops/src/lib/compiler.mjs';
import {
  MemoryStore,
  stableStringify,
  sha256Hex,
  pointerKey,
  versionKey,
  publishScopeAtomic,
  resolveCurrentScope
} from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const catalogueInput = {
  curricula: {
    MATHS_Y2: { lessonIds: ['Y2A'] },
    MATHS_Y3: { lessonIds: ['Y3A'] },
    MATHS_L1: { lessonIds: ['L1A', 'L1B'] },
    MATHS_L2: { lessonIds: ['L2A', 'L2B'] },
    MATHS_L3: { lessonIds: ['L3A'] },
    MATHS_Y6_EXTRA: { lessonIds: ['Y6X1'] },
    ENGLISH_Y2: { lessonIds: ['E2A'] },
    ENGLISH_Y3: { lessonIds: ['E3A'] },
    ENGLISH_Y4: { lessonIds: ['E4A'] },
    ENGLISH_Y5: { lessonIds: ['E5A', 'E5B'] },
    ENGLISH_Y6: { lessonIds: ['E6A'] }
  },
  lessons: {
    Y2A: { lessonId: 'Y2A', title: 'Y2A Numbers', order: 1, active: true },
    Y3A: { lessonId: 'Y3A', title: 'Y3A Numbers', order: 1, active: true },
    L1A: { lessonId: 'L1A', title: 'L1A Place Value', order: 1, active: true },
    L1B: { lessonId: 'L1B', title: 'L1B Arithmetic', order: 2, active: true },
    L2A: { lessonId: 'L2A', title: 'L2A Fractions', order: 1, active: true },
    L2B: { lessonId: 'L2B', title: 'L2B Decimals', order: 2, active: true },
    L3A: { lessonId: 'L3A', title: 'L3A Ratio', order: 1, active: true },
    Y6X1: { lessonId: 'Y6X1', title: 'Y6X1 SATs Preparation', order: 50, active: true },
    E2A: { lessonId: 'E2A', title: 'E2A Grammar', order: 1, active: true },
    E3A: { lessonId: 'E3A', title: 'E3A Grammar', order: 1, active: true },
    E4A: { lessonId: 'E4A', title: 'E4A Comprehension', order: 1, active: true },
    E5A: { lessonId: 'E5A', title: 'E5A Comprehension', order: 1, active: true },
    E5B: { lessonId: 'E5B', title: 'E5B Vocabulary', order: 2, active: true },
    E6A: { lessonId: 'E6A', title: 'E6A Grammar', order: 1, active: true }
  }
};

const globalA = compileGlobalScope(catalogueInput, {
  sourceType: 'synthetic-checkpoint3-fixture',
  sourceRevision: 'fixture-a'
});
assert.equal(globalA.kind, 'prepared-global-read-model');
assert.equal(globalA.navigation.length, 15);
assert.equal(globalA.counts['maths-year6'], 2);
assert.equal(JSON.stringify(globalA).includes('r2Key'), false);

const catalogue = globalToCatalogue(globalA);
const access = compileAccessScope({
  asOfDate: '2026-09-13',
  user: {
    firstName: 'Synthetic',
    loginPassword: 'DO_NOT_COPY',
    answerPassword: 'DO_NOT_COPY',
    fullLibraries: ['MATHS_L2_FULL'],
    blockedLessons: ['L2B'],
    manualAccess: { coreLessons: ['L1B'], specialBuckets: ['VR_HOWTO'] },
    upsellViews: ['english-year5-11plus']
  },
  batchAssignments: [
    { batch_key: 'Y4-OLD', subject: 'maths', school_year: 4, stream: 'normal', effective_from: '2025-09-01', effective_to: '2026-07-31' },
    { batch_key: 'Y5-NOW', subject: 'maths', school_year: 5, stream: 'normal', effective_from: '2026-09-01', effective_to: null },
    { batch_key: 'L2-NOW', subject: 'maths', school_year: 5, stream: '11plus', maths_level: 2, effective_from: '2026-09-01', effective_to: null }
  ],
  batchDefinitions: [
    { batch_key: 'Y4-OLD', subject: 'maths', school_year: 4, stream: 'normal' },
    { batch_key: 'Y5-NOW', subject: 'maths', school_year: 5, stream: 'normal' },
    { batch_key: 'L2-NOW', subject: 'maths', school_year: 5, stream: '11plus', maths_level: 2 }
  ],
  entitlements: [
    { lesson_id: 'L1A', core_access: 1, source_batch_code: 'Y4-OLD' },
    { lesson_id: 'L2A', core_access: 1, vr_access: 1, source_batch_code: 'L2-NOW' }
  ],
  onlinePreLessonEntitlements: []
}, catalogue, { scopeId: 'synthetic-access-001', asOfDate: '2026-09-13' });
assert.equal(access.kind, 'prepared-access-read-model');
assert.equal(access.snapshot.lessonAccess.L2B.blocked, true);
assert.equal(JSON.stringify(access).includes('DO_NOT_COPY'), false);

const lessonRecord = {
  lessonId: 'L2A',
  title: 'Fractions',
  preLessonSheets: [{ displayName: 'PreLesson Sheet', r2Key: 'maths/L2A/pre.pdf' }],
  homeworks: [{
    homework: { displayName: 'Homework', r2Key: 'maths/L2A/homework.pdf' },
    answerPack: { displayName: 'Answer Pack', r2Key: 'maths/L2A/answers.pdf' }
  }]
};
const existing = new Set(['maths/L2A/pre.pdf', 'maths/L2A/homework.pdf', 'maths/L2A/answers.pdf']);
const detail = await compileLessonDetail(lessonRecord, {
  resourceExists: async key => existing.has(key)
});
assert.equal(detail.resourceCount, 3);
assert.equal(detail.resources.find(row => row.type === 'answer-pack').protected, true);

await assert.rejects(
  compileLessonDetail(lessonRecord, { resourceExists: async key => key !== 'maths/L2A/answers.pdf' }),
  /RESOURCE_MISSING:L2A:maths\/L2A\/answers.pdf/
);

const store = new MemoryStore();
const publishedA = await publishScopeAtomic(store, {
  scope: 'global', payload: globalA, version: 'version-a', updatedAt: '2026-09-13T12:00:00Z'
});
assert.equal((await resolveCurrentScope(store, 'global')).version, 'version-a');
const pointerAfterA = store.raw(pointerKey('global'));

const globalB = structuredClone(globalA);
globalB.source.revision = 'fixture-b';
globalB.counts['maths-year6'] = 3;
const hashB1 = await sha256Hex(stableStringify(globalB));
const hashB2 = await sha256Hex(stableStringify(structuredClone(globalB)));
assert.equal(hashB1, hashB2, 'Canonical prepared output must hash deterministically.');

await assert.rejects(
  publishScopeAtomic(store, {
    scope: 'global', payload: globalB, version: 'version-b-failed', failAfterCandidate: true,
    updatedAt: '2026-09-13T12:01:00Z'
  }),
  /CHECKPOINT3_INJECTED_FAILURE_AFTER_CANDIDATE/
);
assert.equal(store.raw(pointerKey('global')), pointerAfterA, 'Failure before pointer must leave the complete previous state live.');
assert.equal((await resolveCurrentScope(store, 'global')).version, 'version-a');
assert.ok(store.raw(versionKey('global', 'version-b-failed')), 'An unreachable orphan candidate is safe.');

// A compiler failure is even earlier: no candidate or pointer operation occurs.
await assert.rejects(
  compileLessonDetail(lessonRecord, { resourceExists: async () => false }),
  /RESOURCE_MISSING/
);
assert.equal(store.raw(pointerKey('global')), pointerAfterA);

const publishedB = await publishScopeAtomic(store, {
  scope: 'global', payload: globalB, version: 'version-b', updatedAt: '2026-09-13T12:02:00Z'
});
assert.equal(publishedB.previousVersion, 'version-a');
let resolved = await resolveCurrentScope(store, 'global');
assert.equal(resolved.version, 'version-b');
assert.equal(resolved.usedFallback, false);

// Simulate KV propagation skew: pointer visible at an edge before the new immutable value.
store.hide(versionKey('global', 'version-b'));
resolved = await resolveCurrentScope(store, 'global');
assert.equal(resolved.version, 'version-a');
assert.equal(resolved.usedFallback, true);
store.show(versionKey('global', 'version-b'));
resolved = await resolveCurrentScope(store, 'global');
assert.equal(resolved.version, 'version-b');
assert.equal(resolved.usedFallback, false);

console.log(JSON.stringify({
  marker: 'REBUILD_CHECKPOINT3_ATOMIC_PUBLISHING_PASS',
  preparedViews: globalA.navigation.length,
  accessViews: access.snapshot.views.length,
  validatedResources: detail.resourceCount,
  firstVersion: publishedA.version,
  secondVersion: publishedB.version,
  propagationFallbackVerified: true,
  failedPublicationPointerUnchanged: true
}));
