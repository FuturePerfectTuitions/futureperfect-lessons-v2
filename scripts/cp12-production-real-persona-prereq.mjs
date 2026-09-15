import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toLowerCase();
const base=clean(process.env.PROD_BASE||'https://lessons.futureperfect.education').replace(/\/$/,'');
const account=clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const token=clean(process.env.CLOUDFLARE_API_TOKEN);
const studentsKv=clean(process.env.STUDENTS_KV_ID);
const summaryPath=clean(process.env.CP12_PERSONA_SUMMARY||'/tmp/cp12-production-real-persona-prereq.json');
const secretPath=clean(process.env.CP12_PERSONA_SECRETS||'/tmp/cp12-production-real-persona-secrets.json');
if(!account||!token||!studentsKv)throw new Error('CP12 real-persona prerequisite requires protected Cloudflare read credentials.');
const cfBase=`https://api.cloudflare.com/client/v4/accounts/${account}`;
const cfHeaders={Authorization:`Bearer ${token}`};
const digest=v=>crypto.createHash('sha256').update(String(v)).digest('hex').slice(0,16);
const valid4=value=>{const p=String(value||'');return p.length===4&&/[A-Z]/.test(p)&&/[a-z]/.test(p)&&/\d/.test(p);};
const londonToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const active=user=>{const status=norm(user?.status||user?.accountStatus||'active');const expires=clean(user?.expires||user?.expiresOn);return !['inactive','disabled','expired','withdrawn'].includes(status)&&(!/^\d{4}-\d{2}-\d{2}$/.test(expires)||expires>=londonToday());};
async function cfJson(path){const r=await fetch(`${cfBase}${path}`,{headers:cfHeaders});const t=await r.text();let b=null;try{b=JSON.parse(t);}catch{}if(!r.ok||b?.success!==true)throw new Error(`Protected Cloudflare read failed HTTP ${r.status}.`);return b;}
async function kvUser(id){const r=await fetch(`${cfBase}/storage/kv/namespaces/${studentsKv}/values/${encodeURIComponent(`user:${norm(id)}`)}`,{headers:cfHeaders});if(!r.ok)return null;try{return JSON.parse(await r.text());}catch{return null;}}
async function userKeys(){const out=[];let cursor='';do{const suffix=cursor?`&cursor=${encodeURIComponent(cursor)}`:'';const b=await cfJson(`/storage/kv/namespaces/${studentsKv}/keys?prefix=${encodeURIComponent('user:')}&limit=1000${suffix}`);out.push(...(b.result||[]).map(r=>clean(r?.name)).filter(Boolean));cursor=clean(b?.result_info?.cursor);}while(cursor);return out;}
function cookiePair(r){const pair=(r.headers.get('set-cookie')||'').split(';')[0].trim();return /^fpt_session=/.test(pair)?pair:'';}
async function bodyJson(r){const t=await r.text();try{return JSON.parse(t);}catch{return null;}}
async function login(id,p){const r=await fetch(`${base}/api/v2/auth/login`,{method:'POST',redirect:'manual',headers:{origin:new URL(base).origin,'content-type':'application/json'},body:JSON.stringify({username:id,password:String(p)})});return {r,b:await bodyJson(r)};}
async function authGet(path,cookie){const r=await fetch(`${base}${path}`,{redirect:'manual',headers:{cookie}});return {r,b:await bodyJson(r)};}
function answerPassword(user){return user?.answerPassword??user?.answer_password??user?.answerPackPassword??user?.answer_pack_password??user?.ap??'';}
async function inspectUser(id,user){
  if(!user||!active(user)||!valid4(user.p)||!valid4(answerPassword(user)))return null;
  const attempt=await login(id,user.p);if(attempt.r.status!==200||attempt.b?.ok!==true||attempt.b?.accountLocked===true)return null;
  const cookie=cookiePair(attempt.r);if(!cookie)return null;
  const home=await authGet('/api/v2/student/home',cookie);if(home.r.status!==200||home.b?.ok!==true||!Array.isArray(home.b?.views))return null;
  const openIds=new Set(home.b.views.filter(v=>v?.lockedPreview!==true).map(v=>clean(v?.viewId)));
  const out={id,user,cookie,firstName:clean(user?.firstName||user?.name),openIds};
  for(const viewId of ['english-year5','english-year5-11plus']){
    if(!openIds.has(viewId))continue;
    const list=await authGet(`/api/v2/student/views/${encodeURIComponent(viewId)}/lessons`,cookie);
    if(list.r.status!==200||list.b?.ok!==true)continue;
    const row=(list.b.lessons||[]).find(x=>clean(x?.lessonId)==='Y5E2');
    out[viewId]=Boolean(row&&row.locked===false&&row.open===true);
  }
  return out;
}

let ordinary=null,vr=null,eligible=0;
for(const key of await userKeys()){
  const id=norm(key.replace(/^user:/,''));if(!id||id==='admin')continue;
  const inspected=await inspectUser(id,await kvUser(id));if(!inspected)continue;eligible++;
  if(!ordinary&&inspected['english-year5']===true&&!inspected.openIds.has('english-year5-11plus'))ordinary=inspected;
  if(!vr&&inspected['english-year5-11plus']===true)vr=inspected;
  if(ordinary&&vr)break;
}
assert(ordinary,'No active real production ordinary Year-5 English Y5E2 persona was found without the Year-5 11+ view.');
assert(vr,'No active real production Year-5 11+ English Y5E2 persona was found.');
for(const row of [ordinary,vr])assert(row.firstName&&valid4(row.user.p)&&valid4(answerPassword(row.user)),'Selected real persona is missing required credential/name shape.');
const secrets={
  ordinary:{username:ordinary.id,password:String(ordinary.user.p),answerPassword:String(answerPassword(ordinary.user)),firstName:ordinary.firstName,viewId:'english-year5'},
  vr:{username:vr.id,password:String(vr.user.p),answerPassword:String(answerPassword(vr.user)),firstName:vr.firstName,viewId:'english-year5-11plus'}
};
fs.writeFileSync(secretPath,JSON.stringify(secrets));
fs.chmodSync(secretPath,0o600);
const summary={marker:'CP12_PRODUCTION_REAL_PERSONA_PREREQ_READONLY_PASS',status:'PASS',productionMutation:false,eligibleScanned:eligible,ordinary:{digest:digest(ordinary.id),viewId:'english-year5',y5e2Open:true,year5ElevenPlusAbsent:true,credentialDisclosed:false},vr:{digest:digest(vr.id),viewId:'english-year5-11plus',y5e2Open:true,credentialDisclosed:false},secretMaterialLogged:false};
fs.writeFileSync(summaryPath,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
