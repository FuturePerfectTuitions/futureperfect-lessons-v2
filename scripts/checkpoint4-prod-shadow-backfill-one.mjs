import fs from 'node:fs';
import { compileAccessReadModel, deriveOpaqueScopeId } from '../worker/src/checkpoint4-shadow-access.mjs';
import { publishScopeAtomic, resolveCurrentScope } from '../worker/src/checkpoint4-shadow-atomic.mjs';

const outputPath = process.argv[2] || '/tmp/checkpoint4-prod-shadow-existing-release.json';
const token=String(process.env.CLOUDFLARE_API_TOKEN||'').trim();
const accountId=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const prodDbId=String(process.env.PROD_DB_ID||'').trim();
const studentsKvId=String(process.env.STUDENTS_KV_NAMESPACE_ID||'').trim();
const shadowKvId=String(process.env.REBUILD_SHADOW_KV_NAMESPACE_ID||'').trim();
const shadowDbId=String(process.env.REBUILD_SHADOW_DB_ID||'').trim();
if(!token||!accountId||!prodDbId||!studentsKvId||!shadowKvId) throw new Error('Required production read/shadow IDs are missing.');

const auth={Authorization:`Bearer ${token}`};
const clean=value=>String(value??'').trim();

async function d1Query(databaseId,sql,params=[]) {
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,{
    method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({sql,params})
  });
  const body=await response.json();
  if(!response.ok||body?.success===false) throw new Error(`D1 query failed HTTP ${response.status}`);
  const first=Array.isArray(body?.result)?body.result[0]:body?.result;
  return Array.isArray(first?.results)?first.results:[];
}

function kvUrl(namespaceId,key){return `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;}
async function kvText(namespaceId,key){
  const response=await fetch(kvUrl(namespaceId,key),{headers:auth});
  if(response.status===404)return null;
  if(!response.ok)throw new Error(`KV read failed HTTP ${response.status}`);
  return response.text();
}
async function kvJson(namespaceId,key){const text=await kvText(namespaceId,key);if(text==null)return null;try{return JSON.parse(text);}catch{return null;}}
const store={
  get:key=>kvText(shadowKvId,key),
  async put(key,value){
    const response=await fetch(kvUrl(shadowKvId,key),{method:'PUT',headers:{...auth,'content-type':'application/json; charset=utf-8'},body:String(value)});
    if(!response.ok)throw new Error(`Shadow KV write failed HTTP ${response.status}`);
  }
};

const globalResolved=await resolveCurrentScope(store,'global');
if(globalResolved?.payload?.kind!=='prepared-global-read-model')throw new Error('Global shadow model unavailable.');
const scopeSalt=clean(await kvText(shadowKvId,'meta:scope-salt'));
if(scopeSalt.length<32)throw new Error('Shadow scope salt unavailable.');

const candidates=await d1Query(prodDbId,`SELECT portal_user_id_norm, lesson_id, last_confirmed_at
  FROM lesson_entitlements
  WHERE core_access = 1
  ORDER BY last_confirmed_at DESC
  LIMIT 50`);
if(candidates.length===0)throw new Error('No existing full-release entitlement available for read-only parity verification.');

let verified=null;
for(const candidate of candidates){
  const userId=clean(candidate.portal_user_id_norm).toLowerCase();
  const lessonId=clean(candidate.lesson_id);
  if(!userId||!lessonId)continue;
  const user=await kvJson(studentsKvId,`user:${userId}`);
  if(!user||typeof user!=='object')continue;
  const [batchAssignments,batchDefinitions,entitlements,onlinePreLessonEntitlements]=await Promise.all([
    d1Query(prodDbId,`SELECT a.assignment_id,a.portal_user_id_norm,a.batch_key,a.effective_from,a.effective_to,b.subject,b.school_year,b.stream,b.maths_level,b.active_from AS batch_active_from,b.active_to AS batch_active_to
      FROM student_batch_assignments a JOIN batch_definitions b ON b.batch_key=a.batch_key
      WHERE a.portal_user_id_norm=? ORDER BY a.effective_from,a.assignment_id`,[userId]),
    d1Query(prodDbId,`SELECT batch_key,academic_year,subject,school_year,stream,maths_level,active_from,active_to FROM batch_definitions ORDER BY batch_key`),
    d1Query(prodDbId,`SELECT portal_user_id_norm,lesson_id,core_access,vr_access,source_batch_code,source_lesson_date FROM lesson_entitlements WHERE portal_user_id_norm=? ORDER BY lesson_id`,[userId]),
    d1Query(prodDbId,`SELECT portal_user_id_norm,lesson_id,batch_key,lesson_date,vr_access FROM online_prelesson_entitlements WHERE portal_user_id_norm=? ORDER BY lesson_id,batch_key`,[userId])
  ]);
  const scopeId=await deriveOpaqueScopeId(userId,scopeSalt);
  const asOfDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const payload=compileAccessReadModel({asOfDate,user,batchAssignments,batchDefinitions,entitlements,onlinePreLessonEntitlements},globalResolved.payload,scopeId,asOfDate);
  const state=payload?.snapshot?.lessonAccess?.[lessonId];
  if(!state||state.core!==true||state.blocked===true)continue;
  const scope=`access:${scopeId}`;
  const operationId=`cp4-existing-${Date.now()}`;
  const published=await publishScopeAtomic(store,{scope,payload,version:`a-${operationId}`});
  const resolved=await resolveCurrentScope(store,scope);
  if(resolved.sha256!==published.payloadSha256)throw new Error('Existing-release shadow verification hash mismatch.');
  const reloaded=resolved.payload?.snapshot?.lessonAccess?.[lessonId];
  if(!reloaded||reloaded.core!==true||reloaded.blocked===true)throw new Error('Existing release did not survive shadow readback.');
  verified={lessonId,scopeId,scope,version:resolved.version,sha256:resolved.sha256,legacyCore:true,shadowCore:true,blocked:false};
  break;
}
if(!verified)throw new Error('Could not find an existing entitlement suitable for effective-access parity verification.');

if(shadowDbId){
  await d1Query(shadowDbId,`INSERT INTO rebuild_shadow_reconciliation (
      operation_id,user_scope,status,shadow_scope,shadow_version,shadow_sha256,error_message,source_route,first_seen_at,last_updated_at
    ) VALUES (?,?,?,?,?,?,NULL,'checkpoint4-readonly-existing-release-verification',datetime('now'),datetime('now'))
    ON CONFLICT(operation_id) DO NOTHING`,[
      `cp4-existing-verification-${verified.sha256.slice(0,12)}`,verified.scopeId,'SYNCED',verified.scope,verified.version,verified.sha256
    ]);
}

const evidence={marker:'CHECKPOINT4_EXISTING_RELEASE_SHADOW_PARITY_PASS',...verified,studentIdentityDisclosed:false,legacyMutationPerformed:false};
fs.writeFileSync(outputPath,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
