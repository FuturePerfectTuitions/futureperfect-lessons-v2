import assert from 'node:assert/strict';
import { normaliseCsvRow } from '../worker/src/admin-lesson-release-import.js';
import { compileGlobalScope } from '../rebuild/adminops/src/lib/compiler.mjs';
import { MemoryStore, pointerKey } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';
import {
  opaqueAccessScopeId,
  publishCompiledAccess,
  runDualWriteCompatibility,
  releaseParity
} from '../rebuild/adminops/src/lib/compatibility.mjs';

const catalogueInput = {
  curricula: {
    MATHS_Y2: { lessonIds: ['Y2A'] },
    MATHS_Y3: { lessonIds: ['Y3A'] },
    MATHS_L1: { lessonIds: ['L1A'] },
    MATHS_L2: { lessonIds: ['L2A', 'L2B'] },
    MATHS_L3: { lessonIds: ['L3A'] },
    MATHS_Y6_EXTRA: { lessonIds: ['Y6X1'] },
    ENGLISH_Y2: { lessonIds: ['E2A'] },
    ENGLISH_Y3: { lessonIds: ['E3A'] },
    ENGLISH_Y4: { lessonIds: ['E4A'] },
    ENGLISH_Y5: { lessonIds: ['E5A'] },
    ENGLISH_Y6: { lessonIds: ['E6A'] }
  },
  lessons: Object.fromEntries([
    ['Y2A','Y2 Numbers'],['Y3A','Y3 Numbers'],['L1A','L1 Place Value'],
    ['L2A','L2 Fractions'],['L2B','L2 Decimals'],['L3A','L3 Ratio'],
    ['Y6X1','Y6 SATs'],['E2A','E2 Grammar'],['E3A','E3 Grammar'],
    ['E4A','E4 Comprehension'],['E5A','E5 Comprehension'],['E6A','E6 Grammar']
  ].map(([lessonId,title], index) => [lessonId, { lessonId, title, active:true, order:index + 1 }]))
};
const global = compileGlobalScope(catalogueInput, {
  sourceType: 'checkpoint4-synthetic', sourceRevision: 'fixture-v1'
});

function csv(status, mode='Y5M') {
  return normaliseCsvRow({
    Student: 'CompatUser',
    Mode: mode,
    Lesson: 'L2A Fractions',
    LessonDated: '13/09/2026',
    LessonStatus: status,
    Remarks: ''
  }, 0);
}

assert.equal(csv('Completed').releaseType, 'FULL');
assert.equal(csv('Continuing').releaseType, 'FULL');
assert.equal(csv('Continue').releaseType, 'FULL');
assert.equal(csv('Working').releaseType, 'SKIP');
assert.equal(csv('Working', 'Y5MO').releaseType, 'PRELESSON_ONLY');

const portalUserIdNorm = 'compatuser';
const scopeSecret = 'checkpoint4-synthetic-scope-secret';
const scopeId = await opaqueAccessScopeId(portalUserIdNorm, scopeSecret);
assert.ok(scopeId.startsWith('u-'));
assert.equal(scopeId.includes(portalUserIdNorm), false);

const legacy = {
  user: { firstName:'Synthetic', fullLibraries:[], manualAccess:{ coreLessons:[], vrLessons:[], specialBuckets:[] } },
  assignments: [{
    portal_user_id_norm: portalUserIdNorm,
    batch_key:'Y5M-COMPAT', subject:'maths', school_year:5, stream:'normal', maths_level:null,
    effective_from:'2026-09-01', effective_to:null
  }],
  definitions: [{
    batch_key:'Y5M-COMPAT', subject:'maths', school_year:5, stream:'normal', maths_level:null
  }],
  entitlements: [],
  prelessons: []
};

function accessInput() {
  return {
    asOfDate:'2026-09-13',
    user:structuredClone(legacy.user),
    batchAssignments:structuredClone(legacy.assignments),
    batchDefinitions:structuredClone(legacy.definitions),
    entitlements:structuredClone(legacy.entitlements),
    onlinePreLessonEntitlements:structuredClone(legacy.prelessons)
  };
}

const reconciliation = [];
const store = new MemoryStore();
const record = async row => reconciliation.push(structuredClone(row));

const completed = await runDualWriteCompatibility({
  operationId:'completed-release', portalUserIdNorm, scopeSecret,
  readModelStore:store, globalReadModel:global, asOfDate:'2026-09-13',
  legacyWrite:async () => {
    legacy.entitlements = [{ lesson_id:'L2A', core_access:1, vr_access:0, source_batch_code:'Y5M-COMPAT' }];
    legacy.prelessons = [];
    return { ok:true, accessMode:'full', status:'CREATED' };
  },
  loadAccessInput:async () => accessInput(), recordReconciliation:record,
  updatedAt:'2026-09-13T13:30:00Z'
});
assert.equal(completed.legacyApplied, true);
assert.equal(completed.shadowApplied, true);
assert.equal(completed.reconciliationRequired, false);
assert.equal(completed.shadow.compiled.snapshot.lessonAccess.L2A.core, true);
assert.equal(completed.shadow.compiled.snapshot.lessonAccess.L2A.preLessonOnly, false);
assert.equal(reconciliation.at(-1).status, 'SYNCED');

const parityFull = releaseParity(
  'L2A',
  { full:{ core_access:1 }, prelesson:null },
  completed.shadow.compiled
);
assert.equal(parityFull.match, true);

const duplicate = await runDualWriteCompatibility({
  operationId:'completed-release-duplicate', portalUserIdNorm, scopeSecret,
  readModelStore:store, globalReadModel:global, asOfDate:'2026-09-13',
  legacyWrite:async () => ({ ok:true, accessMode:'full', status:'CONFIRMED' }),
  loadAccessInput:async () => accessInput(), recordReconciliation:record,
  updatedAt:'2026-09-13T13:31:00Z'
});
assert.equal(duplicate.shadow.status, 'UNCHANGED');
assert.equal(duplicate.shadow.payloadSha256, completed.shadow.payloadSha256);

legacy.entitlements = [];
legacy.prelessons = [{ lesson_id:'L2B', batch_key:'Y5M-COMPAT', lesson_date:'2026-09-14', vr_access:0 }];
const prelesson = await runDualWriteCompatibility({
  operationId:'online-prelesson-release', portalUserIdNorm, scopeSecret,
  readModelStore:store, globalReadModel:global, asOfDate:'2026-09-13',
  legacyWrite:async () => ({ ok:true, accessMode:'prelesson', status:'CREATED' }),
  loadAccessInput:async () => accessInput(), recordReconciliation:record,
  updatedAt:'2026-09-13T13:32:00Z'
});
assert.equal(prelesson.shadow.compiled.snapshot.lessonAccess.L2B.core, false);
assert.equal(prelesson.shadow.compiled.snapshot.lessonAccess.L2B.preLessonOnly, true);
assert.equal(releaseParity('L2B', { full:null, prelesson:{ lesson_id:'L2B' } }, prelesson.shadow.compiled).match, true);

legacy.prelessons = [];
legacy.user.manualAccess.coreLessons = ['L2A'];
const manual = await runDualWriteCompatibility({
  operationId:'manual-release', portalUserIdNorm, scopeSecret,
  readModelStore:store, globalReadModel:global, asOfDate:'2026-09-13',
  legacyWrite:async () => ({ ok:true, accessMode:'manual-core', status:'CREATED' }),
  loadAccessInput:async () => accessInput(), recordReconciliation:record,
  updatedAt:'2026-09-13T13:33:00Z'
});
assert.equal(manual.shadow.compiled.snapshot.lessonAccess.L2A.core, true);
assert.deepEqual(manual.shadow.compiled.snapshot.lessonAccess.L2A.sources, ['manual']);

legacy.user.blockedLessons = ['L2A'];
const blocked = await publishCompiledAccess({
  readModelStore:store, globalReadModel:global, accessInput:accessInput(),
  portalUserIdNorm, scopeSecret, operationId:'blocked-override', asOfDate:'2026-09-13',
  updatedAt:'2026-09-13T13:34:00Z'
});
assert.equal(blocked.compiled.snapshot.lessonAccess.L2A.blocked, true);
assert.equal(blocked.compiled.snapshot.lessonAccess.L2A.core, false);
legacy.user.blockedLessons = [];

// Re-establish a complete previous version, then prove a shadow failure cannot
// corrupt it and cannot roll back the already-authoritative legacy write.
legacy.user.manualAccess.coreLessons = [];
legacy.entitlements = [];
const baseline = await publishCompiledAccess({
  readModelStore:store, globalReadModel:global, accessInput:accessInput(),
  portalUserIdNorm, scopeSecret, operationId:'failure-baseline', asOfDate:'2026-09-13',
  updatedAt:'2026-09-13T13:35:00Z'
});
const accessScope = baseline.scope;
const pointerBeforeFailure = store.raw(pointerKey(accessScope));

const failedShadow = await runDualWriteCompatibility({
  operationId:'release-with-shadow-failure', portalUserIdNorm, scopeSecret,
  readModelStore:store, globalReadModel:global, asOfDate:'2026-09-13',
  legacyWrite:async () => {
    legacy.entitlements = [{ lesson_id:'L2A', core_access:1, vr_access:0, source_batch_code:'Y5M-COMPAT' }];
    return { ok:true, accessMode:'full', status:'CREATED' };
  },
  loadAccessInput:async () => accessInput(), recordReconciliation:record,
  failShadowAfterCandidate:true, updatedAt:'2026-09-13T13:36:00Z'
});
assert.equal(failedShadow.legacyApplied, true);
assert.equal(failedShadow.shadowApplied, false);
assert.equal(failedShadow.reconciliationRequired, true);
assert.equal(legacy.entitlements[0].lesson_id, 'L2A');
assert.equal(store.raw(pointerKey(accessScope)), pointerBeforeFailure);
assert.equal(reconciliation.at(-1).status, 'RECONCILE_REQUIRED');

const storedText = [...store.values.entries()].map(([key, value]) => `${key}\n${value}`).join('\n');
assert.equal(storedText.includes(portalUserIdNorm), false, 'Raw Portal User ID must not leak into read-model keys/payloads.');
assert.equal(storedText.includes('password'), false);

console.log(JSON.stringify({
  marker:'REBUILD_CHECKPOINT4_DUAL_WRITE_COMPATIBILITY_PASS',
  completedFullRelease:true,
  continuingFullRelease:true,
  onlinePrelessonOnly:true,
  duplicateIdempotent:true,
  manualRelease:true,
  blockedOverride:true,
  opaqueAccessScope:true,
  failedShadowLeavesLegacyAuthoritative:true,
  reconciliationMarker:true
}));
