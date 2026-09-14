import crypto from 'node:crypto';
import fs from 'node:fs';
import { compileGlobalScope, compileAccessScope, compileLessonDetail, collectLessonResources, globalToCatalogue } from '../rebuild/adminops/src/lib/compiler.mjs';
import { buildAuthoritativeParityOracle, diffAccessParity } from '../rebuild/adminops/src/lib/backfill-parity-audit.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { stableStringify, sha256Hex, pointerKey, versionKey } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const clean=v=>String(v??'').trim(), norm=v=>clean(v).toLowerCase();
const token=clean(process.env.CLOUDFLARE_API_TOKEN), account=clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const worker=clean(process.env.PROD_WORKER||'fpt-portal-v2-worker');
const shadowKv=clean(process.env.PROD_SHADOW_KV_ID||'77b35165c8694087bc1b0515c35a7e89');
const expectedStudents=clean(process.env.EXPECTED_STUDENTS_KV_ID||'c9723c8806334e4ea54d1b456d31b794');
const expectedLessons=clean(process.env.EXPECTED_LESSONS_KV_ID||'49619b1a24b244bc8aaa6223fcd24e80');
const expectedDb=clean(process.env.EXPECTED_PROD_D1_ID||'97250a54-fa91-45ad-a002-3c4566b1fc38');
const asOf=clean(process.env.CHECKPOINT11_AS_OF_DATE||new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
const runTag=clean(process.env.GITHUB_RUN_ID||Date.now()).replace(/[^A-Za-z0-9._-]+/g,'-').slice(0,40);
if(!token||!account||!shadowKv) throw new Error('CP11 backfill requires Cloudflare credentials and the frozen shadow KV ID.');
const base='https://api.cloudflare.com/client/v4', headers={Authorization:`Bearer ${token}`};
async function request(path,options={}){const response=await fetch(`${base}${path}`,{...options,headers:{...headers,...(options.headers||{})}});const text=await response.text();let body=null;try{body=JSON.parse(text);}catch{}return{response,text,body};}
async function envelope(path,options={}){const out=await request(path,options);if(!out.response.ok||out.body?.success!==true)throw new Error(`Cloudflare request failed: ${out.response.status} ${path}`);return out.body;}
async function kvText(ns,key){const out=await request(`/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`);if(out.response.status===404)return null;if(!out.response.ok)throw new Error(`KV read failed ${out.response.status}: ${key}`);return out.text;}
async function kvJson(ns,key){const text=await kvText(ns,key);if(text==null)return null;try{return JSON.parse(text);}catch{throw new Error(`KV JSON invalid: ${key}`);}}
async function kvKeys(ns,prefix){const keys=[];let cursor='';do{const q=new URLSearchParams({limit:'1000',prefix});if(cursor)q.set('cursor',cursor);const body=await envelope(`/accounts/${account}/storage/kv/namespaces/${ns}/keys?${q}`);keys.push(...(body.result||[]).map(x=>x.name).filter(Boolean));cursor=clean(body.result_info?.cursor);}while(cursor);return keys;}
async function kvBulk(ns,items){for(let i=0;i<items.length;i+=500){const part=items.slice(i,i+500);if(!part.length)continue;const body=await envelope(`/accounts/${account}/storage/kv/namespaces/${ns}/bulk`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(part)});if((body.result?.unsuccessful_keys||[]).length)throw new Error(`KV bulk write incomplete: ${body.result.unsuccessful_keys.length}`);}}
async function d1Query(db,sql){if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql))throw new Error('CP11 backfill permits read-only D1 source statements only.');const body=await envelope(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql})});const first=Array.isArray(body.result)?body.result[0]:body.result;return Array.isArray(first?.results)?first.results:[];}
async function mapLimit(values,limit,fn){const out=new Array(values.length);let next=0;async function runner(){while(true){const i=next++;if(i>=values.length)return;out[i]=await fn(values[i],i);}}await Promise.all(Array.from({length:Math.min(limit,values.length||1)},runner));return out;}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function digest(value){return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0,16);}
function valid4(value){const p=String(value||'');return p.length===4&&/[A-Z]/.test(p)&&/[a-z]/.test(p)&&/\d/.test(p);}

const settings=(await envelope(`/accounts/${account}/workers/scripts/${worker}/settings`)).result||{};
const binding=name=>(settings.bindings||[]).find(x=>x.name===name)||{};
const studentsNs=clean(binding('STUDENTS_KV').namespace_id), lessonsNs=clean(binding('LESSONS_KV').namespace_id), dbId=clean(binding('DB').database_id||binding('DB').id), r2=clean(binding('MATERIALS_R2').bucket_name||binding('MATERIALS_R2').bucket);
if(studentsNs!==expectedStudents||lessonsNs!==expectedLessons||dbId!==expectedDb||!r2) throw new Error('Production source bindings drifted before CP11 backfill.');
if(!(settings.bindings||[]).some(x=>clean(x.namespace_id)===shadowKv)) throw new Error('Legacy production Worker no longer carries the CP4 shadow KV binding.');
const scopeSecret=clean(await kvText(shadowKv,'meta:scope-salt'));
if(!/^[0-9a-f]{64}$/i.test(scopeSecret)) throw new Error('Production shadow scope salt is missing or malformed.');

const curriculumCodes=['MATHS_Y2','MATHS_Y3','MATHS_L1','MATHS_L2','MATHS_L3','MATHS_Y6_EXTRA','ENGLISH_Y2','ENGLISH_Y3','ENGLISH_Y4','ENGLISH_Y5','ENGLISH_Y6'];
const fallback={MATHS_Y2:['maths-year2'],MATHS_Y3:['maths-year3'],MATHS_L1:['maths-year4','maths-level1'],MATHS_L2:['maths-year5','maths-level2'],MATHS_L3:['maths-level3','maths-year6'],MATHS_Y6_EXTRA:['maths-year6-extra'],ENGLISH_Y2:['english-year2'],ENGLISH_Y3:['english-year3'],ENGLISH_Y4:['english-year4','english-year4-11plus'],ENGLISH_Y5:['english-year5','english-year5-11plus'],ENGLISH_Y6:['english-year6']};
const items=raw=>Array.isArray(raw)?raw:Array.isArray(raw?.lessonIds)?raw.lessonIds:Array.isArray(raw?.lessons)?raw.lessons:Array.isArray(raw?.items)?raw.items:[];
const curricula={}, lessonIds=new Set();
for(const code of curriculumCodes){let raw=await kvJson(lessonsNs,`curriculum:${code}`);if(!items(raw).length)for(const view of fallback[code]||[]){const probe=await kvJson(lessonsNs,`view:${view}`);if(items(probe).length){raw=probe;break;}}const rows=items(raw);if(!rows.length)throw new Error(`Required curriculum missing: ${code}`);curricula[code]={lessonIds:rows.map(x=>typeof x==='string'?clean(x):clean(x?.lessonId)).filter(Boolean)};for(const id of curricula[code].lessonIds)lessonIds.add(id);}
const lessonPairs=await mapLimit([...lessonIds].sort(),24,async id=>[id,await kvJson(lessonsNs,`lesson:${id}`)]);
const lessons=Object.fromEntries(lessonPairs.filter(([,row])=>row));
if(Object.keys(lessons).length!==lessonIds.size)throw new Error('One or more live curriculum lesson records are missing.');
if(Object.keys(lessons).length!==372)throw new Error(`CP11 expected 372 canonical lessons, found ${Object.keys(lessons).length}.`);
const sourceRevision=crypto.createHash('sha256').update(stableStringify({curricula,lessons})).digest('hex');
const global=compileGlobalScope({sourceType:'production-authoritative-cp11',sourceRevision,curricula,lessons},{sourceType:'production-authoritative-cp11',sourceRevision});
const catalogue=globalToCatalogue(global);
if(Object.keys(global.catalogues||{}).length!==15)throw new Error(`CP11 expected 15 presentation catalogues, found ${Object.keys(global.catalogues||{}).length}.`);

const [definitions,assignments,entitlements,preLesson]=await Promise.all([
 d1Query(dbId,'SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions'),
 d1Query(dbId,'SELECT a.portal_user_id_norm, a.batch_key, a.effective_from, a.effective_to, b.subject, b.school_year, b.stream, b.maths_level, b.active_from AS batch_active_from, b.active_to AS batch_active_to FROM student_batch_assignments a JOIN batch_definitions b ON b.batch_key = a.batch_key'),
 d1Query(dbId,'SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source, first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date FROM lesson_entitlements'),
 d1Query(dbId,'SELECT portal_user_id_norm, lesson_id, batch_key, lesson_date, first_granted_at FROM online_prelesson_entitlements')
]);
const group=rows=>{const m=new Map();for(const row of rows){const key=norm(row?.portal_user_id_norm);if(!key)continue;const a=m.get(key)||[];a.push(row);m.set(key,a);}return m;};
const byAssignments=group(assignments),byEntitlements=group(entitlements),byPre=group(preLesson);
const userKeys=(await kvKeys(studentsNs,'user:')).sort();
const accessEntries=[];let excludedAdmin=0,excludedInactive=0;let smokeSecret=null;
function currentStudent(id,user){const role=norm(user?.role||user?.accountType);if(id==='admin'||role.includes('admin')||user?.isAdmin===true||user?.superuser===true){excludedAdmin++;return false;}const status=norm(user?.accountStatus||user?.status||'active'),expires=clean(user?.expiresOn||user?.expires);if(['inactive','disabled','expired','withdrawn'].includes(status)||(expires&&expires<=asOf)){excludedInactive++;return false;}return true;}
for(const key of userKeys){
  const id=norm(key.replace(/^user:/,'')),user=await kvJson(studentsNs,key);
  if(!user||!currentStudent(id,user))continue;
  const input={asOfDate:asOf,user,batchDefinitions:definitions,batchAssignments:byAssignments.get(id)||[],entitlements:byEntitlements.get(id)||[],onlinePreLessonEntitlements:byPre.get(id)||[]};
  const scopeId=await opaqueAccessScopeId(id,scopeSecret);
  const compiled=compileAccessScope(input,catalogue,{scopeId,asOfDate:asOf});
  const oracle=buildAuthoritativeParityOracle(input,catalogue,{asOfDate:asOf});
  const parity=diffAccessParity(compiled.snapshot,oracle);
  if(!parity.pass)throw new Error(`Unexplained access parity difference for student digest ${digest(id)}.`);
  accessEntries.push({id,user,scopeId,compiled});
  if(!smokeSecret&&valid4(user.p)&&valid4(user.answerPassword)){
    const visible=new Set((compiled.snapshot.views||[]).filter(v=>!v.lockedPreview).map(v=>v.viewId));
    for(const [lessonId,state] of Object.entries(compiled.snapshot.lessonAccess||{})){
      if(state?.blocked||state?.core!==true)continue;
      const resources=collectLessonResources(lessons[lessonId]||{});
      if(!resources.some(r=>r.type==='answer-pack'&&r.protected===true)||!resources.some(r=>!r.protected&&r.type!=='answer-pack'))continue;
      const viewId=(catalogue.lessonToViews?.[lessonId]||[]).find(v=>visible.has(v));
      if(!viewId)continue;
      smokeSecret={username:id,password:String(user.p),answerPassword:String(user.answerPassword),viewId,lessonId,studentDigest:digest(id)};
      break;
    }
  }
}
if(!accessEntries.length)throw new Error('CP11 found no current students to backfill.');
if(!smokeSecret)throw new Error('CP11 could not identify a masked positive-smoke student with ordinary and Answer Pack access.');

const lessonDetails=await mapLimit(Object.keys(lessons).sort(),24,async id=>[id,await compileLessonDetail(lessons[id],{resourceExists:async()=>true})]);
const nowIso=new Date().toISOString();
async function candidate(scope,payload,version){const payloadText=stableStringify(payload),payloadSha256=await sha256Hex(payloadText);const envelope={schemaVersion:1,kind:'prepared-read-model-envelope',scope,version,sha256:payloadSha256,payload};const envelopeText=stableStringify(envelope),envelopeSha256=await sha256Hex(envelopeText);return{scope,payload,version,payloadSha256,envelopeSha256,envelopeText,key:versionKey(scope,version)};}
async function verifyStoredVersion(scope,ref){
  const version=clean(ref?.version),expectedSha=clean(ref?.sha256),expectedEnvelopeSha=clean(ref?.envelopeSha256);
  if(!version||!expectedSha)return false;
  const actual=await kvText(shadowKv,versionKey(scope,version));
  if(actual==null)return false;
  let parsed;try{parsed=JSON.parse(actual);}catch{return false;}
  if(parsed?.kind!=='prepared-read-model-envelope'||parsed?.scope!==scope||parsed?.version!==version)return false;
  const payloadSha=await sha256Hex(stableStringify(parsed.payload));
  if(payloadSha!==expectedSha||clean(parsed.sha256)!==expectedSha)return false;
  if(expectedEnvelopeSha&&(await sha256Hex(actual))!==expectedEnvelopeSha)return false;
  return true;
}
async function waitForExactPointer(scope,expected){
  const started=Date.now(),deadline=started+90000;
  let last=null;
  while(Date.now()<=deadline){
    last=await kvJson(shadowKv,pointerKey(scope));
    if(last?.kind==='prepared-read-model-pointer'&&last?.scope===scope&&clean(last?.current?.version)===expected.version&&clean(last?.current?.sha256)===expected.payloadSha256){
      if(await verifyStoredVersion(scope,last.current))return {pointer:last,waitMs:Date.now()-started};
    }
    await sleep(1500);
  }
  throw new Error(`Backfill current pointer did not converge to exact candidate within propagation window: ${scope}`);
}
const candidates=[];
const globalSha=await sha256Hex(stableStringify(global));candidates.push(await candidate('global',global,`cp11-g-${globalSha.slice(0,20)}-${runTag}`));
for(const [id,detail] of lessonDetails){const sha=await sha256Hex(stableStringify(detail));candidates.push(await candidate(`lesson:${id}`,detail,`cp11-l-${sha.slice(0,16)}-${runTag}`));}
for(const entry of accessEntries){const sha=await sha256Hex(stableStringify(entry.compiled));candidates.push(await candidate(`access:${entry.scopeId}`,entry.compiled,`cp11-a-${sha.slice(0,16)}-${runTag}`));}

const previous=new Map();
const scopesWithPrevious=candidates.map(c=>c.scope);
await mapLimit(scopesWithPrevious,16,async scope=>{previous.set(scope,await kvJson(shadowKv,pointerKey(scope)));});
const reused=new Map(),toPublish=[];
await mapLimit(candidates,16,async c=>{
  const prior=previous.get(c.scope),current=prior?.current;
  if(clean(current?.sha256)===c.payloadSha256&&await verifyStoredVersion(c.scope,current))reused.set(c.scope,current);
  else toPublish.push(c);
});
await kvBulk(shadowKv,toPublish.map(c=>({key:c.key,value:c.envelopeText})));
await mapLimit(toPublish,16,async c=>{const actual=await kvText(shadowKv,c.key);if(actual==null)throw new Error(`Backfill candidate missing after write: ${c.scope}`);let parsed;try{parsed=JSON.parse(actual);}catch{throw new Error(`Backfill candidate malformed after write: ${c.scope}`);}const psha=await sha256Hex(stableStringify(parsed.payload));if(parsed.scope!==c.scope||parsed.version!==c.version||psha!==c.payloadSha256)throw new Error(`Backfill candidate failed verification: ${c.scope}`);});
const pointerItems=[];
for(const c of toPublish){const prior=previous.get(c.scope);const prev=prior?.current?.version?{version:clean(prior.current.version),sha256:clean(prior.current.sha256),envelopeSha256:clean(prior.current.envelopeSha256)}:null;const pointer={schemaVersion:1,kind:'prepared-read-model-pointer',scope:c.scope,current:{version:c.version,sha256:c.payloadSha256,envelopeSha256:c.envelopeSha256},previous:prev,updatedAt:nowIso};pointerItems.push({key:pointerKey(c.scope),value:stableStringify(pointer)});}
await kvBulk(shadowKv,pointerItems);
const propagation=await mapLimit(toPublish,16,async c=>waitForExactPointer(c.scope,c));

fs.writeFileSync('/tmp/checkpoint11-smoke-secret.json',JSON.stringify(smokeSecret));
const summary={marker:'REBUILD_CHECKPOINT11_BACKFILL_PASS',checkpoint:11,asOfDate:asOf,sourceRevision,catalogue:{curriculumCount:curriculumCodes.length,presentationCount:Object.keys(global.catalogues||{}).length,lessonCount:Object.keys(lessons).length},students:{profileKeyCount:userKeys.length,auditedCurrentStudents:accessEntries.length,excludedAdmin,excludedInactive,unexplainedDifferenceCount:0},publication:{targetKv:shadowKv,globalScopes:1,lessonScopes:lessonDetails.length,accessScopes:accessEntries.length,totalScopes:candidates.length,reusedVerifiedScopes:reused.size,candidateVersionsWritten:toPublish.length,candidateVersionsVerified:candidates.length,pointersWritten:pointerItems.length,strictPropagationVerification:true,maxPropagationWaitMs:propagation.length?Math.max(...propagation.map(x=>x.waitMs)):0,resourceMetadataParityReliedOn:true},scopeCompatibility:{algorithm:'HMAC-SHA256',domain:'rebuild-shadow-scope-v1:<normalized-user>',prefix:'u-',hexCharacters:40},smokeStudentDigest:smokeSecret.studentDigest,credentialsDisclosed:false};
fs.writeFileSync('/tmp/checkpoint11-backfill.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
