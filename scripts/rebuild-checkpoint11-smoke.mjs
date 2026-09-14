import fs from 'node:fs';
import crypto from 'node:crypto';

const clean=v=>String(v??'').trim();
const base=clean(process.env.SMOKE_BASE_URL).replace(/\/$/,'');
const phase=clean(process.argv[2]||process.env.SMOKE_PHASE||'private').replace(/[^A-Za-z0-9._-]+/g,'-');
const secretPath=clean(process.env.CHECKPOINT11_SMOKE_SECRET||'/tmp/checkpoint11-smoke-secret.json');
if(!base||!fs.existsSync(secretPath)) throw new Error('CP11 smoke requires SMOKE_BASE_URL and the protected local smoke fixture.');
const secret=JSON.parse(fs.readFileSync(secretPath,'utf8'));
for(const key of ['username','password','answerPassword','viewId','lessonId','studentDigest']) if(!clean(secret[key])) throw new Error(`Smoke fixture missing ${key}.`);
const origin=new URL(base).origin;
const timing={};
async function measured(name,fn){const start=performance.now();try{return await fn();}finally{timing[name]=Number((performance.now()-start).toFixed(3));}}
async function json(response,label){const text=await response.text();let body=null;try{body=JSON.parse(text);}catch{}if(!body)throw new Error(`${label} returned non-JSON HTTP ${response.status}.`);return body;}
function assert(condition,message){if(!condition)throw new Error(message);}
function cookiePair(setCookie){const pair=String(setCookie||'').split(';')[0].trim();assert(/^fpt_session=/.test(pair),'Session cookie name mismatch.');return pair;}
function assertSessionCookie(setCookie){const value=String(setCookie||'');assert(/(?:^|;\s*)HttpOnly(?:;|$)/i.test(value),'Session cookie missing HttpOnly.');assert(/(?:^|;\s*)Secure(?:;|$)/i.test(value),'Session cookie missing Secure.');assert(/(?:^|;\s*)SameSite=Lax(?:;|$)/i.test(value),'Session cookie missing SameSite=Lax.');assert(/(?:^|;\s*)Max-Age=28800(?:;|$)/i.test(value),'Session cookie must be 8-hour absolute Max-Age.');}
async function authenticated(path,options={}){return fetch(`${base}${path}`,{redirect:'manual',...options,headers:{cookie:cookie,...(options.headers||{})}});}

const root=await measured('frontendRootMs',()=>fetch(`${base}/`,{redirect:'follow'}));
const rootText=await root.text();
assert(root.ok&&/Future Perfect Tuitions/i.test(rootText),`Frontend root unavailable: HTTP ${root.status}`);
const scriptPath=(rootText.match(/<script[^>]+src=["']([^"']+)["']/i)||[])[1]||'';
assert(scriptPath,'Frontend root did not expose a script asset.');
const js=await measured('frontendAssetMs',()=>fetch(new URL(scriptPath,`${base}/`),{redirect:'follow'}));
const jsText=await js.text();
assert(js.ok&&/Student Login/i.test(jsText),'Accepted frontend asset did not match expected Portal V2 build.');
assert(!jsText.includes('https://fpt-portal-v2-worker.futureperfectlessons.workers.dev'),'Accepted frontend unexpectedly contains legacy absolute Worker URL.');

const loginResponse=await measured('loginMs',()=>fetch(`${base}/api/v2/auth/login`,{method:'POST',redirect:'manual',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:secret.username,password:secret.password})}));
const login=await json(loginResponse,'login');
assert(loginResponse.status===200&&login.ok===true&&!login.accountLocked,`Positive login failed: HTTP ${loginResponse.status}`);
const setCookie=loginResponse.headers.get('set-cookie')||'';
assertSessionCookie(setCookie);
const cookie=cookiePair(setCookie);
const nowSec=Math.floor(Date.now()/1000);
assert(Number(login.expiresAt)>=nowSec+28700&&Number(login.expiresAt)<=nowSec+28900,'Session expiry is not approximately 8 hours absolute.');

const homeResponse=await measured('homeMs',()=>authenticated('/api/v2/student/home'));
const home=await json(homeResponse,'home');
assert(homeResponse.status===200&&home.ok===true&&Array.isArray(home.views)&&home.views.length>0,'Home smoke failed.');
const view=home.views.find(v=>clean(v.viewId)===secret.viewId);
assert(view&&!view.lockedPreview,'Smoke view is not available as an unlocked view.');

const subject=String(secret.viewId).startsWith('english-')?'english':'maths';
const subjectResponse=await measured('subjectMs',()=>authenticated(`/api/v2/student/subjects/${subject}`));
const subjectBody=await json(subjectResponse,'subject');
assert(subjectResponse.status===200&&subjectBody.ok===true&&(subjectBody.views||[]).some(v=>clean(v.viewId)===secret.viewId),'Subject navigation smoke failed.');

const viewResponse=await measured('viewMs',()=>authenticated(`/api/v2/student/views/${encodeURIComponent(secret.viewId)}/lessons`));
const viewBody=await json(viewResponse,'view lessons');
assert(viewResponse.status===200&&viewBody.ok===true,'View lessons smoke failed.');
const lessonRow=(viewBody.lessons||[]).find(row=>clean(row.lessonId)===secret.lessonId);
assert(lessonRow&&lessonRow.open===true&&lessonRow.locked===false,'Selected smoke lesson is not open in its accepted view.');

const lessonResponse=await measured('lessonMs',()=>authenticated(`/api/v2/student/lessons/${encodeURIComponent(secret.lessonId)}?viewId=${encodeURIComponent(secret.viewId)}`));
const lesson=await json(lessonResponse,'lesson detail');
assert(lessonResponse.status===200&&lesson.ok===true&&lesson.resourcesIncluded===true,'Lesson detail smoke failed.');
const resources=Array.isArray(lesson.resources)?lesson.resources:[];
const answer=resources.find(r=>r.protected===true||clean(r.type)==='answer-pack');
const ordinary=resources.find(r=>r.protected!==true&&!['answer-pack','video'].includes(clean(r.type)));
const video=resources.find(r=>clean(r.type)==='video');
assert(answer,'Smoke lesson did not expose an Answer Pack resource.');
assert(ordinary,'Smoke lesson did not expose an ordinary downloadable resource.');

const ordinaryOpen=await measured('ordinaryOpenMs',()=>authenticated(`/api/v2/student/lessons/${encodeURIComponent(secret.lessonId)}/resources/${encodeURIComponent(ordinary.resourceId)}/open?viewId=${encodeURIComponent(secret.viewId)}`));
assert(ordinaryOpen.status===302,'Ordinary resource did not issue a direct-navigation capability redirect.');
const ordinaryLocation=ordinaryOpen.headers.get('location')||'';
assert(ordinaryLocation.startsWith('/api/v2/student/resource?cap='),'Ordinary resource capability redirect target is unexpected.');
const ordinaryDelivery=await measured('ordinaryDeliveryMs',()=>authenticated(ordinaryLocation));
assert(ordinaryDelivery.status===200,'Ordinary resource capability delivery failed.');
assert(/attachment/i.test(ordinaryDelivery.headers.get('content-disposition')||''),'Ordinary resource did not retain attachment delivery semantics.');
await ordinaryDelivery.body?.cancel();

const answerOpen=await measured('answerOpenMs',()=>authenticated(`/api/v2/student/lessons/${encodeURIComponent(secret.lessonId)}/resources/${encodeURIComponent(answer.resourceId)}/open?viewId=${encodeURIComponent(secret.viewId)}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({password:secret.answerPassword})}));
const answerBody=await json(answerOpen,'Answer Pack open');
assert(answerOpen.status===200&&answerBody.ok===true&&answerBody.kind==='answer-view','Answer Pack live-password open failed.');
const capabilityLifetime=Number(answerBody.expiresAt)-Math.floor(Date.now()/1000);
assert(capabilityLifetime>0&&capabilityLifetime<=300,'Answer Pack capability exceeds the approved 5-minute lifetime.');
assert(clean(answerBody.viewerUrl).startsWith('/api/v2/student/resource?cap='),'Answer Pack viewer URL is not a scoped capability path.');
const answerDelivery=await measured('answerDeliveryMs',()=>authenticated(answerBody.viewerUrl));
assert(answerDelivery.status===200,'Answer Pack capability delivery failed.');
assert(/inline/i.test(answerDelivery.headers.get('content-disposition')||''),'Answer Pack did not retain inline protected-view delivery semantics.');
await answerDelivery.body?.cancel();

let videoVerification={present:Boolean(video),providerContactedOnlyAfterView:null};
if(video){
  const videoOpen=await measured('videoOpenMs',()=>authenticated(`/api/v2/student/lessons/${encodeURIComponent(secret.lessonId)}/resources/${encodeURIComponent(video.resourceId)}/open?viewId=${encodeURIComponent(secret.viewId)}`));
  assert(videoOpen.status===302,'Video View did not issue a capability redirect.');
  const capLocation=videoOpen.headers.get('location')||'';
  assert(capLocation.startsWith('/api/v2/student/resource?cap='),'Video View contacted an unexpected target before capability validation.');
  const provider=await measured('videoCapabilityMs',()=>authenticated(capLocation));
  assert(provider.status===302,'Video capability did not redirect to the provider.');
  const target=provider.headers.get('location')||'';
  let host='';try{host=new URL(target).hostname.toLowerCase();}catch{}
  assert(['screenpal.com','www.screenpal.com','go.screenpal.com'].includes(host),'Video provider redirect target is not an approved ScreenPal host.');
  videoVerification={present:true,providerContactedOnlyAfterView:true,providerHost:host};
}

const logoutResponse=await measured('logoutMs',()=>authenticated('/api/v2/auth/logout',{method:'POST',headers:{origin}}));
const logout=await json(logoutResponse,'logout');
assert(logoutResponse.status===200&&logout.ok===true,'Logout failed.');
const clearCookie=logoutResponse.headers.get('set-cookie')||'';
assert(/fpt_session=/.test(clearCookie)&&/Max-Age=0/i.test(clearCookie),'Logout did not clear only the current browser cookie.');

const summary={marker:'REBUILD_CHECKPOINT11_SMOKE_PASS',checkpoint:11,phase,baseHost:new URL(base).hostname,frontend:{rootStatus:root.status,assetStatus:js.status,acceptedBuildDetected:true,legacyAbsoluteWorkerUrlAbsent:true},auth:{positiveLogin:true,sessionCookie:{secure:true,httpOnly:true,sameSite:'Lax',maxAgeSeconds:28800},logoutCurrentBrowserCookie:true},navigation:{home:true,subject:true,view:true,lesson:true},resources:{ordinaryCapability:true,ordinaryDelivered:true,answerPackLivePassword:true,answerPackCapabilityMaxSeconds:300,answerPackDelivered:true,video:videoVerification},timingsMs:timing,smokeStudentDigest:secret.studentDigest,credentialsDisclosed:false,evidenceDigest:crypto.createHash('sha256').update(JSON.stringify({phase,timing,student:secret.studentDigest,lesson:secret.lessonId,view:secret.viewId})).digest('hex')};
const out=`/tmp/checkpoint11-smoke-${phase}.json`;fs.writeFileSync(out,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
