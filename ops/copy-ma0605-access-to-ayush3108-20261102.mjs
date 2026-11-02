// Owner-authorised one-off English/Maths effective-access copy. No credential/session/email changes.
// Safety: production-bound only; target-specific canonical and prepared KV writes, D1 SELECT-only.
import {
  VIEW_DEFINITIONS, isYear6SatsLessonId, SCOPE_SALT_KEY, opaqueAccessScopeId,
  resolveCurrentScope, globalToCatalogue, pointerKey, stableStringify,
  assertCanonicalAccessProjected
} from '../worker/src/access-read-model-sync.js';
import {
  loadStudentAccessInput, compileAuthoritativeAccessScope,
  refreshStudentAccessReadModel, assertReadModelReconciliationReady
} from '../worker/src/access-read-model-sync-v2.js';

const SOURCE='ma0605', TARGET='ayush3108';
const token=String(process.env.CLOUDFLARE_API_TOKEN||'').trim();
const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
if(!token || !account) throw Error('CLOUDFLARE_CREDENTIALS_REQUIRED');
const expected={
  STUDENTS_KV:'c9723c8806334e4ea54d1b456d31b794',
  READ_MODELS_KV:'77b35165c8694087bc1b0515c35a7e89',
  DB:'97250a54-fa91-45ad-a002-3c4566b1fc38'
};
const auth={Authorization:'Bearer '+token};
const base='https://api.cloudflare.com/client/v4';
const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toLowerCase();
async function rawRequest(path,options={}){
  const response=await fetch(base+path,{...options,headers:{...auth,...(options.headers||{})}});
  const raw=await response.text();
  let body=null;try{body=JSON.parse(raw)}catch{}
  return {response,raw,body};
}
async function api(path,options={}){
  const out=await rawRequest(path,options);
  if(!out.response.ok || out.body?.success!==true) throw Error('CLOUDFLARE_OPERATION_FAILED_'+out.response.status);
  return out.body.result;
}
const settings=await api('/accounts/'+account+'/workers/scripts/fpt-portal-v2-worker/settings');
const binding=n=>(settings?.bindings||[]).find(x=>x.name===n)||{};
for(const [n,id] of Object.entries(expected)){
  const actual=clean(n==='DB'?(binding(n).database_id||binding(n).id):binding(n).namespace_id);
  if(actual!==id) throw Error('PRODUCTION_BINDING_DRIFT_'+n);
}
async function kvText(ns,key){
  const out=await rawRequest('/accounts/'+account+'/storage/kv/namespaces/'+expected[ns]+'/values/'+encodeURIComponent(key));
  if(out.response.status===404) return null;
  if(!out.response.ok) throw Error('KV_READ_FAILED_'+out.response.status);
  return out.raw;
}
const targetKey='user:'+TARGET;
let allowedAccessPrefix='';
async function kvWrite(ns,key,value){
  if(ns==='STUDENTS_KV' && key!==targetKey) throw Error('FORBIDDEN_STUDENT_MUTATION');
  if(ns==='READ_MODELS_KV' && (!allowedAccessPrefix || !key.startsWith(allowedAccessPrefix) ||
      !(key.endsWith(':current') || key.includes(':version:')))) throw Error('FORBIDDEN_PREPARED_MUTATION');
  if(ns!=='STUDENTS_KV' && ns!=='READ_MODELS_KV') throw Error('FORBIDDEN_NAMESPACE_MUTATION');
  await api('/accounts/'+account+'/storage/kv/namespaces/'+expected[ns]+'/values/'+encodeURIComponent(key),{
    method:'PUT',headers:{'content-type':'text/plain; charset=utf-8'},body:String(value)
  });
}
const students={
  async get(key,options={}){
    const raw=await kvText('STUDENTS_KV',key);
    return options?.type==='json'?(raw?JSON.parse(raw):null):raw;
  },
  async put(key,value){return kvWrite('STUDENTS_KV',key,value)}
};
const preparedStore={
  get:key=>kvText('READ_MODELS_KV',key),
  put:(key,value)=>kvWrite('READ_MODELS_KV',key,value)
};
const db={prepare(sql){
  if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql)) throw Error('D1_WRITE_FORBIDDEN');
  return {
    bind(...params){return {...this,params}},
    async all(){
      const result=await api('/accounts/'+account+'/d1/database/'+expected.DB+'/query',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({sql,params:this.params||[]})
      });
      const row=Array.isArray(result)?result[0]:result;
      return {results:Array.isArray(row?.results)?row.results:[]};
    }
  };
}};
const env={STUDENTS_KV:students,READ_MODELS_KV:preparedStore,DB:db};
const ready=await assertReadModelReconciliationReady(env);
if(!ready?.ok) throw Error('READ_MODEL_NOT_READY');
const salt=clean(await preparedStore.get(SCOPE_SALT_KEY));
if(!/^[0-9a-f]{64}$/i.test(salt)) throw Error('READ_MODEL_SALT_INVALID');
const global=await resolveCurrentScope(preparedStore,'global');
const catalogue=globalToCatalogue(global.payload);
const sourceScope='access:'+(await opaqueAccessScopeId(SOURCE,salt));
const targetScope='access:'+(await opaqueAccessScopeId(TARGET,salt));
allowedAccessPrefix=pointerKey(targetScope).slice(0,-'current'.length);
const sourceBefore=await resolveCurrentScope(preparedStore,sourceScope);
const targetBefore=await resolveCurrentScope(preparedStore,targetScope);
const sourceSnap=sourceBefore.payload?.snapshot;
const originalTargetSnap=targetBefore.payload?.snapshot;
if(!sourceSnap?.lessonAccess || !originalTargetSnap?.lessonAccess) throw Error('PREPARED_ACCESS_INVALID');
const sourceText=await kvText('STUDENTS_KV','user:'+SOURCE);
const originalTargetText=await kvText('STUDENTS_KV',targetKey);
if(!sourceText || !originalTargetText) throw Error('STUDENT_PROFILE_NOT_FOUND');
const sourceProfile=JSON.parse(sourceText), targetProfile=JSON.parse(originalTargetText);
for(const [label,id,p] of [['SOURCE',SOURCE,sourceProfile],['TARGET',TARGET,targetProfile]]){
  if(norm(p?.portalUserId||id)!==id) throw Error(label+'_IDENTIFIER_MISMATCH');
  if(['withdrawn','disabled','expired','inactive'].includes(norm(p.accountStatus||p.status||'active'))) throw Error(label+'_NOT_ACTIVE');
  if(id.startsWith('trial')||p.isAdmin===true||p.superuser===true||norm(p.role||p.accountType).includes('admin')) throw Error(label+'_NOT_ORDINARY_STUDENT');
}
const asOfDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const sourceInput=await loadStudentAccessInput(env,SOURCE,asOfDate);
const targetInput=await loadStudentAccessInput(env,TARGET,asOfDate);
const sourceCompiled=compileAuthoritativeAccessScope(sourceInput,catalogue,await opaqueAccessScopeId(SOURCE,salt),asOfDate);
assertCanonicalAccessProjected(sourceInput,sourceCompiled);
function curriculumLesson(id){
 return (catalogue.lessonToViews?.[id]||[]).some(v=>/^(english|maths)-/.test(v));
}
function effective(snap){
 return Object.fromEntries(Object.entries(snap.lessonAccess||{}).filter(([id,a])=>
   curriculumLesson(id) && a.blocked!==true && (a.core===true || a.vr===true || a.preLessonOnly===true)
 ));
}
function equalsAccess(a,b){
 const aa=effective(a),bb=effective(b);
 for(const [id,state] of Object.entries(aa)){
   const other=bb[id]||{};
   if(state.core!==other.core||state.vr!==other.vr||state.preLessonOnly!==other.preLessonOnly) return false;
 }
 for(const [id,state] of Object.entries(bb)){
   const other=aa[id]||{};
   if(state.core!==other.core||state.vr!==other.vr||state.preLessonOnly!==other.preLessonOnly) return false;
 }
 return true;
}
if(!equalsAccess(sourceSnap,sourceCompiled.snapshot)) throw Error('SOURCE_CANONICAL_PREPARED_ACCESS_DRIFT');
const srcAccess=effective(sourceSnap);
if(Object.values(srcAccess).some(s=>s.preLessonOnly===true)) throw Error('SOURCE_PRELESSON_ONLY_REQUIRES_SEPARATE_GRANT_PATH');
const allowedSpecials=new Set(['VR_HOWTO','MOCKS','Y4MASST1','Y4MASST2','Y5MASST1','Y5MASST2']);
const specials=(sourceSnap.specialAreas||[]).map(v=>clean(v).toUpperCase()).filter(Boolean);
if(specials.some(s=>!allowedSpecials.has(s))) throw Error('UNCLASSIFIED_SPECIAL_ACCESS_STOP');
const sourceLibraries=(Array.isArray(sourceProfile.fullLibraries)?sourceProfile.fullLibraries:[])
  .map(clean).filter(lib=>/^(MATHS|ENGLISH)_/i.test(lib));
for(const lib of sourceLibraries){
 if(!Object.values(VIEW_DEFINITIONS).some(v=>(v.fullLibraryIds||[]).some(x=>x.toUpperCase()===lib.toUpperCase()))) throw Error('UNKNOWN_LIBRARY_'+lib);
}
const sourceFullViews=new Set(sourceSnap.fullViewIds||[]);
const coreIds=Object.keys(srcAccess).filter(id=>srcAccess[id].core===true);
const vrIds=Object.keys(srcAccess).filter(id=>srcAccess[id].vr===true);
const manualCore=coreIds.filter(id=>isYear6SatsLessonId(id)||
 !(catalogue.lessonToViews?.[id]||[]).some(v=>sourceFullViews.has(v)));
const next=structuredClone(targetProfile);
next.fullLibraries=[...new Set([...(Array.isArray(next.fullLibraries)?next.fullLibraries:[]),...sourceLibraries])];
const oldManual=next.manualAccess&&typeof next.manualAccess==='object'&&!Array.isArray(next.manualAccess)?next.manualAccess:{};
next.manualAccess={
 ...oldManual,
 coreLessons:[...new Set([...(Array.isArray(oldManual.coreLessons)?oldManual.coreLessons:[]),...manualCore])].sort(),
 vrLessons:[...new Set([...(Array.isArray(oldManual.vrLessons)?oldManual.vrLessons:[]),...vrIds])].sort(),
 specialBuckets:[...new Set([...(Array.isArray(oldManual.specialBuckets)?oldManual.specialBuckets:[]),...specials])].sort()
};
const beforeMasked=structuredClone(targetProfile),afterMasked=structuredClone(next);
delete beforeMasked.fullLibraries;delete afterMasked.fullLibraries;
delete beforeMasked.manualAccess;delete afterMasked.manualAccess;
if(stableStringify(beforeMasked)!==stableStringify(afterMasked)) throw Error('UNRELATED_CANONICAL_FIELD_MUTATION');
function requireParity(snapshot){
 if(!snapshot?.lessonAccess || !Array.isArray(snapshot.views)) throw Error('TARGET_PREPARED_MISSING');
 for(const [id,sourceState] of Object.entries(srcAccess)){
   const targetState=snapshot.lessonAccess[id]||{};
   if(sourceState.core && (targetState.core!==true || targetState.blocked===true || targetState.preLessonOnly===true)) throw Error('TARGET_CORE_PARITY_FAILURE');
   if(sourceState.vr && (targetState.vr!==true || targetState.blocked===true)) throw Error('TARGET_VR_PARITY_FAILURE');
 }
 for(const id of sourceFullViews) if(!(snapshot.fullViewIds||[]).includes(id)) throw Error('FULL_LIBRARY_PARITY_FAILURE');
 for(const sp of specials) if(!(snapshot.specialAreas||[]).includes(sp)) throw Error('SPECIAL_ACCESS_PARITY_FAILURE');
 for(const v of sourceSnap.views||[]){
   if(v.lockedPreview || !/^(maths|english)-/.test(v.viewId)) continue;
   const matching=(snapshot.views||[]).find(t=>t.viewId===v.viewId);
   if(!matching || matching.lockedPreview || matching.openLessonCount < v.openLessonCount) throw Error('SUBJECT_VIEW_PARITY_FAILURE');
 }
}
const dryInput={...targetInput,user:next};
const dryCompiled=compileAuthoritativeAccessScope(dryInput,catalogue,await opaqueAccessScopeId(TARGET,salt),asOfDate);
assertCanonicalAccessProjected(dryInput,dryCompiled);
requireParity(dryCompiled.snapshot);
if((await kvText('STUDENTS_KV',targetKey))!==originalTargetText) throw Error('TARGET_CHANGED_BEFORE_WRITE');
if((await kvText('STUDENTS_KV','user:'+SOURCE))!==sourceText) throw Error('SOURCE_CHANGED_BEFORE_WRITE');
const updateText=JSON.stringify(next);
let canonicalWritten=false, published=null;
try {
  if(stableStringify(next)!==stableStringify(targetProfile)){
    await students.put(targetKey,updateText);
    canonicalWritten=true;
  }
  let readback=null;
  for(let n=0;n<5;n++){
    const raw=await kvText('STUDENTS_KV',targetKey);
    if(raw) {try{readback=JSON.parse(raw)}catch{}}
    if(readback && stableStringify(readback)===stableStringify(next)) break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!readback || stableStringify(readback)!==stableStringify(next)) throw Error('CANONICAL_READBACK_MISMATCH');
  published=await refreshStudentAccessReadModel(env,TARGET,{asOfDate});
  let confirmed=null;
  for(let n=0;n<6;n++){
    try{
      const found=await resolveCurrentScope(preparedStore,targetScope);
      if(found.sha256===published.sha256 && found.version===published.version) {
        requireParity(found.payload?.snapshot);
        confirmed=found;break;
      }
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!confirmed) throw Error('PREPARED_PUBLICATION_READBACK_FAILED');
  if((await kvText('STUDENTS_KV','user:'+SOURCE))!==sourceText) throw Error('SOURCE_MODIFIED_CONCURRENTLY');
  const unchangedNonAccess=structuredClone(readback);
  delete unchangedNonAccess.fullLibraries;delete unchangedNonAccess.manualAccess;
  if(stableStringify(unchangedNonAccess)!==stableStringify(beforeMasked)) throw Error('NON_ACCESS_PROFILE_CHANGED');
  const stat={marker:'AYUSH3108_ENGLISH_MATHS_FROM_MA0605_PASS',status:'PASS',
   sourceEffectiveCoreLessons:coreIds.length,sourceEffectiveVrLessons:vrIds.length,
   sourceFullLibrariesCopied:sourceLibraries.length,directCoreGrants:manualCore.length,
   directVrGrants:vrIds.length,specialAreasCopied:specials,
   targetPreparedReadback:true,sourceCanonicalUnchanged:true,
   targetUnrelatedProfileFieldsPreserved:true,otherStudentsUnchanged:true,
   noCredentialsDisclosed:true,noEmailsSent:true,
   canonicalMutation:canonicalWritten,preparedVersion:confirmed.version};
  console.log(JSON.stringify(stat,null,2));
} catch(error) {
  if(canonicalWritten) {
    const current=await kvText('STUDENTS_KV',targetKey);
    if(current!==updateText) throw Error('COPY_FAILED_CONCURRENT_TARGET_CHANGE_MANUAL_RECOVERY_REQUIRED');
    try {
      await students.put(targetKey,originalTargetText);
      await refreshStudentAccessReadModel(env,TARGET,{asOfDate});
      const rolled=await kvText('STUDENTS_KV',targetKey);
      if(rolled!==originalTargetText) throw Error('ROLLBACK_CANONICAL_READBACK_FAILED');
    } catch {throw Error('COPY_FAILED_ROLLBACK_INCOMPLETE_MANUAL_RECOVERY_REQUIRED');}
  }
  throw Error('COPY_FAILED_ROLLED_BACK_'+clean(error?.message||error).replace(/[^A-Z0-9_]/gi,'_').slice(0,100));
}
