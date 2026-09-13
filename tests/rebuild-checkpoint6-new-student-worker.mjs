import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStudentRuntime } from '../rebuild/student/src/lib/runtime.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { pointerKey, versionKey, sha256Hex, stableStringify } from '../rebuild/student/src/lib/read-model-resolver.mjs';
import { compileVideoVariants, videoForView } from '../rebuild/shared/read-models/video.mjs';

const AUTH_SECRET='checkpoint6-auth-signing-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const SCOPE_SECRET='checkpoint6-access-scope-secret-not-public';
const USER='syntheticcp6';
const LOGIN_PASSWORD='L9in';
let clock=Date.parse('2026-09-13T15:00:00Z');

class KV {
  constructor(){this.values=new Map();this.gets=[];}
  async get(key,options){this.gets.push(key);const value=this.values.get(key)??null;if(options?.type==='json'&&typeof value==='string')return JSON.parse(value);return value;}
  putRaw(key,value){this.values.set(key,value);}
}
class StudentsKV {
  constructor(user){this.user=user;this.gets=[];}
  async get(key,options){this.gets.push(key);if(key!==`user:${USER}`)return null;return options?.type==='json'?structuredClone(this.user):JSON.stringify(this.user);}
}
class MockD1 {
  constructor(){this.rate=new Map();this.queries=[];}
  prepare(sql){
    const db=this;const text=String(sql);const state={args:[]};db.queries.push(text);
    return {bind(...args){state.args=args;return this;},async first(){const key=state.args[0];const row=db.rate.get(key);return row?{...row}:null;},async run(){
      const key=state.args[0];
      if(/INSERT INTO answer_password_rate_limits/i.test(text)){db.rate.set(key,{window_started_at:state.args[1],attempt_count:1});return{meta:{changes:1}};}
      if(/UPDATE answer_password_rate_limits/i.test(text)){const row=db.rate.get(key);if(row)row.attempt_count+=1;return{meta:{changes:row?1:0}};}
      if(/DELETE FROM answer_password_rate_limits/i.test(text)){const changed=db.rate.delete(key);return{meta:{changes:changed?1:0}};}
      throw new Error(`Unexpected D1 write: ${text}`);
    }};
  }
}
class R2 {
  constructor(){this.gets=[];this.objects=new Map([
    ['maths/M1/pre.pdf','PRE'],['maths/M1/homework.pdf','HOMEWORK'],['maths/M1/answer.pdf','ANSWER'],['maths/P1/pre.pdf','P1PRE'],['maths/P1/homework.pdf','P1HOMEWORK']
  ]);}
  async get(key){this.gets.push(key);if(!this.objects.has(key))return null;const value=this.objects.get(key);return{body:value,writeHttpMetadata(headers){headers.set('content-type','application/pdf');}};}
}

const kv=new KV();
async function publish(scope,payload,version){
  const sha256=await sha256Hex(stableStringify(payload));
  const envelope={schemaVersion:1,kind:'prepared-read-model-envelope',scope,version,sha256,payload};
  kv.putRaw(versionKey(scope,version),JSON.stringify(envelope));
  kv.putRaw(pointerKey(scope),JSON.stringify({schemaVersion:1,kind:'prepared-read-model-pointer',scope,current:{version,sha256},previous:null}));
}

const compiledVideos=compileVideoVariants({video:{embedUrl:'https://go.screenpal.com/player/normal-shape',quiz:{embedUrl:'https://go.screenpal.com/player/quiz-shape'}}});
assert.equal(videoForView(compiledVideos,'maths-year6').targetUrl,'https://go.screenpal.com/player/normal-shape');
assert.equal(videoForView(compiledVideos,'maths-level3').targetUrl,'https://go.screenpal.com/player/quiz-shape');
assert.equal(compileVideoVariants({video:{embedUrl:'https://evil.example/player/nope'}}),null);

const scopeId=await opaqueAccessScopeId(USER,SCOPE_SECRET);
assert.match(scopeId,/^u-[a-f0-9]{40}$/);
assert.equal(scopeId.includes(USER),false);

const lesson=(lessonId,title,order=1)=>({lessonId,displayLessonId:lessonId,title,description:'',order});
const global={schemaVersion:1,kind:'prepared-global-read-model',source:{type:'cp6-test',revision:'1'},navigation:[],catalogues:{
  'maths-year6':{viewId:'maths-year6',subject:'maths',label:'Year 6',rank:1,schoolYear:6,stream:'normal',lessonCount:2,lessons:[lesson('M1','Ratio'),lesson('P1','Online PreLesson',2)]},
  'maths-level3':{viewId:'maths-level3',subject:'maths',label:'L3',rank:2,schoolYear:6,stream:'11plus',mathsLevel:3,lessonCount:1,lessons:[lesson('L3A','Algebra')]},
  'english-year6':{viewId:'english-year6',subject:'english',label:'Year 6',rank:3,schoolYear:6,stream:'normal',lessonCount:1,lessons:[lesson('E1','Grammar')]},
  'maths-level2':{viewId:'maths-level2',subject:'maths',label:'L2',rank:4,schoolYear:5,stream:'11plus',mathsLevel:2,lessonCount:1,lessons:[lesson('LOCK','Locked Preview')]}
},lessonToViews:{M1:['maths-year6'],P1:['maths-year6'],L3A:['maths-level3'],E1:['english-year6'],LOCK:['maths-level2']},counts:{'maths-year6':2,'maths-level3':1,'english-year6':1,'maths-level2':1}};
global.navigation=Object.values(global.catalogues).map(({lessons,...rest})=>rest);
const accessPayload=(versionTag='1',accountOverride={})=>({schemaVersion:1,kind:'prepared-access-read-model',scopeId,snapshot:{schemaVersion:1,kind:'prepared-access-snapshot',asOfDate:'2026-09-13',account:{firstName:'Synthetic',status:'active',expiresOn:null,...accountOverride},views:[
  {viewId:'maths-year6',subject:'maths',label:'Year 6',current:true,group:'current',lockedPreview:false,catalogueAvailable:true,visibleLessonCount:2,openLessonCount:2,lockedLessonCount:0},
  {viewId:'maths-level3',subject:'maths',label:'L3',current:true,group:'current',lockedPreview:false,catalogueAvailable:true,visibleLessonCount:1,openLessonCount:1,lockedLessonCount:0},
  {viewId:'english-year6',subject:'english',label:'Year 6',current:true,group:'current',lockedPreview:false,catalogueAvailable:true,visibleLessonCount:1,openLessonCount:1,lockedLessonCount:0},
  {viewId:'maths-level2',subject:'maths',label:'L2',current:true,group:'current',lockedPreview:true,catalogueAvailable:true,visibleLessonCount:1,openLessonCount:0,lockedLessonCount:1,source:'configuredUpsell'}
],fullViewIds:[],specialAreas:[],lessonAccess:{M1:{core:true,vr:false,preLessonOnly:false,blocked:false,sources:['earned']},P1:{core:false,vr:false,preLessonOnly:true,blocked:false,sources:['online-prelesson']},L3A:{core:true,vr:false,preLessonOnly:false,blocked:false,sources:['earned']},E1:{core:true,vr:false,preLessonOnly:false,blocked:false,sources:['earned']}},testVersionTag:versionTag}});

await publish('global',global,'g-1');
await publish(`access:${scopeId}`,accessPayload(),'a-1');
await publish('lesson:M1',{schemaVersion:1,kind:'prepared-lesson-detail',lessonId:'M1',title:'Ratio',description:'',resourceCount:4,videoVariants:{normal:{displayName:'Lesson Video',targetUrl:'https://go.screenpal.com/player/normal-m1'},elevenPlus:{displayName:'Lesson Video',targetUrl:'https://go.screenpal.com/player/quiz-m1'}},resources:[
  {type:'prelesson',displayName:'PreLesson Sheet',objectKey:'maths/M1/pre.pdf'},
  {type:'homework',displayName:'Homework',objectKey:'maths/M1/homework.pdf'},
  {type:'answer-pack',displayName:'Answer Pack',objectKey:'maths/M1/answer.pdf',protected:true}
]},'l-m1');
await publish('lesson:P1',{schemaVersion:1,kind:'prepared-lesson-detail',lessonId:'P1',title:'Online PreLesson',description:'',resourceCount:2,resources:[
  {type:'prelesson',displayName:'PreLesson Sheet',objectKey:'maths/P1/pre.pdf'},
  {type:'homework',displayName:'Homework',objectKey:'maths/P1/homework.pdf'}
]},'l-p1');
await publish('lesson:L3A',{schemaVersion:1,kind:'prepared-lesson-detail',lessonId:'L3A',title:'Algebra',description:'',resourceCount:1,videoVariants:{normal:{displayName:'Lesson Video',targetUrl:'https://go.screenpal.com/player/normal-l3'},elevenPlus:{displayName:'Lesson Video',targetUrl:'https://go.screenpal.com/player/quiz-l3'}},resources:[]},'l-l3');
await publish('lesson:E1',{schemaVersion:1,kind:'prepared-lesson-detail',lessonId:'E1',title:'Grammar',description:'',resourceCount:0,resources:[]},'l-e1');

const students=new StudentsKV({p:LOGIN_PASSWORD,answerPassword:'P9ck',status:'active',expires:'2027-08-31'});
const db=new MockD1();
const r2=new R2();
const runtime=createStudentRuntime({now:()=>clock});
const origin='https://student.example';
const env={ENVIRONMENT:'development',DEV_LOGIN_ALLOWLIST:USER,ALLOWED_ORIGINS:origin,READ_MODELS_KV:kv,STUDENTS_KV:students,DB:db,MATERIALS_R2:r2,AUTH_SIGNING_SECRET:AUTH_SECRET,ACCESS_SCOPE_SECRET:SCOPE_SECRET};
async function call(path,{method='GET',cookie='',json,requestOrigin=origin}={}){const headers={origin:requestOrigin};if(cookie)headers.cookie=cookie;if(json!==undefined)headers['content-type']='application/json';return runtime.fetch(new Request(new URL(path,origin),{method,headers,body:json===undefined?undefined:JSON.stringify(json),redirect:'manual'}),env);}
function cookieFrom(response){return String(response.headers.get('set-cookie')||'').split(';')[0];}

let res=await call('/api/v2/auth/login',{method:'POST',json:{username:USER,password:LOGIN_PASSWORD},requestOrigin:'https://evil.example'});assert.equal(res.status,403);
res=await call('/api/v2/auth/login',{method:'OPTIONS'});assert.equal(res.status,204);assert.equal(res.headers.get('access-control-allow-origin'),origin);
res=await call('/api/v2/auth/login',{method:'POST',json:{username:USER,password:'X9no'}});assert.equal(res.status,401);
res=await call('/api/v2/auth/login',{method:'POST',json:{username:USER,password:LOGIN_PASSWORD}});assert.equal(res.status,200);const cookie1=cookieFrom(res);assert.match(cookie1,/^fpt_session=/);assert.match(res.headers.get('set-cookie'),/HttpOnly/);assert.match(res.headers.get('set-cookie'),/Secure/);assert.equal(res.headers.get('access-control-allow-origin'),origin);
let body=await res.json();assert.equal(body.modelVersion,'a-1');
const d1AfterLogin=db.queries.length;

res=await call('/api/v2/student/home');assert.equal(res.status,401);
res=await call('/api/v2/student/home',{cookie:cookie1});assert.equal(res.status,200);body=await res.json();assert.equal(body.views.length,4);
res=await call('/api/v2/student/subjects/maths',{cookie:cookie1});body=await res.json();assert.equal(res.status,200);assert.equal(body.views.length,3);assert.ok(body.views.some(v=>v.viewId==='maths-level3'));
res=await call('/api/v2/student/subjects/english',{cookie:cookie1});body=await res.json();assert.equal(body.views.length,1);
res=await call('/api/v2/student/views/maths-year6/lessons',{cookie:cookie1});body=await res.json();assert.equal(res.status,200);assert.equal(body.lessons.length,2);
assert.equal(db.queries.length,d1AfterLogin,'Ordinary navigation must not query D1.');

const r2BeforeLesson=r2.gets.length;
res=await call('/api/v2/student/lessons/M1?viewId=maths-year6',{cookie:cookie1});body=await res.json();assert.equal(res.status,200);assert.equal(body.resourcesIncluded,true);assert.equal(body.resources.length,4);assert.equal(JSON.stringify(body).includes('objectKey'),false);assert.equal(JSON.stringify(body).includes('targetUrl'),false);assert.equal(JSON.stringify(body).includes('maths/M1'),false);assert.equal(r2.gets.length,r2BeforeLesson,'Lesson detail must not probe R2.');
const video=body.resources.find(r=>r.type==='video'),homework=body.resources.find(r=>r.type==='homework'),answer=body.resources.find(r=>r.type==='answer-pack');assert.ok(video&&homework&&answer);

res=await call(`/api/v2/student/lessons/M1/resources/${video.resourceId}/open?viewId=maths-year6`,{cookie:cookie1});assert.equal(res.status,302);let location=res.headers.get('location');assert.match(location,/\/api\/v2\/student\/resource\?/);res=await call(location,{cookie:cookie1});assert.equal(res.status,302);assert.equal(res.headers.get('location'),'https://go.screenpal.com/player/normal-m1');
res=await call('/api/v2/student/lessons/L3A?viewId=maths-level3',{cookie:cookie1});body=await res.json();const l3video=body.resources.find(r=>r.type==='video');assert.ok(l3video);res=await call(`/api/v2/student/lessons/L3A/resources/${l3video.resourceId}/open?viewId=maths-level3`,{cookie:cookie1});location=res.headers.get('location');res=await call(location,{cookie:cookie1});assert.equal(res.headers.get('location'),'https://go.screenpal.com/player/quiz-l3');

res=await call(`/api/v2/student/lessons/M1/resources/${homework.resourceId}/open?viewId=maths-year6`,{cookie:cookie1});assert.equal(res.status,302);const homeworkCapabilityUrl=res.headers.get('location');res=await call(homeworkCapabilityUrl,{cookie:cookie1});assert.equal(res.status,200);assert.equal(await res.text(),'HOMEWORK');assert.match(res.headers.get('content-disposition'),/^attachment/);

res=await call('/api/v2/auth/login',{method:'POST',json:{username:USER,password:LOGIN_PASSWORD}});assert.equal(res.status,200);const cookie2=cookieFrom(res);assert.notEqual(cookie1,cookie2);
res=await call(homeworkCapabilityUrl,{cookie:cookie2});assert.equal(res.status,401);
res=await call(homeworkCapabilityUrl,{cookie:cookie1});assert.equal(res.status,200);

res=await call(`/api/v2/student/lessons/M1/resources/${answer.resourceId}/open?viewId=maths-year6`,{cookie:cookie1});assert.equal(res.status,405);
res=await call(`/api/v2/student/lessons/M1/resources/${answer.resourceId}/open?viewId=maths-year6`,{method:'POST',cookie:cookie1,json:{}});assert.equal(res.status,400);
const studentGetsBeforeWrong=students.gets.length;
res=await call(`/api/v2/student/lessons/M1/resources/${answer.resourceId}/open?viewId=maths-year6`,{method:'POST',cookie:cookie1,json:{password:'B9ad'}});assert.equal(res.status,401);assert.ok(students.gets.length>studentGetsBeforeWrong);
res=await call(`/api/v2/student/lessons/M1/resources/${answer.resourceId}/open?viewId=maths-year6`,{method:'POST',cookie:cookie1,json:{password:'P9ck'}});assert.equal(res.status,200);body=await res.json();assert.match(body.viewerUrl,/\/api\/v2\/student\/resource\?/);const answerViewerUrl=body.viewerUrl;res=await call(answerViewerUrl,{cookie:cookie1});assert.equal(res.status,200);assert.equal(await res.text(),'ANSWER');assert.match(res.headers.get('content-disposition'),/^inline/);
students.user.answerPassword='N9ew';
res=await call(`/api/v2/student/lessons/M1/resources/${answer.resourceId}/open?viewId=maths-year6`,{method:'POST',cookie:cookie1,json:{password:'P9ck'}});assert.equal(res.status,401);
res=await call(`/api/v2/student/lessons/M1/resources/${answer.resourceId}/open?viewId=maths-year6`,{method:'POST',cookie:cookie1,json:{password:'N9ew'}});assert.equal(res.status,200);
for(let i=0;i<10;i++){res=await call(`/api/v2/student/lessons/M1/resources/${answer.resourceId}/open?viewId=maths-year6`,{method:'POST',cookie:cookie1,json:{password:'B9ad'}});assert.equal(res.status,401);}
const getsBeforeRateBlock=students.gets.length;
res=await call(`/api/v2/student/lessons/M1/resources/${answer.resourceId}/open?viewId=maths-year6`,{method:'POST',cookie:cookie1,json:{password:'N9ew'}});assert.equal(res.status,429);assert.equal(students.gets.length,getsBeforeRateBlock,'Rate limit must reject before live password validation.');

res=await call('/api/v2/student/lessons/P1?viewId=maths-year6',{cookie:cookie1});body=await res.json();assert.equal(body.resources.length,1);assert.equal(body.resources[0].type,'prelesson');
const guessedHomeworkId=`r-${(await sha256Hex('P1\nhomework\nmaths/P1/homework.pdf')).slice(0,32)}`;
res=await call(`/api/v2/student/lessons/P1/resources/${guessedHomeworkId}/open?viewId=maths-year6`,{cookie:cookie1});assert.equal(res.status,404);

const beforeGets=kv.gets.length;res=await call('/api/v2/student/lessons/LOCK?viewId=maths-level2',{cookie:cookie1});body=await res.json();assert.equal(res.status,200);assert.equal(body.resourcesIncluded,false);assert.deepEqual(body.resources,[]);const lockedGets=kv.gets.slice(beforeGets);assert.equal(lockedGets.some(key=>key.includes('lesson_3ALOCK')||key.includes('lesson:LOCK')),false);

res=await call(`/api/v2/student/lessons/M1/resources/${homework.resourceId}/open?viewId=maths-year6`,{cookie:cookie1});assert.equal(res.status,302);const oldCapUrl=res.headers.get('location');await publish(`access:${scopeId}`,accessPayload('2'),'a-2');res=await call(oldCapUrl,{cookie:cookie1});assert.equal(res.status,401);

res=await call('/api/v2/auth/logout',{method:'POST',cookie:cookie1});assert.equal(res.status,200);assert.match(res.headers.get('set-cookie'),/Max-Age=0/);res=await call('/api/v2/student/home',{cookie:cookie2});assert.equal(res.status,200);

const studentGetsBeforeLock=students.gets.length;
await publish(`access:${scopeId}`,accessPayload('3',{status:'inactive'}),'a-3');
res=await call('/api/v2/student/home',{cookie:cookie2});assert.equal(res.status,200);body=await res.json();assert.equal(body.accountLocked,true);assert.deepEqual(body.views,[]);
res=await call('/api/v2/student/subjects/maths',{cookie:cookie2});assert.equal(res.status,403);body=await res.json();assert.equal(body.error,'ACCOUNT_LOCKED');
res=await call('/api/v2/student/lessons/M1?viewId=maths-year6',{cookie:cookie2});assert.equal(res.status,403);
assert.equal(students.gets.length,studentGetsBeforeLock,'Prepared account lock must not add a live student-store lookup to ordinary navigation.');

const runtimeSource=['../rebuild/student/src/index.js','../rebuild/student/src/lib/runtime.mjs','../rebuild/student/src/lib/access-scope.mjs','../rebuild/student/src/lib/read-model-resolver.mjs','../rebuild/shared/read-models/video.mjs'].map(p=>fs.readFileSync(new URL(p,import.meta.url),'utf8')).join('\n');
for(const forbidden of ['LESSONS_KV','student_sessions','student_session_profiles','student_batch_assignments','lesson_entitlements','last_activity_at','idle_expires_at','touchSession','.head(','phase11-home-readiness','IDENTITY_SERVICE','ANSWER_PACK_AUTH_SERVICE','VIDEO_REDIRECT_SERVICE'])assert.equal(runtimeSource.includes(forbidden),false,`Forbidden runtime construct: ${forbidden}`);
assert.equal(/fetch\([^)]*\/api\/v2\/student\//.test(runtimeSource),false,'Student routes must not redispatch internally to other student HTTP endpoints.');
const adapterSource=fs.readFileSync(new URL('../rebuild/student/src/lib/runtime-adapters.mjs',import.meta.url),'utf8');
for(const forbidden of ['student_sessions','student_session_profiles','student_batch_assignments','lesson_entitlements','last_activity_at','idle_expires_at','LESSONS_KV','.head(','IDENTITY_SERVICE','ANSWER_PACK_AUTH_SERVICE','VIDEO_REDIRECT_SERVICE'])assert.equal(adapterSource.includes(forbidden),false,`Forbidden adapter construct: ${forbidden}`);
assert.match(adapterSource,/STUDENTS_KV/);assert.match(adapterSource,/answer_password_rate_limits/);
assert.ok(db.queries.every(sql=>/answer_password_rate_limits/i.test(sql)),'D1 must be used only for Answer Pack rate limiting in CP6 runtime.');

console.log(JSON.stringify({marker:'REBUILD_CHECKPOINT6_NEW_STUDENT_WORKER_PASS',login:true,subjects:true,yearLevel:true,lesson:true,videoCapabilityAndDirectScreenPalRedirect:true,ordinaryDirectCapability:true,answerPackLivePasswordAndRateLimit:true,preparedAccountLock:true,prelessonIsolation:true,lockedPreviewNoDetailRead:true,accessVersionRevocation:true,multiDevice:true,corsOriginGate:true,legacyPhaseWorkersUsed:false,d1SessionLookup:false,activityWrites:false,r2HeadFanout:false}));
