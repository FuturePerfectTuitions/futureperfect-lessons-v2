import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { collectLessonResources } from '../rebuild/adminops/src/lib/compiler.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { pointerKey, versionKey } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toLowerCase();
const token=clean(process.env.CLOUDFLARE_API_TOKEN);
const account=clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const legacy=clean(process.env.LEGACY_WORKER||'fpt-portal-v2-worker');
const browser=clean(process.env.BROWSER_WORKER||'fpt-portal-v2-rebuild-browser-prod');
const student=clean(process.env.STUDENT_WORKER||'fpt-portal-v2-rebuild-student-prod');
const host=clean(process.env.PROD_HOST||'lessons.futureperfect.education').toLowerCase();
const asOf=clean(process.env.AS_OF_DATE||'2026-09-15');
if(!token||!account) throw new Error('Cloudflare credentials required.');

const base='https://api.cloudflare.com/client/v4';
const auth={Authorization:`Bearer ${token}`};
const backupPath='/tmp/incident-entitlement-repair-private-backup.json';
const safeReportPath='/tmp/incident-entitlement-production-repair.json';
const stalePreLesson='Y4T1E01 PreLesson Sheet Transitioning from Year 3 to Year 4.pdf';
const targets=[
  {user:'dha2806', lesson:'Y4E1', sourceBatch:'Y411FE'},
  {user:'rei0710', lesson:'Y4E1', sourceBatch:'Y411OE'}
];

async function request(path,options={}){
  const r=await fetch(`${base}${path}`,{...options,headers:{...auth,...(options.headers||{})}});
  const text=await r.text(); let body=null; try{body=JSON.parse(text);}catch{}
  return {r,text,body};
}
async function cf(path,options={}){
  const out=await request(path,options);
  if(!out.r.ok||out.body?.success!==true) throw new Error(`Cloudflare request failed ${out.r.status}: ${path}: ${clean(out.body?.errors?.[0]?.message||out.text).slice(0,240)}`);
  return out.body;
}
async function kvText(ns,key){
  const out=await request(`/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`);
  if(out.r.status===404)return null;
  if(!out.r.ok)throw new Error(`KV read failed ${out.r.status}: ${key}`);
  return out.text;
}
async function kvJson(ns,key){const t=await kvText(ns,key);if(t==null)return null;try{return JSON.parse(t);}catch{throw new Error(`KV JSON invalid: ${key}`);}}
async function kvPut(ns,key,value){
  const out=await request(`/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{method:'PUT',headers:{'content-type':'application/json'},body:value});
  if(!out.r.ok||out.body?.success!==true) throw new Error(`KV write failed ${out.r.status}: ${key}: ${clean(out.body?.errors?.[0]?.message||out.text).slice(0,220)}`);
}
async function d1(db,sql,params=[]){
  const body=await cf(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql,params})});
  const first=Array.isArray(body.result)?body.result[0]:body.result;
  return {rows:Array.isArray(first?.results)?first.results:[],meta:first?.meta||{}};
}
async function settings(worker){return (await cf(`/accounts/${account}/workers/scripts/${encodeURIComponent(worker)}/settings`)).result||{};}
function binding(s,name){return (s?.bindings||[]).find(x=>clean(x.name)===name)||{};}
async function activeVersion(worker){
  const b=await cf(`/accounts/${account}/workers/scripts/${encodeURIComponent(worker)}/deployments`);
  const rows=Array.isArray(b.result?.deployments)?b.result.deployments:Array.isArray(b.result)?b.result:[];
  const versions=Array.isArray(rows[0]?.versions)?rows[0].versions:[];
  return clean((versions.find(v=>Number(v.percentage||0)===100)||versions[0])?.version_id);
}
async function topology(){
  const zones=(await cf(`/zones?per_page=50&account.id=${encodeURIComponent(account)}`)).result||[];
  const zone=zones.filter(z=>host===z.name||host.endsWith(`.${z.name}`)).sort((a,b)=>b.name.length-a.name.length)[0];
  if(!zone)throw new Error('Production zone unavailable.');
  const routes=(await cf(`/zones/${zone.id}/workers/routes`)).result||[];
  const hostRoutes=routes.filter(r=>clean(r.pattern).toLowerCase().includes(host));
  if(hostRoutes.length!==1||clean(hostRoutes[0].pattern).toLowerCase()!==`${host}/*`||clean(hostRoutes[0].script)!==browser)throw new Error(`Public route drift: ${JSON.stringify(hostRoutes)}`);
  const bs=await settings(browser); const services=(bs.bindings||[]).filter(b=>clean(b.type)==='service');
  if(services.length!==1||clean(services[0].service)!==student)throw new Error(`Browser service topology drift: ${JSON.stringify(services.map(x=>({name:x.name,service:x.service})))}`);
  if((bs.bindings||[]).some(b=>/admin/i.test(`${clean(b.name)} ${clean(b.service)}`)))throw new Error('Forbidden Browser Admin/AdminOps binding detected.');
  return {route:{pattern:clean(hostRoutes[0].pattern),script:clean(hostRoutes[0].script)},browserVersion:await activeVersion(browser),studentVersion:await activeVersion(student),service:{name:clean(services[0].name),service:clean(services[0].service)}};
}
function exactTargetRow(rows,t){
  if(rows.length!==1)throw new Error(`Expected one entitlement row for ${t.user}/${t.lesson}, found ${rows.length}`);
  const r=rows[0];
  if(norm(r.portal_user_id_norm)!==t.user||clean(r.lesson_id)!==t.lesson||Number(r.core_access)!==1||Number(r.vr_access)!==0||clean(r.source_batch_code)!==t.sourceBatch)throw new Error(`Entitlement precondition drift for ${t.user}/${t.lesson}`);
  return r;
}
function removeExactStalePreLesson(record){
  let removed=0;
  const filter=list=>Array.isArray(list)?list.filter(x=>{if(clean(x?.displayName||x?.name||x?.title)===stalePreLesson){removed++;return false;}return true;}):list;
  if(Array.isArray(record.preLessonSheets))record.preLessonSheets=filter(record.preLessonSheets);
  if(record.core&&typeof record.core==='object'&&Array.isArray(record.core.preLessonSheets))record.core.preLessonSheets=filter(record.core.preLessonSheets);
  return removed;
}
function hasStale(record){
  const lists=[record?.preLessonSheets,record?.core?.preLessonSheets].filter(Array.isArray);
  return lists.some(list=>list.some(x=>clean(x?.displayName||x?.name||x?.title)===stalePreLesson));
}
function hasVrHomework(record){return collectLessonResources(record).some(r=>r.type==='homework'&&Array.isArray(r.presentationScopes)&&r.presentationScopes.includes('vr'));}
async function readPointerPayload(ns,scope){
  const p=await kvJson(ns,pointerKey(scope));
  const ver=clean(p?.current?.version); if(!ver)throw new Error(`Prepared pointer missing: ${scope}`);
  const e=await kvJson(ns,versionKey(scope,ver)); if(!e?.payload)throw new Error(`Prepared envelope missing: ${scope}`);
  return {pointer:p,payload:e.payload};
}
function runBackfill(env){
  const r=spawnSync(process.execPath,['scripts/rebuild-checkpoint11-backfill.mjs'],{stdio:'inherit',env:{...process.env,...env}});
  if(r.status!==0)throw new Error(`Canonical prepared-model backfill failed with exit ${r.status}`);
}

const legacySettings=await settings(legacy);
const studentsNs=clean(binding(legacySettings,'STUDENTS_KV').namespace_id);
const lessonsNs=clean(binding(legacySettings,'LESSONS_KV').namespace_id);
const dbId=clean(binding(legacySettings,'DB').database_id||binding(legacySettings,'DB').id);
let readNs=clean(binding(legacySettings,'READ_MODELS_KV').namespace_id);
if(!readNs){
  const ss=await settings(student); readNs=clean(binding(ss,'READ_MODELS_KV').namespace_id);
}
const r2=clean(binding(legacySettings,'MATERIALS_R2').bucket_name||binding(legacySettings,'MATERIALS_R2').bucket);
if(!studentsNs||!lessonsNs||!dbId||!readNs||!r2)throw new Error('Required production bindings unresolved.');

const beforeTopology=await topology();
const backup={createdAt:new Date().toISOString(),bindings:{studentsNs,lessonsNs,dbId,readNs},entitlements:{},profiles:{},lessonY4E1:null};
for(const t of targets){
  const q=await d1(dbId,'SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source, first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date FROM lesson_entitlements WHERE portal_user_id_norm = ? AND lesson_id = ?',[t.user,t.lesson]);
  backup.entitlements[`${t.user}|${t.lesson}`]=exactTargetRow(q.rows,t);
  const raw=await kvText(studentsNs,`user:${t.user}`); if(raw==null)throw new Error(`Profile missing: ${t.user}`);
  const p=JSON.parse(raw); if(norm(p.portalUserId||t.user)!==t.user||p.vrEligible!==false)throw new Error(`Profile precondition drift for ${t.user}`);
  backup.profiles[t.user]=raw;
}
const lessonRaw=await kvText(lessonsNs,'lesson:Y4E1'); if(lessonRaw==null)throw new Error('lesson:Y4E1 missing.');
const lessonBefore=JSON.parse(lessonRaw); if(clean(lessonBefore.lessonId)!=='Y4E1'||!hasStale(lessonBefore)||!hasVrHomework(lessonBefore))throw new Error('Y4E1 resource precondition drift.');
backup.lessonY4E1=lessonRaw;
fs.writeFileSync(backupPath,JSON.stringify(backup,null,2)+'\n',{mode:0o600});

const safe={marker:'FPT_ENTITLEMENT_PRODUCTION_REPAIR',startedAt:new Date().toISOString(),success:false,rollbackPerformed:false,beforeTopology,targets:targets.map(t=>({portalUserId:t.user,lessonId:t.lesson,sourceBatch:t.sourceBatch,beforeVr:false,afterVr:true})),profileVrEligible:targets.map(t=>({portalUserId:t.user,before:false,after:true})),lesson:{lessonId:'Y4E1',removedDisplayName:stalePreLesson,vrHomeworkPreserved:true}};
let sourceMutationStarted=false;
async function restoreSource(){
  for(const t of targets){
    const old=backup.entitlements[`${t.user}|${t.lesson}`];
    await d1(dbId,'UPDATE lesson_entitlements SET core_access = ?, vr_access = ?, source = ?, first_granted_at = ?, last_confirmed_at = ?, source_batch_code = ?, source_lesson_date = ? WHERE portal_user_id_norm = ? AND lesson_id = ?',[Number(old.core_access),Number(old.vr_access),old.source,old.first_granted_at,old.last_confirmed_at,old.source_batch_code,old.source_lesson_date,t.user,t.lesson]);
  }
  for(const t of targets)await kvPut(studentsNs,`user:${t.user}`,backup.profiles[t.user]);
  await kvPut(lessonsNs,'lesson:Y4E1',backup.lessonY4E1);
}
const backfillEnv={
  PROD_WORKER:legacy,
  PROD_SHADOW_KV_ID:readNs,
  EXPECTED_STUDENTS_KV_ID:studentsNs,
  EXPECTED_LESSONS_KV_ID:lessonsNs,
  EXPECTED_PROD_D1_ID:dbId,
  CHECKPOINT11_AS_OF_DATE:asOf
};
try{
  sourceMutationStarted=true;
  for(const t of targets){
    await d1(dbId,'UPDATE lesson_entitlements SET vr_access = 1 WHERE portal_user_id_norm = ? AND lesson_id = ? AND core_access = 1 AND vr_access = 0 AND source_batch_code = ?',[t.user,t.lesson,t.sourceBatch]);
    const q=await d1(dbId,'SELECT core_access, vr_access, source_batch_code FROM lesson_entitlements WHERE portal_user_id_norm = ? AND lesson_id = ?',[t.user,t.lesson]);
    if(q.rows.length!==1||Number(q.rows[0].core_access)!==1||Number(q.rows[0].vr_access)!==1||clean(q.rows[0].source_batch_code)!==t.sourceBatch)throw new Error(`D1 entitlement repair verification failed: ${t.user}`);
  }
  for(const t of targets){
    const raw=backup.profiles[t.user], p=JSON.parse(raw); p.vrEligible=true;
    await kvPut(studentsNs,`user:${t.user}`,JSON.stringify(p));
    const confirmed=await kvJson(studentsNs,`user:${t.user}`); if(confirmed?.vrEligible!==true)throw new Error(`Profile repair verification failed: ${t.user}`);
  }
  const lessonAfter=JSON.parse(lessonRaw); const removed=removeExactStalePreLesson(lessonAfter);
  if(removed<1||hasStale(lessonAfter)||!hasVrHomework(lessonAfter))throw new Error(`Y4E1 targeted resource repair failed pre-write; removed=${removed}`);
  await kvPut(lessonsNs,'lesson:Y4E1',JSON.stringify(lessonAfter));
  const lessonConfirmed=await kvJson(lessonsNs,'lesson:Y4E1'); if(!lessonConfirmed||hasStale(lessonConfirmed)||!hasVrHomework(lessonConfirmed))throw new Error('Y4E1 source repair verification failed after write.');
  safe.lesson.removedOccurrences=removed;

  runBackfill(backfillEnv);

  const scopeSalt=clean(await kvText(readNs,'meta:scope-salt')); if(!/^[0-9a-f]{64}$/i.test(scopeSalt))throw new Error('Prepared-model scope salt missing after repair.');
  for(const t of targets){
    const scopeId=await opaqueAccessScopeId(t.user,scopeSalt);
    const prepared=await readPointerPayload(readNs,`access:${scopeId}`);
    const state=prepared.payload?.snapshot?.lessonAccess?.Y4E1;
    if(state?.core!==true||state?.vr!==true||state?.blocked===true)throw new Error(`Prepared access did not converge for ${t.user}/Y4E1`);
  }
  const lessonPrepared=await readPointerPayload(readNs,'lesson:Y4E1');
  const resources=Array.isArray(lessonPrepared.payload?.resources)?lessonPrepared.payload.resources:[];
  if(resources.some(r=>clean(r.displayName)===stalePreLesson))throw new Error('Prepared Y4E1 still contains stale PreLesson resource.');
  const vrHw=resources.filter(r=>r.type==='homework'&&Array.isArray(r.presentationScopes)&&r.presentationScopes.includes('vr'));
  if(vrHw.length<1)throw new Error('Prepared Y4E1 lost VR homework.');

  const afterTopology=await topology();
  if(JSON.stringify(afterTopology)!==JSON.stringify(beforeTopology))throw new Error(`Public topology/version changed during data repair: before=${JSON.stringify(beforeTopology)} after=${JSON.stringify(afterTopology)}`);
  safe.afterTopology=afterTopology;
  safe.prepared={dha2806Y4E1:{core:true,vr:true},rei0710Y4E1:{core:true,vr:true},y4e1StalePreLesson:false,y4e1VrHomeworkCount:vrHw.length};
  safe.success=true; safe.completedAt=new Date().toISOString();
  fs.writeFileSync(safeReportPath,JSON.stringify(safe,null,2)+'\n');
  console.log(JSON.stringify({marker:'FPT_ENTITLEMENT_PRODUCTION_REPAIR_PASS',targets:safe.targets,prepared:safe.prepared,topology:afterTopology},null,2));
}catch(error){
  safe.error=clean(error?.message||error);
  if(sourceMutationStarted){
    try{
      await restoreSource();
      runBackfill(backfillEnv);
      safe.rollbackPerformed=true;
    }catch(rollbackError){
      safe.rollbackError=clean(rollbackError?.message||rollbackError);
      fs.writeFileSync(safeReportPath,JSON.stringify({...safe,completedAt:new Date().toISOString()},null,2)+'\n');
      throw new Error(`REPAIR_FAILED_AND_ROLLBACK_FAILED: ${safe.error}; rollback=${safe.rollbackError}`);
    }
  }
  safe.completedAt=new Date().toISOString();
  fs.writeFileSync(safeReportPath,JSON.stringify(safe,null,2)+'\n');
  throw error;
}
