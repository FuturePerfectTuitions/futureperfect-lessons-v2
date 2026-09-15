import assert from 'node:assert/strict';
import fs from 'node:fs';

const base=String(process.env.PROD_BASE||'https://lessons.futureperfect.education').replace(/\/$/,'');
const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const token=String(process.env.CLOUDFLARE_API_TOKEN||'').trim();
const studentsKv=String(process.env.STUDENTS_KV_ID||'').trim();
const output=String(process.env.CP12_PREREQ_OUTPUT||'/tmp/cp12-production-admin-view-prereq.json');
if(!account||!token||!studentsKv)throw new Error('Read-only Admin UAT prerequisite probe requires Cloudflare read credentials.');
const cfBase=`https://api.cloudflare.com/client/v4/accounts/${account}`;
const cfHeaders={Authorization:`Bearer ${token}`};
const valid4=value=>{const p=String(value||'');return p.length===4&&/[A-Z]/.test(p)&&/[a-z]/.test(p)&&/\d/.test(p);};
async function kvUser(id){const r=await fetch(`${cfBase}/storage/kv/namespaces/${studentsKv}/values/${encodeURIComponent(`user:${String(id).toLowerCase()}`)}`,{headers:cfHeaders});if(!r.ok)throw new Error(`Protected Admin record read failed HTTP ${r.status}.`);return r.json();}
function cookiePair(response){const raw=response.headers.get('set-cookie')||'';const pair=raw.split(';')[0].trim();if(!/^fpt_session=/.test(pair))throw new Error('Admin login did not issue the expected session cookie.');return pair;}
async function jsonResponse(response,label){const text=await response.text();let body=null;try{body=JSON.parse(text);}catch{}if(!body)throw new Error(`${label} returned non-JSON HTTP ${response.status}.`);return body;}
async function authGet(path,cookie,label){const response=await fetch(`${base}${path}`,{headers:{cookie},redirect:'manual'});const body=await jsonResponse(response,label);assert.equal(response.status,200,`${label} failed HTTP ${response.status}.`);assert.equal(body?.ok,true,`${label} did not return ok=true.`);return body;}

const admin=await kvUser('admin');
assert(valid4(admin?.p),'Admin login credential shape is invalid.');
const answerPassword=admin?.answerPassword??admin?.answer_password??admin?.answerPackPassword??admin?.answer_pack_password??admin?.ap;
assert(valid4(answerPassword),'Admin Answer Pack credential shape is invalid.');
const firstName=String(admin?.firstName||admin?.name||'').trim();assert(firstName,'Admin first-name field is missing.');
const login=await fetch(`${base}/api/v2/auth/login`,{method:'POST',redirect:'manual',headers:{origin:new URL(base).origin,'content-type':'application/json'},body:JSON.stringify({username:'admin',password:String(admin.p)})});
const loginBody=await jsonResponse(login,'Admin login');assert.equal(login.status,200,'Admin login failed.');assert.equal(loginBody?.ok,true,'Admin login did not return ok=true.');assert.equal(loginBody?.principal,'admin','Admin principal semantics changed.');
const cookie=cookiePair(login);
const home=await authGet('/api/v2/student/home',cookie,'Admin Home');
const viewIds=new Set((home.views||[]).map(v=>String(v?.viewId||'')));
for(const id of ['english-year5','english-year5-11plus'])assert(viewIds.has(id),`Admin Home is missing required production UAT view ${id}.`);
async function inspectView(viewId){
  const list=await authGet(`/api/v2/student/views/${encodeURIComponent(viewId)}/lessons`,cookie,`${viewId} lesson list`);
  const y5e2=(list.lessons||[]).find(row=>String(row?.lessonId||'')==='Y5E2');assert(y5e2,'Y5E2 is missing from required Admin view.');assert.equal(y5e2.locked,false,`Y5E2 is locked in ${viewId}.`);
  const detail=await authGet(`/api/v2/student/lessons/Y5E2?viewId=${encodeURIComponent(viewId)}`,cookie,`${viewId} Y5E2 detail`);
  const resources=Array.isArray(detail.resources)?detail.resources:[];
  const vr=resources.filter(row=>(row.presentationScopes||[]).includes('vr'));
  return {resourceCount:resources.length,vrCount:vr.length,protectedVr:vr.filter(row=>row.type==='answer-pack'&&row.protected===true).length};
}
const ordinary=await inspectView('english-year5');
const elevenPlus=await inspectView('english-year5-11plus');
assert.equal(ordinary.vrCount,0,'Ordinary Admin view exposes VR resources.');
assert(elevenPlus.vrCount>=4,'11+ Admin view does not expose the canonical VR resource set.');
assert(elevenPlus.protectedVr>=2,'11+ Admin view lacks expected protected VR Answer Packs.');
const summary={marker:'CP12_PRODUCTION_ADMIN_VIEW_PREREQ_READONLY_PASS',status:'PASS',productionMutation:false,admin:{firstNamePresent:true,loginCredentialShape:true,answerCredentialShape:true,requiredViews:true},ordinary,elevenPlus,credentialDisclosed:false};
fs.writeFileSync(output,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
