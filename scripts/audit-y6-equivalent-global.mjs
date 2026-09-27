import { compileAccessScope, globalToCatalogue } from '../rebuild/adminops/src/lib/compiler.mjs';
import { pointerKey, versionKey } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';
import { legacyBatchViewId } from '../rebuild/adminops/src/lib/backfill-parity-audit.mjs';
import { viewIdForBatch } from '../rebuild/shared/read-models/view-registry.mjs';

const token=process.env.CLOUDFLARE_API_TOKEN, account=process.env.CLOUDFLARE_ACCOUNT_ID;
const studentsNs=process.env.STUDENTS_KV_ID, readNs=process.env.READ_MODELS_KV_ID, db=process.env.DB_ID, asOf=process.env.AS_OF_DATE;
const base='https://api.cloudflare.com/client/v4', headers={Authorization:`Bearer ${token}`};
const clean=v=>String(v??'').trim(), norm=v=>clean(v).toLowerCase();
const asDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(clean(v))?clean(v):'';
const satId=id=>/^Y6M(?:5[1-9]|6[0-9])$/.test(clean(id));

async function sha12(value){
  const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value)));
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,12);
}
async function env(path,init={}){
  const r=await fetch(`${base}${path}`,{...init,headers:{...headers,...(init.headers||{})}});
  const b=await r.json().catch(()=>null);
  if(!r.ok||b?.success!==true)throw new Error(`CF ${r.status} ${path}`);
  return b;
}
async function kvJson(ns,key){
  const r=await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{headers});
  if(r.status===404)return null;
  if(!r.ok)throw new Error(`KV ${r.status}`);
  return r.json();
}
async function kvKeys(ns,prefix){
  const out=[];let cursor='';
  do{
    const q=new URLSearchParams({limit:'1000',prefix});if(cursor)q.set('cursor',cursor);
    const b=await env(`/accounts/${account}/storage/kv/namespaces/${ns}/keys?${q}`);
    out.push(...(b.result||[]).map(x=>x.name));cursor=clean(b.result_info?.cursor);
  }while(cursor);
  return out;
}
async function d1(sql,params=[]){
  if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql))throw new Error('READ_ONLY_SQL_ONLY');
  const b=await env(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql,params})});
  const x=Array.isArray(b.result)?b.result[0]:b.result;
  return x?.results||[];
}
function current(row){
  const ef=asDate(row?.effective_from),et=asDate(row?.effective_to),af=asDate(row?.batch_active_from??row?.active_from),at=asDate(row?.batch_active_to??row?.active_to);
  return (!ef||ef<=asOf)&&(!et||asOf<et)&&(!af||af<=asOf)&&(!at||asOf<at);
}
function mathsViewRows(views){
  return (views||[]).filter(v=>norm(v?.subject)==='maths').map(v=>({viewId:clean(v.viewId),label:clean(v.label),current:Boolean(v.current),group:clean(v.group),open:Number(v.openLessonCount||0),locked:Number(v.lockedLessonCount||0)}));
}
function pairCollision(views){
  const cur=new Set((views||[]).filter(v=>v.current).map(v=>clean(v.viewId)));
  return cur.has('maths-year6')&&cur.has('maths-level3');
}
function defSummary(def){
  return def?{batch:clean(def.batch_key),canonicalView:viewIdForBatch(def)||'',legacyView:legacyBatchViewId(def.batch_key)||'',subject:clean(def.subject),schoolYear:Number(def.school_year||0),stream:clean(def.stream),mathsLevel:def.maths_level==null?null:Number(def.maths_level),activeFrom:def.active_from||null,activeTo:def.active_to||null}:null;
}
async function storedSnapshotsByFirstName(){
  const keys=await kvKeys(readNs,'rm:v1:scope:access_3A');
  const currentKeys=keys.filter(k=>k.endsWith(':current'));
  const map=new Map();
  for(const key of currentKeys){
    const pointer=await kvJson(readNs,key);
    if(!pointer?.current?.version)continue;
    const scopeEncoded=key.slice('rm:v1:scope:'.length,-':current'.length);
    const envelopeKey=`rm:v1:scope:${scopeEncoded}:version:${encodeURIComponent(pointer.current.version).replace(/%/g,'_')}`;
    const envelope=await kvJson(readNs,envelopeKey);
    const snapshot=envelope?.payload?.snapshot;
    const first=norm(snapshot?.account?.firstName);
    if(!first)continue;
    const rows=map.get(first)||[];
    rows.push({pointer:{version:pointer.current.version,updatedAt:pointer.updatedAt||null},snapshot});
    map.set(first,rows);
  }
  return map;
}

const globalPointer=await kvJson(readNs,pointerKey('global'));
if(!globalPointer?.current?.version)throw new Error('GLOBAL_POINTER_UNAVAILABLE');
const globalEnvelope=await kvJson(readNs,versionKey('global',globalPointer.current.version));
const catalogue=globalToCatalogue(globalEnvelope.payload);
const defs=await d1('SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions ORDER BY batch_key');
const defMap=new Map(defs.map(r=>[clean(r.batch_key),r]));
const semanticConflicts=defs.map(defSummary).filter(x=>x?.legacyView&&x?.canonicalView&&x.legacyView!==x.canonicalView);
const y6RelevantDefinitions=defs.map(defSummary).filter(x=>x&&(['maths-year6','maths-level3'].includes(x.canonicalView)||['maths-year6','maths-level3'].includes(x.legacyView)));
const storedByName=await storedSnapshotsByFirstName();

const targetRows=await d1(`SELECT DISTINCT a.portal_user_id_norm FROM student_batch_assignments a JOIN batch_definitions b ON b.batch_key=a.batch_key WHERE (a.effective_from IS NULL OR a.effective_from='' OR a.effective_from<=?) AND (a.effective_to IS NULL OR a.effective_to='' OR ?<a.effective_to) AND (b.active_from IS NULL OR b.active_from='' OR b.active_from<=?) AND (b.active_to IS NULL OR b.active_to='' OR ?<b.active_to) AND lower(b.subject)='maths' AND ((lower(b.stream)='normal' AND CAST(b.school_year AS INTEGER)=6) OR (lower(b.stream)='11plus' AND CAST(b.maths_level AS INTEGER)=3)) ORDER BY a.portal_user_id_norm`,[asOf,asOf,asOf,asOf]);
const targetProfiles=[];
for(const target of targetRows){
  const id=norm(target.portal_user_id_norm),tag=await sha12(id),user=await kvJson(studentsNs,`user:${id}`);
  if(!user)throw new Error(`STUDENT_KV_MISSING:${tag}`);
  targetProfiles.push({id,tag,user,first:norm(user?.firstName||user?.name)});
}
const targetNameCounts=new Map();
for(const t of targetProfiles)targetNameCounts.set(t.first,(targetNameCounts.get(t.first)||0)+1);
for(const t of targetProfiles){
  if(!t.first)throw new Error(`TARGET_FIRST_NAME_MISSING:${t.tag}`);
  if(targetNameCounts.get(t.first)!==1)throw new Error(`TARGET_FIRST_NAME_NOT_UNIQUE:${t.tag}`);
  const candidates=storedByName.get(t.first)||[];
  if(candidates.length!==1)throw new Error(`STORED_SNAPSHOT_MATCH_COUNT:${t.tag}:${candidates.length}`);
}

const students=[];
for(const t of targetProfiles){
  const {id,tag,user}=t;
  const stored=storedByName.get(t.first)[0];
  const assignments=await d1('SELECT a.batch_key,a.effective_from,a.effective_to,b.subject,b.school_year,b.stream,b.maths_level,b.active_from AS batch_active_from,b.active_to AS batch_active_to FROM student_batch_assignments a JOIN batch_definitions b ON b.batch_key=a.batch_key WHERE a.portal_user_id_norm=? ORDER BY a.effective_from,a.batch_key',[id]);
  const ent=await d1('SELECT lesson_id,core_access,vr_access,source,source_batch_code,source_lesson_date,first_granted_at,last_confirmed_at FROM lesson_entitlements WHERE portal_user_id_norm=? ORDER BY source_lesson_date,lesson_id',[id]);
  const pre=await d1('SELECT lesson_id,batch_key,lesson_date,first_granted_at FROM online_prelesson_entitlements WHERE portal_user_id_norm=? ORDER BY lesson_date,lesson_id',[id]);
  const input={asOfDate:asOf,user,batchDefinitions:defs,batchAssignments:assignments,entitlements:ent,onlinePreLessonEntitlements:pre};
  const fresh=compileAccessScope(input,catalogue,{scopeId:`audit:${tag}`,asOfDate:asOf}).snapshot;
  const profileBatches=(Array.isArray(user?.batches)?user.batches:[]).map(batch=>{
    const key=clean(batch),def=defMap.get(key),legacy=legacyBatchViewId(key)||'',canonical=def?(viewIdForBatch(def)||''):'';
    return{batch:key,legacyView:legacy,canonicalView:canonical,semanticConflict:Boolean(legacy&&canonical&&legacy!==canonical)};
  });
  const currentAssignments=assignments.filter(current).map(r=>({batch:clean(r.batch_key),view:viewIdForBatch(r)||legacyBatchViewId(r.batch_key)||'',subject:clean(r.subject),stream:clean(r.stream),schoolYear:Number(r.school_year||0),mathsLevel:r.maths_level==null?null:Number(r.maths_level)}));
  const entitlementSources=new Map();
  for(const r of ent){
    const batch=clean(r.source_batch_code),def=defMap.get(batch),view=def?(viewIdForBatch(def)||''):(legacyBatchViewId(batch)||'unresolved'),key=`${batch||'(none)'}|${view}`;
    const s=entitlementSources.get(key)||{batch:batch||null,canonicalView:view,rows:0,coreRows:0,satRows:0,examples:[]};
    s.rows++;if(Number(r.core_access||0)!==0)s.coreRows++;if(satId(r.lesson_id))s.satRows++;
    if(s.examples.length<4)s.examples.push({lessonId:clean(r.lesson_id),source:clean(r.source),sourceLessonDate:r.source_lesson_date||null});
    entitlementSources.set(key,s);
  }
  const preSources=new Map();
  for(const r of pre){
    const batch=clean(r.batch_key),def=defMap.get(batch),view=def?(viewIdForBatch(def)||''):(legacyBatchViewId(batch)||'unresolved'),key=`${batch||'(none)'}|${view}`;
    const s=preSources.get(key)||{batch:batch||null,canonicalView:view,rows:0,satRows:0,examples:[]};
    s.rows++;if(satId(r.lesson_id))s.satRows++;
    if(s.examples.length<4)s.examples.push({lessonId:clean(r.lesson_id),lessonDate:r.lesson_date||null});
    preSources.set(key,s);
  }
  const storedMaths=mathsViewRows(stored.snapshot?.views),freshMaths=mathsViewRows(fresh.views);
  students.push({
    tag,
    profile:{batches:profileBatches,fullLibraries:Array.isArray(user?.fullLibraries)?user.fullLibraries:[],historicalViews:Array.isArray(user?.historicalViews)?user.historicalViews:[],upsellViews:Array.isArray(user?.upsellViews)?user.upsellViews:null},
    currentAssignments,
    entitlementSources:[...entitlementSources.values()],
    preLessonSources:[...preSources.values()],
    satAccessRows:ent.filter(r=>Number(r.core_access||0)!==0&&satId(r.lesson_id)).length+pre.filter(r=>satId(r.lesson_id)).length,
    stored:{pointer:stored.pointer,maths:storedMaths,currentPairCollision:pairCollision(storedMaths)},
    fresh:{maths:freshMaths,currentPairCollision:pairCollision(freshMaths)},
    exactStoredVsFreshMaths:JSON.stringify(storedMaths)===JSON.stringify(freshMaths),
    profileSemanticConflictCount:profileBatches.filter(b=>b.semanticConflict).length
  });
}

const summary={
  asOfDate:asOf,
  currentYear6EquivalentStudents:students.length,
  studentsWithProfileSemanticConflict:students.filter(s=>s.profileSemanticConflictCount>0).length,
  storedCurrentY6L3Collisions:students.filter(s=>s.stored.currentPairCollision).length,
  freshCurrentY6L3Collisions:students.filter(s=>s.fresh.currentPairCollision).length,
  storedVsFreshMathsDifferences:students.filter(s=>!s.exactStoredVsFreshMaths).length,
  studentsWithSatAccess:students.filter(s=>s.satAccessRows>0).length,
  batchDefinitionVsLegacyConflicts:semanticConflicts.length
};
console.log('=== Y6 EQUIVALENT GLOBAL SUMMARY ===');
console.log(JSON.stringify(summary,null,2));
console.log('=== Y6/L3-RELEVANT BATCH DEFINITIONS ===');
console.log(JSON.stringify(y6RelevantDefinitions,null,2));
console.log('=== ALL LEGACY-vs-D1 BATCH SEMANTIC CONFLICTS ===');
console.log(JSON.stringify(semanticConflicts,null,2));
console.log('=== PER-STUDENT PSEUDONYMOUS AUDIT ===');
console.log(JSON.stringify(students,null,2));
if(students.length===0)throw new Error('NO_CURRENT_Y6_EQUIVALENT_STUDENTS');
