import assert from 'node:assert/strict';
import fs from 'node:fs';
import studentWorker from '../rebuild/student/src/index.js';
import {
  MemoryStore,
  publishScopeAtomic,
  versionKey
} from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const scopeId = 'u-917b05289ef8fa1f2c7bb6369bff9cbd2a59cd3c';
const store = new MemoryStore();
const binding = { get: key => store.get(key) };
const env = {
  ENVIRONMENT: 'staging',
  DEPLOYMENT_IDENTITY: 'student-staging',
  STAGING_ACCESS_SCOPE_ID: scopeId,
  READ_MODELS_KV: binding
};

const lessons = [
  { lessonId:'Y5M01', displayLessonId:'Y5T1M01', title:'Full lesson', description:'full', order:1 },
  { lessonId:'Y5M02', displayLessonId:'Y5T1M02', title:'PreLesson lesson', description:'pre', order:2 },
  { lessonId:'Y5M03', displayLessonId:'Y5T1M03', title:'Blocked lesson', description:'blocked', order:3 }
];
const globalPayload = {
  schemaVersion:1,
  kind:'prepared-global-read-model',
  source:{ type:'synthetic-test', revision:'cp5' },
  navigation:[
    { viewId:'maths-year4', subject:'maths', label:'Year 4', rank:40, schoolYear:4, stream:'normal', lessonCount:1 },
    { viewId:'maths-year5', subject:'maths', label:'Year 5', rank:50, schoolYear:5, stream:'normal', lessonCount:3 },
    { viewId:'maths-level2', subject:'maths', label:'L2', rank:51, schoolYear:5, stream:'11plus', mathsLevel:2, lessonCount:3 }
  ],
  catalogues:{
    'maths-year4':{ viewId:'maths-year4', subject:'maths', label:'Year 4', rank:40, schoolYear:4, stream:'normal', lessonCount:1, lessons:[{lessonId:'Y4M01',displayLessonId:'Y4T1M01',title:'History',description:'history',order:1}] },
    'maths-year5':{ viewId:'maths-year5', subject:'maths', label:'Year 5', rank:50, schoolYear:5, stream:'normal', lessonCount:3, lessons },
    'maths-level2':{ viewId:'maths-level2', subject:'maths', label:'L2', rank:51, schoolYear:5, stream:'11plus', mathsLevel:2, lessonCount:3, lessons }
  },
  lessonToViews:{
    Y4M01:['maths-year4'],
    Y5M01:['maths-year5','maths-level2'],
    Y5M02:['maths-year5','maths-level2'],
    Y5M03:['maths-year5','maths-level2']
  },
  counts:{ 'maths-year4':1, 'maths-year5':3, 'maths-level2':3 }
};
const accessPayload = {
  schemaVersion:1,
  kind:'prepared-access-read-model',
  scopeId,
  snapshot:{
    schemaVersion:1,
    kind:'prepared-access-snapshot',
    asOfDate:'2026-09-13',
    account:{ firstName:'Checkpoint5', status:'active', expiresOn:null },
    views:[
      { viewId:'maths-year4', subject:'maths', label:'Year 4', current:false, group:'previous', lockedPreview:false, catalogueAvailable:true, visibleLessonCount:1, openLessonCount:0, lockedLessonCount:1 },
      { viewId:'maths-year5', subject:'maths', label:'Year 5', current:true, group:'current', lockedPreview:false, catalogueAvailable:true, visibleLessonCount:3, openLessonCount:2, lockedLessonCount:1 },
      { viewId:'maths-level2', subject:'maths', label:'L2', current:true, group:'current', lockedPreview:true, catalogueAvailable:true, visibleLessonCount:3, openLessonCount:0, lockedLessonCount:3, source:'configuredUpsell' }
    ],
    fullViewIds:[],
    specialAreas:['CP5_SYNTHETIC_AREA'],
    lessonAccess:{
      Y5M01:{ core:true, vr:false, preLessonOnly:false, blocked:false, sources:['earned'] },
      Y5M02:{ core:false, vr:false, preLessonOnly:true, blocked:false, sources:['online-prelesson'] },
      Y5M03:{ core:false, vr:false, preLessonOnly:false, blocked:true, sources:['earned'] }
    }
  }
};

const globalPublished = await publishScopeAtomic(store,{scope:'global',payload:globalPayload,version:'g-cp5-test'});
const accessV1 = await publishScopeAtomic(store,{scope:`access:${scopeId}`,payload:accessPayload,version:'a-cp5-v1'});
const accessV2Payload = structuredClone(accessPayload);
accessV2Payload.snapshot.account.firstName = 'Checkpoint5V2';
const accessV2 = await publishScopeAtomic(store,{scope:`access:${scopeId}`,payload:accessV2Payload,version:'a-cp5-v2'});

async function get(path) {
  const response = await studentWorker.fetch(new Request(`https://student.test${path}`), env);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

let result = await get('/health');
assert.equal(result.response.status,200);
assert.equal(result.body.checkpoint,5);
assert.equal(result.body.runtime,'student');
assert.equal(result.body.productionTarget,false);
assert.equal(result.body.preparedReadModels.kvBound,true);
assert.equal(result.body.preparedReadModels.d1Bound,false);
assert.equal(result.body.preparedReadModels.r2Bound,false);
assert.equal(result.body.preparedReadModels.productionStudentsKvBound,false);

result = await get('/read-models/status');
assert.equal(result.response.status,200);
assert.equal(result.body.global.version,globalPublished.version);
assert.equal(result.body.access.version,accessV2.version);
assert.equal(result.body.access.usedFallback,false);

result = await get('/api/v2/student/home');
assert.equal(result.response.status,200);
assert.equal(result.body.source,'prepared-access-read-model');
assert.equal(result.body.account.firstName,'Checkpoint5V2');
assert.equal(result.body.views.find(v=>v.viewId==='maths-year5').group,'current');
assert.equal(result.body.views.find(v=>v.viewId==='maths-year4').group,'previous');
assert.equal(result.body.views.find(v=>v.viewId==='maths-level2').lockedPreview,true);

result = await get('/api/v2/student/views/maths-year5/lessons');
assert.equal(result.response.status,200);
assert.equal(result.body.lessonCount,3);
const full = result.body.lessons.find(row=>row.lessonId==='Y5M01');
const pre = result.body.lessons.find(row=>row.lessonId==='Y5M02');
const blocked = result.body.lessons.find(row=>row.lessonId==='Y5M03');
assert.equal(full.open,true);
assert.equal(full.accessMode,'full');
assert.equal(pre.open,true);
assert.equal(pre.accessMode,'prelesson-only');
assert.equal(blocked.open,false);
assert.equal(blocked.locked,true);
assert.equal(blocked.blocked,true);

result = await get('/api/v2/student/views/maths-level2/lessons');
assert.equal(result.response.status,200);
assert.equal(result.body.view.lockedPreview,true);
assert.equal(result.body.lessons.every(row=>row.locked===true && row.open===false),true,'ordinary Year 5 access must not widen into L2 preview');

result = await get('/api/v2/student/lessons/Y5M01?viewId=maths-year5');
assert.equal(result.response.status,200);
assert.equal(result.body.lesson.open,true);
assert.equal(result.body.lesson.accessMode,'full');
assert.equal(result.body.resourcesIncluded,false);
assert.equal(Object.hasOwn(result.body.lesson,'objectKey'),false);

result = await get('/api/v2/student/lessons/Y5M01?viewId=maths-level2');
assert.equal(result.response.status,200);
assert.equal(result.body.lesson.locked,true);
assert.equal(result.body.lesson.open,false);

result = await get('/api/v2/student/views/maths-year5/special-areas');
assert.equal(result.response.status,200);
assert.deepEqual(result.body.specialAreas,['CP5_SYNTHETIC_AREA']);
result = await get('/api/v2/student/views/maths-level2/special-areas');
assert.equal(result.response.status,200);
assert.deepEqual(result.body.specialAreas,[]);

// Atomic read fallback: make the current access envelope unavailable. The student runtime must
// resolve the verified previous version rather than querying legacy entitlement stores.
store.hide(versionKey(`access:${scopeId}`, accessV2.version));
result = await get('/api/v2/student/home');
assert.equal(result.response.status,200);
assert.equal(result.body.modelVersion,accessV1.version);
assert.equal(result.body.usedFallback,true);
assert.equal(result.body.account.firstName,'Checkpoint5');
store.show(versionKey(`access:${scopeId}`, accessV2.version));

const workerSource = fs.readFileSync(new URL('../rebuild/student/src/index.js', import.meta.url),'utf8');
const resolverSource = fs.readFileSync(new URL('../rebuild/student/src/lib/read-model-resolver.mjs', import.meta.url),'utf8');
for (const forbidden of ['STUDENTS_KV','LESSONS_KV','MATERIALS_R2','DB.prepare','student_batch_assignments','lesson_entitlements']) {
  assert.equal(workerSource.includes(forbidden),false,`student hot-read runtime must not reference ${forbidden}`);
}
assert.equal(/\.put\s*\(/.test(resolverSource),false,'student read-model resolver must not write KV');

console.log(JSON.stringify({
  marker:'REBUILD_CHECKPOINT5_STUDENT_READ_RUNTIME_PASS',
  checkpoint:5,
  hotReadsFromPreparedModels:true,
  directEntitlementQueries:false,
  d1RuntimeQueries:false,
  r2RuntimeQueries:false,
  fullRelease:true,
  prelessonOnly:true,
  blockedOverride:true,
  lockedPreviewNoWidening:true,
  atomicFallback:true,
  resourcesDeferred:true
}));
