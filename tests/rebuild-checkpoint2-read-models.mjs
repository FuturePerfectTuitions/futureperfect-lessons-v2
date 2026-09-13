import assert from 'node:assert/strict';
import {
  VIEW_DEFINITIONS,
  VIEW_IDS,
  viewIdForBatch
} from '../rebuild/shared/read-models/view-registry.mjs';
import {
  compileCatalogueReadModel,
  assertMetadataOnlyCatalogue
} from '../rebuild/shared/read-models/catalogue.mjs';
import {
  compileAccessSnapshot,
  assertNoSensitiveSnapshotFields
} from '../rebuild/shared/read-models/access-snapshot.mjs';

const catalogueInput = {
  sourceType: 'synthetic-checkpoint2-fixture',
  sourceRevision: 'fixture-v1',
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
    L1A: {
      lessonId: 'L1A', title: 'L1A Place Value', order: 1, active: true,
      description: 'Safe description',
      displayIds: { 'maths-year4': 'Y4M01', 'maths-level1': 'L1T1M01' },
      core: { video: { embedUrl: 'https://example.invalid/private-video' } },
      homeworks: [{ r2Key: 'maths/private.pdf' }]
    },
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

const catalogue = compileCatalogueReadModel(catalogueInput);
assert.equal(catalogue.kind, 'prepared-catalogue');
assert.equal(VIEW_IDS.length, 15);
assert.equal(VIEW_DEFINITIONS['english-year2-11plus'], undefined);
assert.equal(VIEW_DEFINITIONS['english-year3-11plus'], undefined);
assert.equal(catalogue.views['maths-year6'].lessonCount, 2);
assert.equal(catalogue.views['maths-year4'].lessons[0].displayLessonId, 'Y4M01');
assert.equal(catalogue.views['maths-level1'].lessons[0].displayLessonId, 'L1T1M01');
assert.deepEqual(catalogue.lessonToViews.L1A, ['maths-year4', 'maths-level1']);
assertMetadataOnlyCatalogue(catalogue);
assert.equal(JSON.stringify(catalogue).includes('private-video'), false);
assert.equal(JSON.stringify(catalogue).includes('maths/private.pdf'), false);

const batchDefinitions = [
  { batch_key: 'Y4M-OLD', subject: 'maths', school_year: 4, stream: 'normal', maths_level: null },
  { batch_key: 'Y5M-NOW', subject: 'maths', school_year: 5, stream: 'normal', maths_level: null },
  { batch_key: 'Y5M11-NOW', subject: 'maths', school_year: 5, stream: '11plus', maths_level: 2 },
  { batch_key: 'Y5E-NOW', subject: 'english', school_year: 5, stream: 'normal', maths_level: null }
];
assert.equal(viewIdForBatch(batchDefinitions[1]), 'maths-year5');
assert.equal(viewIdForBatch(batchDefinitions[2]), 'maths-level2');

const snapshotInput = {
  asOfDate: '2026-09-13',
  user: {
    firstName: 'Synthetic',
    loginPassword: 'SHOULD_NOT_APPEAR',
    answerPassword: 'SHOULD_NOT_APPEAR',
    portalUserId: 'SHOULD_NOT_APPEAR',
    accountStatus: 'active',
    fullLibraries: ['MATHS_L2_FULL'],
    manualAccess: {
      coreLessons: ['L1B'],
      specialBuckets: ['VR_HOWTO']
    },
    blockedLessons: ['L2B'],
    upsellViews: ['english-year5-11plus']
  },
  batchDefinitions,
  batchAssignments: [
    {
      batch_key: 'Y4M-OLD', subject: 'maths', school_year: 4, stream: 'normal', maths_level: null,
      effective_from: '2025-09-01', effective_to: '2026-07-31'
    },
    {
      batch_key: 'Y5M-NOW', subject: 'maths', school_year: 5, stream: 'normal', maths_level: null,
      effective_from: '2026-09-01', effective_to: null
    },
    {
      batch_key: 'Y5M11-NOW', subject: 'maths', school_year: 5, stream: '11plus', maths_level: 2,
      effective_from: '2026-09-01', effective_to: null
    },
    {
      batch_key: 'Y5E-NOW', subject: 'english', school_year: 5, stream: 'normal', maths_level: null,
      effective_from: '2026-09-01', effective_to: null
    }
  ],
  entitlements: [
    { lesson_id: 'L1A', core_access: 1, vr_access: 0, source_batch_code: 'Y4M-OLD' },
    { lesson_id: 'E5A', core_access: 1, vr_access: 1, source_batch_code: 'Y5E-NOW' }
  ],
  onlinePreLessonEntitlements: [
    { lesson_id: 'E5B', batch_key: 'Y5E-NOW', vr_access: 0 }
  ]
};

const snapshot = compileAccessSnapshot(snapshotInput, catalogue);
assert.equal(snapshot.kind, 'prepared-access-snapshot');
assert.equal(snapshot.asOfDate, '2026-09-13');
assertNoSensitiveSnapshotFields(snapshot);
const byId = new Map(snapshot.views.map(view => [view.viewId, view]));
assert.equal(byId.get('maths-year5').current, true);
assert.equal(byId.get('maths-level2').current, true);
assert.equal(byId.get('english-year5').current, true);
assert.equal(byId.get('maths-year4').group, 'previous');
assert.equal(byId.get('maths-level1'), undefined, 'manual access to shared L1 curriculum must not widen into 11+');
assert.equal(byId.get('english-year5-11plus').lockedPreview, true);
assert.equal(byId.get('english-year5-11plus').openLessonCount, 0);
assert.equal(snapshot.lessonAccess.L2A.core, true, 'Full Library opens the view');
assert.equal(snapshot.lessonAccess.L2B.blocked, true, 'blocked override wins over Full Library');
assert.equal(snapshot.lessonAccess.L2B.core, false);
assert.equal(snapshot.lessonAccess.L1A.core, true);
assert.equal(snapshot.lessonAccess.L1B.core, true);
assert.equal(snapshot.lessonAccess.E5B.preLessonOnly, true);
assert.equal(snapshot.lessonAccess.E5B.core, false);
assert.deepEqual(snapshot.specialAreas, ['VR_HOWTO']);

const second = compileAccessSnapshot(structuredClone(snapshotInput), structuredClone(catalogue));
assert.equal(JSON.stringify(second), JSON.stringify(snapshot), 'Prepared read models must be deterministic.');
assert.equal(JSON.stringify(snapshot).includes('SHOULD_NOT_APPEAR'), false);

console.log(JSON.stringify({
  marker: 'REBUILD_CHECKPOINT2_READ_MODELS_PASS',
  views: VIEW_IDS.length,
  fixtureLessons: Object.keys(catalogue.lessonToViews).length,
  snapshotViews: snapshot.views.length,
  snapshotLessonAccessRows: Object.keys(snapshot.lessonAccess).length
}));
