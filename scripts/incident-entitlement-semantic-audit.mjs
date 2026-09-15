import fs from 'node:fs';
import { collectLessonResources } from '../rebuild/adminops/src/lib/compiler.mjs';

const token=String(process.env.CLOUDFLARE_API_TOKEN||'').trim();
const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const worker=String(process.env.LEGACY_WORKER||'fpt-portal-v2-worker').trim();
const asOf=String(process.env.AS_OF_DATE||'2026-09-15').trim();
const targetUser=String(process.env.TARGET_USER||'dha2806').trim().toLowerCase();
const targetDisplayId=String(process.env.TARGET_LESSON||'Y4T1EE01').trim();
if(!token||!account) throw new Error('Cloudflare credentials are required for read-only audit.');

const base='https://api.cloudflare.com/client/v4';
const headers={Authorization:`Bearer ${token}`};
const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toLowerCase();
const date10=v=>/^\d{4}-\d{2}-\d{2}/.test(clean(v))?clean(v).slice(0,10):'';
const key=(u,l)=>`${norm(u)}|${clean(l)}`;

async function envelope(path,options={}){
  const r=await fetch(`${base}${path}`,{...options,headers:{...headers,...(options.headers||{})}});
  const b=await r.json().catch(()=>null);
  if(!r.ok||b?.success!==true) throw new Error(`Cloudflare read failed ${r.status}: ${path}`);
  return b;
}
async function d1(db,sql){
  const text=clean(sql);
  if(!/^(SELECT|PRAGMA|WITH)\b/i.test(text)||/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM)\b/i.test(text)) throw new Error('Read-only SQL guard rejected statement.');
  const b=await envelope(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql:text})});
  const first=Array.isArray(b.result)?b.result[0]:b.result;
  return Array.isArray(first?.results)?first.results:[];
}
async function kvGet(ns,k){
  const r=await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(k)}`,{headers});
  if(r.status===404)return null;
  if(!r.ok)throw new Error(`KV read failed ${r.status}: ${k}`);
  return r.json().catch(()=>null);
}
async function kvKeys(ns,prefix){
  const out=[];let cursor='';
  do{const q=new URLSearchParams({limit:'1000',prefix});if(cursor)q.set('cursor',cursor);const b=await envelope(`/accounts/${account}/storage/kv/namespaces/${ns}/keys?${q}`);out.push(...(b.result||[]).map(x=>clean(x.name)).filter(Boolean));cursor=clean(b.result_info?.cursor);}while(cursor);
  return out;
}
function currentProfile(id,user){
  const role=norm(user?.role||user?.accountType);if(id==='admin'||role.includes('admin')||user?.isAdmin===true||user?.superuser===true)return false;
  const status=norm(user?.accountStatus||user?.status||'active');const expires=date10(user?.expiresOn||user?.expires);
  return !['inactive','disabled','expired','withdrawn'].includes(status)&&(!expires||expires>asOf);
}
function assignmentApplies(a,d){
  if(!d)return false;const from=date10(a?.effective_from),to=date10(a?.effective_to),af=date10(a?.active_from),at=date10(a?.active_to);
  return (!from||from<=d)&&(!to||d<to)&&(!af||af<=d)&&(!at||d<at);
}
function isEnglish11(def){return norm(def?.subject)==='english'&&norm(def?.stream)==='11plus';}
function importerRegexWouldGrant(batchKey){return /^Y[45]11/i.test(clean(batchKey));}

const settings=(await envelope(`/accounts/${account}/workers/scripts/${worker}/settings`)).result;
const binding=n=>(settings?.bindings||[]).find(x=>x.name===n)||{};
const studentsNs=clean(binding('STUDENTS_KV').namespace_id),lessonsNs=clean(binding('LESSONS_KV').namespace_id),dbId=clean(binding('DB').database_id||binding('DB').id);
if(!studentsNs||!lessonsNs||!dbId)throw new Error('Production legacy bindings could not be resolved.');

const [defs,assignments,releases,entitlements,prelesson]=await Promise.all([
  d1(dbId,'SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions'),
  d1(dbId,'SELECT portal_user_id_norm, batch_key, effective_from, effective_to FROM student_batch_assignments'),
  d1(dbId,'SELECT batch_key, lesson_id, lesson_date, first_completed_at, last_confirmed_at FROM batch_lesson_releases'),
  d1(dbId,'SELECT portal_user_id_norm, lesson_id, core_access, vr_access, eleven_plus_access, source, first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date FROM lesson_entitlements'),
  d1(dbId,'SELECT * FROM online_prelesson_entitlements')
]);
const defsBy=new Map(defs.map(x=>[clean(x.batch_key),x]));
const entBy=new Map(entitlements.map(x=>[key(x.portal_user_id_norm,x.lesson_id),x]));
const relByBatch=new Map();for(const r of releases){const k=clean(r.batch_key);const a=relByBatch.get(k)||[];a.push(r);relByBatch.set(k,a);}
const asgByUser=new Map();for(const a of assignments){const u=norm(a.portal_user_id_norm);const def=defsBy.get(clean(a.batch_key))||{};const row={...a,...def,batch_key:clean(a.batch_key)};const arr=asgByUser.get(u)||[];arr.push(row);asgByUser.set(u,arr);}

const userKeys=await kvKeys(studentsNs,'user:');
const profiles=new Map();
for(const k of userKeys){const id=norm(k.replace(/^user:/,''));const u=await kvGet(studentsNs,k);if(u)profiles.set(id,u);}
const studentIds=[...profiles.keys()].filter(id=>{const u=profiles.get(id);const role=norm(u?.role||u?.accountType);return id!=='admin'&&!role.includes('admin')&&u?.isAdmin!==true&&u?.superuser!==true;}).sort();
const currentIds=studentIds.filter(id=>currentProfile(id,profiles.get(id)));

// Resolve target display ID through authoritative English Year 4 curriculum.
const curriculum=await kvGet(lessonsNs,'curriculum:ENGLISH_Y4');
const lessonIds=Array.isArray(curriculum?.lessonIds)?curriculum.lessonIds:[];
let targetLesson=null;
for(const id of lessonIds){const l=await kvGet(lessonsNs,`lesson:${clean(id)}`);if(!l)continue;const vals=Object.values(l.displayIds||{}).map(clean);if(clean(l.lessonId)===targetDisplayId||vals.some(v=>norm(v)===norm(targetDisplayId))){targetLesson=l;break;}}
if(!targetLesson)throw new Error(`Target lesson ${targetDisplayId} could not be resolved from ENGLISH_Y4.`);
const targetLessonId=clean(targetLesson.lessonId);
const targetResources=collectLessonResources(targetLesson);
const safeResources=targetResources.map(r=>({type:clean(r.type),presentationGroup:clean(r.presentationGroup),protected:Boolean(r.protected),title:clean(r.title||r.label||r.name)}));
const targetResourceSummary={
  canonicalLessonId:targetLessonId,
  displayId:targetDisplayId,
  total:safeResources.length,
  preLessonCount:safeResources.filter(r=>/pre.?lesson/i.test(r.type)||/pre.?lesson/i.test(r.presentationGroup)||/pre.?lesson/i.test(r.title)).length,
  vrCount:safeResources.filter(r=>/^vr-/i.test(r.presentationGroup)||/\bvr\b|verbal/i.test(`${r.presentationGroup} ${r.title}`)).length,
  vrHomeworkCount:safeResources.filter(r=>(/^vr-/i.test(r.presentationGroup)||/\bvr\b|verbal/i.test(`${r.presentationGroup} ${r.title}`))&&/homework/i.test(`${r.type} ${r.presentationGroup} ${r.title}`)).length,
  resources:safeResources
};

const expectation=new Map();
function addExpected(userId,lessonId,reason,batchKey,lessonDate){
  const k=key(userId,lessonId);const x=expectation.get(k)||{portalUserId:norm(userId),lessonId:clean(lessonId),expectedCore:true,expectedVr:false,reasons:[],batchKeys:new Set(),lessonDates:new Set()};
  x.expectedVr=true;x.reasons.push(reason);if(batchKey)x.batchKeys.add(clean(batchKey));if(lessonDate)x.lessonDates.add(lessonDate);expectation.set(k,x);
}

// Strongest source: an existing entitlement itself names an authoritative English-11+ batch.
for(const e of entitlements){const def=defsBy.get(clean(e.source_batch_code));if(isEnglish11(def))addExpected(e.portal_user_id_norm,e.lesson_id,'entitlement-source-batch-is-english-11plus',e.source_batch_code,date10(e.source_lesson_date));}

// Independent business semantic: a student assigned to an English-11+ batch when that batch released a lesson must receive VR for that lesson.
for(const [u,rows] of asgByUser){for(const a of rows){if(!isEnglish11(a))continue;for(const r of relByBatch.get(clean(a.batch_key))||[]){const d=date10(r.lesson_date)||date10(r.first_completed_at);if(assignmentApplies(a,d))addExpected(u,r.lesson_id,'english-11plus-assignment-at-batch-release',a.batch_key,d);}}}

const under=[];
for(const x of expectation.values()){
  const e=entBy.get(key(x.portalUserId,x.lessonId));
  const lesson=await kvGet(lessonsNs,`lesson:${x.lessonId}`);
  const resources=lesson?collectLessonResources(lesson):[];
  const hasVrResource=resources.some(r=>/^vr-/i.test(clean(r.presentationGroup))||/\bvr\b|verbal/i.test(`${clean(r.presentationGroup)} ${clean(r.title||r.label||r.name)}`));
  const storedVr=Number(e?.vr_access||0)===1;
  const storedCore=Number(e?.core_access||0)===1;
  if(!e||!storedCore||!storedVr){under.push({portalUserId:x.portalUserId,current:currentIds.includes(x.portalUserId),lessonId:x.lessonId,stored:{exists:Boolean(e),core:storedCore,vr:storedVr,elevenPlus:Number(e?.eleven_plus_access||0)===1,sourceBatch:clean(e?.source_batch_code),sourceLessonDate:date10(e?.source_lesson_date),firstGrantedAt:clean(e?.first_granted_at),lastConfirmedAt:clean(e?.last_confirmed_at)},expected:{core:true,vr:true},hasVrResource,batchKeys:[...x.batchKeys].sort(),lessonDates:[...x.lessonDates].sort(),reasons:[...new Set(x.reasons)]});}
}
under.sort((a,b)=>a.portalUserId.localeCompare(b.portalUserId)||a.lessonId.localeCompare(b.lessonId));

const currentEnglish11=[];
for(const id of currentIds){const user=profiles.get(id);const rows=(asgByUser.get(id)||[]).filter(a=>isEnglish11(a)&&assignmentApplies(a,asOf));if(rows.length)currentEnglish11.push({portalUserId:id,vrEligible:user?.vrEligible===true,batches:rows.map(r=>r.batch_key).sort()});}
const profileGateMismatches=currentEnglish11.filter(x=>!x.vrEligible);
const english11Defs=defs.filter(isEnglish11).map(d=>({batchKey:clean(d.batch_key),schoolYear:Number(d.school_year),importerRegexWouldGrant:importerRegexWouldGrant(d.batch_key)})).sort((a,b)=>a.batchKey.localeCompare(b.batchKey));

const targetUserProfile=profiles.get(targetUser)||null;
const targetAssignments=(asgByUser.get(targetUser)||[]).map(a=>({batchKey:a.batch_key,subject:a.subject,schoolYear:a.school_year,stream:a.stream,effectiveFrom:a.effective_from,effectiveTo:a.effective_to,activeNow:assignmentApplies(a,asOf),importerRegexWouldGrant:importerRegexWouldGrant(a.batch_key)}));
const targetEnt=entBy.get(key(targetUser,targetLessonId))||null;
const targetExpected=expectation.get(key(targetUser,targetLessonId));
const targetPre=prelesson.filter(x=>norm(x.portal_user_id_norm)===targetUser&&clean(x.lesson_id)===targetLessonId);
const dhaTrace={
  portalUserId:targetUser,
  profileExists:Boolean(targetUserProfile),
  current:targetUserProfile?currentProfile(targetUser,targetUserProfile):false,
  profileVrEligible:targetUserProfile?.vrEligible===true,
  assignments:targetAssignments,
  lesson:targetResourceSummary,
  storedEntitlement:targetEnt?{core:Number(targetEnt.core_access||0)===1,vr:Number(targetEnt.vr_access||0)===1,elevenPlus:Number(targetEnt.eleven_plus_access||0)===1,source:clean(targetEnt.source),sourceBatch:clean(targetEnt.source_batch_code),sourceLessonDate:date10(targetEnt.source_lesson_date),firstGrantedAt:clean(targetEnt.first_granted_at),lastConfirmedAt:clean(targetEnt.last_confirmed_at)}:null,
  preLessonRows:targetPre.map(x=>({batchKey:clean(x.batch_key),lessonDate:date10(x.lesson_date),vr:Number(x.vr_access||0)===1})),
  semanticExpectation:targetExpected?{core:true,vr:true,batches:[...targetExpected.batchKeys].sort(),reasons:[...new Set(targetExpected.reasons)]}:null,
  importerWouldGrantFromStoredSourceBatch:targetEnt?importerRegexWouldGrant(targetEnt.source_batch_code)&&targetUserProfile?.vrEligible===true:false
};

const byUser={};for(const row of under){const x=byUser[row.portalUserId]||{portalUserId:row.portalUserId,current:row.current,underEntitledLessons:0,withVrResources:0,lessonIds:[]};x.underEntitledLessons++;if(row.hasVrResource)x.withVrResources++;x.lessonIds.push(row.lessonId);byUser[row.portalUserId]=x;}
const report={
  marker:'FPT_ENTITLEMENT_SEMANTIC_AUDIT_2026_09_15',status:under.filter(x=>x.current).length===0?'PASS':'FAIL',readOnly:true,asOfDate:asOf,
  population:{profileKeys:userKeys.length,studentProfiles:studentIds.length,currentStudents:currentIds.length,currentEnglish11Students:currentEnglish11.length},
  batchConfiguration:{english11Definitions:english11Defs,definitionsFailingImporterRegex:english11Defs.filter(x=>!x.importerRegexWouldGrant).length},
  profileGate:{currentEnglish11WithoutVrEligible:profileGateMismatches},
  semanticUnderEntitlements:{allRows:under.length,currentRows:under.filter(x=>x.current).length,affectedUsers:Object.values(byUser).sort((a,b)=>a.portalUserId.localeCompare(b.portalUserId)),rows:under},
  target:dhaTrace
};
fs.writeFileSync('/tmp/entitlement-semantic-audit.json',JSON.stringify(report,null,2)+'\n');
fs.writeFileSync('/tmp/dha2806-trace.json',JSON.stringify(dhaTrace,null,2)+'\n');
console.log(JSON.stringify({marker:report.marker,status:report.status,readOnly:true,population:report.population,english11Definitions:english11Defs,currentEnglish11WithoutVrEligible:profileGateMismatches.map(x=>x.portalUserId),underEntitlementRows:report.semanticUnderEntitlements.currentRows,affectedCurrentUsers:report.semanticUnderEntitlements.affectedUsers.filter(x=>x.current).map(x=>x.portalUserId),target:{portalUserId:targetUser,canonicalLessonId:targetLessonId,storedEntitlement:dhaTrace.storedEntitlement,semanticExpectation:dhaTrace.semanticExpectation,profileVrEligible:dhaTrace.profileVrEligible,resourceSummary:{preLessonCount:targetResourceSummary.preLessonCount,vrCount:targetResourceSummary.vrCount,vrHomeworkCount:targetResourceSummary.vrHomeworkCount}}},null,2));
if(report.status!=='PASS')process.exitCode=2;
