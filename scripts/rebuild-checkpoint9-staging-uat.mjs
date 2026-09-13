import assert from 'node:assert/strict';
import fs from 'node:fs';

const base=String(process.env.STAGING_BASE_URL||'').replace(/\/$/,'');
const loginPassword=process.env.UAT_LOGIN_PASSWORD||'';
const answerPassword=process.env.UAT_ANSWER_PASSWORD||'';
const seedPath=process.env.CHECKPOINT9_SEED_SUMMARY||'/tmp/checkpoint9-seed-summary.json';
const origin='https://futureperfecttuitions.github.io';
if(!base||!loginPassword||!answerPassword) throw new Error('Checkpoint 9 UAT environment is incomplete.');
const seed=JSON.parse(fs.readFileSync(seedPath,'utf8'));
const selected=seed.selected||{};

function cookieFrom(response){return String(response.headers.get('set-cookie')||'').split(';')[0];}
async function call(path,{method='GET',cookie='',json,requestOrigin=origin}={}){const headers={Origin:requestOrigin};if(cookie)headers.Cookie=cookie;if(json!==undefined)headers['Content-Type']='application/json';return fetch(`${base}${path}`,{method,headers,body:json===undefined?undefined:JSON.stringify(json),redirect:'manual'});}
async function login(username){const response=await call('/api/v2/auth/login',{method:'POST',json:{username,password:loginPassword}});assert.equal(response.status,200,`${username} login failed`);const setCookie=response.headers.get('set-cookie')||'';assert.match(setCookie,/HttpOnly/i);assert.match(setCookie,/Secure/i);return{cookie:cookieFrom(response),body:await response.json()};}
async function json(response){return response.json();}
async function lesson(cookie,lessonId,viewId){const response=await call(`/api/v2/student/lessons/${encodeURIComponent(lessonId)}?viewId=${encodeURIComponent(viewId)}`,{cookie});assert.equal(response.status,200,`lesson ${lessonId} ${viewId} failed`);return json(response);}
async function openOrdinary(cookie,lessonId,viewId,resource){let response=await call(`/api/v2/student/lessons/${encodeURIComponent(lessonId)}/resources/${encodeURIComponent(resource.resourceId)}/open?viewId=${encodeURIComponent(viewId)}`,{cookie});assert.equal(response.status,302);const location=response.headers.get('location');assert.ok(location?.startsWith('/api/v2/student/resource?'));response=await call(location,{cookie});assert.equal(response.status,200);assert.match(response.headers.get('content-disposition')||'',/^attachment/i);const bytes=new Uint8Array(await response.arrayBuffer());assert.ok(bytes.length>0);return bytes.length;}

const healthResponse=await call('/health');assert.equal(healthResponse.status,200);const health=await json(healthResponse);assert.equal(health.environment,'staging');assert.equal(health.productionTarget,false);assert.equal(health.preparedReadModels.kvBound,true);assert.equal(health.auth.studentStoreBound,true);assert.equal(health.resources.r2Bound,true);assert.equal(health.resources.answerRateStoreBound,true);

let response=await call('/api/v2/auth/login',{method:'POST',json:{username:'cp9normal',password:loginPassword},requestOrigin:'https://evil.example'});assert.equal(response.status,403);
const normal1=await login('cp9normal'),normal2=await login('cp9normal');assert.notEqual(normal1.cookie,normal2.cookie,'multi-device sessions must coexist');
response=await call('/api/v2/student/home',{cookie:normal1.cookie});assert.equal(response.status,200,'first session must remain valid after second login');const normalHome=await json(response),normalViews=new Set(normalHome.views.map(x=>x.viewId));assert.ok(normalViews.has('maths-year6'));assert.ok(normalViews.has('english-year6'));

const ordinary=await lesson(normal1.cookie,selected.ordinary,'maths-year6');assert.equal(ordinary.resourcesIncluded,true);const ordinaryHomework=ordinary.resources.find(x=>x.type==='homework'),ordinaryAnswer=ordinary.resources.find(x=>x.type==='answer-pack');assert.ok(ordinaryHomework&&ordinaryAnswer);const ordinaryBytes=await openOrdinary(normal1.cookie,selected.ordinary,'maths-year6',ordinaryHomework);
response=await call(`/api/v2/student/lessons/${encodeURIComponent(selected.ordinary)}/resources/${encodeURIComponent(ordinaryAnswer.resourceId)}/open?viewId=maths-year6`,{cookie:normal1.cookie});assert.equal(response.status,405);
response=await call(`/api/v2/student/lessons/${encodeURIComponent(selected.ordinary)}/resources/${encodeURIComponent(ordinaryAnswer.resourceId)}/open?viewId=maths-year6`,{method:'POST',cookie:normal1.cookie,json:{password:'B9ad'}});assert.equal(response.status,401);
response=await call(`/api/v2/student/lessons/${encodeURIComponent(selected.ordinary)}/resources/${encodeURIComponent(ordinaryAnswer.resourceId)}/open?viewId=maths-year6`,{method:'POST',cookie:normal1.cookie,json:{password:answerPassword}});assert.equal(response.status,200);let body=await json(response);assert.ok(body.viewerUrl?.startsWith('/api/v2/student/resource?'));response=await call(body.viewerUrl,{cookie:normal1.cookie});assert.equal(response.status,200);assert.match(response.headers.get('content-disposition')||'',/^inline/i);assert.ok((await response.arrayBuffer()).byteLength>0);

const sats=await lesson(normal1.cookie,selected.sats,'maths-year6');assert.ok(sats.resources.some(x=>x.type==='homework'));
const l2=await login('cp9l2');response=await call('/api/v2/student/home',{cookie:l2.cookie});body=await json(response);assert.ok(body.views.some(x=>x.viewId==='maths-level2'&&x.group==='current'));
const cumulative=await lesson(l2.cookie,selected.cumulative,'maths-level2');assert.ok(cumulative.resources.some(x=>x.type==='cumulative-homework'),'L2 cumulative Homework must be exposed with its canonical resource type');assert.ok(cumulative.resources.some(x=>x.type==='answer-pack'&&x.protected===true),'L2 cumulative Answer Pack must remain protected');
const blocked=await lesson(l2.cookie,selected.blocked,'maths-level2');assert.equal(blocked.resourcesIncluded,false,'blocked lesson must not reveal resource detail');assert.deepEqual(blocked.resources,[]);

const l3=await login('cp9l3');const l3Lesson=await lesson(l3.cookie,selected.l3,'maths-level3'),l3Video=l3Lesson.resources.find(x=>x.type==='video');assert.ok(l3Video,'L3 must expose its authorised Lesson Video slot');response=await call(`/api/v2/student/lessons/${encodeURIComponent(selected.l3)}/resources/${encodeURIComponent(l3Video.resourceId)}/open?viewId=maths-level3`,{cookie:l3.cookie});assert.equal(response.status,302);let location=response.headers.get('location');assert.ok(location?.startsWith('/api/v2/student/resource?'));response=await call(location,{cookie:l3.cookie});assert.equal(response.status,302);assert.match(response.headers.get('location')||'',/^https:\/\/go\.screenpal\.com\/player\//i);

const history=await login('cp9history');response=await call('/api/v2/student/home',{cookie:history.cookie});body=await json(response);assert.ok(body.views.some(x=>x.viewId==='maths-level1'&&x.group==='previous'));assert.ok(body.views.some(x=>x.viewId==='maths-level2'&&x.group==='current'));assert.ok(body.views.some(x=>x.viewId==='english-year4'&&x.lockedPreview===true));assert.ok(body.views.some(x=>x.viewId==='maths-year3'),'guest/manual individual access must surface its exact presentation');

const pre=await login('cp9pre');response=await call('/api/v2/student/home',{cookie:pre.cookie});body=await json(response);assert.ok(body.views.some(x=>x.viewId==='english-year5'));const preLesson=await lesson(pre.cookie,selected.preOnly,'english-year5');assert.ok(preLesson.resources.length>0);assert.equal(preLesson.resources.every(x=>x.type==='prelesson'),true,'PreLesson-only persona must not discover Homework/Answer resources');

for(let i=0;i<10;i++){response=await call(`/api/v2/student/lessons/${encodeURIComponent(selected.ordinary)}/resources/${encodeURIComponent(ordinaryAnswer.resourceId)}/open?viewId=maths-year6`,{method:'POST',cookie:normal2.cookie,json:{password:'B9ad'}});assert.equal(response.status,401,`wrong Answer Pack attempt ${i+1} did not fail normally`);}
response=await call(`/api/v2/student/lessons/${encodeURIComponent(selected.ordinary)}/resources/${encodeURIComponent(ordinaryAnswer.resourceId)}/open?viewId=maths-year6`,{method:'POST',cookie:normal2.cookie,json:{password:answerPassword}});assert.equal(response.status,429,'Answer Pack rate limiter must block after ten failures');
response=await call('/api/v2/auth/logout',{method:'POST',cookie:normal1.cookie});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie')||'',/Max-Age=0/i);response=await call('/api/v2/student/home',{cookie:normal2.cookie});assert.equal(response.status,200,'logging out one device must not revoke another device session');

const summary={marker:'REBUILD_CHECKPOINT9_STAGING_UAT_PASS',environment:health.environment,productionTarget:health.productionTarget,multiDevice:true,normalNavigation:true,ordinaryResourceBytes:ordinaryBytes,answerPackProtected:true,answerRateLimit:true,sats:true,l2CumulativeHomework:true,l3VideoRedirect:true,history:true,lockedPreview:true,guestManual:true,preLessonOnly:true,l3CumulativePolicy:'content-state-not-prohibition',seedL3CurrentCumulativeCount:Number(seed.l3CurrentCumulativeCount||0)};
fs.writeFileSync('/tmp/checkpoint9-uat-summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
