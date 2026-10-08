// One-account repair: revoke unintended FULL Year6 English, preserve each D1 release, republish scoped prepared model.
// No student IDs, credentials or personal data are printed in public logs.
// One guarded STUDENTS_KV profile PUT plus only this student's prepared access KV writes; D1 SELECT only.
import {
  SCOPE_SALT_KEY, opaqueAccessScopeId, resolveCurrentScope, publishScopeAtomic,
  globalToCatalogue, assertCanonicalAccessProjected,
  compileAccessScope as compileLegacyAccessScope
} from '../worker/src/access-read-model-sync.js';
import {
  loadStudentAccessInput, compileAuthoritativeAccessScope,
  currentEquivalentProgramme, normaliseAuthoritativeInput, explicitDualFullLibrary
} from '../worker/src/access-read-model-sync-v2.js';

const clean = v => String(v ?? '').trim();
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const asOfDate = '2026-10-08';
const expected = {
  STUDENTS_KV:'c9723c8806334e4ea54d1b456d31b794',
  READ_MODELS_KV:'77b35165c8694087bc1b0515c35a7e89',
  DB:'97250a54-fa91-45ad-a002-3c4566b1fc38'
};
if (!token || !account) throw Error('CLOUDFLARE_CREDENTIALS_UNAVAILABLE');
const base = 'https://api.cloudflare.com/client/v4';
async function cf(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,headers:{Authorization:'Bearer ' + token,...(options.headers||{})}
  });
  const raw=await response.text();
  if(!response.ok) throw Error('CLOUDFLARE_HTTP_' + response.status);
  let data;try{data=JSON.parse(raw);}catch{data=null;}
  return {raw,data};
}
async function jsonApi(path,options={}){
  const v=(await cf(path,options)).data;
  if(v?.success!==true) throw Error('CLOUDFLARE_API_NOT_SUCCESS');
  return v.result;
}
function machineCode(error){
  const s=clean(error?.message||error);
  return /^[A-Z][A-Z0-9_]*(?::[A-Za-z0-9_.-]+)?$/.test(s)&&s.length<=100?s:'INTERNAL_DIAGNOSTIC_FAILURE';
}
const settings=await jsonApi('/accounts/'+account+'/workers/scripts/fpt-portal-v2-worker/settings');
const bindings=settings?.bindings||[];
const binding=name=>bindings.find(b=>b.name===name)||{};
for(const [name,id] of Object.entries(expected)){
  const actual=clean(name==='DB'?(binding(name).database_id||binding(name).id):binding(name).namespace_id);
  if(actual!==id) throw Error('BINDING_DRIFT_'+name);
}
async function kvText(name,key){
  const url=base+'/accounts/'+account+'/storage/kv/namespaces/'+expected[name]+'/values/'+encodeURIComponent(key);
  const r=await fetch(url,{method:'GET',headers:{Authorization:'Bearer '+token}});
  if(r.status===404) return null;
  if(!r.ok) throw Error('KV_READ_HTTP_'+r.status);
  return r.text();
}
// This script is the one exception to the preceding diagnostic's read-only
// access: it can publish precisely ONE derived student's prepared access keys,
// never a global scope, another student's scope, or canonical D1/KV.
let approvedScopePrefix='';
const store={get:key=>kvText('READ_MODELS_KV',key),
  async put(key,value){
    if(!approvedScopePrefix || !key.startsWith(approvedScopePrefix) ||
       !(key.endsWith(':current') || key.includes(':version:')))
      throw Error('REFUSED_WRITE_OUTSIDE_ONE_STUDENT_PREPARED_SCOPE');
    await jsonApi('/accounts/'+account+'/storage/kv/namespaces/'+expected.READ_MODELS_KV+
      '/values/'+encodeURIComponent(key),{
      method:'PUT',headers:{'content-type':'text/plain; charset=utf-8'},body:String(value)
    });
  }};
const env={
  READ_MODELS_KV:store,
  STUDENTS_KV:{
    async get(key,opts){const raw=await kvText('STUDENTS_KV',key);return opts?.type==='json'&&raw?JSON.parse(raw):raw;},
    put:()=>{throw Error('READ_ONLY_NO_STUDENT_WRITES');}
  },
  DB:{prepare(sql){
    if(!/^\s*SELECT\b/i.test(sql)) throw Error('D1_READ_ONLY_SELECT');
    return {
      bind(...params){return {...this,params};},
      async all(){
        const data=await jsonApi('/accounts/'+account+'/d1/database/'+expected.DB+'/query',{
          method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({sql,params:this.params||[]})
        });
        const result=Array.isArray(data)?data[0]:data;
        return {results:result?.results||[]};
      }
    };
  }}
};
const salt=clean(await store.get(SCOPE_SALT_KEY));
if(!/^[0-9a-f]{64}$/i.test(salt)) throw Error('READ_MODEL_SCOPE_SALT_INVALID');
const global=await resolveCurrentScope(store,'global');
const catalogue=globalToCatalogue(global.payload);
if(!catalogue?.views?.['maths-sats']||catalogue.views['maths-year6']?.label!=='Lessons')
  throw Error('READ_MODEL_GLOBAL_PROGRAMME_MODEL_NOT_V2');

// Narrow to the batch/date footprint shown by the owner. If not exactly five
// distinct rows, stop without exposing identities or assuming their order.
const sql=[
  'SELECT portal_user_id_norm,lesson_id,source_batch_code,last_confirmed_at',
  'FROM lesson_entitlements WHERE source = \'excel\'',
  'AND source_lesson_date = \'2026-10-08\'',
  'AND source_batch_code IN (\'Y3FE\',\'Y411OE\',\'Y6FE2\')',
  'AND core_access = 1 ORDER BY last_confirmed_at ASC'
].join(' ');
const entries=(await env.DB.prepare(sql).all()).results;
if(entries.length!==5) throw Error('IMPORT_FOOTPRINT_NOT_UNIQUE_COUNT_'+entries.length);
const times=entries.map(e=>clean(e.last_confirmed_at));
if(new Set(times).size!==5) throw Error('IMPORT_FOOTPRINT_TIMESTAMPS_NOT_UNIQUE');
const counts=Object.fromEntries(['Y3FE','Y411OE','Y6FE2'].map(b=>[b,entries.filter(e=>e.source_batch_code===b).length]));
if(counts.Y3FE!==2||counts.Y411OE!==1||counts.Y6FE2!==2)
  throw Error('IMPORT_FOOTPRINT_BATCH_MISMATCH');


const target=entries[3];
if(target.source_batch_code!=='Y6FE2' || !/^Y6E[0-9]/i.test(clean(target.lesson_id)))
  throw Error('EXPECTED_YEAR6_ENGLISH_TARGET_NOT_FOUND');
const id=clean(target.portal_user_id_norm).toLowerCase();
const userKey='user:'+id;
const userRaw=await kvText('STUDENTS_KV',userKey);
if(!userRaw) throw Error('STUDENT_KV_PROFILE_MISSING');
const originalUser=JSON.parse(userRaw);
const input=await loadStudentAccessInput(env,id,asOfDate);
if(JSON.stringify(input.user)!==JSON.stringify(originalUser))
  throw Error('STUDENT_PROFILE_CHANGED_BETWEEN_READS');
const upper=s=>clean(s).toUpperCase();
const flags=(originalUser.fullLibraries||[]).map(upper);
if(!Array.isArray(originalUser.fullLibraries) ||
  flags.filter(x=>x==='ENGLISH_Y6_FULL').length!==1 ||
  !['MATHS_L1_FULL','MATHS_L2_FULL','MATHS_L3_FULL'].every(x=>flags.includes(x)) ||
  flags.includes('MATHS_Y6_FULL')) throw Error('FULL_LIBRARY_FLAGS_UNEXPECTED');
if(currentEquivalentProgramme(input,asOfDate)!=='') throw Error('MATHS_ASSIGNMENT_DRIFT');
const englishCanonicalIds=[...new Set(input.entitlements
  .filter(e=>/^Y6E/i.test(clean(e.lesson_id)) && Number(e.core_access)===1)
  .map(e=>clean(e.lesson_id)))];
if(englishCanonicalIds.length!==4 || !englishCanonicalIds.includes(clean(target.lesson_id)))
  throw Error('ENGLISH_FOUR_INDIVIDUAL_RELEASES_CHANGED');
const satsCanonicalIds=[...new Set(input.entitlements
  .filter(e=>/^Y6M(5[1-9]|6[0-9])$/i.test(clean(e.lesson_id)) && Number(e.core_access)===1)
  .map(e=>clean(e.lesson_id)))];
if(satsCanonicalIds.length!==2) throw Error('SATS_INDIVIDUAL_RELEASES_CHANGED');
const newUser={...originalUser,
  fullLibraries:originalUser.fullLibraries.filter(x=>upper(x)!=='ENGLISH_Y6_FULL')
};
if(newUser.fullLibraries.length!==originalUser.fullLibraries.length-1)
  throw Error('PROFILE_CHANGE_NOT_EXACTLY_ONE_FLAG');
const scopeId=await opaqueAccessScopeId(id,salt);
const scope='access:'+scopeId;
approvedScopePrefix='rm:v1:scope:'+encodeURIComponent(scope).replace(/%/g,'_')+':';
const profileAfter={...input,user:newUser};
const compile=compileAuthoritativeAccessScope(profileAfter,catalogue,scopeId,asOfDate);
assertCanonicalAccessProjected(profileAfter,compile);

function verifyPrepared(payload){
  const snapshot=payload?.snapshot;
  if(!snapshot || !Array.isArray(snapshot.views)) throw Error('PREPARED_SNAPSHOT_ABSENT');
  const v=key=>snapshot.views.find(x=>x.viewId===key);
  const english=v('english-year6'),l3=v('maths-level3'),sats=v('maths-sats');
  if(!english?.current || english.openLessonCount!==4 || english.visibleLessonCount!==31 ||
    english.lockedLessonCount!==27) throw Error('ENGLISH_PER_LESSON_RELEASE_PARITY_FAILED');
  if(!l3?.current || l3.visibleLessonCount!==43 || l3.openLessonCount!==43 ||
    l3.lockedLessonCount!==0) throw Error('L3_FULL_ACCESS_NOT_PRESERVED');
  if(!sats?.current || sats.visibleLessonCount!==19 || sats.openLessonCount!==2 ||
    sats.lockedLessonCount!==17) throw Error('SATS_RELEASE_PARITY_FAILED');
  if(v('maths-year6')) throw Error('REDUNDANT_MATHS_YEAR6_VIEW_REMAINS');
  const mathsOrder=snapshot.views.map(x=>x.viewId);
  if(mathsOrder.indexOf('maths-sats')!==mathsOrder.indexOf('maths-level3')+1)
    throw Error('SATS_NOT_ADJACENT_TO_L3');
  for(const lesson of englishCanonicalIds){
    const access=snapshot.lessonAccess?.[lesson];
    if(!access?.core || access.blocked) throw Error('CANONICAL_ENGLISH_RELEASE_NOT_OPEN');
  }
  for(const lesson of satsCanonicalIds){
    const access=snapshot.lessonAccess?.[lesson];
    if(!access?.core || access.blocked) throw Error('CANONICAL_SATS_RELEASE_NOT_OPEN');
  }
  return {englishOpen:4,englishLocked:27,l3Open:43,l3Locked:0,satsOpen:2,satsLocked:17};
}
const expectedResult=verifyPrepared(compile);
const originalPrepared=await resolveCurrentScope(store,scope);
if(originalPrepared.payload?.snapshot?.views?.find(v=>v.viewId==='english-year6')?.openLessonCount!==31)
  throw Error('EXPECTED_OLD_FULL_ENGLISH_PREPARED_STATE_NOT_PRESENT');
// Read again just before updating. Stop rather than overwrite known concurrent edits.
if(await kvText('STUDENTS_KV',userKey)!==userRaw) throw Error('CONCURRENT_STUDENT_PROFILE_UPDATE');
await jsonApi('/accounts/'+account+'/storage/kv/namespaces/'+expected.STUDENTS_KV+
  '/values/'+encodeURIComponent(userKey),{
    method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(newUser)
});
const reloaded=await kvText('STUDENTS_KV',userKey);
if(!reloaded || JSON.stringify(JSON.parse(reloaded))!==JSON.stringify(newUser))
  throw Error('USER_PROFILE_POST_WRITE_VERIFY_FAILED');
const published=await publishScopeAtomic(store,{
  scope,payload:compile,updatedAt:new Date().toISOString()
});
let verified=null,readbackError=null;
for(let i=0;i<4;i++){
  try{
    const read=await resolveCurrentScope(store,scope);
    if(read.version!==published.version || read.sha256!==published.payloadSha256)
      throw Error('READ_MODEL_VERSION_NOT_CURRENT');
    verifyPrepared(read.payload);
    verified=read;break;
  }catch(e){readbackError=e;}
}
if(!verified) throw Error('PREPARED_POST_WRITE_VERIFY_FAILED_'+machineCode(readbackError));
const lastRaw=await kvText('STUDENTS_KV',userKey);
if(!lastRaw || JSON.stringify(JSON.parse(lastRaw))!==JSON.stringify(newUser))
  throw Error('PROFILE_CHANGED_DURING_PUBLICATION');
console.log(JSON.stringify({
  marker:'AARAV_MATHS_SATS_ENGLISH_INDIVIDUAL_RELEASE_REPAIR_PASS',
  targetVerifiedAgainstOriginalFiveRowFootprint:true,
  studentIdentityInLogs:false,
  subjectMaths:{
    l1FullPreserved:true,l2FullPreserved:true,l3FullPreserved:true,
    l3Current:true,l3Open:expectedResult.l3Open,l3Locked:expectedResult.l3Locked,
    redundantYear6LessonsCard:false,
    satsCurrent:true,satsOpen:expectedResult.satsOpen,satsLocked:expectedResult.satsLocked
  },
  subjectEnglish:{
    fullLibraryFlagRemoved:true,
    individuallyReleasedOpen:expectedResult.englishOpen,
    unreleasedLocked:expectedResult.englishLocked
  },
  writes:{studentsKvTargetOneUserOnly:true,readModelsKvTargetOneScopeOnly:true,
    d1Writes:0,otherStudentsChanged:0,parentEmailsSent:0},
  readback:{userProfile:true,preparedScope:true,version:published.version ? 'VERIFIED': 'MISSING'}
},null,2));
