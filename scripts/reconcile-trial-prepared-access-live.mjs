import { publishTrialPreparedAccess } from '../worker/src/trial-prepared-access-publisher.js';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const studentsKv = clean(process.env.STUDENTS_KV_ID || 'c9723c8806334e4ea54d1b456d31b794');
const readKv = clean(process.env.READ_MODELS_KV_ID || '77b35165c8694087bc1b0515c35a7e89');
const dbId = clean(process.env.PROD_D1_ID || '97250a54-fa91-45ad-a002-3c4566b1fc38');
if (!account || !token) throw new Error('Cloudflare credentials required');
const base=`https://api.cloudflare.com/client/v4/accounts/${account}`;
const auth={Authorization:`Bearer ${token}`};

async function checked(response,label){
  const text=await response.text();
  if(!response.ok) throw new Error(`${label} ${response.status}: ${text.slice(0,300)}`);
  return text;
}
async function kvGet(ns,key,options={}){
  const r=await fetch(`${base}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{headers:auth});
  if(r.status===404)return null;
  const text=await checked(r,`KV GET ${key}`);
  return options?.type==='json'?JSON.parse(text):text;
}
async function kvPut(ns,key,value){
  const r=await fetch(`${base}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{method:'PUT',headers:{...auth,'content-type':'text/plain'},body:String(value)});
  await checked(r,`KV PUT ${key}`);
}
async function kvList(ns,prefix){
  const u=new URL(`${base}/storage/kv/namespaces/${ns}/keys`);u.searchParams.set('prefix',prefix);u.searchParams.set('limit','1000');
  const body=JSON.parse(await checked(await fetch(u,{headers:auth}),'KV LIST'));
  if(body.success!==true)throw new Error(`KV LIST failed: ${JSON.stringify(body.errors||[])}`);
  return body.result||[];
}
async function d1Query(sql,params=[]){
  const r=await fetch(`${base}/d1/database/${dbId}/query`,{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({sql,params})});
  const body=JSON.parse(await checked(r,'D1 query'));
  if(body.success!==true)throw new Error(`D1 failed: ${JSON.stringify(body.errors||[])}`);
  return body.result?.[0]?.results||[];
}
function dbAdapter(){return{prepare(sql){let params=[];return{bind(...values){params=values;return this;},async all(){return{results:await d1Query(sql,params)};},async first(){return(await d1Query(sql,params))[0]||null;}};}};}
const env={STUDENTS_KV:{get:(k,o)=>kvGet(studentsKv,k,o),put:(k,v)=>kvPut(studentsKv,k,v)},READ_MODELS_KV:{get:(k,o)=>kvGet(readKv,k,o),put:(k,v)=>kvPut(readKv,k,v)},DB:dbAdapter()};

function encodedScope(scope){return encodeURIComponent(scope).replace(/%/g,'_');}
function pointerKey(scope){return `rm:v1:scope:${encodedScope(scope)}:current`;}
function versionKey(scope,version){return `rm:v1:scope:${encodedScope(scope)}:version:${encodeURIComponent(version).replace(/%/g,'_')}`;}
async function preparedSnapshot(scopeId){
  const scope=`access:${scopeId}`;
  const pointer=await kvGet(readKv,pointerKey(scope),{type:'json'});
  if(!pointer?.current?.version)return null;
  const envelope=await kvGet(readKv,versionKey(scope,pointer.current.version),{type:'json'});
  return envelope?.payload?.snapshot||null;
}
async function consumption(id){return(await d1Query('SELECT consumed_at FROM trial_login_consumptions WHERE portal_user_id_norm = ? LIMIT 1',[id]))[0]||null;}

const keys=await kvList(studentsKv,'user:trial');
const results=[];
for(const row of keys){
  const key=clean(row?.name);if(!key.startsWith('user:trial'))continue;
  const profile=await kvGet(studentsKv,key,{type:'json'});
  const id=norm(profile?.portalUserId);
  if(!id.startsWith('trial')||id.startsWith('admintrial')||!Array.isArray(profile?.trialViews)||!profile.trialViews.length)continue;
  const before=await consumption(id);
  const published=await publishTrialPreparedAccess(env,id);
  const after=await consumption(id);
  if(clean(before?.consumed_at)!==clean(after?.consumed_at))throw new Error(`Trial consumption changed during prepared-access reconciliation: ${id}`);
  results.push({id,published,consumed:Boolean(after)});
}

const eva=results.find(row=>row.id==='trialeva');
if(!eva)throw new Error('TrialEva was not reconciled');
const profile=await kvGet(studentsKv,'user:trialeva',{type:'json'});
const expected=['maths-level1','maths-level2','english-year4-11plus'];
if(JSON.stringify((profile?.trialViews||[]).map(norm))!==JSON.stringify(expected))throw new Error('TrialEva canonical Trial views changed unexpectedly');
const snapshot=await preparedSnapshot(eva.published.scopeId);
if(snapshot?.account?.trial!==true)throw new Error('TrialEva prepared account is not marked Trial');
if(JSON.stringify(snapshot.account.trialViews||[])!==JSON.stringify(expected))throw new Error('TrialEva prepared Trial views mismatch');
const visible=(snapshot.views||[]).map(v=>norm(v.viewId));
if(expected.some(v=>!visible.includes(v))||visible.some(v=>!expected.includes(v)))throw new Error(`TrialEva visible views mismatch: ${JSON.stringify(visible)}`);
const lessonAccessCount=Object.keys(snapshot.lessonAccess||{}).length;
if(lessonAccessCount===0)throw new Error('TrialEva prepared lesson access is empty');
if(await consumption('trialeva'))throw new Error('TrialEva one-login allowance was consumed during repair');
console.log(JSON.stringify({marker:'TRIAL_PREPARED_ACCESS_RECONCILIATION_PASS',reconciledCount:results.length,eva:{trialViews:expected,visibleViews:visible,lessonAccessCount,oneLoginUnused:true,preparedVersion:eva.published.version}},null,2));
