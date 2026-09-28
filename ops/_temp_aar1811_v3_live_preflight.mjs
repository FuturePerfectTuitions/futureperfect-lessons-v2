import assert from 'node:assert/strict';
import { compileAuthoritativeAccessScope } from '../worker/src/access-read-model-sync-v3.js';
import { globalToCatalogue } from '../worker/src/access-read-model-sync.js';

const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const token=process.env.CLOUDFLARE_API_TOKEN;
const api=`https://api.cloudflare.com/client/v4/accounts/${account}`;
const headers={Authorization:`Bearer ${token}`};
const db='97250a54-fa91-45ad-a002-3c4566b1fc38';
const studentsKv='c9723c8806334e4ea54d1b456d31b794';
const readModelsKv='77b35165c8694087bc1b0515c35a7e89';
const userId='aar1811';
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

async function kvText(ns,key){const r=await fetch(`${api}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{headers});if(!r.ok)throw new Error(`KV_${r.status}:${key}`);return r.text();}
async function d1(sql,params=[]){const r=await fetch(`${api}/d1/database/${db}/query`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({sql,params})});const b=await r.json();if(!r.ok||b.success!==true)throw new Error(`D1_${r.status}:${JSON.stringify(b.errors||b)}`);return b.result?.[0]?.results||[];}

const user=JSON.parse(await kvText(studentsKv,`user:${userId}`));
assert.equal(String(user.portalUserId||'').toLowerCase(),userId);
const originalFull=JSON.stringify(user.fullLibraries||[]);
const definitions=await d1(`SELECT batch_key,academic_year,subject,school_year,stream,maths_level,active_from,active_to FROM batch_definitions`);
const assignments=await d1(`SELECT a.assignment_id,a.portal_user_id_norm,a.batch_key,a.effective_from,a.effective_to,b.subject,b.school_year,b.stream,b.maths_level,b.active_from AS batch_active_from,b.active_to AS batch_active_to FROM student_batch_assignments a LEFT JOIN batch_definitions b ON b.batch_key=a.batch_key WHERE a.portal_user_id_norm=? ORDER BY a.assignment_id`,[userId]);
const entitlements=await d1(`SELECT portal_user_id_norm,lesson_id,core_access,vr_access,source,first_granted_at,last_confirmed_at,source_batch_code,source_lesson_date FROM lesson_entitlements WHERE portal_user_id_norm=? ORDER BY lesson_id`,[userId]);
const pre=await d1(`SELECT portal_user_id_norm,lesson_id,batch_key,lesson_date,vr_access,source_row_id,first_granted_at,last_confirmed_at FROM online_prelesson_entitlements WHERE portal_user_id_norm=? ORDER BY lesson_id`,[userId]);

const old=assignments.filter(r=>Number(r.assignment_id)===161&&r.batch_key==='Y611FM'&&!r.effective_to);
assert.equal(old.length,1,'Expected unchanged active Y611FM assignment 161');
assert.equal(assignments.filter(r=>r.batch_key==='Y511FM'&&!r.effective_to).length,0,'Unexpected active L3 before correction');
const l3=definitions.find(r=>r.batch_key==='Y511FM');
assert.ok(l3&&String(l3.subject).toLowerCase()==='maths'&&String(l3.stream).toLowerCase()==='11plus'&&Number(l3.maths_level)===3,'Y511FM is not authoritative L3');

const targetAssignments=assignments.map(r=>Number(r.assignment_id)===161?{...r,effective_to:today}:{...r});
targetAssignments.push({portal_user_id_norm:userId,batch_key:'Y511FM',effective_from:today,effective_to:null,subject:l3.subject,school_year:l3.school_year,stream:l3.stream,maths_level:l3.maths_level,batch_active_from:l3.active_from,batch_active_to:l3.active_to});

const p=JSON.parse(await kvText(readModelsKv,'rm:v1:scope:global:current'));
const version=p.current?.version;assert.ok(version);
const env=JSON.parse(await kvText(readModelsKv,`rm:v1:scope:global:version:${version}`));
const catalogue=globalToCatalogue(env.payload);
const payload=compileAuthoritativeAccessScope({asOfDate:today,user,batchDefinitions:definitions,batchAssignments:targetAssignments,entitlements,onlinePreLessonEntitlements:pre},catalogue,'preflight-only',today);
assert.equal(JSON.stringify(user.fullLibraries||[]),originalFull,'Preflight mutated Full Library history');

const maths=payload.snapshot.views.filter(v=>v.subject==='maths'&&!v.lockedPreview).map(v=>({id:v.viewId,label:v.label,current:v.current,group:v.group,open:v.openLessonCount,locked:v.lockedLessonCount}));
console.log('TARGET_MATHS='+JSON.stringify(maths));
const current=maths.filter(v=>v.current).map(v=>v.id).sort();
assert.deepEqual(current,['maths-level1','maths-level2','maths-level3','maths-sats']);
for(const id of ['maths-year3','maths-year6']){const v=maths.find(x=>x.id===id);assert.ok(v,`${id} history missing`);assert.equal(v.current,false);assert.equal(v.group,'previous');}
const sats=maths.find(v=>v.id==='maths-sats');assert.equal(sats.open,1);assert.equal(sats.locked,18);

const activeQuiz=targetAssignments.filter(r=>{const d=definitions.find(x=>x.batch_key===r.batch_key);if(!d||String(d.subject).toLowerCase()!=='maths'||String(d.stream).toLowerCase()!=='11plus')return false;const n=Number(d.maths_level)>=1&&Number(d.maths_level)<=3?Number(d.maths_level):Number(d.school_year)-3;return (n===2||n===3)&&String(r.effective_from||'')<=today&&(!r.effective_to||today<String(r.effective_to));});
assert.equal(activeQuiz.length,1);assert.equal(activeQuiz[0].batch_key,'Y511FM');
assert.equal(Number(definitions.find(d=>d.batch_key===activeQuiz[0].batch_key).maths_level),3);
console.log(`QUIZ_TARGET=L3; CORE_ENTITLEMENTS=${entitlements.filter(e=>Number(e.core_access)===1).length}; TOTAL_ENTITLEMENTS=${entitlements.length}`);
console.log('AAR1811_V3_LIVE_PREFLIGHT_PASS');
