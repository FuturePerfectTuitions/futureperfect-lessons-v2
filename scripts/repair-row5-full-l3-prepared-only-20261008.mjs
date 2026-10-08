// Read-only production diagnosis for 2026-10-08 English CSV access release.
// No student IDs, credentials or personal data are printed in public logs.
// Only Cloudflare Worker settings GET, KV GET, and D1 SELECT may be invoked.
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
const input=await loadStudentAccessInput(env,id,asOfDate);
const fullLibraries=new Set((input.user?.fullLibraries||[]).map(v=>clean(v).toUpperCase()));
if(!fullLibraries.has('MATHS_L3_FULL') || fullLibraries.has('MATHS_Y6_FULL'))
  throw Error('FULL_LIBRARY_AUTHORITY_CHANGED');
if(currentEquivalentProgramme(input,asOfDate)!=='')
  throw Error('D1_MATHS_MEMBERSHIP_CHANGED_STOP');
if(!input.entitlements.some(e=>clean(e.lesson_id)===clean(target.lesson_id)&&Number(e.core_access)===1))
  throw Error('ENGLISH_CANONICAL_GRANT_MISSING');
const scopeId=await opaqueAccessScopeId(id,salt);
const scope='access:'+scopeId;
const encodedScope=encodeURIComponent(scope).replace(/%/g,'_');
approvedScopePrefix='rm:v1:scope:'+encodedScope+':';

function validatePrepared(payload){
  const snap=payload?.snapshot;
  const l3=(snap?.views||[]).find(v=>v.viewId==='maths-level3');
  if(!l3 || l3.current!==true || l3.group!=='current' || l3.lockedPreview===true)
    throw Error('L3_MUST_BE_CURRENT');
  const visible=Number(l3.visibleLessonCount);
  const open=Number(l3.openLessonCount);
  if(!Number.isFinite(visible)||visible<=0||open!==visible||Number(l3.lockedLessonCount)!==0)
    throw Error('L3_FULL_LIBRARY_NOT_100_PERCENT_OPEN');
  if((snap.views||[]).some(v=>v.viewId==='maths-year6'&&v.current===true))
    throw Error('DUPLICATE_CURRENT_YEAR6_FORBIDDEN');
  if(snap.lessonAccess?.[clean(target.lesson_id)]?.core!==true)
    throw Error('YEAR6_ENGLISH_RELEASE_NOT_FULL');
  return {visible,open};
}
const compiled=compileAuthoritativeAccessScope(input,catalogue,scopeId,asOfDate);
assertCanonicalAccessProjected(input,compiled);
const verification=validatePrepared(compiled);
const before=await resolveCurrentScope(store,scope).catch(()=>null);
const published=await publishScopeAtomic(store,{
  scope,payload:compiled,updatedAt:new Date().toISOString()
});
let verified=null,readbackError=null;
for(let i=0;i<4;i++){
  try{
    const out=await resolveCurrentScope(store,scope);
    if(out.sha256!==published.payloadSha256 || out.version!==published.version)
      throw Error('READBACK_NOT_PUBLISHED_VERSION');
    validatePrepared(out.payload);
    verified=out;break;
  }catch(e){readbackError=e;}
}
if(!verified) throw Error('POST_PUBLICATION_VERIFY_FAILED_'+machineCode(readbackError));
console.log(JSON.stringify({
  marker:'ADMIN_IMPORT_ROW5_L3_FULL_PREPARED_RECONCILIATION_PASS',
  productionBindingsVerified:true,
  targetIdentifiedFromExactlyFiveDistinctCanonicalRows:true,
  englishLessonFull:true,
  mathsProgramme:'L3',
  mathsL3VisibleLessons:verification.visible,
  mathsL3OpenLessons:verification.open,
  mathsL3LockedLessons:0,
  duplicateCurrentYear6:false,
  preparedScopeVerified:true,
  unchangedCanonicalD1:true,
  unchangedStudentsKv:true,
  unchangedOtherStudentReadModels:true,
  onlyWrittenTo:'READ_MODELS_KV_ONE_STUDENT_SCOPE',
  parentEmailsSent:0,
  existingVersionReused:published.reused===true,
  priorPreparedScopeFound:Boolean(before),
  studentIdentityDisclosed:false
},null,2));
