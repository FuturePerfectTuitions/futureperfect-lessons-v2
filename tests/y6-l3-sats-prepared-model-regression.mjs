import assert from 'node:assert/strict';
import { compileCatalogueReadModel } from '../rebuild/shared/read-models/catalogue.mjs';
import { compileAccessSnapshot } from '../rebuild/shared/read-models/access-snapshot.mjs';
import { prepareAccessInputForParity, authoritativeBatchViewId } from '../rebuild/adminops/src/lib/backfill-parity-audit.mjs';

const asOfDate = '2026-09-27';
const batchDefinitions = [
  { batch_key: 'Y611FM', subject: 'maths', school_year: 6, stream: 'normal', maths_level: null, active_from: '2026-09-01', active_to: null },
  { batch_key: 'Y511FM', subject: 'maths', school_year: 6, stream: '11plus', maths_level: 3, active_from: '2026-09-01', active_to: null }
];
const catalogue = compileCatalogueReadModel({
  sourceType: 'y6-l3-sats-regression',
  curricula: {
    MATHS_L3: { lessonIds: ['L3T1M01'] },
    MATHS_Y6_EXTRA: { lessonIds: ['Y6M50', 'Y6M51', 'Y6M52'] }
  },
  lessons: {
    L3T1M01: { lessonId: 'L3T1M01', title: 'Core L3', order: 1, active: true },
    Y6M50: { lessonId: 'Y6M50', title: 'Normal Year 6 extra', order: 50, active: true },
    Y6M51: { lessonId: 'Y6M51', title: 'SATS 1', order: 51, active: true },
    Y6M52: { lessonId: 'Y6M52', title: 'SATS 2', order: 52, active: true }
  }
});

const defs = new Map(batchDefinitions.map(row => [row.batch_key, row]));
assert.equal(authoritativeBatchViewId('Y611FM', defs), 'maths-year6', 'D1 must override legacy Y611FM=>L3 heuristic');
assert.equal(authoritativeBatchViewId('Y511FM', defs), 'maths-level3', 'D1 must override legacy Y511FM=>L2 heuristic');
assert.equal(authoritativeBatchViewId('Y611M', defs), 'maths-level3', 'undefined legacy batch must retain compatibility fallback');

assert.equal(catalogue.views['maths-year6'].label, 'Lessons');
assert.equal(catalogue.views['maths-level3'].label, 'L3');
assert.equal(catalogue.views['maths-sats'].label, 'SATS');
assert.deepEqual(catalogue.views['maths-year6'].lessons.map(x => x.lessonId), ['L3T1M01', 'Y6M50']);
assert.deepEqual(catalogue.views['maths-sats'].lessons.map(x => x.lessonId), ['Y6M51', 'Y6M52']);

function compile({ batch, profileBatch = batch, entitlements = [], pre = [], fullLibraries = [], historicalViews = [] }) {
  const definition = batchDefinitions.find(row => row.batch_key === batch);
  assert.ok(definition, `missing fixture definition ${batch}`);
  const input = {
    asOfDate,
    user: { firstName: 'Fixture', batches: [profileBatch], fullLibraries, historicalViews, upsellViews: [] },
    batchDefinitions,
    batchAssignments: [{ ...definition, effective_from: '2026-09-01', effective_to: null, batch_active_from: '2026-09-01', batch_active_to: null }],
    entitlements,
    onlinePreLessonEntitlements: pre
  };
  const normalized = prepareAccessInputForParity(input, catalogue, { asOfDate });
  return compileAccessSnapshot(normalized, catalogue, { asOfDate });
}
function currentMaths(snapshot) {
  return snapshot.views.filter(v => v.subject === 'maths' && v.current && !v.lockedPreview).map(v => `${v.viewId}:${v.label}:${v.openLessonCount}`).sort();
}
function assertNoY6L3Collision(snapshot) {
  const ids = new Set(snapshot.views.filter(v => v.current && v.subject === 'maths').map(v => v.viewId));
  assert.equal(ids.has('maths-year6') && ids.has('maths-level3'), false, 'same student must never have current Year 6 and L3 teaching cards');
}

const normalNoSats = compile({ batch: 'Y611FM' });
assert.deepEqual(currentMaths(normalNoSats), ['maths-year6:Lessons:0']);
assertNoY6L3Collision(normalNoSats);

const normalWithSats = compile({
  batch: 'Y611FM',
  entitlements: [{ lesson_id: 'Y6M51', core_access: 1, vr_access: 0, source: 'excel', source_batch_code: 'Y611FM', source_lesson_date: asOfDate }]
});
assert.deepEqual(currentMaths(normalWithSats), ['maths-sats:SATS:1', 'maths-year6:Lessons:0']);
assert.equal(normalWithSats.lessonAccess.Y6M51.core, true);
assertNoY6L3Collision(normalWithSats);

const l3NoSats = compile({ batch: 'Y511FM' });
assert.deepEqual(currentMaths(l3NoSats), ['maths-level3:L3:0']);
assertNoY6L3Collision(l3NoSats);

const l3WithSats = compile({
  batch: 'Y511FM',
  entitlements: [{ lesson_id: 'Y6M52', core_access: 1, vr_access: 0, source: 'manual', source_batch_code: 'Y511FM', source_lesson_date: asOfDate }]
});
assert.deepEqual(currentMaths(l3WithSats), ['maths-level3:L3:0', 'maths-sats:SATS:1']);
assertNoY6L3Collision(l3WithSats);

const normalPreLessonSats = compile({
  batch: 'Y611FM',
  pre: [{ lesson_id: 'Y6M51', batch_key: 'Y611FM', lesson_date: asOfDate }]
});
assert.deepEqual(currentMaths(normalPreLessonSats), ['maths-sats:SATS:1', 'maths-year6:Lessons:0']);
assert.equal(normalPreLessonSats.lessonAccess.Y6M51.preLessonOnly, true);
assertNoY6L3Collision(normalPreLessonSats);

const fullLibraryOnly = compile({ batch: 'Y611FM', fullLibraries: ['MATHS_Y6_FULL'] });
const fullById = new Map(fullLibraryOnly.views.map(v => [v.viewId, v]));
assert.equal(fullById.has('maths-sats'), false, 'MATHS_Y6_FULL must not create SATS card');
assert.equal(fullLibraryOnly.lessonAccess.Y6M51, undefined, 'MATHS_Y6_FULL must not open SATS lessons');
assert.equal(fullLibraryOnly.lessonAccess.L3T1M01.core, true, 'ordinary Year 6 full-library access must be preserved');
assert.equal(fullLibraryOnly.lessonAccess.Y6M50.core, true, 'ordinary Year 6 extra full-library access must be preserved');
assertNoY6L3Collision(fullLibraryOnly);

const historical = compile({ batch: 'Y611FM', historicalViews: ['maths-year5'], fullLibraries: ['MATHS_Y5_FULL'] });
assert.ok(historical.views.some(v => v.viewId === 'maths-year5'), 'legitimate historical/full-library view must remain visible');
assertNoY6L3Collision(historical);

console.log(JSON.stringify({
  marker: 'Y6_L3_SATS_PREPARED_MODEL_REGRESSION_PASS',
  scenarios: 7,
  normalWithSats: currentMaths(normalWithSats),
  l3WithSats: currentMaths(l3WithSats)
}));