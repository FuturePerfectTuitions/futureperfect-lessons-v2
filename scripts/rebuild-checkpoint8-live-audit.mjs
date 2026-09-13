import crypto from 'node:crypto';
import fs from 'node:fs';
import { compileGlobalScope, compileAccessScope, collectLessonResources, globalToCatalogue } from '../rebuild/adminops/src/lib/compiler.mjs';
import { buildAuthoritativeParityOracle, diffAccessParity } from '../rebuild/adminops/src/lib/backfill-parity-audit.mjs';
import { auditLegacyLessonResourceParity, legacyPhase11Inventory } from '../rebuild/adminops/src/lib/legacy-resource-oracle.mjs';

const token=process.env.CLOUDFLARE_API_TOKEN||'', account=process.env.CLOUDFLARE_ACCOUNT_ID||'', worker=process.env.WORKER_NAME||'fpt-portal-v2-worker', asOf=process.env.CHECKPOINT8_AS_OF_DATE||'2026-09-13';
if(!token||!account) throw new Error('Cloudflare read-only credentials are required.');
const base='https://api.cloudflare.com/client/v4';
const headers={Authorization:`Bearer ${token}`};
const clean=v=>String(v??'').trim(), norm=v=>clean(v).toLowerCase(), digest=v=>crypto.createHash('sha256').update(clean(v)).digest('hex').slice(0,16);

async function envelope(path,options={}) {
  const response=await fetch(`${base}${path}`,{...options,headers:{...headers,...(options.headers||{})}});
  const body=await response.json().catch(()=>null);
  if(!response.ok||body?.success!==true) throw new Error(`Cloudflare read failed: ${response.status} ${path}`);
  return body;
}
async function kvGet(ns,key) {
  const response=await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{headers});
  if(response.status===404) return null;
  if(!response.ok) throw new Error(`KV read failed: ${response.status}`);
  return response.json().catch(()=>null);
}
async function kvKeys(ns,prefix) {
  const keys=[]; let cursor='';
  do {
    const q=new URLSearchParams({limit:'1000',prefix}); if(cursor) q.set('cursor',cursor);
    const body=await envelope(`/accounts/${account}/storage/kv/namespaces/${ns}/keys?${q}`);
    keys.push(...(body.result||[]).map(x=>x.name).filter(Boolean)); cursor=clean(body.result_info?.cursor);
  } while(cursor);
  return keys;
}
async function d1Query(db,sql) {
  if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql)) throw new Error('Checkpoint 8 permits read-only D1 statements only.');
  const body=await envelope(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql})});
  const first=Array.isArray(body.result)?body.result[0]:body.result;
  return Array.isArray(first?.results)?first.results:[];
}

const settings=(await envelope(`/accounts/${account}/workers/scripts/${worker}/settings`)).result;
const binding=name=>(settings?.bindings||[]).find(x=>x.name===name)||{};
const studentsNs=clean(binding('STUDENTS_KV').namespace_id), lessonsNs=clean(binding('LESSONS_KV').namespace_id), dbId=clean(binding('DB').database_id||binding('DB').id);
if(!studentsNs||!lessonsNs||!dbId) throw new Error('Required production bindings could not be resolved read-only.');

const curriculumCodes=['MATHS_Y2','MATHS_Y3','MATHS_L1','MATHS_L2','MATHS_L3','MATHS_Y6_EXTRA','ENGLISH_Y2','ENGLISH_Y3','ENGLISH_Y4','ENGLISH_Y5','ENGLISH_Y6'];
const fallback={MATHS_Y2:['maths-year2'],MATHS_Y3:['maths-year3'],MATHS_L1:['maths-year4','maths-level1'],MATHS_L2:['maths-year5','maths-level2'],MATHS_L3:['maths-level3','maths-year6'],MATHS_Y6_EXTRA:['maths-year6-extra'],ENGLISH_Y2:['english-year2'],ENGLISH_Y3:['english-year3'],ENGLISH_Y4:['english-year4','english-year4-11plus'],ENGLISH_Y5:['english-year5','english-year5-11plus'],ENGLISH_Y6:['english-year6']};
const items=raw=>Array.isArray(raw)?raw:Array.isArray(raw?.lessonIds)?raw.lessonIds:Array.isArray(raw?.lessons)?raw.lessons:Array.isArray(raw?.items)?raw.items:[];
const curricula={}, lessonIds=new Set();
for(const code of curriculumCodes) {
  let raw=await kvGet(lessonsNs,`curriculum:${code}`);
  if(!items(raw).length) for(const view of fallback[code]||[]) { const probe=await kvGet(lessonsNs,`view:${view}`); if(items(probe).length){raw=probe;break;} }
  const rows=items(raw); curricula[code]={lessonIds:rows.map(x=>typeof x==='string'?clean(x):clean(x?.lessonId)).filter(Boolean)}; for(const id of curricula[code].lessonIds) lessonIds.add(id);
}
const lessons={};
for(const id of [...lessonIds].sort()) { const row=await kvGet(lessonsNs,`lesson:${id}`); if(row) lessons[id]=row; }
const global=compileGlobalScope({sourceType:'production-authoritative-readonly',sourceRevision:`checkpoint8-${asOf}`,curricula,lessons},{sourceType:'production-authoritative-readonly',sourceRevision:`checkpoint8-${asOf}`});
const catalogue=globalToCatalogue(global);

const [definitions,assignments,entitlements,preLesson]=await Promise.all([
  d1Query(dbId,'SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions'),
  d1Query(dbId,'SELECT a.portal_user_id_norm, a.batch_key, a.effective_from, a.effective_to, b.subject, b.school_year, b.stream, b.maths_level, b.active_from AS batch_active_from, b.active_to AS batch_active_to FROM student_batch_assignments a JOIN batch_definitions b ON b.batch_key = a.batch_key'),
  d1Query(dbId,'SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source, first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date FROM lesson_entitlements'),
  d1Query(dbId,'SELECT portal_user_id_norm, lesson_id, batch_key, lesson_date, first_granted_at FROM online_prelesson_entitlements')
]);
const group=(rows,key='portal_user_id_norm')=>{const m=new Map();for(const r of rows){const k=norm(r?.[key]);if(!k)continue;const a=m.get(k)||[];a.push(r);m.set(k,a);}return m;};
const byAssignments=group(assignments), byEntitlements=group(entitlements), byPre=group(preLesson);

const resourceMismatches=[]; let cumulativeLessons=0, answerPackLessons=0, satsLessons=0, phase11Lessons=0, phase11ExtensionEntries=0;
for(const [id,record] of Object.entries(lessons)) {
  const compiled=collectLessonResources(record), parity=auditLegacyLessonResourceParity(record,compiled); if(!parity.pass) resourceMismatches.push(id);
  const phase11=legacyPhase11Inventory(record); if(phase11.extensionEntries>0) phase11Lessons++; phase11ExtensionEntries+=phase11.extensionEntries; if(phase11.cumulativePairs>0)cumulativeLessons++;
  if(compiled.some(x=>x.type==='answer-pack'&&x.protected===true)) answerPackLessons++; if(/sat/i.test(clean(record?.title))||/sat/i.test(id)) satsLessons++;
}

const userKeys=await kvKeys(studentsNs,'user:');
let excludedAdmin=0, excludedInactive=0, audited=0, unexplained=0;
const safeFailures=[], featureCounts={fullLibrary:0,blocked:0,preLessonOnly:0,manual:0,configuredPreview:0,historicalHint:0,rejoin:0,multiBatch:0};
function currentStudent(id,user) {
  const role=norm(user?.role||user?.accountType); if(id==='admin'||role.includes('admin')||user?.isAdmin===true||user?.superuser===true){excludedAdmin++;return false;}
  const status=norm(user?.accountStatus||user?.status||'active'); const expires=clean(user?.expiresOn||user?.expires);
  if(['inactive','disabled','expired','withdrawn'].includes(status)||(expires&&expires<=asOf)){excludedInactive++;return false;} return true;
}

for(const key of userKeys.sort()) {
  const id=norm(key.replace(/^user:/,'')), user=await kvGet(studentsNs,key); if(!user||!currentStudent(id,user)) continue;
  const userAssignments=byAssignments.get(id)||[], userEntitlements=byEntitlements.get(id)||[], userPre=byPre.get(id)||[];
  if((user.fullLibraries||[]).length)featureCounts.fullLibrary++; if((user.blockedLessons||[]).length)featureCounts.blocked++; if(userPre.length)featureCounts.preLessonOnly++;
  if((user.manualAccess?.coreLessons||[]).length||(user.manualAccess?.vrLessons||[]).length||user.manualLessonAccess)featureCounts.manual++;
  if(Array.isArray(user.upsellViews))featureCounts.configuredPreview++; if((user.historicalViews||[]).length)featureCounts.historicalHint++;
  const batchCounts=new Map(); for(const r of userAssignments){const k=clean(r.batch_key);batchCounts.set(k,(batchCounts.get(k)||0)+1);} if([...batchCounts.values()].some(n=>n>1))featureCounts.rejoin++; if(new Set(userAssignments.map(r=>clean(r.batch_key))).size>1)featureCounts.multiBatch++;
  const input={asOfDate:asOf,user,batchDefinitions:definitions,batchAssignments:userAssignments,entitlements:userEntitlements,onlinePreLessonEntitlements:userPre};
  const scopeId=`cp8-${digest(id)}`, compiled=compileAccessScope(input,catalogue,{scopeId,asOfDate:asOf}), oracle=buildAuthoritativeParityOracle(input,catalogue,{asOfDate:asOf}), parity=diffAccessParity(compiled.snapshot,oracle);
  audited++; if(!parity.pass){unexplained+=parity.unexplained.length;safeFailures.push({student:digest(id),differenceIds:parity.unexplained.map(x=>x.id).slice(0,30)});}
}

const summary={marker:'REBUILD_CHECKPOINT8_LIVE_READONLY_AUDIT',asOfDate:asOf,status:unexplained===0&&resourceMismatches.length===0?'PASS':'FAIL',catalogue:{curriculumCount:curriculumCodes.length,presentationCount:Object.keys(global.catalogues||{}).length,lessonCount:Object.keys(lessons).length,satsLessons,cumulativeLessons,answerPackLessons,phase11Lessons,phase11ExtensionEntries,resourceMismatchCount:resourceMismatches.length,resourceMismatchLessonIds:resourceMismatches.slice(0,50)},students:{profileKeyCount:userKeys.length,auditedCurrentStudents:audited,excludedAdmin,excludedInactive,unexplainedDifferenceCount:unexplained,featureCounts,failures:safeFailures.slice(0,25)}};
fs.writeFileSync('/tmp/checkpoint8-live-summary.json',JSON.stringify(summary,null,2)); console.log(JSON.stringify(summary,null,2));
if(summary.status!=='PASS') process.exitCode=1;
