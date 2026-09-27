import nodeCrypto from 'node:crypto';
import { compileAccessScopeV2 } from '../rebuild/adminops/src/lib/access-compiler-v2.mjs';
import {
  stableStringify,
  sha256Hex,
  pointerKey,
  versionKey,
  resolveCurrentScope
} from '../rebuild/adminops/src/lib/atomic-publisher.mjs';
import {
  viewIdForBatch,
  fullLibraryViewIds,
  isSatsLessonId
} from '../rebuild/shared/read-models/view-registry.mjs';
import { authoritativeBatchViewId } from '../rebuild/adminops/src/lib/backfill-parity-audit.mjs';
import { PREPARED_CATALOGUE } from '../rebuild/student/src/prepared-catalogue.generated.js';

const token=String(process.env.CLOUDFLARE_API_TOKEN||'').trim();
const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const studentsNs=String(process.env.STUDENTS_KV_ID||'').trim();
const readModelsNs=String(process.env.READ_MODELS_KV_ID||'').trim();
const db=String(process.env.DB_ID||'').trim();
const asOf=String(process.env.AS_OF_DATE||'2026-09-27').trim();
const apply=String(process.env.APPLY||'0').trim()==='1';
if(!token||!account||!studentsNs||!readModelsNs||!db) throw new Error('Cloudflare production inputs are required.');
if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('AS_OF_DATE_INVALID');

const base='https://api.cloudflare.com/client/v4';
const auth={Authorization:`Bearer ${token}`};
const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toLowerCase();
const upper=v=>clean(v).toUpperCase();
const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(clean(v))?clean(v):'';
const lessonId=row=>clean(row?.lesson_id??row?.lessonId);
const tag=value=>nodeCrypto.createHash('sha256').update(String(value)).digest('hex').slice(0,12);

async function cfJson(path,init={}){
  const response=await fetch(`${base}${path}`,{...init,headers:{...auth,...(init.headers||{})}});
  const body=await response.json().catch(()=>null);
  if(!response.ok||body?.success!==true) throw new Error(`CF_API_FAILED:${response.status}:${path}`);
  return body;
}
async function d1(sql,params=[]){
  if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql)) throw new Error('READ_ONLY_SQL_ONLY');
  const body=await cfJson(`/accounts/${account}/d1/database/${db}/query`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql,params})
  });
  const result=Array.isArray(body.result)?body.result[0]:body.result;
  return result?.results||[];
}
async function kvRaw(namespace,key){
  const response=await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${namespace}/values/${encodeURIComponent(key)}`,{headers:auth});
  if(response.status===404)return null;
  if(!response.ok)throw new Error(`KV_GET_FAILED:${response.status}:${namespace}`);
  return response.text();
}
async function kvJson(namespace,key){
  const raw=await kvRaw(namespace,key); if(raw==null)return null;
  try{return JSON.parse(raw);}catch{throw new Error(`KV_JSON_INVALID:${tag(key)}`);}
}
async function kvPut(namespace,key,value){
  if(!apply)throw new Error('WRITE_ATTEMPT_IN_DRY_RUN');
  const response=await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${namespace}/values/${encodeURIComponent(key)}`,{
    method:'PUT',headers:{...auth,'content-type':'text/plain; charset=utf-8'},body:String(value)
  });
  const body=await response.json().catch(()=>null);
  if(!response.ok||body?.success!==true)throw new Error(`KV_PUT_FAILED:${response.status}:${tag(key)}`);
}
async function listStudentUserKeys(){
  const keys=[]; let cursor='';
  do{
    const query=new URLSearchParams({prefix:'user:',limit:'1000'}); if(cursor)query.set('cursor',cursor);
    const body=await cfJson(`/accounts/${account}/storage/kv/namespaces/${studentsNs}/keys?${query}`);
    for(const item of body.result||[])if(clean(item?.name).startsWith('user:'))keys.push(clean(item.name));
    cursor=clean(body?.result_info?.cursor);
  }while(cursor);
  return [...new Set(keys)].sort();
}

function started(row){const from=date(row?.effective_from);return !from||from<=asOf;}
function current(row){
  const from=date(row?.effective_from),to=date(row?.effective_to),bf=date(row?.batch_active_from),bt=date(row?.batch_active_to);
  return (!from||from<=asOf)&&(!to||asOf<to)&&(!bf||bf<=asOf)&&(!bt||asOf<bt);
}
function globalPayloadFromCatalogue(catalogue){
  return {
    schemaVersion:1,
    kind:'prepared-global-read-model',
    source:catalogue.source,
    navigation:catalogue.navigation,
    catalogues:catalogue.views,
    lessonToViews:catalogue.lessonToViews,
    counts:Object.fromEntries((catalogue.navigation||[]).map(view=>[view.viewId,Number(view.lessonCount||0)]))
  };
}
function validateCatalogue(catalogue){
  if(catalogue?.kind!=='prepared-catalogue')throw new Error('CANDIDATE_CATALOGUE_MISSING');
  if((catalogue.navigation||[]).length!==16)throw new Error(`CANDIDATE_VIEW_COUNT:${catalogue.navigation?.length}`);
  if(catalogue.views?.['maths-year6']?.label!=='Lessons')throw new Error('YEAR6_LABEL_NOT_LESSONS');
  if(catalogue.views?.['maths-level3']?.label!=='L3')throw new Error('L3_LABEL_CHANGED');
  if(catalogue.views?.['maths-sats']?.label!=='SATS')throw new Error('SATS_LABEL_MISSING');
  const sats=(catalogue.views['maths-sats'].lessons||[]).map(row=>row.lessonId);
  if(sats.length!==19||sats.some(id=>!isSatsLessonId(id)))throw new Error(`SATS_CATALOGUE_INVALID:${sats.length}`);
  const normal=catalogue.views['maths-year6'].lessons||[];
  if(normal.length!==50||normal.some(row=>isSatsLessonId(row.lessonId)))throw new Error(`YEAR6_LESSONS_CATALOGUE_INVALID:${normal.length}`);
}

function definitionsMap(rows){return new Map(rows.map(row=>[upper(row.batch_key),row]).filter(([key])=>key));}
function profileRelevant(user,definitions){
  const full=new Set((user?.fullLibraries||[]).map(upper));
  if(full.has('MATHS_Y6_FULL')||full.has('MATHS_L3_FULL'))return true;
  const historical=new Set((user?.historicalViews||[]).map(norm));
  if(historical.has('maths-year6')||historical.has('maths-level3'))return true;
  for(const batch of user?.batches||[]){
    const id=authoritativeBatchViewId(batch,definitions);
    if(id==='maths-year6'||id==='maths-level3')return true;
  }
  return false;
}
function deriveScopeId(userId,scopeSalt){
  const digest=nodeCrypto.createHmac('sha256',scopeSalt).update(`rebuild-shadow-scope-v1:${norm(userId)}`).digest('hex');
  return `u-${digest.slice(0,40)}`;
}

async function loadInput(id,defs){
  const [user,assignments,entitlements,pre]=await Promise.all([
    kvJson(studentsNs,`user:${id}`),
    d1('SELECT a.batch_key,a.effective_from,a.effective_to,b.subject,b.school_year,b.stream,b.maths_level,b.active_from AS batch_active_from,b.active_to AS batch_active_to FROM student_batch_assignments a LEFT JOIN batch_definitions b ON b.batch_key=a.batch_key WHERE a.portal_user_id_norm=? ORDER BY a.effective_from,a.batch_key',[id]),
    d1('SELECT lesson_id,core_access,vr_access,source,source_batch_code,source_lesson_date,first_granted_at,last_confirmed_at FROM lesson_entitlements WHERE portal_user_id_norm=? ORDER BY source_lesson_date,lesson_id',[id]),
    d1('SELECT lesson_id,batch_key,lesson_date,vr_access,source_row_id,first_granted_at,last_confirmed_at FROM online_prelesson_entitlements WHERE portal_user_id_norm=? ORDER BY lesson_date,lesson_id',[id])
  ]);
  if(!user)throw new Error(`MISSING_PROFILE:${tag(id)}`);
  return {asOfDate:asOf,user,batchDefinitions:defs,batchAssignments:assignments,entitlements,onlinePreLessonEntitlements:pre};
}

function assertCompiled(id,input,payload,currentRoster){
  const pseudonym=tag(id),snapshot=payload?.snapshot;
  if(!snapshot||!Array.isArray(snapshot.views))throw new Error(`SNAPSHOT_INVALID:${pseudonym}`);
  const maths=snapshot.views.filter(view=>view.subject==='maths'&&view.current&&!view.lockedPreview);
  const teaching=maths.filter(view=>view.viewId==='maths-year6'||view.viewId==='maths-level3');
  if(teaching.length>1)throw new Error(`Y6_L3_COLLISION:${pseudonym}`);
  if(teaching.some(view=>view.viewId==='maths-year6'&&view.label!=='Lessons'))throw new Error(`YEAR6_LABEL_MISMATCH:${pseudonym}`);
  if(teaching.some(view=>view.viewId==='maths-level3'&&view.label!=='L3'))throw new Error(`L3_LABEL_MISMATCH:${pseudonym}`);

  if(currentRoster.has(id)){
    const expected=[...new Set((input.batchAssignments||[]).filter(current).map(viewIdForBatch).filter(view=>view==='maths-year6'||view==='maths-level3'))];
    if(expected.length!==1||teaching.length!==1||teaching[0].viewId!==expected[0]){
      throw new Error(`CURRENT_PROGRAMME_MISMATCH:${pseudonym}:${expected.join(',')}:${teaching.map(v=>v.viewId).join(',')}`);
    }
  }

  const blocked=new Set((input.user?.blockedLessons||[]).map(clean));
  const satsExpected=(input.entitlements||[]).some(row=>Number(row.core_access??1)!==0&&isSatsLessonId(lessonId(row)))||
    (input.onlinePreLessonEntitlements||[]).some(row=>isSatsLessonId(lessonId(row)));
  const sats=maths.find(view=>view.viewId==='maths-sats');
  if(Boolean(sats)!==satsExpected)throw new Error(`SATS_VISIBILITY_MISMATCH:${pseudonym}:${satsExpected}`);
  if(sats&&sats.label!=='SATS')throw new Error(`SATS_LABEL_MISMATCH:${pseudonym}`);
  if(!satsExpected&&(input.user?.fullLibraries||[]).map(upper).includes('MATHS_Y6_FULL')&&sats){
    throw new Error(`FULL_LIBRARY_CREATED_SATS:${pseudonym}`);
  }

  for(const row of input.entitlements||[]){
    const lid=lessonId(row); if(!lid||Number(row.core_access??1)===0||blocked.has(lid))continue;
    if(!snapshot.lessonAccess?.[lid]?.core)throw new Error(`CORE_ENTITLEMENT_LOST:${pseudonym}:${lid}`);
  }
  for(const row of input.onlinePreLessonEntitlements||[]){
    const lid=lessonId(row); if(!lid||blocked.has(lid))continue;
    const state=snapshot.lessonAccess?.[lid]; if(!state||(!state.core&&!state.preLessonOnly))throw new Error(`PRELESSON_LOST:${pseudonym}:${lid}`);
  }
  for(const viewId of fullLibraryViewIds(input.user?.fullLibraries||[])){
    if(!snapshot.views.some(view=>view.viewId===viewId))throw new Error(`FULL_LIBRARY_VIEW_LOST:${pseudonym}:${viewId}`);
  }
  for(const viewId of (input.batchAssignments||[]).filter(row=>started(row)&&!current(row)).map(viewIdForBatch).filter(Boolean)){
    if(!snapshot.views.some(view=>view.viewId===viewId))throw new Error(`HISTORICAL_VIEW_LOST:${pseudonym}:${viewId}`);
  }
  return {programme:teaching[0]?.viewId||null,sats:satsExpected};
}

const store={
  async get(key){return kvRaw(readModelsNs,key);},
  async put(key,value){return kvPut(readModelsNs,key,value);}
};

function candidateRecord(scope,payload){
  return Promise.resolve().then(async()=>{
    const payloadText=stableStringify(payload),sha=await sha256Hex(payloadText),version=sha.slice(0,24);
    const envelope={schemaVersion:1,kind:'prepared-read-model-envelope',scope,version,sha256:sha,payload};
    const text=stableStringify(envelope),envelopeSha256=await sha256Hex(text);
    return {scope,payload,sha,version,envelope,text,envelopeSha256,key:versionKey(scope,version)};
  });
}
async function currentBaseline(scope){
  try{
    const resolved=await resolveCurrentScope(store,scope);
    if(resolved.usedFallback)throw new Error(`CURRENT_SCOPE_USING_FALLBACK:${tag(scope)}`);
    return {exists:true,version:resolved.version,sha:resolved.sha256,envelopeSha256:resolved.envelopeSha256};
  }catch(error){
    if(String(error?.message)==='READ_MODEL_POINTER_UNAVAILABLE')return {exists:false};
    throw error;
  }
}
async function assertBaselineUnchanged(scope,baseline){
  const pointer=await kvJson(readModelsNs,pointerKey(scope));
  if(!baseline.exists){if(pointer!=null)throw new Error(`POINTER_APPEARED:${tag(scope)}`);return;}
  if(clean(pointer?.current?.version)!==baseline.version||clean(pointer?.current?.sha256)!==baseline.sha||clean(pointer?.current?.envelopeSha256)!==baseline.envelopeSha256){
    throw new Error(`POINTER_CHANGED_CONCURRENTLY:${tag(scope)}`);
  }
}
async function verifyCandidate(record){
  const raw=await kvRaw(readModelsNs,record.key); if(raw==null)throw new Error(`CANDIDATE_MISSING:${tag(record.scope)}`);
  const envelope=JSON.parse(raw),sha=await sha256Hex(stableStringify(envelope.payload)),envelopeSha=await sha256Hex(raw);
  if(envelope.kind!=='prepared-read-model-envelope'||envelope.scope!==record.scope||envelope.version!==record.version||sha!==record.sha||clean(envelope.sha256)!==record.sha||envelopeSha!==record.envelopeSha256){
    throw new Error(`CANDIDATE_VERIFY_FAILED:${tag(record.scope)}`);
  }
}
function pointerFor(record,baseline,updatedAt){
  return {
    schemaVersion:1,kind:'prepared-read-model-pointer',scope:record.scope,
    current:{version:record.version,sha256:record.sha,envelopeSha256:record.envelopeSha256},
    previous:baseline.exists?{version:baseline.version,sha256:baseline.sha,envelopeSha256:baseline.envelopeSha256}:null,
    updatedAt
  };
}
async function switchPointer(record,baseline,updatedAt){
  await assertBaselineUnchanged(record.scope,baseline);
  await kvPut(readModelsNs,pointerKey(record.scope),stableStringify(pointerFor(record,baseline,updatedAt)));
  const confirmed=await resolveCurrentScope(store,record.scope);
  if(confirmed.version!==record.version||confirmed.sha256!==record.sha||confirmed.usedFallback)throw new Error(`POINTER_SWITCH_VERIFY_FAILED:${tag(record.scope)}`);
}

validateCatalogue(PREPARED_CATALOGUE);
const scopeSalt=clean(await kvRaw(readModelsNs,'meta:scope-salt'));
if(!/^[0-9a-f]{64}$/i.test(scopeSalt))throw new Error('SCOPE_SALT_INVALID');
const defs=await d1('SELECT batch_key,academic_year,subject,school_year,stream,maths_level,active_from,active_to FROM batch_definitions ORDER BY batch_key');
const defsMap=definitionsMap(defs);

const currentRows=await d1(`SELECT DISTINCT a.portal_user_id_norm FROM student_batch_assignments a JOIN batch_definitions b ON b.batch_key=a.batch_key WHERE (a.effective_from IS NULL OR a.effective_from='' OR a.effective_from<=?) AND (a.effective_to IS NULL OR a.effective_to='' OR ?<a.effective_to) AND (b.active_from IS NULL OR b.active_from='' OR b.active_from<=?) AND (b.active_to IS NULL OR b.active_to='' OR ?<b.active_to) AND lower(b.subject)='maths' AND ((lower(b.stream)='normal' AND CAST(b.school_year AS INTEGER)=6) OR (lower(b.stream)='11plus' AND CAST(b.maths_level AS INTEGER)=3)) ORDER BY a.portal_user_id_norm`,[asOf,asOf,asOf,asOf]);
const currentRoster=new Set(currentRows.map(row=>norm(row.portal_user_id_norm)).filter(Boolean));
if(currentRoster.size!==9)throw new Error(`CURRENT_Y6_EQUIVALENT_ROSTER_CHANGED:${currentRoster.size}`);

const affected=new Set(currentRoster);
for(const row of await d1(`SELECT DISTINCT a.portal_user_id_norm FROM student_batch_assignments a JOIN batch_definitions b ON b.batch_key=a.batch_key WHERE (a.effective_from IS NULL OR a.effective_from='' OR a.effective_from<=?) AND lower(b.subject)='maths' AND ((lower(b.stream)='normal' AND CAST(b.school_year AS INTEGER)=6) OR (lower(b.stream)='11plus' AND CAST(b.maths_level AS INTEGER)=3))`,[asOf])) affected.add(norm(row.portal_user_id_norm));
for(const row of await d1(`SELECT DISTINCT portal_user_id_norm,lesson_id FROM lesson_entitlements WHERE lesson_id LIKE 'Y6M%'`))if(isSatsLessonId(row.lesson_id))affected.add(norm(row.portal_user_id_norm));
for(const row of await d1(`SELECT DISTINCT portal_user_id_norm,lesson_id FROM online_prelesson_entitlements WHERE lesson_id LIKE 'Y6M%'`))if(isSatsLessonId(row.lesson_id))affected.add(norm(row.portal_user_id_norm));

for(const key of await listStudentUserKeys()){
  const id=norm(key.slice(5)); if(!id||affected.has(id))continue;
  const user=await kvJson(studentsNs,key); if(user&&profileRelevant(user,defsMap))affected.add(id);
}

const globalPayload=globalPayloadFromCatalogue(PREPARED_CATALOGUE);
const records=[await candidateRecord('global',globalPayload)];
const studentEvidence=[];
for(const id of [...affected].filter(Boolean).sort()){
  const input=await loadInput(id,defs);
  const scopeId=deriveScopeId(id,scopeSalt),scope=`access:${scopeId}`;
  const payload=compileAccessScopeV2(input,PREPARED_CATALOGUE,{scopeId,asOfDate:asOf});
  const evidence=assertCompiled(id,input,payload,currentRoster);
  records.push(await candidateRecord(scope,payload));
  studentEvidence.push({idHash:tag(id),current:currentRoster.has(id),...evidence});
}

const currentEvidence=studentEvidence.filter(row=>row.current);
const normalYear6=currentEvidence.filter(row=>row.programme==='maths-year6').length;
const level3=currentEvidence.filter(row=>row.programme==='maths-level3').length;
const sats=currentEvidence.filter(row=>row.sats).length;
if(normalYear6!==6||level3!==3||sats!==2)throw new Error(`CURRENT_INVARIANT_CHANGED:${normalYear6}:${level3}:${sats}`);

const baselines=new Map();
for(const record of records)baselines.set(record.scope,await currentBaseline(record.scope));
const summary={
  marker:apply?'Y6_L3_SATS_PRODUCTION_PUBLISH_READY':'Y6_L3_SATS_PRODUCTION_DRY_RUN_PASS',
  asOfDate:asOf,apply,affectedStudents:studentEvidence.length,currentStudents:currentEvidence.length,
  normalYear6,level3,sats,noSats:currentEvidence.length-sats,collisions:0,
  globalCandidateVersion:records[0].version,accessCandidates:records.length-1,
  existingAccessPointers:[...baselines.entries()].filter(([scope,value])=>scope!=='global'&&value.exists).length,
  newAccessPointers:[...baselines.entries()].filter(([scope,value])=>scope!=='global'&&!value.exists).length
};
console.log(JSON.stringify(summary,null,2));

if(!apply)process.exit(0);

// Re-check source invariants immediately before the first write.
const rosterNow=await d1(`SELECT DISTINCT a.portal_user_id_norm FROM student_batch_assignments a JOIN batch_definitions b ON b.batch_key=a.batch_key WHERE (a.effective_from IS NULL OR a.effective_from='' OR a.effective_from<=?) AND (a.effective_to IS NULL OR a.effective_to='' OR ?<a.effective_to) AND (b.active_from IS NULL OR b.active_from='' OR b.active_from<=?) AND (b.active_to IS NULL OR b.active_to='' OR ?<b.active_to) AND lower(b.subject)='maths' AND ((lower(b.stream)='normal' AND CAST(b.school_year AS INTEGER)=6) OR (lower(b.stream)='11plus' AND CAST(b.maths_level AS INTEGER)=3)) ORDER BY a.portal_user_id_norm`,[asOf,asOf,asOf,asOf]);
if(stableStringify(rosterNow.map(row=>norm(row.portal_user_id_norm)).sort())!==stableStringify([...currentRoster].sort()))throw new Error('CURRENT_ROSTER_CHANGED_BEFORE_WRITE');
for(const [scope,baseline] of baselines)await assertBaselineUnchanged(scope,baseline);

// Forward-only candidate staging: no pointer changes until every candidate has
// been written and verified. Re-running is idempotent because versions are
// content-addressed by payload hash.
for(const record of records)await kvPut(readModelsNs,record.key,record.text);
for(const record of records)await verifyCandidate(record);
for(const [scope,baseline] of baselines)await assertBaselineUnchanged(scope,baseline);

const updatedAt=new Date().toISOString();
// Switch global first. The new global is a superset-compatible catalogue for old
// access snapshots; student pointers then converge one by one. Never roll back.
await switchPointer(records[0],baselines.get('global'),updatedAt);
for(const record of records.slice(1))await switchPointer(record,baselines.get(record.scope),updatedAt);

for(const record of records){
  const resolved=await resolveCurrentScope(store,record.scope);
  if(resolved.version!==record.version||resolved.sha256!==record.sha||resolved.usedFallback)throw new Error(`POST_PUBLISH_SCOPE_MISMATCH:${tag(record.scope)}`);
}
console.log(JSON.stringify({...summary,marker:'Y6_L3_SATS_PRODUCTION_PUBLISH_PASS',publishedScopes:records.length,updatedAt},null,2));
