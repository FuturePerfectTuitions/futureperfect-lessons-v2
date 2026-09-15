import fs from 'node:fs';
import { collectLessonResources } from '../rebuild/adminops/src/lib/compiler.mjs';

const token=String(process.env.CLOUDFLARE_API_TOKEN||'').trim();
const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const worker=String(process.env.LEGACY_WORKER||'fpt-portal-v2-worker').trim();
const asOf=String(process.env.AS_OF_DATE||'2026-09-15').trim();
const targetUser=String(process.env.TARGET_USER||'dha2806').trim().toLowerCase();
const targetDisplayId=String(process.env.TARGET_LESSON||'Y4T1EE01').trim();
if(!token||!account) throw new Error('Cloudflare credentials required.');
const base='https://api.cloudflare.com/client/v4';
const headers={Authorization:`Bearer ${token}`};
const clean=v=>String(v??'').trim(), norm=v=>clean(v).toLowerCase();
const d10=v=>/^\d{4}-\d{2}-\d{2}/.test(clean(v))?clean(v).slice(0,10):'';
const pair=(u,l)=>`${norm(u)}|${clean(l)}`;

async function api(path,options={}){const r=await fetch(`${base}${path}`,{...options,headers:{...headers,...(options.headers||{})}});const b=await r.json().catch(()=>null);if(!r.ok||b?.success!==true)throw new Error(`Cloudflare read failed ${r.status}: ${path}`);return b;}
async function sql(db,statement){const s=clean(statement);if(!/^(SELECT|PRAGMA|WITH)\b/i.test(s)||/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM)\b/i.test(s))throw new Error('Read-only SQL guard');const b=await api(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql:s})});const x=Array.isArray(b.result)?b.result[0]:b.result;return Array.isArray(x?.results)?x.results:[];}
async function kv(ns,k){const r=await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(k)}`,{headers});if(r.status===404)return null;if(!r.ok)throw new Error(`KV read failed ${r.status}: ${k}`);return r.json().catch(()=>null);}
async function keys(ns,prefix){const out=[];let cursor='';do{const q=new URLSearchParams({limit:'1000',prefix});if(cursor)q.set('cursor',cursor);const b=await api(`/accounts/${account}/storage/kv/namespaces/${ns}/keys?${q}`);out.push(...(b.result||[]).map(x=>clean(x.name)).filter(Boolean));cursor=clean(b.result_info?.cursor);}while(cursor);return out;}
function isStudent(id,u){const role=norm(u?.role||u?.accountType);return id!=='admin'&&!role.includes('admin')&&u?.isAdmin!==true&&u?.superuser!==true;}
function current(id,u){if(!isStudent(id,u))return false;const status=norm(u?.accountStatus||u?.status||'active'),exp=d10(u?.expiresOn||u?.expires);return !['inactive','disabled','expired','withdrawn'].includes(status)&&(!exp||exp>asOf);}
function english11(x){return norm(x?.subject)==='english'&&norm(x?.stream)==='11plus';}
function activeAt(a,date){if(!date)return false;const from=d10(a.effective_from),to=d10(a.effective_to),bf=d10(a.active_from),bt=d10(a.active_to);return (!from||from<=date)&&(!to||date<to)&&(!bf||bf<=date)&&(!bt||date<bt);}
function oldImporterBatchMatch(k){return /^Y[45]11/i.test(clean(k));}

const settings=(await api(`/accounts/${account}/workers/scripts/${worker}/settings`)).result;
const bind=n=>(settings?.bindings||[]).find(x=>x.name===n)||{};
const studentsNs=clean(bind('STUDENTS_KV').namespace_id),lessonsNs=clean(bind('LESSONS_KV').namespace_id),db=clean(bind('DB').database_id||bind('DB').id);
if(!studentsNs||!lessonsNs||!db)throw new Error('Legacy production bindings unresolved.');

const [defs,assignments,releases,ents,pres]=await Promise.all([
 sql(db,'SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions'),
 sql(db,'SELECT portal_user_id_norm, batch_key, effective_from, effective_to FROM student_batch_assignments'),
 sql(db,'SELECT batch_key, lesson_id, lesson_date, first_completed_at, last_confirmed_at FROM batch_lesson_releases'),
 sql(db,'SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source, first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date FROM lesson_entitlements'),
 sql(db,'SELECT * FROM online_prelesson_entitlements')
]);
const defBy=new Map(defs.map(d=>[clean(d.batch_key),d]));
const entBy=new Map(ents.map(e=>[pair(e.portal_user_id_norm,e.lesson_id),e]));
const relBy=new Map();for(const r of releases){const a=relBy.get(clean(r.batch_key))||[];a.push(r);relBy.set(clean(r.batch_key),a);}
const asgBy=new Map();for(const a of assignments){const d=defBy.get(clean(a.batch_key))||{};const row={...d,...a,batch_key:clean(a.batch_key)};const u=norm(a.portal_user_id_norm),arr=asgBy.get(u)||[];arr.push(row);asgBy.set(u,arr);}

const profiles=new Map();const userKeys=await keys(studentsNs,'user:');for(const k of userKeys){const id=norm(k.replace(/^user:/,'')),u=await kv(studentsNs,k);if(u)profiles.set(id,u);}
const students=[...profiles].filter(([id,u])=>isStudent(id,u)).map(([id])=>id).sort();
const currentStudents=students.filter(id=>current(id,profiles.get(id)));

// Resolve the reported lesson display code and inspect its actual resource composition.
const cur=await kv(lessonsNs,'curriculum:ENGLISH_Y4');const ids=Array.isArray(cur?.lessonIds)?cur.lessonIds:[];let targetLesson=null;
for(const id of ids){const l=await kv(lessonsNs,`lesson:${clean(id)}`);if(!l)continue;const displays=Object.values(l.displayIds||{}).map(norm);if(clean(l.lessonId)===targetDisplayId||displays.includes(norm(targetDisplayId))){targetLesson=l;break;}}
if(!targetLesson)throw new Error(`Unable to resolve ${targetDisplayId}`);
const targetLessonId=clean(targetLesson.lessonId), targetResources=collectLessonResources(targetLesson);
const safeTargetResources=targetResources.map(r=>({type:clean(r.type),presentationGroup:clean(r.presentationGroup),title:clean(r.title||r.label||r.name),protected:Boolean(r.protected)}));
const isVrRes=r=>/^vr-/i.test(clean(r.presentationGroup))||/\bvr\b|verbal/i.test(`${clean(r.presentationGroup)} ${clean(r.title||r.label||r.name)}`);
const targetSummary={canonicalLessonId:targetLessonId,displayId:targetDisplayId,total:safeTargetResources.length,preLessonCount:safeTargetResources.filter(r=>/pre.?lesson/i.test(`${r.type} ${r.presentationGroup} ${r.title}`)).length,vrResourceCount:safeTargetResources.filter(isVrRes).length,vrHomeworkCount:safeTargetResources.filter(r=>isVrRes(r)&&/homework/i.test(`${r.type} ${r.presentationGroup} ${r.title}`)).length,resources:safeTargetResources};

// Derive expected VR independently of lesson_entitlements.
const expected=new Map();
function requireVr(u,l,reason,batch,date){const k=pair(u,l),x=expected.get(k)||{portalUserId:norm(u),lessonId:clean(l),reasons:new Set(),batches:new Set(),dates:new Set()};x.reasons.add(reason);if(batch)x.batches.add(clean(batch));if(date)x.dates.add(date);expected.set(k,x);}
for(const e of ents){const d=defBy.get(clean(e.source_batch_code));if(english11(d))requireVr(e.portal_user_id_norm,e.lesson_id,'stored-source-batch-is-authoritative-english11',e.source_batch_code,d10(e.source_lesson_date));}
for(const [u,rows] of asgBy){for(const a of rows){if(!english11(a))continue;for(const r of relBy.get(a.batch_key)||[]){const date=d10(r.lesson_date)||d10(r.first_completed_at);if(activeAt(a,date))requireVr(u,r.lesson_id,'assigned-to-english11-when-batch-released-lesson',a.batch_key,date);}}}

const under=[];
for(const x of expected.values()){const e=entBy.get(pair(x.portalUserId,x.lessonId));const lesson=await kv(lessonsNs,`lesson:${x.lessonId}`);const hasVr=lesson?collectLessonResources(lesson).some(isVrRes):false;const core=Number(e?.core_access||0)===1,vr=Number(e?.vr_access||0)===1;if(!e||!core||!vr)under.push({portalUserId:x.portalUserId,current:currentStudents.includes(x.portalUserId),lessonId:x.lessonId,hasVrResources:hasVr,stored:{exists:Boolean(e),core,vr,source:clean(e?.source),sourceBatch:clean(e?.source_batch_code),sourceLessonDate:d10(e?.source_lesson_date),firstGrantedAt:clean(e?.first_granted_at),lastConfirmedAt:clean(e?.last_confirmed_at)},expected:{core:true,vr:true},batches:[...x.batches].sort(),dates:[...x.dates].sort(),reasons:[...x.reasons].sort()});}
under.sort((a,b)=>a.portalUserId.localeCompare(b.portalUserId)||a.lessonId.localeCompare(b.lessonId));

const activeEnglish11=[];for(const id of currentStudents){const u=profiles.get(id),rows=(asgBy.get(id)||[]).filter(a=>english11(a)&&activeAt(a,asOf));if(rows.length)activeEnglish11.push({portalUserId:id,vrEligible:u?.vrEligible===true,batches:rows.map(x=>x.batch_key).sort()});}
const englishDefs=defs.filter(english11).map(d=>({batchKey:clean(d.batch_key),schoolYear:Number(d.school_year),oldImporterRegexWouldRecognise:oldImporterBatchMatch(d.batch_key)})).sort((a,b)=>a.batchKey.localeCompare(b.batchKey));
const affectedByUser=new Map();for(const r of under){const x=affectedByUser.get(r.portalUserId)||{portalUserId:r.portalUserId,current:r.current,underEntitledLessons:0,withVrResources:0,lessonIds:[]};x.underEntitledLessons++;if(r.hasVrResources)x.withVrResources++;x.lessonIds.push(r.lessonId);affectedByUser.set(r.portalUserId,x);}

const tp=profiles.get(targetUser),te=entBy.get(pair(targetUser,targetLessonId));const tx=expected.get(pair(targetUser,targetLessonId));
const target={portalUserId:targetUser,profileExists:Boolean(tp),current:tp?current(targetUser,tp):false,profileVrEligible:tp?.vrEligible===true,assignments:(asgBy.get(targetUser)||[]).map(a=>({batchKey:a.batch_key,subject:a.subject,schoolYear:a.school_year,stream:a.stream,effectiveFrom:a.effective_from,effectiveTo:a.effective_to,activeNow:activeAt(a,asOf),oldImporterRegexWouldRecognise:oldImporterBatchMatch(a.batch_key)})),lesson:targetSummary,storedEntitlement:te?{core:Number(te.core_access||0)===1,vr:Number(te.vr_access||0)===1,source:clean(te.source),sourceBatch:clean(te.source_batch_code),sourceLessonDate:d10(te.source_lesson_date),firstGrantedAt:clean(te.first_granted_at),lastConfirmedAt:clean(te.last_confirmed_at)}:null,preLessonRows:pres.filter(p=>norm(p.portal_user_id_norm)===targetUser&&clean(p.lesson_id)===targetLessonId).map(p=>({batchKey:clean(p.batch_key),lessonDate:d10(p.lesson_date),vr:Number(p.vr_access||0)===1})),semanticExpectation:tx?{core:true,vr:true,batches:[...tx.batches].sort(),reasons:[...tx.reasons].sort()}:null};

const report={marker:'FPT_ENTITLEMENT_SEMANTIC_AUDIT_V2',readOnly:true,asOfDate:asOf,status:under.filter(r=>r.current).length?'FAIL':'PASS',population:{profileKeys:userKeys.length,studentProfiles:students.length,currentStudents:currentStudents.length,currentEnglish11Students:activeEnglish11.length},batchConfiguration:{english11Definitions:englishDefs,definitionsNotRecognisedByOldImporterRegex:englishDefs.filter(x=>!x.oldImporterRegexWouldRecognise).length},profileGate:{currentEnglish11WithoutVrEligible:activeEnglish11.filter(x=>!x.vrEligible)},semanticUnderEntitlements:{allRows:under.length,currentRows:under.filter(r=>r.current).length,affectedUsers:[...affectedByUser.values()].sort((a,b)=>a.portalUserId.localeCompare(b.portalUserId)),rows:under},target};
fs.writeFileSync('/tmp/entitlement-semantic-audit.json',JSON.stringify(report,null,2)+'\n');fs.writeFileSync('/tmp/dha2806-trace.json',JSON.stringify(target,null,2)+'\n');
console.log(JSON.stringify({marker:report.marker,status:report.status,readOnly:true,population:report.population,batchConfiguration:report.batchConfiguration,currentEnglish11WithoutVrEligible:report.profileGate.currentEnglish11WithoutVrEligible.map(x=>x.portalUserId),currentUnderEntitlementRows:report.semanticUnderEntitlements.currentRows,affectedCurrentUsers:report.semanticUnderEntitlements.affectedUsers.filter(x=>x.current).map(x=>x.portalUserId),target:{portalUserId:target.portalUserId,profileVrEligible:target.profileVrEligible,storedEntitlement:target.storedEntitlement,semanticExpectation:target.semanticExpectation,lesson:{canonicalLessonId:target.lesson.canonicalLessonId,preLessonCount:target.lesson.preLessonCount,vrResourceCount:target.lesson.vrResourceCount,vrHomeworkCount:target.lesson.vrHomeworkCount}}},null,2));
if(report.status==='FAIL')process.exitCode=2;
