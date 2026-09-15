import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { pointerKey, versionKey } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';
import { compileLessonDetail } from '../rebuild/adminops/src/lib/compiler.mjs';

const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toLowerCase();
const base=clean(process.env.PROD_BASE||'https://lessons.futureperfect.education').replace(/\/$/,'');
const account=clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const token=clean(process.env.CLOUDFLARE_API_TOKEN);
const studentsKv=clean(process.env.STUDENTS_KV_ID);
const readModelsKv=clean(process.env.READ_MODELS_KV_ID||process.env.EXPECTED_READ_MODELS_KV);
const lessonsKv=clean(process.env.LESSONS_KV_ID||process.env.EXPECTED_LESSONS_KV);
const summaryPath=clean(process.env.CP12_PERSONA_SUMMARY||'/tmp/cp12-production-real-persona-prereq.json');
const secretPath=clean(process.env.CP12_PERSONA_SECRETS||'/tmp/cp12-production-real-persona-secrets.json');
if(!account||!token||!studentsKv||!readModelsKv||!lessonsKv)throw new Error('CP12 real-persona prerequisite requires protected Cloudflare read credentials and exact production KV bindings.');
const cfBase=`https://api.cloudflare.com/client/v4/accounts/${account}`;
const cfHeaders={Authorization:`Bearer ${token}`};
const digest=v=>crypto.createHash('sha256').update(String(v)).digest('hex').slice(0,16);
const valid4=value=>{const p=String(value||'');return p.length===4&&/[A-Z]/.test(p)&&/[a-z]/.test(p)&&/\d/.test(p);};
const londonToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const active=user=>{const status=norm(user?.status||user?.accountStatus||'active');const expires=clean(user?.expires||user?.expiresOn);return !['inactive','disabled','expired','withdrawn'].includes(status)&&(!/^\d{4}-\d{2}-\d{2}$/.test(expires)||expires>=londonToday());};
const answerPassword=user=>user?.answerPassword??user?.answer_password??user?.answerPackPassword??user?.answer_pack_password??user?.ap??'';
async function cfJson(path){const r=await fetch(`${cfBase}${path}`,{headers:cfHeaders});const t=await r.text();let b=null;try{b=JSON.parse(t);}catch{}if(!r.ok||b?.success!==true)throw new Error(`Protected Cloudflare read failed HTTP ${r.status}.`);return b;}
async function kvText(ns,key){const r=await fetch(`${cfBase}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{headers:cfHeaders});if(r.status===404)return null;if(!r.ok)throw new Error(`Protected KV read failed HTTP ${r.status}.`);return r.text();}
async function kvJson(ns,key){const t=await kvText(ns,key);if(t==null)return null;try{return JSON.parse(t);}catch{return null;}}
async function kvUser(id){return kvJson(studentsKv,`user:${norm(id)}`);}
async function userKeys(){const out=[];let cursor='';do{const suffix=cursor?`&cursor=${encodeURIComponent(cursor)}`:'';const b=await cfJson(`/storage/kv/namespaces/${studentsKv}/keys?prefix=${encodeURIComponent('user:')}&limit=1000${suffix}`);out.push(...(b.result||[]).map(r=>clean(r?.name)).filter(Boolean));cursor=clean(b?.result_info?.cursor);}while(cursor);return out;}
function cookiePair(r){const pair=(r.headers.get('set-cookie')||'').split(';')[0].trim();return /^fpt_session=/.test(pair)?pair:'';}
async function bodyJson(r){const t=await r.text();try{return JSON.parse(t);}catch{return null;}}
async function login(id,p){const r=await fetch(`${base}/api/v2/auth/login`,{method:'POST',redirect:'manual',headers:{origin:new URL(base).origin,'content-type':'application/json'},body:JSON.stringify({username:id,password:String(p)})});return {r,b:await bodyJson(r)};}
async function authGet(path,cookie){const r=await fetch(`${base}${path}`,{redirect:'manual',headers:{cookie}});return {r,b:await bodyJson(r)};}

const scopeSecret=clean(await kvText(readModelsKv,'meta:scope-salt'));
if(!/^[0-9a-f]{64}$/i.test(scopeSecret))throw new Error('Production prepared-access scope salt is missing or malformed.');
async function publishedAccessSnapshot(id){
  const scopeId=await opaqueAccessScopeId(id,scopeSecret);
  const scope=`access:${scopeId}`;
  const pointer=await kvJson(readModelsKv,pointerKey(scope));
  const version=clean(pointer?.current?.version);
  if(!version)return null;
  const envelope=await kvJson(readModelsKv,versionKey(scope,version));
  const payload=envelope?.payload;
  if(payload?.kind!=='prepared-access-read-model'||payload?.scopeId!==scopeId||payload?.snapshot?.kind!=='prepared-access-snapshot')return null;
  return payload.snapshot;
}

const sourceVrCache=new Map();
async function sourceCanonicalVrShape(lessonId){
  if(sourceVrCache.has(lessonId))return sourceVrCache.get(lessonId);
  const record=await kvJson(lessonsKv,`lesson:${lessonId}`);
  if(!record?.lessonId)return null;
  const detail=await compileLessonDetail(record,{resourceExists:async()=>true});
  const rows=(detail.resources||[]).filter(row=>(row.presentationScopes||[]).includes('vr'));
  const shape={
    resourceCount:rows.length,
    preSheet:rows.some(row=>row.presentationGroup==='vr-prelesson'&&row.type==='prelesson'),
    preAnswer:rows.some(row=>row.presentationGroup==='vr-prelesson'&&row.type==='answer-pack'&&row.protected===true),
    homework:rows.some(row=>row.presentationGroup==='vr-homework'&&row.type==='homework'),
    homeAnswer:rows.some(row=>row.presentationGroup==='vr-homework'&&row.type==='answer-pack'&&row.protected===true)
  };
  shape.canonical=shape.preSheet&&shape.preAnswer&&shape.homework&&shape.homeAnswer;
  sourceVrCache.set(lessonId,shape);
  return shape;
}

async function inspectUser(id,user){
  if(!user||!active(user)||!valid4(user.p)||!valid4(answerPassword(user)))return null;
  const snapshot=await publishedAccessSnapshot(id);if(!snapshot)return null;
  const attempt=await login(id,user.p);if(attempt.r.status!==200||attempt.b?.ok!==true||attempt.b?.accountLocked===true)return null;
  const cookie=cookiePair(attempt.r);if(!cookie)return null;
  const home=await authGet('/api/v2/student/home',cookie);if(home.r.status!==200||home.b?.ok!==true||!Array.isArray(home.b?.views))return null;
  const openViews=home.b.views.filter(v=>v?.lockedPreview!==true).map(v=>({viewId:clean(v?.viewId),subject:norm(v?.subject)})).filter(v=>v.viewId);
  const openIds=new Set(openViews.map(v=>v.viewId));
  const out={id,user,cookie,firstName:clean(user?.firstName||user?.name),openViews,openIds,vrHowTo:openIds.has('special-vr-howto'),ordinaryY5E2:false,vrTarget:null};
  if(openIds.has('english-year5')){
    const list=await authGet('/api/v2/student/views/english-year5/lessons',cookie);
    if(list.r.status===200&&list.b?.ok===true){const row=(list.b.lessons||[]).find(x=>clean(x?.lessonId)==='Y5E2');out.ordinaryY5E2=Boolean(row&&row.locked===false&&row.open===true);}
  }
  if(out.vrHowTo){
    for(const view of openViews.filter(v=>v.subject==='english'&&v.viewId!=='special-vr-howto')){
      const list=await authGet(`/api/v2/student/views/${encodeURIComponent(view.viewId)}/lessons`,cookie);if(list.r.status!==200||list.b?.ok!==true)continue;
      for(const row of (list.b.lessons||[]).filter(x=>x?.locked===false&&x?.open===true)){
        const lessonId=clean(row?.lessonId);if(!lessonId)continue;
        const state=snapshot?.lessonAccess?.[lessonId];
        if(!state||state.blocked===true||state.core!==true||state.vr!==true)continue;
        let shape=null;try{shape=await sourceCanonicalVrShape(lessonId);}catch{continue;}
        if(!shape?.canonical)continue;
        out.vrTarget={viewId:view.viewId,lessonId,accessProven:true,core:true,vr:true,canonicalVrRows:true,canonicalVrResourceCount:shape.resourceCount};break;
      }
      if(out.vrTarget)break;
    }
  }
  return out;
}

let ordinary=null,vr=null,eligible=0,vrHowToCandidates=0;
for(const key of await userKeys()){
  const id=norm(key.replace(/^user:/,''));if(!id||id==='admin')continue;
  const inspected=await inspectUser(id,await kvUser(id));if(!inspected)continue;eligible++;
  if(!ordinary&&inspected.ordinaryY5E2===true&&!inspected.openIds.has('english-year5-11plus'))ordinary=inspected;
  if(inspected.vrHowTo)vrHowToCandidates++;
  if(!vr&&inspected.vrHowTo&&inspected.vrTarget)vr=inspected;
  if(ordinary&&vr&&ordinary.id!==vr.id)break;
}
assert(ordinary,'No active real production ordinary Year-5 English Y5E2 persona was found without the Year-5 11+ view.');
assert(vr,'No active real production VR-entitled student with VR How-To, authoritative prepared VR access and source-canonical VR rows was found.');
assert.notEqual(vr.id,ordinary.id,'VR and ordinary production UAT principals must be distinct.');
for(const row of [ordinary,vr])assert(row.firstName&&valid4(row.user.p)&&valid4(answerPassword(row.user)),'Selected real persona is missing required credential/name shape.');
const secrets={
  ordinary:{username:ordinary.id,password:String(ordinary.user.p),answerPassword:String(answerPassword(ordinary.user)),firstName:ordinary.firstName,viewId:'english-year5',lessonId:'Y5E2'},
  vr:{username:vr.id,password:String(vr.user.p),answerPassword:String(answerPassword(vr.user)),firstName:vr.firstName,viewId:vr.vrTarget.viewId,lessonId:vr.vrTarget.lessonId}
};
fs.writeFileSync(secretPath,JSON.stringify(secrets));fs.chmodSync(secretPath,0o600);
const summary={marker:'CP12_PRODUCTION_REAL_PERSONA_PREREQ_READONLY_PASS',status:'PASS',productionMutation:false,eligibleScanned:eligible,vrHowToCandidatesScanned:vrHowToCandidates,ordinary:{digest:digest(ordinary.id),viewId:'english-year5',lessonId:'Y5E2',lessonOpen:true,year5ElevenPlusAbsent:true,credentialDisclosed:false},vr:{digest:digest(vr.id),vrHowToVisible:true,viewId:vr.vrTarget.viewId,lessonId:vr.vrTarget.lessonId,lessonOpen:true,accessProven:true,preparedCoreAccess:true,preparedVrAccess:true,canonicalVrRows:true,canonicalVrResourceCount:vr.vrTarget.canonicalVrResourceCount,credentialDisclosed:false},distinctPrincipals:true,secretMaterialLogged:false};
fs.writeFileSync(summaryPath,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
