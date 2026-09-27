import assert from 'node:assert/strict';
import {
  compileAuthoritativeAccessScope,
  normaliseAuthoritativeInput
} from '../worker/src/access-read-model-sync-v2.js';

const asOfDate = '2026-09-27';
const definitions = [
  { batch_key:'Y611FM', subject:'maths', school_year:6, stream:'normal', maths_level:null, active_from:'2026-09-01', active_to:null },
  { batch_key:'Y511FM', subject:'maths', school_year:6, stream:'11plus', maths_level:3, active_from:'2026-09-01', active_to:null }
];
const catalogue = {
  schemaVersion:1,
  kind:'prepared-catalogue',
  navigation:[],
  views:{
    'maths-year6':{ viewId:'maths-year6', label:'Lessons', lessonCount:2, lessons:[{lessonId:'Y6M50'},{lessonId:'COMMON1'}] },
    'maths-level3':{ viewId:'maths-level3', label:'L3', lessonCount:2, lessons:[{lessonId:'Y6M50'},{lessonId:'COMMON1'}] },
    'maths-sats':{ viewId:'maths-sats', label:'SATS', lessonCount:2, lessons:[{lessonId:'Y6M51'},{lessonId:'Y6M52'}] }
  },
  lessonToViews:{
    Y6M50:['maths-year6','maths-level3'],
    COMMON1:['maths-year6','maths-level3'],
    Y6M51:['maths-sats'],
    Y6M52:['maths-sats']
  }
};

function assignment(batchKey) {
  const definition = definitions.find(row => row.batch_key === batchKey);
  return {
    ...definition,
    portal_user_id_norm:'fixture',
    effective_from:'2026-09-01',
    effective_to:null,
    batch_active_from:'2026-09-01',
    batch_active_to:null
  };
}

function compile({ currentBatch, profileBatches=[currentBatch], entitlements=[], pre=[] }) {
  const input = {
    asOfDate,
    user:{ name:'Fixture', batches:profileBatches, upsellViews:[] },
    batchDefinitions:definitions,
    batchAssignments:[assignment(currentBatch)],
    entitlements,
    onlinePreLessonEntitlements:pre
  };
  return {
    input,
    payload:compileAuthoritativeAccessScope(input, catalogue, 'fixture-scope', asOfDate)
  };
}

function currentMaths(payload) {
  return payload.snapshot.views
    .filter(view => view.subject === 'maths' && view.current && !view.lockedPreview)
    .map(view => `${view.viewId}:${view.label}:${view.openLessonCount}`)
    .sort();
}

// Exact live root-cause shape: D1 says Y611FM = Year 6 while the legacy parser
// would call that same profile batch L3. D1 must win.
{
  const { payload } = compile({ currentBatch:'Y611FM' });
  assert.deepEqual(currentMaths(payload), ['maths-year6:Lessons:0']);
}

// A SATS release on normal Year 6 adds SATS only; it does not change teaching identity.
{
  const { payload } = compile({
    currentBatch:'Y611FM',
    entitlements:[{ lesson_id:'Y6M51', core_access:1, source:'excel', source_batch_code:'Y611FM', source_lesson_date:asOfDate }]
  });
  assert.deepEqual(currentMaths(payload), ['maths-sats:SATS:1','maths-year6:Lessons:0']);
  assert.equal(payload.snapshot.lessonAccess.Y6M51.core, true);
}

// Strong transfer/mixed-history invariant: current L3 + SATS whose audit source
// is a normal-Year6 batch remains L3 + SATS. SATS must never synthesize Year 6.
{
  const { payload } = compile({
    currentBatch:'Y511FM',
    entitlements:[{ lesson_id:'Y6M51', core_access:1, source:'excel', source_batch_code:'Y611FM', source_lesson_date:asOfDate }]
  });
  assert.deepEqual(currentMaths(payload), ['maths-level3:L3:0','maths-sats:SATS:1']);
  assert.equal(payload.snapshot.lessonAccess.Y6M51.core, true);
}

// Existing old-Year6 lesson access survives a transfer to L3 without becoming a
// second current teaching programme.
{
  const { payload } = compile({
    currentBatch:'Y511FM',
    entitlements:[{ lesson_id:'Y6M50', core_access:1, source:'excel', source_batch_code:'Y611FM', source_lesson_date:asOfDate }]
  });
  assert.deepEqual(currentMaths(payload), ['maths-level3:L3:1']);
  assert.equal(payload.snapshot.lessonAccess.Y6M50.core, true);
}

// Online PreLesson SATS has the same programme-neutral behaviour.
{
  const { payload } = compile({
    currentBatch:'Y511FM',
    pre:[{ lesson_id:'Y6M52', batch_key:'Y611FM', lesson_date:asOfDate }]
  });
  assert.deepEqual(currentMaths(payload), ['maths-level3:L3:0','maths-sats:SATS:1']);
  assert.equal(payload.snapshot.lessonAccess.Y6M52.preLessonOnly, true);
}

// A stale known profile batch for the opposite equivalent curriculum cannot
// compete with the current D1 programme.
{
  const { payload } = compile({
    currentBatch:'Y511FM',
    profileBatches:['Y511FM','Y611FM']
  });
  assert.deepEqual(currentMaths(payload), ['maths-level3:L3:0']);
}
{
  const { payload } = compile({
    currentBatch:'Y611FM',
    profileBatches:['Y611FM','Y511FM']
  });
  assert.deepEqual(currentMaths(payload), ['maths-year6:Lessons:0']);
}

// Known D1 profile batch with a temporarily absent assignment is interpreted by
// its D1 definition, never by regex. This preserves the old parity/backfill role.
{
  const input = {
    asOfDate,
    user:{ name:'Fixture', batches:['Y611FM'], upsellViews:[] },
    batchDefinitions:definitions,
    batchAssignments:[],
    entitlements:[],
    onlinePreLessonEntitlements:[]
  };
  const normalized = normaliseAuthoritativeInput(input, asOfDate);
  assert.equal(normalized.user.batches.length, 0);
  assert.equal(normalized.batchAssignments.length, 1);
  assert.equal(normalized.batchAssignments[0].stream, 'normal');
  const payload = compileAuthoritativeAccessScope(input, catalogue, 'fixture-scope', asOfDate);
  assert.deepEqual(currentMaths(payload), ['maths-year6:Lessons:0']);
}

console.log('ACCESS_READ_MODEL_SYNC_V2_VERIFICATION_PASS');
