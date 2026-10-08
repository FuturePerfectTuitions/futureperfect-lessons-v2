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

function assignment(batchKey, effectiveTo = null) {
  const definition = definitions.find(row => row.batch_key === batchKey);
  return {
    ...definition,
    portal_user_id_norm:'fixture',
    effective_from:'2026-09-01',
    effective_to:effectiveTo,
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
  return { input, payload:compileAuthoritativeAccessScope(input, catalogue, 'fixture-scope', asOfDate) };
}

function currentMaths(payload) {
  return payload.snapshot.views
    .filter(view => view.subject === 'maths' && view.current && !view.lockedPreview)
    .map(view => `${view.viewId}:${view.label}:${view.openLessonCount}`)
    .sort();
}

{
  const { payload } = compile({ currentBatch:'Y611FM' });
  assert.deepEqual(currentMaths(payload), ['maths-year6:Lessons:0']);
}
{
  const { payload } = compile({ currentBatch:'Y611FM', entitlements:[{ lesson_id:'Y6M51', core_access:1, source:'excel', source_batch_code:'Y611FM', source_lesson_date:asOfDate }] });
  assert.deepEqual(currentMaths(payload), ['maths-sats:SATS:1','maths-year6:Lessons:0']);
  assert.equal(payload.snapshot.lessonAccess.Y6M51.core, true);
}
{
  const { payload } = compile({ currentBatch:'Y511FM', entitlements:[{ lesson_id:'Y6M51', core_access:1, source:'excel', source_batch_code:'Y611FM', source_lesson_date:asOfDate }] });
  assert.deepEqual(currentMaths(payload), ['maths-level3:L3:0','maths-sats:SATS:1']);
  assert.equal(payload.snapshot.lessonAccess.Y6M51.core, true);
}
{
  const { payload } = compile({ currentBatch:'Y511FM', entitlements:[{ lesson_id:'Y6M50', core_access:1, source:'excel', source_batch_code:'Y611FM', source_lesson_date:asOfDate }] });
  assert.deepEqual(currentMaths(payload), ['maths-level3:L3:1']);
  assert.equal(payload.snapshot.lessonAccess.Y6M50.core, true);
}
{
  const { payload } = compile({ currentBatch:'Y511FM', pre:[{ lesson_id:'Y6M52', batch_key:'Y611FM', lesson_date:asOfDate }] });
  assert.deepEqual(currentMaths(payload), ['maths-level3:L3:0','maths-sats:SATS:1']);
  assert.equal(payload.snapshot.lessonAccess.Y6M52.preLessonOnly, true);
}
{
  const { payload } = compile({ currentBatch:'Y511FM', profileBatches:['Y511FM','Y611FM'] });
  assert.deepEqual(currentMaths(payload), ['maths-level3:L3:0']);
}
{
  const { payload } = compile({ currentBatch:'Y611FM', profileBatches:['Y611FM','Y511FM'] });
  assert.deepEqual(currentMaths(payload), ['maths-year6:Lessons:0']);
}

// Ended D1 assignment stays historical even if stale KV profile batches remain.
{
  const input = {
    asOfDate,
    user:{ name:'Fixture', batches:['Y511FM','Y611FM'], upsellViews:[] },
    batchDefinitions:definitions,
    batchAssignments:[assignment('Y511FM','2026-09-20')],
    entitlements:[],
    onlinePreLessonEntitlements:[]
  };
  const payload = compileAuthoritativeAccessScope(input, catalogue, 'fixture-historical', asOfDate);
  assert.deepEqual(currentMaths(payload), []);
  const historicalL3 = payload.snapshot.views.find(view => view.viewId === 'maths-level3');
  assert.equal(Boolean(historicalL3), true);
  assert.equal(historicalL3.current, false);
}

// Dual Full Library access is retained but is not current programme identity.
{
  const input = {
    asOfDate,
    user:{ name:'Fixture', batches:[], upsellViews:[], fullLibraries:['MATHS_Y6_FULL','MATHS_L3_FULL'] },
    batchDefinitions:definitions,
    batchAssignments:[],
    entitlements:[],
    onlinePreLessonEntitlements:[]
  };
  const payload = compileAuthoritativeAccessScope(input, catalogue, 'fixture-full-library', asOfDate);
  assert.deepEqual(currentMaths(payload), []);
  const y6 = payload.snapshot.views.find(view => view.viewId === 'maths-year6');
  const l3 = payload.snapshot.views.find(view => view.viewId === 'maths-level3');
  assert.equal(Boolean(y6), true);
  assert.equal(Boolean(l3), true);
  assert.equal(y6.current, false);
  assert.equal(y6.group, 'previous');
  assert.equal(l3.current, false);
  assert.equal(l3.group, 'previous');
  assert.equal(payload.snapshot.views.some(view => view.viewId === 'maths-sats'), false);
}

// With a current D1 programme plus both Full Libraries, D1 remains current and
// the opposite equivalent Full Library is preserved under Previous. The current
// L3 view is fully open because MATHS_L3_FULL is an explicit access grant.
{
  const input = {
    asOfDate,
    user:{ name:'Fixture', batches:['Y511FM'], upsellViews:[], fullLibraries:['MATHS_Y6_FULL','MATHS_L3_FULL'] },
    batchDefinitions:definitions,
    batchAssignments:[assignment('Y511FM')],
    entitlements:[],
    onlinePreLessonEntitlements:[]
  };
  const payload = compileAuthoritativeAccessScope(input, catalogue, 'fixture-current-plus-full', asOfDate);
  assert.deepEqual(currentMaths(payload), ['maths-level3:L3:2']);
  const y6 = payload.snapshot.views.find(view => view.viewId === 'maths-year6');
  assert.equal(Boolean(y6), true);
  assert.equal(y6.current, false);
  assert.equal(y6.group, 'previous');
}

// Known D1 profile batch with no D1 assignment history remains a migration
// fallback, but uses the D1 definition rather than the legacy regex.
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

// Regression: an English-only current student with explicit MATHS_L3_FULL
// retains the whole L3 Maths catalogue as CURRENT and FULL (all 2/2 lessons
// open in this fixture). Shared canonical Y6 membership must not manufacture
// a duplicate current Year 6 view or block an unrelated English import.
{
  const input = {
    asOfDate,
    user:{name:'Fixture',batches:[],upsellViews:[],fullLibraries:['MATHS_L3_FULL']},
    batchDefinitions:definitions,
    batchAssignments:[{
      batch_key:'Y6FE2', subject:'english',school_year:6,stream:'normal',maths_level:null,
      effective_from:'2026-09-01',effective_to:null,batch_active_from:'2026-09-01',batch_active_to:null
    }],
    entitlements:[{lesson_id:'Y6M50',core_access:1,source:'excel',source_batch_code:'Y511FM',source_lesson_date:asOfDate}],
    onlinePreLessonEntitlements:[]
  };
  const payload=compileAuthoritativeAccessScope(input,catalogue,'fixture-single-full-l3',asOfDate);
  assert.deepEqual(currentMaths(payload),['maths-level3:L3:2']);
  const l3=payload.snapshot.views.find(v=>v.viewId==='maths-level3');
  assert.equal(l3.current,true);
  assert.equal(l3.group,'current');
  assert.equal(l3.visibleLessonCount,2);
  assert.equal(l3.openLessonCount,2);
  assert.equal(l3.lockedLessonCount,0);
  assert.equal(l3.lockedPreview,false);
  const year6=payload.snapshot.views.find(v=>v.viewId==='maths-year6');
  assert.equal(year6.current,false);
  assert.equal(year6.group,'previous');
  assert.equal(payload.snapshot.lessonAccess.Y6M50.core,true,'Existing Y6/L3 canonical lesson entitlement remains open');
  assert.equal(payload.snapshot.lessonAccess.COMMON1.core,true,'Second L3 lesson must remain open under Full Library');
}

// D1 curriculum membership outranks an opposite Full Library entitlement.
{
  const input = {
    asOfDate,
    user:{name:'Fixture',batches:[],upsellViews:[],fullLibraries:['MATHS_L3_FULL']},
    batchDefinitions:definitions,
    batchAssignments:[assignment('Y611FM')],
    entitlements:[],onlinePreLessonEntitlements:[]
  };
  const payload=compileAuthoritativeAccessScope(input,catalogue,'fixture-y6-plus-full-l3',asOfDate);
  assert.deepEqual(currentMaths(payload),['maths-year6:Lessons:0']);
  const other=payload.snapshot.views.find(v=>v.viewId==='maths-level3');
  assert.equal(other.current,false);
  assert.equal(other.group,'previous');
}
// Existing fallback: a current D1-defined KV batch stays current even when
// the student has an opposite Full Library without a D1 assignment record.
{
  const input = {
    asOfDate,
    user:{name:'Fixture',batches:['Y511FM'],upsellViews:[],fullLibraries:['MATHS_Y6_FULL']},
    batchDefinitions:definitions,batchAssignments:[],
    entitlements:[],onlinePreLessonEntitlements:[]
  };
  const payload=compileAuthoritativeAccessScope(input,catalogue,'fixture-kv-fallback-with-full',asOfDate);
  assert.deepEqual(currentMaths(payload),['maths-level3:L3:0']);
}

console.log('ACCESS_READ_MODEL_SYNC_V2_VERIFICATION_PASS');