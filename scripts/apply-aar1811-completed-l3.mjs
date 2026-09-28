import nodeCrypto from 'node:crypto';
import { compileAccessScopeV2 } from '../rebuild/adminops/src/lib/access-compiler-v2.mjs';
import { PREPARED_CATALOGUE } from '../rebuild/student/src/prepared-catalogue.generated.js';
import { publishScopeAtomic, resolveCurrentScope } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const token=String(process.env.CLOUDFLARE_API_TOKEN||'').trim();
const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const studentsNs=String(process.env.STUDENTS_KV_ID||'').trim();
const readModelsNs=String(process.env.READ_MODELS_KV_ID||'').trim();
const db=String(process.env.DB_ID||'').trim();
const apply=String(process.env.APPLY||'0').trim()==='1';
const asOf='2026-09-28';
const id='aar1811';
const assignmentId=161;
const quizGrant='MATHS_11PLUS_QUIZ_L3_COMPLETED';
if(!token||!account||!studentsNs||!readModelsNs||!db) throw new Error('PRODUCTION_INPUTS_REQUIRED');
if(!PREPARED_CATALOGUE) throw new Error('PREPARED_CATALOGUE_REQUIRED');
const base='https://api.cloudflare.com/client/v4';
const auth={Authorization:`Bearer ${token}`};
const upper=v=>String(v??'').trim().toUpperCase();

async function cfJson(path,init={}){
  const r=await fetch(`${base}${path}`,{...init,headers:{...auth,...(init.headers||{})}});
  const b=await r.json().catch(()=>null);
  if(!r.ok||b?.success!==true) throw new Error(`CF_FAILED:${r.status}:${path}`);
  return b;
}
async function d1Read(sql,params=[]){
  if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql)) throw new Error('READ_ONLY_SQL_REQUIRED');
  const b=await cfJson(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql,params})});
  return (Array.isArray(b.result)?b.result[0]:b.result)?.results||[];
}
async function d1Write(sql,params=[]){
  if(!apply) throw new Error('D1_WRITE_IN_DRY_RUN');
  return cfJson(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql,params})});
}
async function kvRaw(ns,key){
  const r=await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{headers:auth});
  if(r.status===404) return null;
  if(!r.ok) throw new Error(`KV_GET_FAILED:${r.status}:${key}`);
  return r.text();
}
async function kvJson(ns,key){const raw=await kvRaw(ns,key); if(raw==null)return null; return JSON.parse(raw);}
async function kvPut(ns,key,value){
  if(!apply) throw new Error('KV_WRITE_IN_DRY_RUN');
  const r=await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{method:'PUT',headers:{...auth,'content-type':'application/json'},body:typeof value==='string'?value:JSON.stringify(value)});
  const b=await r.json().catch(()=>null);
  if(!r.ok||b?.success!==true) throw new Error(`KV_PUT_FAILED:${r.status}:${key}`);
}
const store={get:key=>kvRaw(readModelsNs,key),put:(key,value)=>kvPut(readModelsNs,key,value)};

async function load(){
  const [user,defs,assignments,entitlements,pre]=await Promise.all([
    kvJson(studentsNs,`user:${id}`),
    d1Read('SELECT batch_key,academic_year,subject,school_year,stream,maths_level,active_from,active_to FROM batch_definitions ORDER BY batch_key'),
    d1Read('SELECT a.assignment_id,a.portal_user_id_norm,a.batch_key,a.effective_from,a.effective_to,b.subject,b.school_year,b.stream,b.maths_level,b.active_from AS batch_active_from,b.active_to AS batch_active_to FROM student_batch_assignments a LEFT JOIN batch_definitions b ON b.batch_key=a.batch_key WHERE a.portal_user_id_norm=? ORDER BY a.effective_from,a.assignment_id',[id]),
    d1Read('SELECT lesson_id,core_access,vr_access,source,source_batch_code,source_lesson_date,first_granted_at,last_confirmed_at FROM lesson_entitlements WHERE portal_user_id_norm=? ORDER BY source_lesson_date,lesson_id',[id]),
    d1Read('SELECT lesson_id,batch_key,lesson_date,vr_access,source_row_id,first_granted_at,last_confirmed_at FROM online_prelesson_entitlements WHERE portal_user_id_norm=? ORDER BY lesson_date,lesson_id',[id])
  ]);
  if(!user||typeof user!=='object') throw new Error('AAR1811_PROFILE_MISSING');
  return {user,defs,assignments,entitlements,pre};
}
function classifyProfile(user){
  const full=new Set((user.fullLibraries||[]).map(upper));
  for(const required of ['MATHS_L1_FULL','MATHS_L2_FULL']) if(!full.has(required)) throw new Error(`REQUIRED_LIBRARY_MISSING:${required}`);
  const old=full.has('MATHS_Y3_FULL')&&full.has('MATHS_Y6_FULL')&&!full.has('MATHS_L3_FULL')&&!(user.specialAccess||[]).includes(quizGrant);
  const target=!full.has('MATHS_Y3_FULL')&&!full.has('MATHS_Y6_FULL')&&full.has('MATHS_L3_FULL')&&(user.specialAccess||[]).includes(quizGrant);
  if(!old&&!target) throw new Error(`AAR1811_PROFILE_STATE_UNEXPECTED:${JSON.stringify([...full].filter(x=>x.startsWith('MATHS_')).sort())}`);
  return old?'old':'target';
}
function targetUser(user){
  const next=structuredClone(user);
  next.fullLibraries=[...(user.fullLibraries||[]).filter(v=>!['MATHS_Y3_FULL','MATHS_Y6_FULL','MATHS_L3_FULL'].includes(upper(v))),'MATHS_L3_FULL'];
  next.specialAccess=[...new Set([...(user.specialAccess||[]),quizGrant])];
  return next;
}
function assignmentState(assignments){
  const maths=assignments.filter(r=>String(r.subject||'').toLowerCase()==='maths');
  const wrong=maths.filter(r=>Number(r.assignment_id)===assignmentId&&r.batch_key==='Y611FM'&&r.portal_user_id_norm===id);
  if(maths.length===1&&wrong.length===1) return 'old';
  if(maths.length===0) return 'target';
  throw new Error(`AAR1811_MATHS_ASSIGNMENT_STATE_UNEXPECTED:${JSON.stringify(maths.map(r=>({id:r.assignment_id,batch:r.batch_key,to:r.effective_to})))}`);
}
function compileTarget(state,scopeId){
  const input={asOfDate:asOf,user:targetUser(state.user),batchDefinitions:state.defs,batchAssignments:state.assignments.filter(r=>Number(r.assignment_id)!==assignmentId),entitlements:state.entitlements,onlinePreLessonEntitlements:state.pre};
  const payload=compileAccessScopeV2(input,PREPARED_CATALOGUE,{asOfDate:asOf,scopeId});
  const views=(payload?.snapshot?.views||[]).filter(v=>v.subject==='maths'&&!v.lockedPreview);
  const ids=new Set(views.map(v=>v.viewId));
  for(const wanted of ['maths-level1','maths-level2','maths-level3','maths-sats']) if(!ids.has(wanted)) throw new Error(`MISSING_TARGET_VIEW:${wanted}`);
  for(const forbidden of ['maths-year3','maths-year6']) if(ids.has(forbidden)) throw new Error(`FORBIDDEN_TARGET_VIEW:${forbidden}`);
  const access=payload?.snapshot?.lessonAccess||{};
  const counts=viewId=>{const ls=PREPARED_CATALOGUE.views?.[viewId]?.lessons||[]; const open=ls.filter(x=>access[x.lessonId]?.core).length; return {total:ls.length,open,locked:ls.length-open};};
  const c={l1:counts('maths-level1'),l2:counts('maths-level2'),l3:counts('maths-level3'),sats:counts('maths-sats')};
  for(const k of ['l1','l2','l3']) if(c[k].open!==c[k].total||c[k].total<1) throw new Error(`${k.toUpperCase()}_NOT_FULL`);
  if(c.sats.total!==19||c.sats.open!==1||c.sats.locked!==18) throw new Error(`SATS_COUNT_MISMATCH:${JSON.stringify(c.sats)}`);
  return {payload,counts:c,views:views.map(v=>({viewId:v.viewId,label:v.label,current:v.current,group:v.group}))};
}

const state=await load();
const profileState=classifyProfile(state.user);
const assignmentBefore=assignmentState(state.assignments);
const sats=state.entitlements.filter(r=>/^Y6M(5[1-9]|6[0-9])$/.test(String(r.lesson_id))&&Number(r.core_access??1)!==0).map(r=>r.lesson_id).sort();
if(JSON.stringify(sats)!==JSON.stringify(['Y6M51'])) throw new Error(`SATS_SOURCE_CHANGED:${JSON.stringify(sats)}`);
const scopeSalt=String(await kvRaw(readModelsNs,'meta:scope-salt')||'').trim();
if(!/^[0-9a-f]{64}$/i.test(scopeSalt)) throw new Error('SCOPE_SALT_INVALID');
const scopeId=`u-${nodeCrypto.createHmac('sha256',scopeSalt).update(`rebuild-shadow-scope-v1:${id}`).digest('hex').slice(0,40)}`;
const scope=`access:${scopeId}`;
const baseline=await resolveCurrentScope(store,scope);
if(baseline.usedFallback) throw new Error('BASELINE_READ_MODEL_USING_FALLBACK');
const preview=compileTarget(state,scopeId);
console.log(JSON.stringify({apply,profileState,assignmentBefore,scope,scopeId,baselineVersion:baseline.version,views:preview.views,counts:preview.counts,sats}));
if(!apply){console.log('AAR1811_COMPLETED_L3_DRY_RUN_PASS');process.exit(0);}

if(assignmentBefore==='old'){
  await d1Write('DELETE FROM student_batch_assignments WHERE assignment_id=? AND portal_user_id_norm=? AND batch_key=?',[assignmentId,id,'Y611FM']);
  const check=await d1Read('SELECT assignment_id,batch_key FROM student_batch_assignments WHERE assignment_id=? OR (portal_user_id_norm=? AND lower(COALESCE((SELECT subject FROM batch_definitions WHERE batch_key=student_batch_assignments.batch_key),""))="maths")',[assignmentId,id]);
  if(check.length!==0) throw new Error(`MATHS_ASSIGNMENT_DELETE_VERIFY_FAILED:${JSON.stringify(check)}`);
}
if(profileState==='old'){
  await kvPut(studentsNs,`user:${id}`,targetUser(state.user));
}

const actual=await load();
if(classifyProfile(actual.user)!=='target') throw new Error('PROFILE_POSTWRITE_NOT_TARGET');
if(assignmentState(actual.assignments)!=='target') throw new Error('ASSIGNMENT_POSTWRITE_NOT_TARGET');
const actualSats=actual.entitlements.filter(r=>/^Y6M(5[1-9]|6[0-9])$/.test(String(r.lesson_id))&&Number(r.core_access??1)!==0).map(r=>r.lesson_id).sort();
if(JSON.stringify(actualSats)!==JSON.stringify(['Y6M51'])) throw new Error(`SATS_CHANGED_DURING_APPLY:${JSON.stringify(actualSats)}`);
const currentBeforePublish=await resolveCurrentScope(store,scope);
if(currentBeforePublish.version!==baseline.version||currentBeforePublish.sha256!==baseline.sha256) throw new Error('READ_MODEL_POINTER_CHANGED_CONCURRENTLY');
const compiled=compileTarget(actual,scopeId);
const published=await publishScopeAtomic(store,{scope,payload:compiled.payload,updatedAt:new Date().toISOString()});
const resolved=await resolveCurrentScope(store,scope);
if(resolved.usedFallback||resolved.version!==published.version) throw new Error('POSTPUBLISH_RESOLVE_FAILED');
const finalViews=(resolved.payload?.snapshot?.views||[]).filter(v=>v.subject==='maths'&&!v.lockedPreview).map(v=>v.viewId).sort();
const expected=['maths-level1','maths-level2','maths-level3','maths-sats'].sort();
if(JSON.stringify(finalViews)!==JSON.stringify(expected)) throw new Error(`FINAL_VIEWS_MISMATCH:${JSON.stringify(finalViews)}`);
console.log(JSON.stringify({publishedVersion:published.version,previousVersion:published.previousVersion,finalViews,counts:compiled.counts,quizGrantPresent:(actual.user.specialAccess||[]).includes(quizGrant),sats:actualSats}));
console.log('AAR1811_COMPLETED_L3_PRODUCTION_APPLY_PASS');
