import fs from 'node:fs';
import crypto from 'node:crypto';

const clean=v=>String(v??'').trim();
const token=clean(process.env.CLOUDFLARE_API_TOKEN);
const account=clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const worker=clean(process.env.PROD_WORKER||'fpt-portal-v2-worker');
const host=clean(process.env.PROD_HOST||'lessons.futureperfect.education');
const expectedDeployment=clean(process.env.EXPECTED_PROD_DEPLOYMENT);
const expectedVersion=clean(process.env.EXPECTED_PROD_VERSION);
const expectedFrontendSha=clean(process.env.EXPECTED_FRONTEND_MAIN_SHA);
const studentProd=clean(process.env.NEW_STUDENT_WORKER||'fpt-portal-v2-rebuild-student-prod');
const browserProd=clean(process.env.NEW_BROWSER_WORKER||'fpt-portal-v2-rebuild-browser-prod');
const expectedShadowKv=clean(process.env.PROD_SHADOW_KV_ID||'77b35165c8694087bc1b0515c35a7e89');
const expectedShadowD1=clean(process.env.PROD_SHADOW_D1_ID||'3a17180e-b554-4740-a629-bcaca6a2eeb5');
if(!token||!account||!expectedDeployment||!expectedVersion||!expectedFrontendSha) throw new Error('CP11 preflight requires Cloudflare credentials and frozen anchors.');
const base='https://api.cloudflare.com/client/v4';
const headers={Authorization:`Bearer ${token}`};
async function request(path,options={}){
  const response=await fetch(`${base}${path}`,{...options,headers:{...headers,...(options.headers||{})}});
  const text=await response.text(); let body=null; try{body=JSON.parse(text);}catch{}
  return {response,body,text};
}
async function envelope(path,options={}){
  const {response,body}=await request(path,options);
  if(!response.ok||body?.success!==true) throw new Error(`Cloudflare read failed: ${response.status} ${path}`);
  return body;
}
async function workerExists(name){
  const {response,body}=await request(`/accounts/${account}/workers/scripts/${encodeURIComponent(name)}/settings`);
  if(response.status===404) return {exists:false};
  if(!response.ok||body?.success!==true) throw new Error(`Worker inventory failed for ${name}: ${response.status}`);
  const bindings=(body.result?.bindings||[]).map(x=>({name:x.name,type:x.type,namespace_id:x.namespace_id||null,database_id:x.database_id||x.id||null,bucket_name:x.bucket_name||x.bucket||null,service:x.service||null}));
  return {exists:true,bindings};
}
async function kvText(ns,key){
  const {response,text}=await request(`/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`);
  if(response.status===404)return null;
  if(!response.ok)throw new Error(`KV read failed ${response.status}`);
  return text;
}
async function d1Query(db,sql){
  const body=await envelope(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql})});
  const first=Array.isArray(body.result)?body.result[0]:body.result;
  return first?.results||[];
}
function deploymentAnchor(body){
  const rows=body?.result?.deployments||body?.result||[];
  const first=Array.isArray(rows)?rows[0]:null;
  const deploymentId=clean(first?.id);
  const versions=Array.isArray(first?.versions)?first.versions:[];
  const versionId=clean((versions.find(v=>Number(v?.percentage||0)===100)||versions[0])?.version_id);
  return {deploymentId,versionId};
}

const dep=deploymentAnchor(await envelope(`/accounts/${account}/workers/scripts/${worker}/deployments`));
if(dep.deploymentId!==expectedDeployment||dep.versionId!==expectedVersion) throw new Error(`Production anchor moved: ${dep.deploymentId}/${dep.versionId}`);
const settings=(await envelope(`/accounts/${account}/workers/scripts/${worker}/settings`)).result||{};
const bindings=settings.bindings||[];
const binding=name=>bindings.find(x=>x.name===name)||{};
const studentsKv=clean(binding('STUDENTS_KV').namespace_id), lessonsKv=clean(binding('LESSONS_KV').namespace_id), prodDb=clean(binding('DB').database_id||binding('DB').id), prodR2=clean(binding('MATERIALS_R2').bucket_name||binding('MATERIALS_R2').bucket);
if(!studentsKv||!lessonsKv||!prodDb||!prodR2) throw new Error('Legacy production bindings incomplete.');
const boundKvIds=bindings.map(x=>clean(x.namespace_id)).filter(Boolean), boundD1Ids=bindings.map(x=>clean(x.database_id||x.id)).filter(Boolean);
if(!boundKvIds.includes(expectedShadowKv)) throw new Error('Production dual-write shadow KV binding is missing.');
if(!boundD1Ids.includes(expectedShadowD1)) throw new Error('Production dual-write shadow D1 binding is missing.');
const salt=clean(await kvText(expectedShadowKv,'meta:scope-salt'));
if(!/^[0-9a-f]{64}$/i.test(salt)) throw new Error('Production shadow scope salt is missing or malformed.');
const rateTable=await d1Query(prodDb,"SELECT name FROM sqlite_master WHERE type='table' AND name='answer_password_rate_limits'");
if(!rateTable.length) throw new Error('Production D1 is missing answer_password_rate_limits.');

const zones=(await envelope(`/zones?per_page=50&account.id=${encodeURIComponent(account)}`)).result||[];
const zone=zones.filter(z=>host===z.name||host.endsWith(`.${z.name}`)).sort((a,b)=>b.name.length-a.name.length)[0];
if(!zone) throw new Error(`No Cloudflare zone found for ${host}.`);
const dns=(await envelope(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(host)}&per_page=100`)).result||[];
if(dns.length!==1) throw new Error(`Expected exactly one DNS record for ${host}; got ${dns.length}.`);
const routes=(await envelope(`/zones/${zone.id}/workers/routes`)).result||[];
const matchingRoutes=routes.filter(r=>clean(r.pattern).toLowerCase().includes(host.toLowerCase()));
const [studentInventory,browserInventory]=await Promise.all([workerExists(studentProd),workerExists(browserProd)]);
if(studentInventory.exists||browserInventory.exists) throw new Error('Intended CP11 production rebuild Worker name already exists; refusing to overwrite without explicit reconciliation.');

const gh=await fetch('https://api.github.com/repos/FuturePerfectTuitions/futureperfect-lessons-test/branches/main',{headers:{'User-Agent':'fpt-cp11-preflight'}});
if(!gh.ok) throw new Error(`Frontend branch query failed: ${gh.status}`);
const ghBody=await gh.json(); const frontendMainSha=clean(ghBody?.commit?.sha);
if(frontendMainSha!==expectedFrontendSha) throw new Error(`Live frontend main moved: ${frontendMainSha}`);
const publicResponse=await fetch(`https://${host}/`,{redirect:'follow'});
const publicText=await publicResponse.text();
if(!publicResponse.ok||!/Future Perfect Tuitions/i.test(publicText)) throw new Error(`Public portal baseline unavailable: ${publicResponse.status}`);

const summary={
  marker:'REBUILD_CHECKPOINT11_PREFLIGHT_PASS',
  checkpoint:11,
  exactSha:clean(process.env.GITHUB_SHA),
  production:{worker,deploymentId:dep.deploymentId,versionId:dep.versionId,studentsKv,lessonsKv,db:prodDb,r2:prodR2,dualWriteShadowKvBound:true,dualWriteShadowD1Bound:true,scopeSaltPresent:true,answerRateTablePresent:true},
  frontend:{repository:'FuturePerfectTuitions/futureperfect-lessons-test',mainSha:frontendMainSha,publicHost:host,publicHttpStatus:publicResponse.status,publicBodySha256:crypto.createHash('sha256').update(publicText).digest('hex')},
  cloudflare:{zoneId:zone.id,zoneName:zone.name,dns:{id:dns[0].id,type:dns[0].type,name:dns[0].name,content:dns[0].content,proxied:Boolean(dns[0].proxied),ttl:dns[0].ttl},matchingWorkerRoutes:matchingRoutes.map(r=>({id:r.id,pattern:r.pattern,script:r.script||null}))},
  intendedNames:{student:studentProd,browser:browserProd,studentUnused:!studentInventory.exists,browserUnused:!browserInventory.exists},
  safety:{readOnly:true,productionDataMutated:false,productionRoutingMutated:false,frontendMutated:false}
};
fs.writeFileSync('/tmp/checkpoint11-preflight.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
