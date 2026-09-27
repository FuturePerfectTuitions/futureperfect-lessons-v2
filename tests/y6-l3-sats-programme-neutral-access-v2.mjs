import assert from 'node:assert/strict';
import { compileCatalogueReadModel } from '../rebuild/shared/read-models/catalogue.mjs';
import { compileAccessScopeV2 } from '../rebuild/adminops/src/lib/access-compiler-v2.mjs';

const asOfDate = '2026-09-27';
const definitions = [
  { batch_key:'Y611FM', subject:'maths', school_year:6, stream:'normal', maths_level:null, active_from:'2026-09-01', active_to:null },
  { batch_key:'Y511FM', subject:'maths', school_year:6, stream:'11plus', maths_level:3, active_from:'2026-09-01', active_to:null }
];
const catalogue = compileCatalogueReadModel({
  sourceType:'programme-neutral-v2-test',
  curricula:{
    MATHS_L3:{ lessonIds:['Y6M50'] },
    MATHS_Y6_EXTRA:{ lessonIds:['Y6M50','Y6M51','Y6M52'] }
  },
  lessons:{
    Y6M50:{ lessonId:'Y6M50', title:'Shared curriculum lesson', order:50, active:true },
    Y6M51:{ lessonId:'Y6M51', title:'SATS 1', order:51, active:true },
    Y6M52:{ lessonId:'Y6M52', title:'SATS 2', order:52, active:true }
  }
});

function assignment(batchKey) {
  const definition = definitions.find(row => row.batch_key === batchKey);
  return { ...definition, effective_from:'2026-09-01', effective_to:null, batch_active_from:'2026-09-01', batch_active_to:null };
}
function compile({ currentBatch, entitlements=[], pre=[] }) {
  return compileAccessScopeV2({
    asOfDate,
    user:{ name:'Fixture', batches:[currentBatch], upsellViews:[] },
    batchDefinitions:definitions,
    batchAssignments:[assignment(currentBatch)],
    entitlements,
    onlinePreLessonEntitlements:pre
  }, catalogue, { scopeId:'fixture', asOfDate });
}
function currentMaths(payload) {
  return payload.snapshot.views.filter(v => v.subject === 'maths' && v.current && !v.lockedPreview)
    .map(v => `${v.viewId}:${v.label}:${v.openLessonCount}`).sort();
}

const l3SatsFromNormalBatch = compile({
  currentBatch:'Y511FM',
  entitlements:[{ lesson_id:'Y6M51', core_access:1, source:'excel', source_batch_code:'Y611FM', source_lesson_date:asOfDate }]
});
assert.deepEqual(currentMaths(l3SatsFromNormalBatch), ['maths-level3:L3:0','maths-sats:SATS:1']);
assert.equal(l3SatsFromNormalBatch.snapshot.lessonAccess.Y6M51.core, true);

const l3OldNormalLesson = compile({
  currentBatch:'Y511FM',
  entitlements:[{ lesson_id:'Y6M50', core_access:1, source:'excel', source_batch_code:'Y611FM', source_lesson_date:asOfDate }]
});
assert.deepEqual(currentMaths(l3OldNormalLesson), ['maths-level3:L3:1']);
assert.equal(l3OldNormalLesson.snapshot.lessonAccess.Y6M50.core, true);

const l3PreSatsFromNormalBatch = compile({
  currentBatch:'Y511FM',
  pre:[{ lesson_id:'Y6M52', batch_key:'Y611FM', lesson_date:asOfDate }]
});
assert.deepEqual(currentMaths(l3PreSatsFromNormalBatch), ['maths-level3:L3:0','maths-sats:SATS:1']);
assert.equal(l3PreSatsFromNormalBatch.snapshot.lessonAccess.Y6M52.preLessonOnly, true);

console.log('Y6_L3_SATS_PROGRAMME_NEUTRAL_ACCESS_V2_PASS');
