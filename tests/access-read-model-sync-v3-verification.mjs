import assert from 'node:assert/strict';
import {
  compileAuthoritativeAccessScope,
  currentD1ElevenPlusMathsViews
} from '../worker/src/access-read-model-sync-v3.js';

const asOfDate='2026-09-28';
const definitions=[
  {batch_key:'Y3FM',subject:'maths',school_year:3,stream:'normal',maths_level:null,active_from:'2026-09-01',active_to:null},
  {batch_key:'Y611FM',subject:'maths',school_year:6,stream:'normal',maths_level:null,active_from:'2026-09-01',active_to:null},
  {batch_key:'Y511FM',subject:'maths',school_year:5,stream:'11plus',maths_level:3,active_from:'2026-09-01',active_to:null}
];
const catalogue={
  schemaVersion:1,kind:'prepared-catalogue',navigation:[],
  views:{
    'maths-year3':{viewId:'maths-year3',label:'Year 3',lessonCount:1,lessons:[{lessonId:'Y3M1'}]},
    'maths-level1':{viewId:'maths-level1',label:'L1',lessonCount:1,lessons:[{lessonId:'L1CAN'}]},
    'maths-level2':{viewId:'maths-level2',label:'L2',lessonCount:1,lessons:[{lessonId:'L2CAN'}]},
    'maths-year6':{viewId:'maths-year6',label:'Lessons',lessonCount:2,lessons:[{lessonId:'COMMON'},{lessonId:'Y6M50'}]},
    'maths-level3':{viewId:'maths-level3',label:'L3',lessonCount:2,lessons:[{lessonId:'COMMON'},{lessonId:'Y6M50'}]},
    'maths-sats':{viewId:'maths-sats',label:'SATS',lessonCount:2,lessons:[{lessonId:'Y6M51'},{lessonId:'Y6M52'}]}
  },
  lessonToViews:{
    Y3M1:['maths-year3'],L1CAN:['maths-level1'],L2CAN:['maths-level2'],
    COMMON:['maths-year6','maths-level3'],Y6M50:['maths-year6','maths-level3'],
    Y6M51:['maths-sats'],Y6M52:['maths-sats']
  }
};
function assignment(batchKey,effectiveTo=null){const d=definitions.find(x=>x.batch_key===batchKey);return {...d,portal_user_id_norm:'fixture',effective_from:'2026-09-01',effective_to:effectiveTo,batch_active_from:d.active_from,batch_active_to:d.active_to};}

const input={
  asOfDate,
  user:{
    name:'Fixture',batches:[],upsellViews:[],
    fullLibraries:['MATHS_Y3_FULL','MATHS_L1_FULL','MATHS_L2_FULL','MATHS_Y6_FULL']
  },
  batchDefinitions:definitions,
  batchAssignments:[assignment('Y611FM','2026-09-28'),assignment('Y511FM')],
  entitlements:[{lesson_id:'Y6M51',core_access:1,source:'excel',source_batch_code:'Y611FM',source_lesson_date:asOfDate}],
  onlinePreLessonEntitlements:[]
};

assert.deepEqual(currentD1ElevenPlusMathsViews(input,asOfDate),['maths-level3']);
const payload=compileAuthoritativeAccessScope(input,catalogue,'fixture-v3',asOfDate);
const maths=payload.snapshot.views.filter(v=>v.subject==='maths'&&!v.lockedPreview);
const current=maths.filter(v=>v.current).map(v=>v.viewId).sort();
assert.deepEqual(current,['maths-level1','maths-level2','maths-level3','maths-sats']);
for(const id of ['maths-year3','maths-year6']){
  const view=maths.find(v=>v.viewId===id);
  assert.ok(view,`${id} history must remain visible`);
  assert.equal(view.current,false,`${id} must not remain current`);
  assert.equal(view.group,'previous',`${id} must be Previous`);
}
for(const id of ['MATHS_Y3_FULL','MATHS_L1_FULL','MATHS_L2_FULL','MATHS_Y6_FULL']){
  assert.ok(payload.snapshot.fullViewIds.includes(id.replace('MATHS_Y3_FULL','maths-year3').replace('MATHS_L1_FULL','maths-level1').replace('MATHS_L2_FULL','maths-level2').replace('MATHS_Y6_FULL','maths-year6')));
}
assert.equal(payload.snapshot.views.find(v=>v.viewId==='maths-sats').openLessonCount,1);

// A genuinely concurrent normal Maths D1 programme is not presentation-demoted.
const concurrent={...input,batchAssignments:[assignment('Y3FM'),assignment('Y511FM')]};
const concurrentPayload=compileAuthoritativeAccessScope(concurrent,catalogue,'fixture-concurrent',asOfDate);
const currentConcurrent=concurrentPayload.snapshot.views.filter(v=>v.subject==='maths'&&v.current&&!v.lockedPreview).map(v=>v.viewId);
assert.ok(currentConcurrent.includes('maths-year3'));
assert.ok(currentConcurrent.includes('maths-level3'));

console.log('ACCESS_READ_MODEL_SYNC_V3_VERIFICATION_PASS');
