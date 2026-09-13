import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  compileGlobalScope,
  compileAccessScope,
  compileLessonDetail,
  collectLessonResources,
  globalToCatalogue
} from '../rebuild/adminops/src/lib/compiler.mjs';
import { compileVideoVariants } from '../rebuild/shared/read-models/video.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { stableStringify, sha256Hex, pointerKey, versionKey } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const token=process.env.CLOUDFLARE_API_TOKEN||'';
const account=process.env.CLOUDFLARE_ACCOUNT_ID||'';
const worker=process.env.PROD_WORKER||'fpt-portal-v2-worker';
const readModelsNs=process.env.STAGING_READ_MODELS_KV_ID||'';
const studentsNs=process.env.STAGING_STUDENTS_KV_ID||'';
const accessSecret=process.env.ACCESS_SCOPE_SECRET||'';
const loginPassword=process.env.UAT_LOGIN_PASSWORD||'';
const answerPassword=process.env.UAT_ANSWER_PASSWORD||'';
const asOf=process.env.CHECKPOINT9_AS_OF_DATE||'2026-09-13';
if(!token||!account||!readModelsNs||!studentsNs||!accessSecret) throw new Error('Checkpoint 9 seed environment is incomplete.');
if(!/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{4}$/.test(loginPassword)) throw new Error('UAT login password must satisfy the four-character policy.');
if(!/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{4}$/.test(answerPassword)) throw new Error('UAT Answer Pack password must satisfy the four-character policy.');

const base='https://api.cloudflare.com/client/v4';
const headers={Authorization:`Bearer ${token}`};
const clean=v=>String(v??'').trim();

async function envelope(path,options={}){
  const response=await fetch(`${base}${path}`,{...options,headers:{...headers,...(options.headers||{})}});
  const body=await response.json().catch(()=>null);
  if(!response.ok||body?.success!==true) throw new Error(`Cloudflare request failed: ${response.status} ${path}`);
  return body;
}
async function kvGet(ns,key){
  const response=await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{headers});
  if(response.status===404)return null;
  if(!response.ok)throw new Error(`KV read failed: ${response.status}`);
  return response.json().catch(()=>null);
}
async function kvBulk(ns,items){
  if(!items.length)return;
  const body=await envelope(`/accounts/${account}/storage/kv/namespaces/${ns}/bulk`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(items)});
  const failed=body?.result?.unsuccessful_keys||[];
  if(failed.length)throw new Error(`KV bulk write incomplete: ${failed.length}`);
}
async function mapLimit(values,limit,fn){
  const out=[];
  for(let i=0;i<values.length;i+=limit){
    const chunk=values.slice(i,i+limit);
    out.push(...await Promise.all(chunk.map(fn)));
  }
  return out;
}

const settings=(await envelope(`/accounts/${account}/workers/scripts/${worker}/settings`)).result;
const binding=name=>(settings?.bindings||[]).find(x=>x.name===name)||{};
const lessonsNs=clean(binding('LESSONS_KV').namespace_id);
const productionR2=clean(binding('MATERIALS_R2').bucket_name||binding('MATERIALS_R2').bucket);
if(!lessonsNs||!productionR2) throw new Error('Production lesson/R2 bindings could not be resolved read-only.');

const curriculumCodes=['MATHS_Y2','MATHS_Y3','MATHS_L1','MATHS_L2','MATHS_L3','MATHS_Y6_EXTRA','ENGLISH_Y2','ENGLISH_Y3','ENGLISH_Y4','ENGLISH_Y5','ENGLISH_Y6'];
const fallback={MATHS_Y2:['maths-year2'],MATHS_Y3:['maths-year3'],MATHS_L1:['maths-year4','maths-level1'],MATHS_L2:['maths-year5','maths-level2'],MATHS_L3:['maths-level3','maths-year6'],MATHS_Y6_EXTRA:['maths-year6-extra'],ENGLISH_Y2:['english-year2'],ENGLISH_Y3:['english-year3'],ENGLISH_Y4:['english-year4','english-year4-11plus'],ENGLISH_Y5:['english-year5','english-year5-11plus'],ENGLISH_Y6:['english-year6']};
const items=raw=>Array.isArray(raw)?raw:Array.isArray(raw?.lessonIds)?raw.lessonIds:Array.isArray(raw?.lessons)?raw.lessons:Array.isArray(raw?.items)?raw.items:[];
const curricula={}, lessonIds=new Set();
for(const code of curriculumCodes){
  let raw=await kvGet(lessonsNs,`curriculum:${code}`);
  if(!items(raw).length){
    for(const view of fallback[code]||[]){const probe=await kvGet(lessonsNs,`view:${view}`);if(items(probe).length){raw=probe;break;}}
  }
  const rows=items(raw);
  curricula[code]={lessonIds:rows.map(x=>typeof x==='string'?clean(x):clean(x?.lessonId)).filter(Boolean)};
  for(const id of curricula[code].lessonIds)lessonIds.add(id);
}
const lessonPairs=await mapLimit([...lessonIds].sort(),24,async id=>[id,await kvGet(lessonsNs,`lesson:${id}`)]);
const lessons=Object.fromEntries(lessonPairs.filter(([,row])=>row));
const global=compileGlobalScope({sourceType:'production-authoritative-cp9-seed',sourceRevision:`cp9-${asOf}`,curricula,lessons},{sourceType:'production-authoritative-cp9-seed',sourceRevision:`cp9-${asOf}`});
const catalogue=globalToCatalogue(global);
if(Object.keys(lessons).length!==372) throw new Error(`CP9 production-shaped seed expected 372 lessons, got ${Object.keys(lessons).length}.`);
if(Object.keys(global.catalogues||{}).length!==15) throw new Error('CP9 production-shaped seed expected 15 presentation catalogues.');

function idsForView(viewId){return (global.catalogues?.[viewId]?.lessons||[]).map(x=>clean(x.lessonId)).filter(Boolean);}
function resources(id){return collectLessonResources(lessons[id]||{});}
function choose(viewId,predicate,exclude=new Set()){
  for(const id of idsForView(viewId)) if(!exclude.has(id)&&predicate(id,lessons[id],resources(id))) return id;
  throw new Error(`No CP9 UAT lesson candidate for ${viewId}.`);
}
const used=new Set();
const cumulative=choose('maths-level2',(id,row,r)=>r.some(x=>x.type==='homework'&&/cumulative/i.test(x.displayName||'')),used);used.add(cumulative);
const blocked=choose('maths-level2',()=>true,used);used.add(blocked);
const ordinary=choose('maths-year6',(id,row,r)=>r.some(x=>x.type==='homework')&&r.some(x=>x.type==='answer-pack'),used);used.add(ordinary);
const sats=choose('maths-year6',(id,row,r)=>/sat/i.test(`${id} ${row?.title||''}`)&&r.some(x=>x.type==='homework'),used);used.add(sats);
const l3=choose('maths-level3',(id,row)=>Boolean(compileVideoVariants(row)?.elevenPlus),used);used.add(l3);
const english=choose('english-year6',(id,row,r)=>r.some(x=>x.type==='homework')&&r.some(x=>x.type==='answer-pack'),used);used.add(english);
const preOnly=choose('english-year5',(id,row,r)=>r.some(x=>x.type==='prelesson'),used);used.add(preOnly);
const historic=choose('maths-level1',()=>true,used);used.add(historic);
const guest=choose('maths-year3',()=>true,used);used.add(guest);

const l3CurrentCumulativeCount=idsForView('maths-level3').filter(id=>resources(id).some(x=>x.type==='homework'&&/cumulative/i.test(x.displayName||''))).length;

const personas=[
  {
    username:'cp9normal', firstName:'CP9 Normal',
    input:{asOfDate:asOf,user:{firstName:'CP9 Normal',accountStatus:'active',expiresOn:'2027-08-31'},batchAssignments:[
      {batch_key:'CP9-Y6M',subject:'maths',school_year:6,stream:'normal',effective_from:'2026-09-01',effective_to:null},
      {batch_key:'CP9-Y6E',subject:'english',school_year:6,stream:'normal',effective_from:'2026-09-01',effective_to:null}
    ],entitlements:[
      {lesson_id:ordinary,viewId:'maths-year6',core_access:1,vr_access:0,source:'cp9-uat'},
      {lesson_id:sats,viewId:'maths-year6',core_access:1,vr_access:0,source:'cp9-uat'},
      {lesson_id:english,viewId:'english-year6',core_access:1,vr_access:0,source:'cp9-uat'}
    ],onlinePreLessonEntitlements:[]}
  },
  {
    username:'cp9l2', firstName:'CP9 L2',
    input:{asOfDate:asOf,user:{firstName:'CP9 L2',accountStatus:'active',expiresOn:'2027-08-31',fullLibraries:['MATHS_L2_FULL'],blockedLessons:[blocked]},batchAssignments:[
      {batch_key:'CP9-L2',subject:'maths',school_year:5,stream:'11plus',maths_level:2,effective_from:'2026-09-01',effective_to:null}
    ],entitlements:[{lesson_id:cumulative,viewId:'maths-level2',core_access:1,vr_access:0,source:'cp9-uat'}],onlinePreLessonEntitlements:[]}
  },
  {
    username:'cp9l3', firstName:'CP9 L3',
    input:{asOfDate:asOf,user:{firstName:'CP9 L3',accountStatus:'active',expiresOn:'2027-08-31'},batchAssignments:[
      {batch_key:'CP9-L3',subject:'maths',school_year:6,stream:'11plus',maths_level:3,effective_from:'2026-09-01',effective_to:null}
    ],entitlements:[{lesson_id:l3,viewId:'maths-level3',core_access:1,vr_access:0,source:'cp9-uat'}],onlinePreLessonEntitlements:[]}
  },
  {
    username:'cp9history', firstName:'CP9 History',
    input:{asOfDate:asOf,user:{firstName:'CP9 History',accountStatus:'active',expiresOn:'2027-08-31',upsellViews:['english-year4']},batchAssignments:[
      {batch_key:'CP9-L1-OLD',subject:'maths',school_year:4,stream:'11plus',maths_level:1,effective_from:'2025-09-01',effective_to:'2026-02-01'},
      {batch_key:'CP9-L2-NOW',subject:'maths',school_year:5,stream:'11plus',maths_level:2,effective_from:'2026-09-01',effective_to:null}
    ],entitlements:[
      {lesson_id:historic,viewId:'maths-level1',core_access:1,vr_access:0,source:'cp9-history'},
      {lesson_id:guest,viewId:'maths-year3',core_access:1,vr_access:0,source:'guest'}
    ],onlinePreLessonEntitlements:[]}
  },
  {
    username:'cp9pre', firstName:'CP9 PreLesson',
    input:{asOfDate:asOf,user:{firstName:'CP9 PreLesson',accountStatus:'active',expiresOn:'2027-08-31'},batchAssignments:[],entitlements:[],onlinePreLessonEntitlements:[{lesson_id:preOnly,viewId:'english-year5',batch_key:'CP9-PRE',lesson_date:asOf,first_granted_at:`${asOf}T08:00:00Z`}]}
  }
];

async function scopePairs(scope,payload,version){
  const payloadText=stableStringify(payload), payloadSha=await sha256Hex(payloadText);
  const envelope={schemaVersion:1,kind:'prepared-read-model-envelope',scope,version,sha256:payloadSha,payload};
  const envelopeText=stableStringify(envelope), envelopeSha=await sha256Hex(envelopeText);
  const candidate={version,sha256:payloadSha,envelopeSha256:envelopeSha};
  const pointer={schemaVersion:1,kind:'prepared-read-model-pointer',scope,current:candidate,previous:null,updatedAt:new Date().toISOString()};
  return [{key:versionKey(scope,version),value:envelopeText},{key:pointerKey(scope),value:stableStringify(pointer)}];
}

const rmItems=[];
rmItems.push(...await scopePairs('global',global,`cp9-global-${asOf}`));
const userItems=[];
const personaSummary=[];
for(const persona of personas){
  const scopeId=await opaqueAccessScopeId(persona.username,accessSecret);
  const access=compileAccessScope(persona.input,catalogue,{scopeId,asOfDate:asOf});
  rmItems.push(...await scopePairs(`access:${scopeId}`,access,`cp9-access-${persona.username}-${asOf}`));
  userItems.push({key:`user:${persona.username}`,value:JSON.stringify({name:persona.firstName,p:loginPassword,answerPassword,status:'active',expires:'2027-08-31'})});
  personaSummary.push({username:persona.username,scopeId,viewIds:access.snapshot.views.map(x=>x.viewId),openLessonCount:Object.values(access.snapshot.lessonAccess||{}).filter(x=>x.core||x.preLessonOnly).length});
}

const selected=[ordinary,sats,l3,english,preOnly,cumulative,blocked,historic,guest];
const copyKeys=new Set();
const lessonSummary=[];
for(const id of selected){
  const detail=await compileLessonDetail(lessons[id],{resourceExists:async()=>true});
  rmItems.push(...await scopePairs(`lesson:${id}`,detail,`cp9-lesson-${crypto.createHash('sha256').update(id).digest('hex').slice(0,12)}`));
  for(const resource of detail.resources||[]) if(resource.objectKey) copyKeys.add(resource.objectKey);
  lessonSummary.push({lessonId:id,title:detail.title,resourceTypes:(detail.resources||[]).map(x=>x.type),video:Boolean(detail.videoVariants)});
}

await kvBulk(readModelsNs,rmItems);
await kvBulk(studentsNs,userItems);

const plan={sourceBucket:productionR2,destinationBucket:'fpt-portal-v2-rebuild-materials-staging',keys:[...copyKeys].sort()};
fs.writeFileSync('/tmp/checkpoint9-r2-copy-plan.json',JSON.stringify(plan,null,2));
const summary={marker:'REBUILD_CHECKPOINT9_PRODUCTION_SHAPED_SEED',asOfDate:asOf,catalogue:{curriculumCount:curriculumCodes.length,presentationCount:Object.keys(global.catalogues||{}).length,lessonCount:Object.keys(lessons).length},selected:{ordinary,sats,l3,english,preOnly,cumulative,blocked,historic,guest},personas:personaSummary,selectedLessons:lessonSummary,stagingResourceObjectCount:plan.keys.length,l3CurrentCumulativeCount,policyNote:'L3 cumulative Homework absence/presence is content-state only; no L3 prohibition is encoded.'};
fs.writeFileSync('/tmp/checkpoint9-seed-summary.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
