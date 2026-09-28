import assert from 'node:assert/strict';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
assert.ok(account && token, 'Cloudflare credentials missing');

const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const headers = { Authorization:`Bearer ${token}` };
const db = '97250a54-fa91-45ad-a002-3c4566b1fc38';
const studentsKv = 'c9723c8806334e4ea54d1b456d31b794';
const readModelsKv = '77b35165c8694087bc1b0515c35a7e89';
const userId = 'aar1811';
const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));

async function cfJson(path, options={}) {
  const r = await fetch(`${api}${path}`, { ...options, headers:{...headers,...(options.headers||{})} });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw:text }; }
  if (!r.ok || body?.success === false) throw new Error(`CF_${r.status}:${path}:${JSON.stringify(body?.errors||body)}`);
  return body;
}
async function d1(sql, params=[]) {
  const body = await cfJson(`/d1/database/${db}/query`, {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({sql,params})
  });
  return body.result?.[0]?.results || [];
}
async function kvJson(ns,key) {
  const r=await fetch(`${api}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{headers});
  if(!r.ok) throw new Error(`KV_${r.status}:${ns}:${key}`);
  return JSON.parse(await r.text());
}
async function fetchWithRetry(url, attempts=4) {
  let last;
  for (let i=1;i<=attempts;i+=1) {
    try { return await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(10000)}); }
    catch (error) { last=error; if(i<attempts) await sleep(i*500); }
  }
  throw last;
}

const sharedSettings = await cfJson('/workers/scripts/fpt-portal-v2-worker/settings');
const sharedBindings = sharedSettings.result?.bindings || [];
const sharedReadModels = sharedBindings.find(b=>b.name==='READ_MODELS_KV');
assert.ok(sharedReadModels, 'Shared Worker READ_MODELS_KV binding missing');
assert.equal(sharedReadModels.namespace_id || sharedReadModels.id, readModelsKv, 'Shared Worker READ_MODELS_KV mismatch');
const sharedDb = sharedBindings.find(b=>b.name==='DB');
if (sharedDb?.id || sharedDb?.database_id) assert.equal(sharedDb.id || sharedDb.database_id, db, 'Shared Worker D1 mismatch');
const sharedStudents = sharedBindings.find(b=>b.name==='STUDENTS_KV');
if (sharedStudents?.namespace_id || sharedStudents?.id) assert.equal(sharedStudents.namespace_id || sharedStudents.id, studentsKv, 'Shared Worker STUDENTS_KV mismatch');
console.log('SHARED_WORKER_BINDINGS_PASS');

const deployments = await cfJson('/workers/scripts/fpt-portal-v2-worker/deployments');
const deployment = (deployments.result?.deployments || deployments.result || [])[0] || null;
console.log('SHARED_WORKER_DEPLOYMENT='+JSON.stringify(deployment ? {id:deployment.id,source:deployment.source,created_on:deployment.created_on,versions:deployment.versions} : null));

const studentSettings = await cfJson('/workers/scripts/fpt-portal-v2-rebuild-student-prod/settings');
const studentBindings = studentSettings.result?.bindings || [];
const studentReadModels = studentBindings.find(b=>b.name==='READ_MODELS_KV');
assert.ok(studentReadModels, 'Student Worker READ_MODELS_KV binding missing');
assert.equal(studentReadModels.namespace_id || studentReadModels.id, readModelsKv, 'Student Worker READ_MODELS_KV mismatch');
console.log('STUDENT_WORKER_PREPARED_AUTHORITY_PASS');

const tableSql = await d1(`SELECT sql FROM sqlite_master WHERE type='table' AND name='student_batch_assignments'`);
assert.equal(tableSql.length,1,'student_batch_assignments table missing');
console.log('ASSIGNMENT_TABLE_SQL='+String(tableSql[0].sql));
const cols = await d1('PRAGMA table_info(student_batch_assignments)');
const names = new Set(cols.map(r=>String(r.name)));
for (const required of ['assignment_id','portal_user_id_norm','batch_key','effective_from','effective_to','created_at','updated_at']) assert.ok(names.has(required),`Missing assignment column ${required}`);
console.log('ASSIGNMENT_SCHEMA_PASS');

const indexes = await d1('PRAGMA index_list(student_batch_assignments)');
console.log('ASSIGNMENT_INDEXES='+JSON.stringify(indexes.map(r=>({name:r.name,unique:r.unique,origin:r.origin}))));
const openIndex = await d1(`SELECT name,sql FROM sqlite_master WHERE type='index' AND name='idx_student_batch_assignments_open_unique'`);
assert.equal(openIndex.length,1,'Open-assignment unique index missing');
console.log('OPEN_ASSIGNMENT_INDEX_SQL='+openIndex[0].sql);

const batchProbe = await cfJson(`/d1/database/${db}/query`, {
  method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({batch:[
    {sql:'SELECT ? AS probe',params:['one']},
    {sql:'SELECT ? AS probe',params:['two']}
  ]})
});
assert.equal(batchProbe.result?.length,2,'D1 batch API did not return two results');
assert.ok(batchProbe.result.every(r=>r.success===true),'D1 batch probe failed');
console.log('D1_BATCH_INTERFACE_PASS');

const user = await kvJson(studentsKv,`user:${userId}`);
assert.equal(String(user.portalUserId||'').toLowerCase(),userId);
const full = new Set((user.fullLibraries||[]).map(String));
for (const id of ['MATHS_L1_FULL','MATHS_L2_FULL','MATHS_Y6_FULL']) assert.ok(full.has(id),`Unexpected pre-state: ${id} missing`);
assert.ok(!full.has('MATHS_L3_FULL'),'Unexpected pre-state: MATHS_L3_FULL already present');

const assignments = await d1(`SELECT a.assignment_id,a.batch_key,a.effective_from,a.effective_to,b.subject,b.stream,b.maths_level,b.school_year FROM student_batch_assignments a LEFT JOIN batch_definitions b ON b.batch_key=a.batch_key WHERE a.portal_user_id_norm=? ORDER BY a.assignment_id`,[userId]);
const activeY6 = assignments.filter(r=>r.batch_key==='Y611FM' && !r.effective_to);
const activeL3 = assignments.filter(r=>r.batch_key==='Y511FM' && !r.effective_to);
assert.equal(activeY6.length,1,'Expected exactly one active Y611FM pre-state');
assert.equal(activeY6[0].assignment_id,161,'Aarav Y611FM assignment id changed');
assert.equal(activeL3.length,0,'Aarav already has active Y511FM');
const l3defs = await d1(`SELECT batch_key,subject,school_year,stream,maths_level,active_from,active_to FROM batch_definitions WHERE batch_key='Y511FM'`);
assert.equal(l3defs.length,1,'Y511FM definition missing');
assert.equal(String(l3defs[0].subject).toLowerCase(),'maths');
assert.equal(String(l3defs[0].stream).toLowerCase(),'11plus');
assert.equal(Number(l3defs[0].maths_level),3);
assert.ok(!l3defs[0].active_from || l3defs[0].active_from<=today);
assert.ok(!l3defs[0].active_to || today<l3defs[0].active_to);
console.log('AAR1811_CANONICAL_PRESTATE_PASS');

const publicHome = await fetchWithRetry('https://lessons.futureperfect.education/api/v2/student/home');
console.log(`PUBLIC_V2_UNAUTH_HOME_STATUS=${publicHome.status}`);
assert.ok([401,403].includes(publicHome.status),'Public v2 route did not enforce authentication as expected');

console.log('AAR1811_LIVE_PRODUCTION_GUARD_PASS');
