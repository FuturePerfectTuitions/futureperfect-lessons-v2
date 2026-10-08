// Read-only production diagnosis for 2026-10-08 English CSV access release.
// No student IDs, credentials or personal data are printed in public logs.
// Only Cloudflare Worker settings GET, KV GET, and D1 SELECT may be invoked.
import {
  SCOPE_SALT_KEY, opaqueAccessScopeId, resolveCurrentScope,
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
const store={get:key=>kvText('READ_MODELS_KV',key),
  put:()=>{throw Error('READ_ONLY_NO_KV_WRITES');}};
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

const results=[];
for(let index=0;index<entries.length;index++){
  const e=entries[index],id=clean(e.portal_user_id_norm).toLowerCase(),lesson=clean(e.lesson_id);
  let stage='compile', errorCode=null, projection='UNKNOWN', collisionContext=null;
  try{
    const input=await loadStudentAccessInput(env,id,asOfDate);
    const scopeId=await opaqueAccessScopeId(id,salt);
    if(index===3){
      // Metadata-only comparison; no account IDs, credentials or batch codes.
      const normalized=normaliseAuthoritativeInput(input,asOfDate);
      const raw=compileLegacyAccessScope(normalized,catalogue,scopeId,asOfDate);
      collisionContext={
        authoritativeD1CurrentProgramme:currentEquivalentProgramme(input,asOfDate)||'NONE',
        explicitDualFullLibrary:explicitDualFullLibrary(input),
        hasFullYear6:(input.user?.fullLibraries||[]).includes('MATHS_Y6_FULL'),
        hasFullL3:(input.user?.fullLibraries||[]).includes('MATHS_L3_FULL'),
        profileBatchCount:(input.user?.batches||[]).length,
        d1AssignmentCount:(input.batchAssignments||[]).length,
        rawEquivalentViews:(raw?.snapshot?.views||[])
          .filter(v=>v?.viewId==='maths-year6'||v?.viewId==='maths-level3')
          .map(v=>({viewId:v.viewId,current:v.current,group:v.group,lockedPreview:v.lockedPreview})),
        // Source flags and totals only. No identifying fields or lesson titles.
        fullLibraryFlags:Object.fromEntries(
          ['MATHS_L1_FULL','MATHS_L2_FULL','MATHS_L3_FULL','MATHS_Y6_FULL','ENGLISH_Y6_FULL']
            .map(flag=>[flag,(input.user?.fullLibraries||[]).includes(flag)])
        ),
        englishYear6CanonicalFullCount:(input.entitlements||[])
          .filter(v=>/^Y6E/i.test(clean(v.lesson_id))&&Number(v.core_access)===1).length,
        englishYear6PrelessonCount:(input.onlinePreLessonEntitlements||[])
          .filter(v=>/^Y6E/i.test(clean(v.lesson_id))).length,
        mathsSatsCanonicalFullCount:(input.entitlements||[])
          .filter(v=>/^Y6M(5[1-9]|6[0-9])$/i.test(clean(v.lesson_id))&&Number(v.core_access)===1).length,
        mathsSatsPrelessonCount:(input.onlinePreLessonEntitlements||[])
          .filter(v=>/^Y6M(5[1-9]|6[0-9])$/i.test(clean(v.lesson_id))).length,
        preparedCards:(await resolveCurrentScope(store,'access:'+scopeId).catch(()=>null))?.payload?.snapshot?.views
          ?.filter(v=>['maths-level1','maths-level2','maths-level3','maths-year6','maths-sats','english-year6'].includes(v.viewId))
          .map(v=>({viewId:v.viewId,group:v.group,current:v.current,open:v.openLessonCount,locked:v.lockedLessonCount}))
      };
    }
    const compiled=compileAuthoritativeAccessScope(input,catalogue,scopeId,asOfDate);
    assertCanonicalAccessProjected(input,compiled);
    stage='prepared-read';
    const prepared=await resolveCurrentScope(store,'access:'+scopeId);
    const access=prepared.payload?.snapshot?.lessonAccess?.[lesson];
    projection=access?.core===true&&!access?.blocked?'FULL_VISIBLE':'MISSING_FULL';
    stage='complete';
  }catch(error){errorCode=machineCode(error);}
  results.push({csvRow:index+2,batch:e.source_batch_code,stage,
    diagnosis:errorCode||(projection==='FULL_VISIBLE'?'CURRENT_PREPARED_FULL':'CURRENT_PREPARED_NOT_FULL'),
    preparedLessonState:projection,...(collisionContext?{collisionContext}:{})});
}
console.log(JSON.stringify({
  marker:'ADMIN_IMPORT_20261008_READONLY_DIAGNOSTIC',
  bindingChecks:'PASS',safeReadOnly:true,studentIdentityDisclosed:false,
  canonicalWrites:0,preparedWrites:0,emailsSent:0,
  rowOrder:'D1 last_confirmed_at ascending; all five timestamps unique',
  results
},null,2));
