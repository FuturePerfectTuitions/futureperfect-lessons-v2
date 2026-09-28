import assert from 'node:assert/strict';
import {
  compileAuthoritativeAccessScope
} from '../worker/src/access-read-model-sync-v2.js';
import {
  globalToCatalogue
} from '../worker/src/access-read-model-sync.js';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const studentsKv = 'c9723c8806334e4ea54d1b456d31b794';
const readModelsKv = '77b35165c8694087bc1b0515c35a7e89';
const db = '97250a54-fa91-45ad-a002-3c4566b1fc38';
const userId = 'aar1811';
const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const headers = { Authorization:`Bearer ${token}` };
const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

async function kvGet(ns,key){
  const r=await fetch(`${api}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{headers});
  if(!r.ok) throw new Error(`KV_GET_${r.status}:${key}`);
  return r.text();
}
async function d1(sql,params=[]){
  const r=await fetch(`${api}/d1/database/${db}/query`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({sql,params})});
  const body=await r.json();
  if(!r.ok||body.success!==true) throw new Error(`D1_QUERY_FAILED:${r.status}:${JSON.stringify(body.errors||body)}`);
  return body.result?.[0]?.results||[];
}
const user=JSON.parse(await kvGet(studentsKv,`user:${userId}`));
assert.equal(String(user.portalUserId||'').toLowerCase(),userId);

const definitions=await d1(`SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions`);
const assignments=await d1(`SELECT a.assignment_id,a.portal_user_id_norm,a.batch_key,a.effective_from,a.effective_to,b.subject,b.school_year,b.stream,b.maths_level,b.active_from AS batch_active_from,b.active_to AS batch_active_to FROM student_batch_assignments a LEFT JOIN batch_definitions b ON b.batch_key=a.batch_key WHERE a.portal_user_id_norm=? ORDER BY a.assignment_id`,[userId]);
const entitlements=await d1(`SELECT portal_user_id_norm,lesson_id,core_access,vr_access,source,first_granted_at,last_confirmed_at,source_batch_code,source_lesson_date FROM lesson_entitlements WHERE portal_user_id_norm=? ORDER BY lesson_id`,[userId]);
const preLesson=await d1(`SELECT portal_user_id_norm,lesson_id,batch_key,lesson_date,vr_access,source_row_id,first_granted_at,last_confirmed_at FROM online_prelesson_entitlements WHERE portal_user_id_norm=? ORDER BY lesson_id`,[userId]);

const y6=assignments.filter(r=>r.batch_key==='Y611FM'&&!r.effective_to);
assert.equal(y6.length,1,'Expected exactly one active Aarav Y611FM assignment');
const l3def=definitions.find(r=>r.batch_key==='Y511FM');
assert.ok(l3def,'Y511FM definition missing');
assert.equal(String(l3def.subject).toLowerCase(),'maths');
assert.equal(String(l3def.stream).toLowerCase(),'11plus');
assert.equal(Number(l3def.maths_level),3);
const existingActiveL3=assignments.filter(r=>r.batch_key==='Y511FM'&&!r.effective_to);
assert.equal(existingActiveL3.length,0,'Aarav already has active Y511FM unexpectedly');

const full=(Array.isArray(user.fullLibraries)?user.fullLibraries:[]).map(String);
assert.ok(full.includes('MATHS_L1_FULL'),'L1 full library missing');
assert.ok(full.includes('MATHS_L2_FULL'),'L2 full library missing');
assert.ok(full.includes('MATHS_Y6_FULL'),'Expected current Year 6 full-library alias');
const targetFull=[...new Set(full.filter(x=>x!=='MATHS_Y6_FULL').concat('MATHS_L3_FULL'))];
const targetUser={...user,fullLibraries:targetFull};

const targetAssignments=assignments.map(r=>r.assignment_id===y6[0].assignment_id?{...r,effective_to:today}:{...r});
targetAssignments.push({
  assignment_id:999999999,
  portal_user_id_norm:userId,
  batch_key:'Y511FM',
  effective_from:today,
  effective_to:null,
  subject:l3def.subject,
  school_year:l3def.school_year,
  stream:l3def.stream,
  maths_level:l3def.maths_level,
  batch_active_from:l3def.active_from,
  batch_active_to:l3def.active_to
});

const pointer=JSON.parse(await kvGet(readModelsKv,'rm:v1:scope:global:current'));
assert.equal(pointer.kind,'prepared-read-model-pointer');
const version=pointer.current?.version;
assert.ok(version,'Global current version missing');
const envelope=JSON.parse(await kvGet(readModelsKv,`rm:v1:scope:global:version:${version}`));
const catalogue=globalToCatalogue(envelope.payload);
const payload=compileAuthoritativeAccessScope({
  asOfDate:today,
  user:targetUser,
  batchDefinitions:definitions,
  batchAssignments:targetAssignments,
  entitlements,
  onlinePreLessonEntitlements:preLesson
},catalogue,'aar1811-preflight',today);

const maths=payload.snapshot.views.filter(v=>v.subject==='maths'&&!v.lockedPreview).map(v=>({id:v.viewId,label:v.label,current:v.current,group:v.group,open:v.openLessonCount,locked:v.lockedLessonCount}));
console.log('TARGET_MATHS_VIEWS='+JSON.stringify(maths));
const ids=new Set(maths.map(v=>v.id));
assert.ok(ids.has('maths-level1'),'L1 access would be lost');
assert.ok(ids.has('maths-level2'),'L2 access would be lost');
assert.ok(ids.has('maths-level3'),'L3 access missing');
assert.ok(ids.has('maths-sats'),'SATS access missing');
assert.ok(!ids.has('maths-year6'),'Year 6 Lessons card would remain');
const l3=maths.find(v=>v.id==='maths-level3');
assert.equal(l3.current,true,'L3 is not current');
const sats=maths.find(v=>v.id==='maths-sats');
assert.equal(sats.current,true,'SATS is not current');
assert.ok(sats.open>=1,'Existing SATS release would not remain open');

const hypotheticalQuizRows=targetAssignments.filter(r=>{
  const def=definitions.find(d=>d.batch_key===r.batch_key);
  if(!def||String(def.subject).toLowerCase()!=='maths'||String(def.stream).toLowerCase()!=='11plus') return false;
  const level=Number(def.maths_level)>=1&&Number(def.maths_level)<=3?Number(def.maths_level):Number(def.school_year)-3;
  return (level===2||level===3)&&String(r.effective_from||'')<=today&&(!r.effective_to||today<String(r.effective_to));
});
assert.equal(hypotheticalQuizRows.length,1,'Target quiz assignment is not uniquely eligible');
assert.equal(hypotheticalQuizRows[0].batch_key,'Y511FM');
console.log('TARGET_QUIZ_LEVEL=L3');
console.log(`ENTITLEMENTS=${entitlements.length}; PRELESSON=${preLesson.length}`);
console.log('AAR1811_L3_QUIZ_TARGET_PREFLIGHT_PASS');
