import fs from 'node:fs';
import { compileAccessScope, globalToCatalogue } from '../rebuild/adminops/src/lib/compiler.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import {
  stableStringify,
  sha256Hex,
  pointerKey,
  publishScopeAtomic,
  resolveCurrentScope
} from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const clean=v=>String(v??'').trim(), norm=v=>clean(v).toLowerCase();
const account=clean(process.env.CLOUDFLARE_ACCOUNT_ID),token=clean(process.env.CLOUDFLARE_API_TOKEN);
const allowWrite=norm(process.env.ALLOW_WRITE)==='true';
const worker=clean(process.env.LEGACY_WORKER||'fpt-portal-v2-worker');
const readNs=clean(process.env.READ_MODELS_KV||'77b35165c8694087bc1b0515c35a7e89');
const expectedStudents=clean(process.env.STUDENTS_KV||'c9723c8806334e4ea54d1b456d31b794');
const expectedDb=clean(process.env.D1_ID||'97250a54-fa91-45ad-a002-3c4566b1fc38');
const asOfDate=clean(process.env.AS_OF_DATE||'2026-09-16');
const target='ann3009';
const targetLesson='Y6M2.2';
if(!account||!token)throw new Error('Cloudflare credentials required');
const base='https://api.cloudflare.com/client/v4',headers={Authorization:`Bearer ${token}`};
async function req(path,opt={}){const r=await fetch(base+path,{...opt,headers:{...headers,...(opt.headers||{})}});const text=await r.text();let body=null;try{body=JSON.parse(text)}catch{}return{r,text,body}}
async function envp(path,opt={}){const o=await req(path,opt);if(!o.r.ok||o.body?.success!==true)throw new Error(`${o.r.status} ${path}: ${JSON.stringify(o.body?.errors||[])}`);return o.body.result}
async function kvText(ns,key){const o=await req(`/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`);if(o.r.status===404)return null;if(!o.r.ok)throw new Error(`KV read ${o.r.status}: ${key}`);return o.text}
async function kvJson(ns,key){const t=await kvText(ns,key);return t==null?null:JSON.parse(t)}
async function kvPut(ns,key,value){if(!allowWrite)throw new Error('WRITE_GUARD_BLOCKED');const o=await req(`/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{method:'PUT',headers:{'content-type':'text/plain; charset=utf-8'},body:String(value)});if(!o.r.ok)throw new Error(`KV write ${o.r.status}: ${key}`)}
async function d1(db,sql){if(!/^\s*SELECT\b/i.test(sql)||/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM)\b/i.test(sql))throw new Error('Read-only D1 guard');const result=await envp(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql})});const first=Array.isArray(result)?result[0]:result;return Array.isArray(first?.results)?first.results:[]}
const store={get:key=>kvText(readNs,key),put:(key,value)=>kvPut(readNs,key,value)};

const settings=await envp(`/accounts/${account}/workers/scripts/${encodeURIComponent(worker)}/settings`),binding=n=>(settings.bindings||[]).find(x=>x.name===n)||{};
const students=clean(binding('STUDENTS_KV').namespace_id),db=clean(binding('DB').database_id||binding('DB').id);
if(students!==expectedStudents||db!==expectedDb)throw new Error(`Production source binding drift: ${students}/${db}`);
const readBinding=(settings.bindings||[]).find(x=>x.name==='REBUILD_SHADOW_KV');
if(readBinding?.namespace_id!==readNs)throw new Error('Prepared-model binding drift');
const salt=clean(await kvText(readNs,'meta:scope-salt'));if(!/^[0-9a-f]{64}$/i.test(salt))throw new Error('scope salt invalid');
const global=await resolveCurrentScope(store,'global'),catalogue=globalToCatalogue(global.payload);
const [defs,assignments,ents,pre]=await Promise.all([
 d1(db,'SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions'),
 d1(db,`SELECT a.portal_user_id_norm, a.batch_key, a.effective_from, a.effective_to, b.subject, b.school_year, b.stream, b.maths_level, b.active_from AS batch_active_from, b.active_to AS batch_active_to FROM student_batch_assignments a JOIN batch_definitions b ON b.batch_key=a.batch_key WHERE lower(a.portal_user_id_norm)='${target}'`),
 d1(db,`SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source, first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date FROM lesson_entitlements WHERE lower(portal_user_id_norm)='${target}'`),
 d1(db,`SELECT portal_user_id_norm, lesson_id, batch_key, lesson_date, vr_access, source_row_id, first_granted_at, last_confirmed_at FROM online_prelesson_entitlements WHERE lower(portal_user_id_norm)='${target}'`)
]);
const targetEntitlement=ents.find(x=>clean(x.lesson_id)===targetLesson);
if(!targetEntitlement||Number(targetEntitlement.core_access)!==1)throw new Error(`Annisha D1 full entitlement missing for ${targetLesson}`);
const user=await kvJson(students,`user:${target}`);if(!user)throw new Error('Annisha profile missing');
const scopeId=await opaqueAccessScopeId(target,salt),scope=`access:${scopeId}`,beforeRaw=await kvText(readNs,pointerKey(scope));if(!beforeRaw)throw new Error('Annisha prepared pointer missing');
const beforePointer=JSON.parse(beforeRaw),before=await resolveCurrentScope(store,scope);
const input={asOfDate,user,batchDefinitions:defs,batchAssignments:assignments,entitlements:ents,onlinePreLessonEntitlements:pre};
const expected=compileAccessScope(input,catalogue,{scopeId,asOfDate});
if(stableStringify(before.payload)===stableStringify(expected))throw new Error('Annisha prepared access is already current; repair no longer required');
const report={marker:'FIX_IMPORTER_ANNISHA_PREPARED_ACCESS_REPAIR',mode:allowWrite?'WRITE':'DRY_RUN',asOfDate,observedAt:new Date().toISOString(),portalUserId:target,targetLesson,d1TargetEntitlement:{coreAccess:Number(targetEntitlement.core_access),vrAccess:Number(targetEntitlement.vr_access||0),sourceBatchCode:clean(targetEntitlement.source_batch_code),sourceLessonDate:clean(targetEntitlement.source_lesson_date)},scope,beforeVersion:before.version,status:allowWrite?'PENDING':'DRY_RUN_PASS',published:null,rollback:null};
if(!allowWrite){fs.writeFileSync('/tmp/fix-importer-annisha-repair.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exit(0)}
let mutated=false;
try{
 const immediate=await kvText(readNs,pointerKey(scope));if(immediate!==beforeRaw)throw new Error('Concurrent pointer change detected for Annisha');
 const sha=await sha256Hex(stableStringify(expected)),version=`fix-annisha-${sha.slice(0,16)}-${clean(process.env.GITHUB_RUN_ID||Date.now())}`;
 const published=await publishScopeAtomic(store,{scope,payload:expected,version,updatedAt:new Date().toISOString()});mutated=true;
 const after=await resolveCurrentScope(store,scope);if(stableStringify(after.payload)!==stableStringify(expected))throw new Error('Post-publish Annisha payload mismatch');
 report.published={version:published.version,previousVersion:published.previousVersion,payloadSha256:published.payloadSha256};report.afterVersion=after.version;report.status='WRITE_PASS';report.completedAt=new Date().toISOString();
}catch(error){
 if(mutated){await kvPut(readNs,pointerKey(scope),beforeRaw);const restored=await resolveCurrentScope(store,scope);const ok=clean(restored.version)===clean(beforePointer?.current?.version)&&clean(restored.sha256)===clean(beforePointer?.current?.sha256);report.rollback={attempted:true,ok,restoredVersion:restored.version};if(!ok)report.rollbackFailure='Rollback verification failed';}
 report.status='WRITE_FAILED_ROLLED_BACK';report.error=String(error?.message||error);fs.writeFileSync('/tmp/fix-importer-annisha-repair.json',JSON.stringify(report,null,2)+'\n');throw error;
}
fs.writeFileSync('/tmp/fix-importer-annisha-repair.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
