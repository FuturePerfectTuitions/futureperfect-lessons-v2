import fs from 'node:fs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { pointerKey, versionKey } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toLowerCase();
const token=clean(process.env.CLOUDFLARE_API_TOKEN);
const account=clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const opsWorker=clean(process.env.WORKER_NAME||'fpt-portal-v2-worker');
const studentWorker=clean(process.env.STUDENT_WORKER_NAME||'fpt-portal-v2-rebuild-student-prod');
const browserWorker=clean(process.env.BROWSER_WORKER_NAME||'fpt-portal-v2-rebuild-browser-prod');
const portalOrigin=clean(process.env.PORTAL_ORIGIN||'https://lessons.futureperfect.education').replace(/\/$/,'');
const asOf=clean(process.env.CHECKPOINT8_AS_OF_DATE||'2026-09-14');
if(!token||!account)throw new Error('Cloudflare read-only credentials are required.');

const base='https://api.cloudflare.com/client/v4';
const cfHeaders={Authorization:`Bearer ${token}`};
async function cf(path,options={}){const r=await fetch(`${base}${path}`,{...options,headers:{...cfHeaders,...(options.headers||{})}});const text=await r.text();let body=null;try{body=JSON.parse(text);}catch{};if(!r.ok||body?.success!==true)throw new Error(`Cloudflare read failed: ${r.status} ${path}`);return body;}
async function workerSettings(name){return (await cf(`/accounts/${account}/workers/scripts/${name}/settings`)).result||{};}
function binding(settings,name){return (settings?.bindings||[]).find(x=>x.name===name)||{};}
async function kvText(ns,key){const r=await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{headers:cfHeaders});if(r.status===404)return null;if(!r.ok)throw new Error(`KV read failed: ${r.status} ${key}`);return r.text();}
async function kvJson(ns,key){const t=await kvText(ns,key);if(t==null)return null;try{return JSON.parse(t);}catch{throw new Error(`KV JSON invalid: ${key}`);}}
async function kvKeys(ns,prefix){const out=[];let cursor='';do{const q=new URLSearchParams({limit:'1000',prefix});if(cursor)q.set('cursor',cursor);const b=await cf(`/accounts/${account}/storage/kv/namespaces/${ns}/keys?${q}`);out.push(...(b.result||[]).map(x=>x.name).filter(Boolean));cursor=clean(b.result_info?.cursor);}while(cursor);return out;}
function currentStudent(id,user){const role=norm(user?.role||user?.accountType);if(id==='admin'||role.includes('admin')||user?.isAdmin===true||user?.superuser===true)return false;const status=norm(user?.accountStatus||user?.status||'active');const expires=clean(user?.expiresOn||user?.expires);return !['inactive','disabled','expired','withdrawn'].includes(status)&&(!expires||expires>asOf);}
function viewSummary(rows,{ignoreRuntimeCompat=false}={}){return Object.fromEntries((Array.isArray(rows)?rows:[]).filter(v=>!(ignoreRuntimeCompat&&clean(v?.viewId)==='special-vr-howto')).map(v=>[clean(v?.viewId),{subject:norm(v?.subject),current:v?.current===true,group:clean(v?.group),lockedPreview:v?.lockedPreview===true,openLessonCount:Number(v?.openLessonCount||0),visibleLessonCount:Number(v?.visibleLessonCount||0)}]));}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
async function jsonFetch(path,init={}){const r=await fetch(`${portalOrigin}${path}`,{redirect:'manual',...init});const text=await r.text();let body=null;try{body=JSON.parse(text);}catch{};return {status:r.status,headers:r.headers,body,text};}

const [opsSettings,studentSettings,browserSettings]=await Promise.all([workerSettings(opsWorker),workerSettings(studentWorker),workerSettings(browserWorker)]);
const studentsNs=clean(binding(opsSettings,'STUDENTS_KV').namespace_id);
const readModelsNs=clean(binding(studentSettings,'READ_MODELS_KV').namespace_id);
const browserStudent=clean(binding(browserSettings,'STAGING_API').service||binding(browserSettings,'STUDENT_API').service);
if(!studentsNs||!readModelsNs)throw new Error('Required production KV bindings are missing.');
if(browserStudent&&browserStudent!==studentWorker)throw new Error(`Canonical Browser→Student binding drifted: ${browserStudent}`);
const scopeSecret=clean(await kvText(readModelsNs,'meta:scope-salt'));
if(!/^[0-9a-f]{64}$/i.test(scopeSecret))throw new Error('Production read-model scope salt is missing or malformed.');

const results=[];
for(const key of (await kvKeys(studentsNs,'user:')).sort()){
  const id=norm(key.replace(/^user:/,''));
  const user=await kvJson(studentsNs,key);
  if(!user||!currentStudent(id,user))continue;
  const password=String(user?.p||'');
  const row={portalUserId:id,firstName:clean(user?.firstName||user?.name),login:'NOT_RUN',home:'NOT_RUN',english:'NOT_RUN',maths:'NOT_RUN',status:'UNKNOWN',runtimeVrHowTo:false,differences:[]};
  if(!password){row.login='MISSING_STORED_PASSWORD';row.status='FAIL';results.push(row);continue;}

  const scopeId=await opaqueAccessScopeId(id,scopeSecret);
  const pointer=await kvJson(readModelsNs,pointerKey(`access:${scopeId}`));
  const version=clean(pointer?.current?.version);
  const envelope=version?await kvJson(readModelsNs,versionKey(`access:${scopeId}`,version)):null;
  const published=envelope?.payload?.snapshot||null;
  if(!published){row.status='FAIL';row.differences.push({kind:'PUBLISHED_ACCESS_MISSING'});results.push(row);continue;}
  const expected=viewSummary(published.views);

  const login=await jsonFetch('/api/v2/auth/login',{method:'POST',headers:{'content-type':'application/json','origin':portalOrigin},body:JSON.stringify({username:id,password})});
  row.login=login.status===200&&login.body?.ok===true?'PASS':`FAIL_${login.status}_${clean(login.body?.error||'UNKNOWN')}`;
  const cookie=clean(login.headers.get('set-cookie')).split(';')[0];
  if(row.login!=='PASS'||!cookie){row.status='FAIL';results.push(row);continue;}
  const authHeaders={cookie,origin:portalOrigin};

  const home=await jsonFetch('/api/v2/student/home',{headers:authHeaders});
  row.home=home.status===200&&home.body?.ok===true?'PASS':`FAIL_${home.status}_${clean(home.body?.error||'UNKNOWN')}`;
  if(row.home==='PASS'){
    row.runtimeVrHowTo=(home.body.views||[]).some(v=>clean(v?.viewId)==='special-vr-howto');
    const actualHome=viewSummary(home.body.views,{ignoreRuntimeCompat:true});
    if(!same(expected,actualHome))row.differences.push({kind:'HOME_VIEW_MISMATCH',expectedViewIds:Object.keys(expected).sort(),actualViewIds:Object.keys(actualHome).sort()});
  }

  for(const subject of ['english','maths']){
    const response=await jsonFetch(`/api/v2/student/subjects/${subject}`,{headers:authHeaders});
    row[subject]=response.status===200&&response.body?.ok===true?'PASS':`FAIL_${response.status}_${clean(response.body?.error||'UNKNOWN')}`;
    if(row[subject]==='PASS'){
      const expectedSubject=Object.fromEntries(Object.entries(expected).filter(([,v])=>v.subject===subject));
      const actualSubject=viewSummary(response.body.views,{ignoreRuntimeCompat:true});
      if(!same(expectedSubject,actualSubject))row.differences.push({kind:`${subject.toUpperCase()}_SUBJECT_VIEW_MISMATCH`,expectedViewIds:Object.keys(expectedSubject).sort(),actualViewIds:Object.keys(actualSubject).sort()});
    }
  }

  if(id==='ayla0108'){
    const lessons=await jsonFetch('/api/v2/student/views/english-year4-11plus/lessons',{headers:authHeaders});
    const target=(Array.isArray(lessons.body?.lessons)?lessons.body.lessons:[]).find(x=>clean(x?.lessonId)==='Y4E1');
    row.aylaY4E1={status:lessons.status,found:Boolean(target),open:target?.open===true,locked:target?.locked===true,accessMode:clean(target?.accessMode)};
    if(!(lessons.status===200&&target&&target.open===true&&target.accessMode==='full'))row.differences.push({kind:'AYLA_Y4E1_NOT_FULL_ON_PUBLIC_ROUTE',detail:row.aylaY4E1});
  }

  row.status=row.login==='PASS'&&row.home==='PASS'&&row.english==='PASS'&&row.maths==='PASS'&&row.differences.length===0?'PASS':'FAIL';
  results.push(row);
}
const failures=results.filter(x=>x.status!=='PASS');
const out={marker:'CP12_LIVE_PUBLIC_ENTITLEMENT_ROUTE_AUDIT',generatedAt:new Date().toISOString(),readOnly:true,portalOrigin,canonicalBrowserStudent:browserStudent,currentStudentCount:results.length,passCount:results.length-failures.length,failCount:failures.length,failureIds:failures.map(x=>x.portalUserId),runtimeVrHowToIds:results.filter(x=>x.runtimeVrHowTo).map(x=>x.portalUserId),results};
fs.writeFileSync('/tmp/cp12-live-public-entitlement-route-audit.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({marker:out.marker,currentStudentCount:out.currentStudentCount,passCount:out.passCount,failCount:out.failCount,failureIds:out.failureIds,runtimeVrHowToIds:out.runtimeVrHowToIds,results:out.results.map(({portalUserId,firstName,login,home,english,maths,status,runtimeVrHowTo,differences,aylaY4E1})=>({portalUserId,firstName,login,home,english,maths,status,runtimeVrHowTo,differences,aylaY4E1}))},null,2));
if(failures.length)throw new Error('One or more live public student entitlement routes do not match published access.');
