import fs from 'node:fs';
import crypto from 'node:crypto';
import { compileAccessScope, compileLessonDetail, globalToCatalogue } from '../rebuild/adminops/src/lib/compiler.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { stableStringify, sha256Hex, pointerKey, versionKey } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const clean=v=>String(v??'').trim();
const token=clean(process.env.CLOUDFLARE_API_TOKEN);
const account=clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const sourceWorker=clean(process.env.PROD_WORKER||'fpt-portal-v2-worker');
const readNs=clean(process.env.STAGING_READ_MODELS_KV_ID);
const studentsNs=clean(process.env.STAGING_STUDENTS_KV_ID);
const accessSecret=clean(process.env.ACCESS_SCOPE_SECRET);
const loginPassword=String(process.env.UAT_LOGIN_PASSWORD||'');
const answerPassword=String(process.env.UAT_ANSWER_PASSWORD||'');
const asOf=clean(process.env.CHECKPOINT9_AS_OF_DATE||'2026-09-14');
if(!token||!account||!readNs||!studentsNs||!accessSecret) throw new Error('CP12 staging seed inputs are incomplete.');
if(!/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{4}$/.test(loginPassword)) throw new Error('Invalid UAT login password.');
if(!/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{4}$/.test(answerPassword)) throw new Error('Invalid UAT answer password.');

const base='https://api.cloudflare.com/client/v4';
const headers={Authorization:`Bearer ${token}`};
async function cf(path,options={}){
  const response=await fetch(`${base}${path}`,{...options,headers:{...headers,...(options.headers||{})}});
  const text=await response.text(); let body=null; try{body=JSON.parse(text);}catch{}
  if(!response.ok||body?.success!==true) throw new Error(`Cloudflare request failed ${response.status}: ${path}`);
  return body;
}
async function kvRaw(ns,key){
  const response=await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{headers});
  if(response.status===404)return null;
  if(!response.ok)throw new Error(`KV read failed ${response.status}: ${key}`);
  return response.text();
}
async function kvJson(ns,key){const text=await kvRaw(ns,key);if(text==null)return null;return JSON.parse(text);}
async function kvBulk(ns,items){
  const body=await cf(`/accounts/${account}/storage/kv/namespaces/${ns}/bulk`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(items)});
  if((body?.result?.unsuccessful_keys||[]).length)throw new Error('KV bulk write incomplete.');
}
async function scopePairs(scope,payload,version){
  const payloadText=stableStringify(payload), payloadSha=await sha256Hex(payloadText);
  const envelope={schemaVersion:1,kind:'prepared-read-model-envelope',scope,version,sha256:payloadSha,payload};
  const envelopeText=stableStringify(envelope), envelopeSha=await sha256Hex(envelopeText);
  const candidate={version,sha256:payloadSha,envelopeSha256:envelopeSha};
  const pointer={schemaVersion:1,kind:'prepared-read-model-pointer',scope,current:candidate,previous:null,updatedAt:new Date().toISOString()};
  return [{key:versionKey(scope,version),value:envelopeText},{key:pointerKey(scope),value:stableStringify(pointer)}];
}
async function currentPayload(scope){
  const pointer=await kvJson(readNs,pointerKey(scope));
  const version=clean(pointer?.current?.version); if(!version)throw new Error(`Missing staging pointer ${scope}`);
  const envelope=await kvJson(readNs,versionKey(scope,version));
  if(!envelope?.payload)throw new Error(`Missing staging envelope ${scope}`);
  return envelope.payload;
}

const settings=(await cf(`/accounts/${account}/workers/scripts/${sourceWorker}/settings`)).result;
const lessonsBinding=(settings?.bindings||[]).find(row=>row.name==='LESSONS_KV');
const lessonsNs=clean(lessonsBinding?.namespace_id||lessonsBinding?.id);
if(!lessonsNs)throw new Error('Production LESSONS_KV binding unavailable read-only.');
const lesson=await kvJson(lessonsNs,'lesson:Y5E2');
if(!lesson)throw new Error('Canonical Y5E2 source unavailable.');
const detail=await compileLessonDetail(lesson,{resourceExists:async()=>true});
const vrRows=(detail.resources||[]).filter(row=>(row.presentationScopes||[]).includes('vr'));
const requiredGroups=new Set(['vr-prelesson','vr-homework']);
for(const group of requiredGroups)if(!vrRows.some(row=>row.presentationGroup===group))throw new Error(`Y5E2 missing ${group} in compiled candidate.`);
if(!vrRows.some(row=>row.presentationGroup==='vr-prelesson'&&row.type==='answer-pack'&&row.protected===true))throw new Error('Y5E2 VR PreLesson protected answer missing.');
if(!vrRows.some(row=>row.presentationGroup==='vr-homework'&&row.type==='answer-pack'&&row.protected===true))throw new Error('Y5E2 VR Homework protected answer missing.');

const global=await currentPayload('global');
const catalogue=globalToCatalogue(global);
const username='cp12vrui';
const scopeId=await opaqueAccessScopeId(username,accessSecret);
const access=compileAccessScope({
  asOfDate:asOf,
  user:{firstName:'CP12 VR UI',accountStatus:'active',expiresOn:'2027-08-31'},
  batchAssignments:[{batch_key:'CP12-Y5E11',subject:'english',school_year:5,stream:'11plus',effective_from:'2026-09-01',effective_to:null}],
  entitlements:[{lesson_id:'Y5E2',viewId:'english-year5-11plus',core_access:1,vr_access:1,source:'cp12-ui-staging'}],
  onlinePreLessonEntitlements:[]
},catalogue,{scopeId,asOfDate:asOf});
const state=access?.snapshot?.lessonAccess?.Y5E2;
if(state?.core!==true||state?.vr!==true||state?.blocked===true)throw new Error('CP12 VR UI staging access did not compile as core+VR.');
if(!(access?.snapshot?.views||[]).some(view=>view.viewId==='english-year5-11plus'&&view.lockedPreview!==true))throw new Error('CP12 VR UI staging 11+ English view unavailable.');

const versionSuffix=crypto.createHash('sha256').update(`cp12-resource-ui:${Date.now()}`).digest('hex').slice(0,12);
const rmItems=[
  ...await scopePairs('lesson:Y5E2',detail,`cp12-ui-lesson-${versionSuffix}`),
  ...await scopePairs(`access:${scopeId}`,access,`cp12-ui-access-${versionSuffix}`)
];
await kvBulk(readNs,rmItems);
await kvBulk(studentsNs,[{key:`user:${username}`,value:JSON.stringify({name:'CP12 VR UI',p:loginPassword,answerPassword,status:'active',expires:'2027-08-31'})}]);

const summary={
  marker:'CP12_RESOURCE_UI_STAGING_SEED_PASS',
  username,
  lessonId:'Y5E2',
  viewId:'english-year5-11plus',
  credentialDisclosed:false,
  vrRows:vrRows.map(row=>({type:row.type,displayName:row.displayName,protected:row.protected===true,presentationScopes:row.presentationScopes,presentationGroup:row.presentationGroup})),
  coreRows:(detail.resources||[]).filter(row=>!(row.presentationScopes||[]).includes('vr')).map(row=>({type:row.type,displayName:row.displayName,presentationGroup:row.presentationGroup||null}))
};
fs.writeFileSync('/tmp/cp12-resource-ui-staging-seed.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({marker:summary.marker,lessonId:summary.lessonId,vrRowCount:summary.vrRows.length,groups:[...new Set(summary.vrRows.map(row=>row.presentationGroup))]}));
