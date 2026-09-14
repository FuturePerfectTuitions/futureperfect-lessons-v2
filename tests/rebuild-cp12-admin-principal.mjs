import assert from 'node:assert/strict';
import { createStudentRuntime } from '../rebuild/student/src/lib/runtime.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { pointerKey, versionKey, sha256Hex, stableStringify } from '../rebuild/student/src/lib/read-model-resolver.mjs';

const AUTH_SECRET='cp12-admin-auth-signing-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const SCOPE_SECRET='cp12-admin-access-scope-secret-not-public';
const ORIGIN='https://student.example';
const ADMIN_PASSWORD='A9bc';
const STUDENT='pupilcp12';
const STUDENT_PASSWORD='P8il';
const NOW=Date.parse('2026-09-14T11:30:00Z');

class KV {
  constructor(){this.values=new Map();this.gets=[];}
  async get(key,options){
    this.gets.push(key);
    const value=this.values.get(key)??null;
    if(options?.type==='json'&&typeof value==='string')return JSON.parse(value);
    return value;
  }
  putRaw(key,value){this.values.set(key,value);}
}

class StudentsKV {
  constructor(users){this.users=users;this.gets=[];}
  async get(key,options){
    this.gets.push(key);
    const userId=String(key||'').replace(/^user:/,'');
    const user=this.users[userId];
    if(!user)return null;
    return options?.type==='json'?structuredClone(user):JSON.stringify(user);
  }
}

class MockD1 {
  constructor(){this.queries=[];}
  prepare(sql){
    this.queries.push(String(sql));
    return {
      bind(){return this;},
      async first(){return null;},
      async run(){return {meta:{changes:0}};}
    };
  }
}

const kv=new KV();

async function publish(scope,payload,version){
  const sha256=await sha256Hex(stableStringify(payload));
  const envelope={schemaVersion:1,kind:'prepared-read-model-envelope',scope,version,sha256,payload};
  kv.putRaw(versionKey(scope,version),JSON.stringify(envelope));
  kv.putRaw(pointerKey(scope),JSON.stringify({
    schemaVersion:1,
    kind:'prepared-read-model-pointer',
    scope,
    current:{version,sha256},
    previous:null
  }));
}

const lesson={lessonId:'M1',displayLessonId:'Y6M01',title:'Ratio',description:'',order:1};
const global={
  schemaVersion:1,
  kind:'prepared-global-read-model',
  source:{type:'cp12-admin-incident-test',revision:'1'},
  navigation:[
    {viewId:'maths-year6',subject:'maths',label:'Year 6',rank:60,schoolYear:6,stream:'normal',lessonCount:1},
    {viewId:'maths-level3',subject:'maths',label:'L3',rank:61,schoolYear:6,stream:'11plus',mathsLevel:3,lessonCount:1},
    {viewId:'english-year6',subject:'english',label:'Year 6',rank:60,schoolYear:6,stream:'normal',lessonCount:0}
  ],
  catalogues:{
    'maths-year6':{viewId:'maths-year6',subject:'maths',label:'Year 6',rank:60,schoolYear:6,stream:'normal',lessonCount:1,lessons:[lesson]},
    'maths-level3':{viewId:'maths-level3',subject:'maths',label:'L3',rank:61,schoolYear:6,stream:'11plus',mathsLevel:3,lessonCount:1,lessons:[lesson]},
    'english-year6':{viewId:'english-year6',subject:'english',label:'Year 6',rank:60,schoolYear:6,stream:'normal',lessonCount:0,lessons:[]}
  },
  lessonToViews:{M1:['maths-year6','maths-level3']},
  counts:{'maths-year6':1,'maths-level3':1,'english-year6':0}
};

await publish('global',global,'g-1');
await publish('lesson:M1',{
  schemaVersion:1,
  kind:'prepared-lesson-detail',
  lessonId:'M1',
  title:'Ratio',
  description:'',
  resourceCount:2,
  resources:[
    {type:'homework',displayName:'Homework',objectKey:'maths/M1/homework.pdf'},
    {type:'answer-pack',displayName:'Answer Pack',objectKey:'maths/M1/answer.pdf',protected:true}
  ]
},'l-1');

const studentScopeId=await opaqueAccessScopeId(STUDENT,SCOPE_SECRET);
await publish(`access:${studentScopeId}`,{
  schemaVersion:1,
  kind:'prepared-access-read-model',
  scopeId:studentScopeId,
  snapshot:{
    schemaVersion:1,
    kind:'prepared-access-snapshot',
    asOfDate:'2026-09-14',
    account:{firstName:'Pupil',status:'active',expiresOn:null},
    views:[{
      viewId:'maths-year6',
      subject:'maths',
      label:'Year 6',
      current:true,
      group:'current',
      lockedPreview:false,
      catalogueAvailable:true,
      visibleLessonCount:1,
      openLessonCount:1,
      lockedLessonCount:0
    }],
    fullViewIds:[],
    specialAreas:[],
    lessonAccess:{M1:{core:true,vr:false,preLessonOnly:false,blocked:false,sources:['earned']}}
  }
},'a-1');

const students=new StudentsKV({
  admin:{p:ADMIN_PASSWORD,answerPassword:'Q7rs',status:'active',expires:'2027-08-31'},
  [STUDENT]:{p:STUDENT_PASSWORD,answerPassword:'R6dy',status:'active',expires:'2027-08-31'}
});
const db=new MockD1();
const runtime=createStudentRuntime({now:()=>NOW});
const env={
  ENVIRONMENT:'development',
  DEV_LOGIN_ALLOWLIST:`admin,${STUDENT}`,
  ALLOWED_ORIGINS:ORIGIN,
  READ_MODELS_KV:kv,
  STUDENTS_KV:students,
  DB:db,
  AUTH_SIGNING_SECRET:AUTH_SECRET,
  ACCESS_SCOPE_SECRET:SCOPE_SECRET
};

async function call(path,{method='GET',cookie='',json}={}){
  const headers={origin:ORIGIN};
  if(cookie)headers.cookie=cookie;
  if(json!==undefined)headers['content-type']='application/json';
  return runtime.fetch(new Request(new URL(path,ORIGIN),{
    method,
    headers,
    body:json===undefined?undefined:JSON.stringify(json),
    redirect:'manual'
  }),env);
}

function cookieFrom(response){
  return String(response.headers.get('set-cookie')||'').split(';')[0];
}

kv.gets.length=0;
let res=await call('/api/v2/auth/login',{method:'POST',json:{username:'admin',password:ADMIN_PASSWORD}});
assert.equal(res.status,200);
let body=await res.json();
assert.equal(body.principal,'admin');
assert.equal(body.account?.role,'admin');
assert.equal(body.accountLocked,false);
assert.match(res.headers.get('set-cookie'),/HttpOnly/);
assert.deepEqual(kv.gets,[],'Admin login must not resolve a pupil access pointer or global catalogue.');
const adminCookie=cookieFrom(res);
assert.match(adminCookie,/^fpt_session=/);

kv.gets.length=0;
res=await call('/api/v2/student/home',{cookie:adminCookie});
assert.equal(res.status,200);
body=await res.json();
assert.equal(body.source,'prepared-global-read-model');
assert.equal(body.role,'admin');
assert.equal(body.superuser,true);
assert.equal(body.views.length,3);
assert.ok(body.views.every(view=>view.current===true&&view.lockedPreview===false));
assert.ok(body.views.every(view=>view.openLessonCount===view.visibleLessonCount&&view.lockedLessonCount===0));
assert.equal(kv.gets.some(key=>String(key).includes('access:')),false,'Admin Home must not read a pupil access scope.');

res=await call('/api/v2/student/subjects/maths',{cookie:adminCookie});
assert.equal(res.status,200);
body=await res.json();
assert.equal(body.views.length,2);
assert.ok(body.views.some(view=>view.viewId==='maths-year6'));
assert.ok(body.views.some(view=>view.viewId==='maths-level3'));

res=await call('/api/v2/student/views/maths-year6/lessons',{cookie:adminCookie});
assert.equal(res.status,200);
body=await res.json();
assert.equal(body.lessonCount,1);
assert.equal(body.lessons[0].open,true);
assert.equal(body.lessons[0].accessMode,'full');

res=await call('/api/v2/student/lessons/M1?viewId=maths-year6',{cookie:adminCookie});
assert.equal(res.status,200);
body=await res.json();
assert.equal(body.lesson.open,true);
assert.equal(body.lesson.accessMode,'full');
const answer=body.resources.find(resource=>resource.type==='answer-pack');
assert.ok(answer);
assert.equal(answer.protected,true,'Admin must not bypass protected Answer Pack semantics.');

res=await call(`/api/v2/student/lessons/M1/resources/${answer.resourceId}/open?viewId=maths-year6`,{cookie:adminCookie});
assert.equal(res.status,405);
body=await res.json();
assert.equal(body.error,'ANSWER_PASSWORD_REQUIRED');

const tampered=`${adminCookie.slice(0,-1)}${adminCookie.endsWith('a')?'b':'a'}`;
res=await call('/api/v2/student/home',{cookie:tampered});
assert.equal(res.status,401,'Admin authority must remain bound to the signed session identity.');

kv.gets.length=0;
res=await call('/api/v2/auth/login',{method:'POST',json:{username:STUDENT,password:STUDENT_PASSWORD}});
assert.equal(res.status,200);
body=await res.json();
assert.equal(body.modelVersion,'a-1');
assert.ok(kv.gets.some(key=>String(key).includes('access:')),'Ordinary student login must retain prepared access-snapshot resolution.');
const studentCookie=cookieFrom(res);

kv.gets.length=0;
res=await call('/api/v2/student/home',{cookie:studentCookie});
assert.equal(res.status,200);
body=await res.json();
assert.equal(body.source,'prepared-access-read-model');
assert.equal(body.views.length,1);
assert.equal(body.views[0].viewId,'maths-year6');
assert.ok(kv.gets.some(key=>String(key).includes('access:')),'Ordinary student Home must retain the existing access-snapshot path.');
assert.equal(db.queries.length,0,'Admin/student navigation must not introduce D1 traffic.');

console.log(JSON.stringify({
  marker:'REBUILD_CP12_ADMIN_PRINCIPAL_INCIDENT_VALIDATION_PASS',
  adminLoginWithoutPupilSnapshot:true,
  signedAdminIdentity:true,
  adminHomeFromPreparedGlobal:true,
  adminFullLibraryNavigation:true,
  adminProtectedAnswerPackPreserved:true,
  ordinaryStudentPathPreserved:true,
  addedNavigationD1Reads:0
}));
