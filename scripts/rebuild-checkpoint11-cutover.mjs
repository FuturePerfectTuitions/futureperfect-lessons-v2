import fs from 'node:fs';

const clean=v=>String(v??'').trim();
const mode=clean(process.argv[2]||'');
const token=clean(process.env.CLOUDFLARE_API_TOKEN),account=clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const host=clean(process.env.PROD_HOST||'lessons.futureperfect.education').toLowerCase();
const browser=clean(process.env.NEW_BROWSER_WORKER||'fpt-portal-v2-rebuild-browser-prod');
const legacyWorker=clean(process.env.PROD_WORKER||'fpt-portal-v2-worker');
const expectedDeployment=clean(process.env.EXPECTED_PROD_DEPLOYMENT||'ce193be0-d018-403f-a417-999e9e6eea41');
const expectedVersion=clean(process.env.EXPECTED_PROD_VERSION||'aed13a31-21fa-49c3-8830-c37fd8645c31');
const expectedFrontendMain=clean(process.env.EXPECTED_FRONTEND_MAIN_SHA||'96bfdc4dc3e72b0f354a205bc5a79f6d51c290f7');
const rehearsalHost=clean(process.env.CP11_REHEARSAL_HOST||'cp11-rollback-rehearsal.futureperfect.education').toLowerCase();
if(!['rehearse','public','rollback','verify'].includes(mode))throw new Error('Usage: rebuild-checkpoint11-cutover.mjs rehearse|public|rollback|verify');
if(!token||!account||!host||!browser)throw new Error('CP11 cutover requires Cloudflare credentials and frozen target names.');
const base='https://api.cloudflare.com/client/v4',headers={Authorization:`Bearer ${token}`};
async function request(path,options={}){const response=await fetch(`${base}${path}`,{...options,headers:{...headers,...(options.headers||{})}});const text=await response.text();let body=null;try{body=JSON.parse(text);}catch{}return{response,text,body};}
async function envelope(path,options={}){const out=await request(path,options);if(!out.response.ok||out.body?.success!==true)throw new Error(`Cloudflare request failed: ${out.response.status} ${path} ${JSON.stringify(out.body?.errors||[])}`);return out.body;}
async function cfDelete(path){const out=await request(path,{method:'DELETE'});if(out.response.status===404)return;if(!out.response.ok||out.body?.success!==true)throw new Error(`Cloudflare delete failed: ${out.response.status} ${path}`);}
function deploymentAnchor(body){const rows=body?.result?.deployments||body?.result||[];const first=Array.isArray(rows)?rows[0]:null;const deploymentId=clean(first?.id);const versions=Array.isArray(first?.versions)?first.versions:[];const versionId=clean((versions.find(v=>Number(v?.percentage||0)===100)||versions[0])?.version_id);return{deploymentId,versionId};}
async function zoneFor(name){const zones=(await envelope(`/zones?per_page=50&account.id=${encodeURIComponent(account)}`)).result||[];const zone=zones.filter(z=>name===z.name||name.endsWith(`.${z.name}`)).sort((a,b)=>b.name.length-a.name.length)[0];if(!zone)throw new Error(`No Cloudflare zone for ${name}.`);return zone;}
async function dnsRecords(zoneId,name){return (await envelope(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}&per_page=100`)).result||[];}
async function routes(zoneId){return (await envelope(`/zones/${zoneId}/workers/routes`)).result||[];}
function hostRoutes(rows,name){const lower=name.toLowerCase();return rows.filter(r=>clean(r.pattern).toLowerCase().includes(lower));}
async function patchDns(zoneId,record,proxied){return (await envelope(`/zones/${zoneId}/dns_records/${record.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({type:record.type,name:record.name,content:record.content,ttl:record.ttl||1,proxied})})).result;}
async function addRoute(zoneId,pattern,script){return (await envelope(`/zones/${zoneId}/workers/routes`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pattern,script})})).result;}
async function publicProbe(url,{candidate=false,legacy=false}={}){let last={};for(let i=0;i<30;i++){try{const response=await fetch(url,{redirect:'follow',cache:'no-store'});const text=await response.text();last={status:response.status,text,headers:Object.fromEntries(response.headers.entries())};const brand=response.ok&&/Future Perfect Tuitions/i.test(text);const facade=(response.headers.get('x-fpt-cp9-browser-facade')||'').toLowerCase()==='service-binding';if(candidate?brand:(legacy?brand:true))return{...last,brand,facade};}catch(error){last={error:clean(error?.message)}}await new Promise(r=>setTimeout(r,1000));}throw new Error(`Public probe failed for ${url}: ${JSON.stringify(last).slice(0,500)}`);}
async function apiProbe(url,expectFacade){for(let i=0;i<30;i++){try{const response=await fetch(url,{redirect:'manual',cache:'no-store'});const facade=(response.headers.get('x-fpt-cp9-browser-facade')||'').toLowerCase()==='service-binding';if(response.status===401&&facade===expectFacade)return{status:response.status,facade};}catch{}await new Promise(r=>setTimeout(r,1000));}throw new Error(`API probe did not reach expected topology for ${url}.`);}
async function frontendMain(){const response=await fetch('https://api.github.com/repos/FuturePerfectTuitions/futureperfect-lessons-test/branches/main',{headers:{'user-agent':'fpt-cp11-cutover'}});if(!response.ok)throw new Error(`Frontend branch query failed ${response.status}`);return clean((await response.json())?.commit?.sha);}
async function confirmLegacyAnchor(){const dep=deploymentAnchor(await envelope(`/accounts/${account}/workers/scripts/${legacyWorker}/deployments`));if(dep.deploymentId!==expectedDeployment||dep.versionId!==expectedVersion)throw new Error(`Legacy production Worker anchor moved: ${dep.deploymentId}/${dep.versionId}`);return dep;}
async function confirmPublicLegacyBaseline(zone){const records=await dnsRecords(zone.id,host);if(records.length!==1)throw new Error(`Expected one ${host} DNS record, found ${records.length}.`);const record=records[0];if(record.type!=='CNAME'||record.proxied!==false)throw new Error('Public DNS no longer has the expected DNS-only CNAME baseline.');const matching=hostRoutes(await routes(zone.id),host);if(matching.length)throw new Error(`Public host unexpectedly already has ${matching.length} Worker route(s).`);const main=await frontendMain();if(main!==expectedFrontendMain)throw new Error(`Rollback frontend main moved: ${main}`);const probe=await publicProbe(`https://${host}/`,{legacy:true});return{record,main,probe:{status:probe.status,brand:probe.brand}};}
async function browserExists(){const out=await request(`/accounts/${account}/workers/scripts/${encodeURIComponent(browser)}/settings`);if(!out.response.ok||out.body?.success!==true)throw new Error(`Candidate browser Worker is unavailable: ${out.response.status}`);return true;}

const zone=await zoneFor(host);
if(mode==='rehearse'){
  await browserExists();
  const legacy=await confirmLegacyAnchor();
  const publicBaseline=await confirmPublicLegacyBaseline(zone);
  const existing=await dnsRecords(zone.id,rehearsalHost);if(existing.length)throw new Error(`Rollback rehearsal hostname already exists: ${rehearsalHost}`);
  let rehearsalRecord=null,rehearsalRoute=null;
  const state={marker:'REBUILD_CHECKPOINT11_ROLLBACK_REHEARSAL',checkpoint:11,host:rehearsalHost,passed:false,publicHostUnchanged:false};
  try{
    rehearsalRecord=(await envelope(`/zones/${zone.id}/dns_records`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'CNAME',name:rehearsalHost,content:publicBaseline.record.content,ttl:1,proxied:false})})).result;
    rehearsalRoute=await addRoute(zone.id,`${rehearsalHost}/*`,browser);
    rehearsalRecord=await patchDns(zone.id,rehearsalRecord,true);
    const candidateRoot=await publicProbe(`https://${rehearsalHost}/`,{candidate:true});
    const candidateApi=await apiProbe(`https://${rehearsalHost}/api/v2/student/home`,true);
    rehearsalRecord=await patchDns(zone.id,rehearsalRecord,false);
    const rolledBackDns=(await dnsRecords(zone.id,rehearsalHost))[0];
    if(!rolledBackDns||rolledBackDns.proxied!==false)throw new Error('Rollback rehearsal failed to restore DNS-only state.');
    await cfDelete(`/zones/${zone.id}/workers/routes/${rehearsalRoute.id}`);rehearsalRoute=null;
    const publicAfter=(await dnsRecords(zone.id,host))[0];const publicRoutes=hostRoutes(await routes(zone.id),host);
    if(!publicAfter||publicAfter.id!==publicBaseline.record.id||publicAfter.proxied!==false||publicRoutes.length)throw new Error('Public host changed during rollback rehearsal.');
    state.passed=true;state.publicHostUnchanged=true;state.candidate={rootStatus:candidateRoot.status,apiStatus:candidateApi.status,facade:true};state.rollback={dnsRestoredToDnsOnly:true,routeRemoved:true};state.legacyAnchor=legacy;
  }finally{
    if(rehearsalRecord){try{const current=(await dnsRecords(zone.id,rehearsalHost))[0];if(current?.proxied)await patchDns(zone.id,current,false);}catch{}}
    if(rehearsalRoute){try{await cfDelete(`/zones/${zone.id}/workers/routes/${rehearsalRoute.id}`);}catch{}}
    try{const left=(await dnsRecords(zone.id,rehearsalHost))[0];if(left)await cfDelete(`/zones/${zone.id}/dns_records/${left.id}`);}catch{}
  }
  if(!state.passed)throw new Error('Rollback rehearsal did not reach PASS.');
  fs.writeFileSync('/tmp/checkpoint11-rollback-rehearsal.json',JSON.stringify(state,null,2));console.log(JSON.stringify(state,null,2));
}

if(mode==='public'){
  await browserExists();
  const legacy=await confirmLegacyAnchor();
  const baseline=await confirmPublicLegacyBaseline(zone);
  let route=null,switched=false;
  try{
    route=await addRoute(zone.id,`${host}/*`,browser);
    const routeCheck=hostRoutes(await routes(zone.id),host);if(!routeCheck.some(r=>r.id===route.id&&clean(r.script)===browser))throw new Error('Candidate public route did not verify after creation.');
    const proxied=await patchDns(zone.id,baseline.record,true);switched=true;
    if(proxied.proxied!==true)throw new Error('Public CNAME did not enter proxied state.');
    const root=await publicProbe(`https://${host}/`,{candidate:true});
    const api=await apiProbe(`https://${host}/api/v2/student/home`,true);
    const state={marker:'REBUILD_CHECKPOINT11_PUBLIC_CUTOVER_PASS',checkpoint:11,host,zone:{id:zone.id,name:zone.name},dns:{id:baseline.record.id,type:baseline.record.type,name:baseline.record.name,content:baseline.record.content,proxied:true},route:{id:route.id,pattern:`${host}/*`,script:browser},legacyAnchor:legacy,rollbackFrontendMainSha:baseline.main,verification:{rootStatus:root.status,apiStatus:api.status,facade:true},rollbackReady:true};
    fs.writeFileSync('/tmp/checkpoint11-public-cutover.json',JSON.stringify(state,null,2));console.log(JSON.stringify(state,null,2));
  }catch(error){
    if(switched){try{const current=(await dnsRecords(zone.id,host))[0];if(current)await patchDns(zone.id,current,false);}catch{}}
    if(route){try{await cfDelete(`/zones/${zone.id}/workers/routes/${route.id}`);}catch{}}
    try{await publicProbe(`https://${host}/`,{legacy:true});}catch{}
    throw error;
  }
}

if(mode==='rollback'){
  const records=await dnsRecords(zone.id,host);if(records.length!==1)throw new Error(`Rollback expected one ${host} DNS record, found ${records.length}.`);const record=records[0];
  const matching=hostRoutes(await routes(zone.id),host);
  const foreign=matching.filter(r=>clean(r.script)!==browser);if(foreign.length)throw new Error('Rollback refuses to delete a public route owned by another Worker.');
  if(record.proxied)await patchDns(zone.id,record,false);
  for(const route of matching)await cfDelete(`/zones/${zone.id}/workers/routes/${route.id}`);
  const root=await publicProbe(`https://${host}/`,{legacy:true});
  const after=(await dnsRecords(zone.id,host))[0];const afterRoutes=hostRoutes(await routes(zone.id),host);
  if(!after||after.proxied!==false||afterRoutes.length)throw new Error('Emergency rollback verification failed.');
  const state={marker:'REBUILD_CHECKPOINT11_EMERGENCY_ROLLBACK_PASS',checkpoint:11,host,dnsOnly:true,candidateRoutesRemaining:0,legacyRootStatus:root.status};fs.writeFileSync('/tmp/checkpoint11-emergency-rollback.json',JSON.stringify(state,null,2));console.log(JSON.stringify(state,null,2));
}

if(mode==='verify'){
  await browserExists();const records=await dnsRecords(zone.id,host);if(records.length!==1)throw new Error(`Expected one ${host} DNS record.`);const record=records[0];const matching=hostRoutes(await routes(zone.id),host);if(record.proxied!==true)throw new Error('Public host is not proxied after cutover.');const route=matching.find(r=>clean(r.script)===browser);if(!route)throw new Error('Candidate public Worker route is not installed.');const root=await publicProbe(`https://${host}/`,{candidate:true});const api=await apiProbe(`https://${host}/api/v2/student/home`,true);const state={marker:'REBUILD_CHECKPOINT11_PUBLIC_VERIFY_PASS',checkpoint:11,host,dns:{id:record.id,proxied:true,content:record.content},route:{id:route.id,script:browser,pattern:route.pattern},verification:{rootStatus:root.status,apiStatus:api.status,facade:true}};fs.writeFileSync('/tmp/checkpoint11-public-verify.json',JSON.stringify(state,null,2));console.log(JSON.stringify(state,null,2));
}
