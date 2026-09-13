import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileAccessReadModel, deriveOpaqueScopeId } from '../worker/src/checkpoint4-shadow-access.mjs';
import { successfulAffectedUsers } from '../worker/src/checkpoint4-shadow-compat.mjs';
import { isConfirmRequest, CONFIRM_PATH } from '../worker/src/index-checkpoint4-shadow.js';

assert.equal(CONFIRM_PATH,'/api/v1/admin/lesson-releases/confirm');
assert.equal(isConfirmRequest(new Request(`https://example.test${CONFIRM_PATH}`,{method:'POST'})),true);
assert.equal(isConfirmRequest(new Request(`https://example.test${CONFIRM_PATH}`,{method:'GET'})),false);
assert.equal(isConfirmRequest(new Request('https://example.test/api/v1/student/home',{method:'POST'})),false);

assert.deepEqual(successfulAffectedUsers({ok:true,results:[
  {ok:true,status:'CREATED',portalUserIdNorm:'alpha'},
  {ok:true,status:'CONFIRMED',portalUserIdNorm:'ALPHA'},
  {ok:false,status:'ERROR',portalUserIdNorm:'beta'},
  {ok:true,status:'SKIPPED',portalUserIdNorm:'gamma'},
  {ok:true,status:'CREATED',portalUserIdNorm:'delta'}
]}),['alpha','delta']);

const global={
  kind:'prepared-global-read-model',
  lessonToViews:{L2A:['maths-year5','maths-level2'],L2B:['maths-year5','maths-level2']},
  catalogues:{
    'maths-year5':{lessonCount:2,lessons:[{lessonId:'L2A'},{lessonId:'L2B'}]},
    'maths-level2':{lessonCount:2,lessons:[{lessonId:'L2A'},{lessonId:'L2B'}]}
  }
};
const input={
  asOfDate:'2026-09-13',
  user:{firstName:'Synthetic',loginPassword:'MUST_NOT_COPY',answerPassword:'MUST_NOT_COPY',fullLibraries:[],manualAccess:{coreLessons:[],vrLessons:[],specialBuckets:[]}},
  batchAssignments:[{batch_key:'Y5M',subject:'maths',school_year:5,stream:'normal',maths_level:null,effective_from:'2026-09-01',effective_to:null}],
  batchDefinitions:[{batch_key:'Y5M',subject:'maths',school_year:5,stream:'normal',maths_level:null}],
  entitlements:[{lesson_id:'L2A',core_access:1,vr_access:0,source_batch_code:'Y5M'}],
  onlinePreLessonEntitlements:[{lesson_id:'L2B',batch_key:'Y5M',lesson_date:'2026-09-14',vr_access:0}]
};
const scopeId=await deriveOpaqueScopeId('synthetic-user','synthetic-test-secret');
assert.match(scopeId,/^u-[a-f0-9]{40}$/);
assert.equal(scopeId.includes('synthetic-user'),false);
const model=compileAccessReadModel(input,global,scopeId,'2026-09-13');
assert.equal(model.snapshot.lessonAccess.L2A.core,true);
assert.equal(model.snapshot.lessonAccess.L2B.preLessonOnly,true);
assert.equal(model.snapshot.views.find(v=>v.viewId==='maths-year5').current,true);
assert.equal(model.snapshot.views.some(v=>v.viewId==='maths-level2' && !v.lockedPreview),false,'ordinary Year 5 entitlement must not widen into L2');
assert.equal(JSON.stringify(model).includes('MUST_NOT_COPY'),false);
assert.equal(JSON.stringify(model).includes('synthetic-user'),false);

const wrapper=fs.readFileSync(new URL('../worker/src/index-checkpoint4-shadow.js',import.meta.url),'utf8');
const legacyCall=wrapper.indexOf('await legacyWorker.fetch(request, env, ctx)');
const scheduleCall=wrapper.indexOf('scheduleShadow(ctx, shadowFromLegacyResponse',legacyCall);
const returnCall=wrapper.indexOf('return legacyResponse;',scheduleCall);
assert.ok(legacyCall>=0 && scheduleCall>legacyCall && returnCall>scheduleCall,'legacy response must be produced first, shadow scheduled second, legacy response returned unchanged');
assert.equal(wrapper.includes('REBUILD_SHADOW_KV'),false,'outer wrapper must delegate shadow internals instead of changing legacy request handling');

console.log(JSON.stringify({marker:'CHECKPOINT4_PRODUCTION_SHADOW_STATIC_PASS',opaqueScope:true,fullRelease:true,prelessonOnly:true,no11plusWidening:true,legacyResponsePreserved:true}));
