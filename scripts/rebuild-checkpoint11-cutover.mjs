import fs from 'node:fs';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { Resolver, resolve4 } from 'node:dns/promises';

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
const hostsMarker='FPT_CP11_EDGE_PIN';
if(!['rehearse','public','rollback','verify'].includes(mode))throw new Error('Usage: rebuild-checkpoint11-cutover.mjs rehearse|public|rollback|verify');
if(!token||!account||!host||!browser)throw new Error('CP11 cutover requires Cloudflare credentials and frozen target names.');
const base='https://api.cloudflare.com/client/v4',headers={Authorization:`Bearer ${token}`};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function request(path,options={}){const response=await fetch(`${base}${path}`,{...options,headers:{...headers,...(options.headers||{})}});const text=await response.text();let body=null;try{body=JSON.parse(text);}catch{}return{response,text,body};}
async function envelope(path,options={}){const out=await request(path,options);if(!out.response.ok||out.body?.success!==true)throw new Error(`Cloudflare request failed: ${out.response.status} ${path} ${JSON.stringify(out.body?.errors||[])}`);return out.body;}
async function cfDelete(path){const out=await request(path,{method:'DELETE'});if(out.response.status===404)return;if(!out.response.ok||out.body?.success!==true)throw new Error(`Cloudflare delete failed: ${out.response.status} ${path}`);}
function deploymentAnchor(body){const rows=body?.result?.deployments||body?.result||[];const first=Array.isArray(rows)?rows[0]:null;const deploymentId=clean(first?.id);const versions=Array.isArray(first?.versions)?first.versions:[];const versionId=clean((versions.find(v=>Number(v?.percentage||0)===100)||versions[0])?.version_id);return{deploymentId,versionId};}
async function zoneFor(name){const zones=(await envelope(`/zones?per_page=50&account.id=${encodeURIComponent(account)}`)).result||[];const zone=zones.filter(z=>name===z.name||name.endsWith(`.${z.name}`)).sort((a,b)=>b.name.length-a.name.length)[0];if(!zone)throw new Error(`No Cloudflare zone for ${name}.`);return zone;}
async function zoneDetails(zoneId){return (await envelope(`/zones/${zoneId}`)).result;}
async function dnsRecords(zoneId,name){return (await envelope(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}&per_page=100`)).result||[];}
async function routes(zoneId){return (await envelope(`/zones/${zoneId}/workers/routes`)).result||[];}
function hostRoutes(rows,name){const lower=name.toLowerCase();return rows.filter(r=>clean(r.pattern).toLowerCase().includes(lower));}
async function patchDns(zoneId,record,proxied){return (await envelope(`/zones/${zoneId}/dns_records/${record.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({type:record.type,name:record.name,content:record.content,ttl:record.ttl||1,proxied})})).result;}
async function addRoute(zoneId,pattern,script){return (await envelope(`/zones/${zoneId}/workers/routes`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pattern,script})})).result;}
async function publicProbe(url,{candidate=false,legacy=false,attempts=30}={}){let last={};for(let i=0;i<attempts;i++){try{const response=await fetch(url,{redirect:'follow',cache:'no-store'});const text=await response.text();last={status:response.status,text,headers:Object.fromEntries(response.headers.entries())};const brand=response.ok&&/Future Perfect Tuitions/i.test(text);const facade=(response.headers.get('x-fpt-cp9-browser-facade')||'').toLowerCase()==='service-binding';if(candidate?brand:(legacy?brand:true))return{...last,brand,facade};}catch(error){last={error:clean(error?.message)}}await wait(1000);}throw new Error(`Public probe failed for ${url}: ${JSON.stringify(last).slice(0,500)}`);}
async function apiProbe(url,expectFacade,{attempts=30,intervalMs=1000}={}){let last={};for(let i=0;i<attempts;i++){try{const response=await fetch(url,{redirect:'manual',cache:'no-store'});const facade=(response.headers.get('x-fpt-cp9-browser-facade')||'').toLowerCase()==='service-binding';last={status:response.status,facade};if(response.status===401&&facade===expectFacade)return last;}catch(error){last={error:clean(error?.message)}}await wait(intervalMs);}throw new Error(`API probe did not reach expected topology for ${url}: ${JSON.stringify(last).slice(0,300)}`);}
function directHttps(url,edgeIp){const target=new URL(url);return new Promise((resolve,reject)=>{const req=https.request({protocol:'https:',hostname:edgeIp,port:443,servername:target.hostname,path:`${target.pathname}${target.search}`,method:'GET',headers:{Host:target.host,'Cache-Control':'no-store','User-Agent':'fpt-cp11-authoritative-edge'},rejectUnauthorized:true,timeout:10000},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode||0,text:Buffer.concat(chunks).toString('utf8'),headers:res.headers}));});req.on('timeout',()=>req.destroy(new Error('Direct edge request timed out.')));req.on('error',reject);req.end();});}
async function directEdgeApiProbe(url,edgeIp,{attempts=30}={}){let last={};for(let i=0;i<attempts;i++){try{const out=await directHttps(url,edgeIp);const facade=clean(out.headers['x-fpt-cp9-browser-facade']).toLowerCase()==='service-binding';last={status:out.status,facade};if(out.status===401&&facade)return last;}catch(error){last={error:clean(error?.message)}}await wait(1000);}throw new Error(`Direct Cloudflare-edge API probe failed via ${edgeIp}: ${JSON.stringify(last).slice(0,300)}`);}
async function directEdgeRootProbe(url,edgeIp,{attempts=30}={}){let last={};for(let i=0;i<attempts;i++){try{const out=await directHttps(url,edgeIp);const brand=out.status>=200&&out.status<300&&/Future Perfect Tuitions/i.test(out.text);last={status:out.status,brand};if(brand)return last;}catch(error){last={error:clean(error?.message)}}await wait(1000);}throw new Error(`Direct Cloudflare-edge root probe failed via ${edgeIp}: ${JSON.stringify(last).slice(0,300)}`);}
async function authoritativeEdgeCandidates(zone,name,{attempts=45}={}){const details=await zoneDetails(zone.id);const nameservers=Array.isArray(details?.name_servers)?details.name_servers.map(clean).filter(Boolean):[];if(!nameservers.length)throw new Error('Cloudflare zone has no authoritative nameservers in API response.');let lastError='';for(let attempt=0;attempt<attempts;attempt++){for(const nameserver of nameservers){let nsIps=[];try{nsIps=await resolve4(nameserver);}catch(error){lastError=clean(error?.message);continue;}for(const nsIp of nsIps){try{const resolver=new Resolver();resolver.setServers([nsIp]);const edgeIps=await resolver.resolve4(name);if(edgeIps.length)return{nameserver,nameserverIp:nsIp,edgeIps:[...new Set(edgeIps)]};}catch(error){lastError=clean(error?.message);}}}await wait(1000);}throw new Error(`Authoritative Cloudflare DNS did not publish proxied A records for ${name}: ${lastError}`);}
async function verifiedAuthoritativeEdge(zone,name){const resolved=await authoritativeEdgeCandidates(zone,name);let lastError='';for(const edgeIp of resolved.edgeIps){try{const api=await directEdgeApiProbe(`https://${name}/api/v2/student/home`,edgeIp,{attempts:5});const root=await directEdgeRootProbe(`https://${name}/`,edgeIp,{attempts:5});return{...resolved,edgeIp,api,root};}catch(error){lastError=clean(error?.message);}}throw new Error(`No authoritative Cloudflare edge served the CP11 candidate: ${lastError}`);}
function hostsWithoutCp11Pin(){return fs.readFileSync('/etc/hosts','utf8').split(/\r?\n/).filter(line=>!line.includes(hostsMarker)).join('\n').replace(/\n*$/,'\n');}
function unpinPublicHost(){const updated=hostsWithoutCp11Pin();execFileSync('sudo',['tee','/etc/hosts'],{input:updated,stdio:['pipe','ignore','pipe']});}
function pinPublicHost(edgeIp,name){const updated=`${hostsWithoutCp11Pin()}${edgeIp} ${name} # ${hostsMarker}\n`;execFileSync('sudo',['tee','/etc/hosts'],{input:updated,stdio:['pipe','ignore','pipe']});const active=fs.readFileSync('/etc/hosts','utf8').includes(`${edgeIp} ${name} # ${hostsMarker}`);if(!active)throw new Error('Failed to install CP11 edge pin in /etc/hosts.');fs.writeFileSync('/tmp/checkpoint11-public-edge-ip',`${edgeIp}\n`);}
function pinIsActive(){return fs.readFileSync('/etc/hosts','utf8').split(/\r?\n/).some(line=>line.includes(hostsMarker)&&line.includes(host));}
async function frontendMain(){const response=await fetch('https://api.github.com/repos/FuturePerfectTuitions/futureperfect-lessons-test/branches/main',{headers:{'user-agent':'fpt-cp11-cutover'}});if(!response.ok)throw new Error(`Frontend branch query failed ${response.status}`);return clean((await response.json())?.commit?.sha);}
async function confirmLegacyAnchor(){const dep=deploymentAnchor(await envelope(`/accounts/${account}/workers/scripts/${legacyWorker}/deployments`));if(dep.deploymentId!==expectedDeployment||dep.versionId!==expectedVersion)throw new Error(`Legacy production Worker anchor moved: ${dep.deploymentId}/${dep.versionId}`);return dep;}
async function confirmPublicLegacyBaseline(zone){const records=await dnsRecords(zone.id,host);if(records.length!==1)throw new Error(`Expected one ${host} DNS record, found ${records.length}.`);const record=records[0];if(record.type!=='CNAME'||record.proxied!==false)throw new Error('Public DNS no longer has the expected DNS-only CNAME baseline.');const matching=hostRoutes(await routes(zone.id),host);if(matching.length)throw new Error(`Public host unexpectedly already has ${matching.length} Worker route(s).`);const main=await frontendMain();if(main!==expectedFrontendMain)throw new Error(`Rollback frontend main moved: ${main}`);const probe=await publicProbe(`https://${host}/`,{legacy:true});return{record,main,probe:{status:probe.status,brand:probe.brand}};}
async function browserExists(){const out=await request(`/accounts/${account}/workers/scripts/${encodeURIComponent(browser)}/settings`);if(!out.response.ok||out.body?.success!==true)throw new Error(`Candidate browser Worker is unavailable: ${out.response.status}`);return true;}
async function restoreLegacyControlPlane(zone){unpinPublicHost();const records=await dnsRecords(zone.id,host);if(records.length!==1)throw new Error(`Rollback expected one ${host} DNS record, found ${records.length}.`);let record=records[0];const matching=hostRoutes(await routes(zone.id),host);const foreign=matching.filter(r=>clean(r.script)!==browser);if(foreign.length)throw new Error('Rollback refuses to delete a public route owned by another Worker.');if(record.proxied)record=await patchDns(zone.id,record,false);for(const route of matching)await cfDelete(`/zones/${zone.id}/workers/routes/${route.id}`);const after=(await dnsRecords(zone.id,host))[0];const afterRoutes=hostRoutes(await routes(zone.id),host);if(!after||after.proxied!==false||afterRoutes.length)throw new Error('Legacy topology restoration failed control-plane verification.');const legacy=await confirmLegacyAnchor();const main=await frontendMain();if(main!==expectedFrontendMain)throw new Error(`Rollback frontend main moved: ${main}`);const origin=await publicProbe(`https://${after.content}/`,{legacy:true});return{record:after,legacy,main,originStatus:origin.status};}

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
    const edge=await verifiedAuthoritativeEdge(zone,rehearsalHost);
    const candidateRoot=edge.root;
    const candidateApi=edge.api;
    rehearsalRecord=await patchDns(zone.id,rehearsalRecord,false);
    const rolledBackDns=(await dnsRecords(zone.id,rehearsalHost))[0];
    if(!rolledBackDns||rolledBackDns.proxied!==false)throw new Error('Rollback rehearsal failed to restore DNS-only state.');
    await cfDelete(`/zones/${zone.id}/workers/routes/${rehearsalRoute.id}`);rehearsalRoute=null;
    const publicAfter=(await dnsRecords(zone.id,host))[0];const publicRoutes=hostRoutes(await routes(zone.id),host);
    if(!publicAfter||publicAfter.id!==publicBaseline.record.id||publicAfter.proxied!==false||publicRoutes.length)throw new Error('Public host changed during rollback rehearsal.');
    state.passed=true;state.publicHostUnchanged=true;state.candidate={rootStatus:candidateRoot.status,apiStatus:candidateApi.status,facade:true,authoritativeDns:true,authoritativeNameserver:edge.nameserver,authoritativeNameserverIp:edge.nameserverIp,edgeIp:edge.edgeIp,directEdgeRootStatus:edge.root.status,directEdgeApiStatus:edge.api.status,sameRunnerRecursiveDnsBypassed:true};state.rollback={dnsRestoredToDnsOnly:true,routeRemoved:true};state.legacyAnchor=legacy;
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
    const edge=await verifiedAuthoritativeEdge(zone,host);
    pinPublicHost(edge.edgeIp,host);
    const api=await apiProbe(`https://${host}/api/v2/student/home`,true,{attempts:30});
    const root=await publicProbe(`https://${host}/`,{candidate:true,attempts:30});
    const state={marker:'REBUILD_CHECKPOINT11_PUBLIC_CUTOVER_PASS',checkpoint:11,host,zone:{id:zone.id,name:zone.name},dns:{id:baseline.record.id,type:baseline.record.type,name:baseline.record.name,content:baseline.record.content,proxied:true},route:{id:route.id,pattern:`${host}/*`,script:browser},legacyAnchor:legacy,rollbackFrontendMainSha:baseline.main,verification:{rootStatus:root.status,apiStatus:api.status,facade:true,authoritativeDns:true,authoritativeNameserver:edge.nameserver,authoritativeNameserverIp:edge.nameserverIp,edgeIp:edge.edgeIp,directEdgeRootStatus:edge.root.status,directEdgeApiStatus:edge.api.status,sameRunnerRecursiveDnsBypassed:true,postCutoverHostPin:true},rollbackReady:true};
    fs.writeFileSync('/tmp/checkpoint11-public-cutover.json',JSON.stringify(state,null,2));console.log(JSON.stringify(state,null,2));
  }catch(error){
    let rollbackError=null;try{await restoreLegacyControlPlane(zone);}catch(inner){rollbackError=inner;}
    if(rollbackError)throw new AggregateError([error,rollbackError],`CP11 public cutover failed and legacy topology restoration also failed: ${clean(rollbackError?.message)}`);
    throw error;
  }
}

if(mode==='rollback'){
  const restored=await restoreLegacyControlPlane(zone);
  const state={marker:'REBUILD_CHECKPOINT11_EMERGENCY_ROLLBACK_PASS',checkpoint:11,host,dnsOnly:true,candidateRoutesRemaining:0,legacyOriginStatus:restored.originStatus,legacyDeploymentId:restored.legacy.deploymentId,legacyVersionId:restored.legacy.versionId,frontendMainSha:restored.main,hostPinRemoved:true};fs.writeFileSync('/tmp/checkpoint11-emergency-rollback.json',JSON.stringify(state,null,2));console.log(JSON.stringify(state,null,2));
}

if(mode==='verify'){
  await browserExists();const records=await dnsRecords(zone.id,host);if(records.length!==1)throw new Error(`Expected one ${host} DNS record.`);const record=records[0];const matching=hostRoutes(await routes(zone.id),host);if(record.proxied!==true)throw new Error('Public host is not proxied after cutover.');const route=matching.find(r=>clean(r.script)===browser);if(!route)throw new Error('Candidate public Worker route is not installed.');if(!pinIsActive())throw new Error('CP11 public edge pin is not active for same-runner production verification.');const edge=await verifiedAuthoritativeEdge(zone,host);const root=await publicProbe(`https://${host}/`,{candidate:true});const api=await apiProbe(`https://${host}/api/v2/student/home`,true);const state={marker:'REBUILD_CHECKPOINT11_PUBLIC_VERIFY_PASS',checkpoint:11,host,dns:{id:record.id,proxied:true,content:record.content},route:{id:route.id,script:browser,pattern:route.pattern},verification:{rootStatus:root.status,apiStatus:api.status,facade:true,authoritativeDns:true,edgeIp:edge.edgeIp,directEdgeRootStatus:edge.root.status,directEdgeApiStatus:edge.api.status,hostPinActive:true}};fs.writeFileSync('/tmp/checkpoint11-public-verify.json',JSON.stringify(state,null,2));console.log(JSON.stringify(state,null,2));
}
