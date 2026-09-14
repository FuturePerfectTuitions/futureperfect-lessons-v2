import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { stableStringify, pointerKey, versionKey } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const clean = v => String(v ?? '').trim();
const norm = v => clean(v).toLowerCase();
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const apply = clean(process.env.CP12_BATCH_REGISTRY_APPLY) === '1';
const asOf = clean(process.env.CP12_AS_OF_DATE || '2026-09-14');
const opsWorker = clean(process.env.OPS_WORKER || 'fpt-portal-v2-worker');
const browserWorker = clean(process.env.BROWSER_WORKER || 'fpt-portal-v2-rebuild-browser-prod');
const studentWorker = clean(process.env.STUDENT_WORKER || 'fpt-portal-v2-rebuild-student-prod');
const expectedStudents = clean(process.env.EXPECTED_STUDENTS_KV_ID || 'c9723c8806334e4ea54d1b456d31b794');
const expectedLessons = clean(process.env.EXPECTED_LESSONS_KV_ID || '49619b1a24b244bc8aaa6223fcd24e80');
const expectedDb = clean(process.env.EXPECTED_D1_ID || '97250a54-fa91-45ad-a002-3c4566b1fc38');
const expectedReadModels = clean(process.env.EXPECTED_READ_MODELS_KV_ID || '77b35165c8694087bc1b0515c35a7e89');
const expectedR2 = clean(process.env.EXPECTED_R2 || 'fpt-materials-dev');
if (!token || !account) throw new Error('Cloudflare credentials are required.');
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('A deterministic as-of date is required.');

// Current 2026-27 operational workbook authority. Batch IDs are opaque; semantics come from the workbook rows.
const required = [
  { batch_key:'Y3FM', academic_year:'2026-27', subject:'maths',   school_year:3, stream:'normal', maths_level:null, active_from:'2026-09-07', active_to:null },
  { batch_key:'Y3FE', academic_year:'2026-27', subject:'english', school_year:3, stream:'normal', maths_level:null, active_from:'2026-09-10', active_to:null },
  { batch_key:'Y4FE', academic_year:'2026-27', subject:'english', school_year:4, stream:'normal', maths_level:null, active_from:'2026-09-11', active_to:null },
  { batch_key:'Y411FE', academic_year:'2026-27', subject:'english', school_year:4, stream:'11plus', maths_level:null, active_from:'2026-09-11', active_to:null },
  { batch_key:'Y411FM', academic_year:'2026-27', subject:'maths', school_year:4, stream:'11plus', maths_level:2, active_from:'2026-09-07', active_to:null },
  { batch_key:'Y411OM', academic_year:'2026-27', subject:'maths', school_year:4, stream:'11plus', maths_level:2, active_from:'2026-09-07', active_to:null },
  { batch_key:'Y411OE', academic_year:'2026-27', subject:'english', school_year:4, stream:'11plus', maths_level:null, active_from:'2026-09-10', active_to:null },
  { batch_key:'Y5FM', academic_year:'2026-27', subject:'maths', school_year:5, stream:'normal', maths_level:null, active_from:'2026-09-09', active_to:null },
  { batch_key:'Y5OE', academic_year:'2026-27', subject:'english', school_year:5, stream:'normal', maths_level:null, active_from:'2026-09-11', active_to:null },
  { batch_key:'Y511FE', academic_year:'2026-27', subject:'english', school_year:5, stream:'11plus', maths_level:null, active_from:'2026-09-12', active_to:null },
  { batch_key:'Y511FM', academic_year:'2026-27', subject:'maths', school_year:5, stream:'11plus', maths_level:3, active_from:'2026-09-08', active_to:null },
  { batch_key:'Y511OE1', academic_year:'2026-27', subject:'english', school_year:5, stream:'11plus', maths_level:null, active_from:'2026-09-07', active_to:null },
  { batch_key:'Y511OM1', academic_year:'2026-27', subject:'maths', school_year:5, stream:'11plus', maths_level:3, active_from:'2026-09-09', active_to:null },
  { batch_key:'Y6OE', academic_year:'2026-27', subject:'english', school_year:6, stream:'normal', maths_level:null, active_from:'2026-09-07', active_to:null },
  { batch_key:'Y6FE', academic_year:'2026-27', subject:'english', school_year:6, stream:'normal', maths_level:null, active_from:'2026-09-10', active_to:null },
  { batch_key:'Y6FM', academic_year:'2026-27', subject:'maths', school_year:6, stream:'normal', maths_level:null, active_from:'2026-09-08', active_to:null },
  { batch_key:'Y611FM', academic_year:'2026-27', subject:'maths', school_year:6, stream:'normal', maths_level:null, active_from:'2026-09-12', active_to:null }
];
const requiredByKey = new Map(required.map(r => [r.batch_key, r]));
const expectedMissing = ['Y4FE','Y411FE','Y411FM','Y5FM','Y5OE','Y511OE1','Y511OM1','Y6FE','Y6FM','Y611FM'].sort();

const base = 'https://api.cloudflare.com/client/v4';
const headers = { Authorization:`Bearer ${token}` };
async function request(path, options={}) {
  const response = await fetch(`${base}${path}`, { ...options, headers:{ ...headers, ...(options.headers || {}) } });
  const text = await response.text(); let body = null; try { body = JSON.parse(text); } catch {}
  return { response, text, body };
}
async function envelope(path, options={}) {
  const out = await request(path, options);
  if (!out.response.ok || out.body?.success !== true) throw new Error(`Cloudflare request failed: ${out.response.status} ${path} ${out.text.slice(0,300)}`);
  return out.body;
}
async function workerSettings(name) { return (await envelope(`/accounts/${account}/workers/scripts/${name}/settings`)).result || {}; }
function binding(settings, name) { return (settings.bindings || []).find(x => x.name === name) || {}; }
async function latestDeployment(name) {
  const body = await envelope(`/accounts/${account}/workers/scripts/${name}/deployments`);
  const rows = Array.isArray(body.result?.deployments) ? body.result.deployments : Array.isArray(body.result) ? body.result : [];
  const first = rows[0] || {};
  const versions = Array.isArray(first.versions) ? first.versions : [];
  return { deploymentId: clean(first.id), versions: versions.map(v => ({ versionId:clean(v.version_id || v.id), percentage:Number(v.percentage ?? 0) })) };
}
async function kvText(ns,key){const out=await request(`/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`);if(out.response.status===404)return null;if(!out.response.ok)throw new Error(`KV read failed: ${out.response.status} ${key}`);return out.text;}
async function kvJson(ns,key){const t=await kvText(ns,key);if(t==null)return null;try{return JSON.parse(t);}catch{throw new Error(`KV JSON invalid: ${key}`);}}
async function kvKeys(ns,prefix){const keys=[];let cursor='';do{const q=new URLSearchParams({limit:'1000',prefix});if(cursor)q.set('cursor',cursor);const body=await envelope(`/accounts/${account}/storage/kv/namespaces/${ns}/keys?${q}`);keys.push(...(body.result||[]).map(x=>x.name).filter(Boolean));cursor=clean(body.result_info?.cursor);}while(cursor);return keys;}
async function d1(sql, params=[]) {
  const body = await envelope(`/accounts/${account}/d1/database/${expectedDb}/query`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({sql,params}) });
  const first = Array.isArray(body.result) ? body.result[0] : body.result;
  return { rows:Array.isArray(first?.results)?first.results:[], meta:first?.meta || {} };
}
function canonicalRow(row){return {batch_key:clean(row.batch_key),academic_year:clean(row.academic_year),subject:norm(row.subject),school_year:Number(row.school_year),stream:norm(row.stream),maths_level:row.maths_level==null?null:Number(row.maths_level),active_from:clean(row.active_from),active_to:row.active_to==null||clean(row.active_to)===''?null:clean(row.active_to)};}
function assertRequiredRows(rows, stage) {
  const map = new Map(rows.map(r => [clean(r.batch_key), canonicalRow(r)]));
  const unexpected = [...map.keys()].filter(k => !requiredByKey.has(k));
  if (unexpected.length) throw new Error(`${stage}: unexpected production batch definitions: ${unexpected.join(',')}`);
  for (const [key,row] of map) {
    const expected = requiredByKey.get(key);
    if (stableStringify(row) !== stableStringify(expected)) throw new Error(`${stage}: conflicting definition for ${key}: ${JSON.stringify(row)} != ${JSON.stringify(expected)}`);
  }
  return map;
}
async function snapshotStudentAccess(studentsNs, readModelsNs) {
  const salt=clean(await kvText(readModelsNs,'meta:scope-salt'));
  if(!/^[0-9a-f]{64}$/i.test(salt)) throw new Error('Read-model scope salt missing or malformed.');
  const keys=(await kvKeys(studentsNs,'user:')).sort(); const out=[];
  for(const key of keys){
    const id=norm(key.replace(/^user:/,'')); const user=await kvJson(studentsNs,key); if(!user)continue;
    const role=norm(user?.role||user?.accountType); const status=norm(user?.accountStatus||user?.status||'active'); const expires=clean(user?.expiresOn||user?.expires);
    if(id==='admin'||role.includes('admin')||user?.isAdmin===true||user?.superuser===true)continue;
    if(['inactive','disabled','expired','withdrawn'].includes(status)||(expires&&expires<=asOf))continue;
    const scopeId=await opaqueAccessScopeId(id,salt); const scope=`access:${scopeId}`; const ptr=await kvJson(readModelsNs,pointerKey(scope));
    if(!ptr?.current?.version) throw new Error(`Missing current access pointer for user digest ${id.length}:${scopeId.slice(0,8)}`);
    const env=await kvJson(readModelsNs,versionKey(scope,ptr.current.version)); if(!env?.payload?.snapshot) throw new Error(`Missing access payload for ${scopeId.slice(0,8)}`);
    out.push({id,scopeId,pointer:ptr,payload:env.payload});
  }
  return out;
}
function viewOpen(payload, id){return (payload?.snapshot?.views||[]).some(v=>v.viewId===id&&v.lockedPreview!==true);}
function state(payload, lessonId){const s=payload?.snapshot?.lessonAccess?.[lessonId];if(!s)return'LOCKED';if(s.blocked)return'BLOCKED';if(s.core)return'FULL';if(s.preLessonOnly)return'PRELESSON_ONLY';if(s.vr)return'VR_ONLY';return'LOCKED';}
async function removeInserted(keys) {
  for (const key of [...keys].reverse()) await d1('DELETE FROM batch_definitions WHERE batch_key = ?', [key]);
}
function runBackfill(label) {
  console.log(`${label}: rebuilding canonical prepared access snapshots via existing CP11 compiler/publisher...`);
  execFileSync(process.execPath, ['scripts/rebuild-checkpoint11-backfill.mjs'], { stdio:'inherit', env:{...process.env, PROD_WORKER:opsWorker, PROD_SHADOW_KV_ID:expectedReadModels, EXPECTED_STUDENTS_KV_ID:expectedStudents, EXPECTED_LESSONS_KV_ID:expectedLessons, EXPECTED_PROD_D1_ID:expectedDb, CHECKPOINT11_AS_OF_DATE:asOf} });
}

const [opsSettings,browserSettings,studentSettings,opsDeploy,browserDeploy,studentDeploy] = await Promise.all([
  workerSettings(opsWorker), workerSettings(browserWorker), workerSettings(studentWorker), latestDeployment(opsWorker), latestDeployment(browserWorker), latestDeployment(studentWorker)
]);
const studentsNs=clean(binding(opsSettings,'STUDENTS_KV').namespace_id), lessonsNs=clean(binding(opsSettings,'LESSONS_KV').namespace_id), dbId=clean(binding(opsSettings,'DB').database_id||binding(opsSettings,'DB').id), r2=clean(binding(opsSettings,'MATERIALS_R2').bucket_name||binding(opsSettings,'MATERIALS_R2').bucket), readModelsNs=clean(binding(studentSettings,'READ_MODELS_KV').namespace_id);
const browserStudent=clean(binding(browserSettings,'STAGING_API').service||binding(browserSettings,'STUDENT_API').service);
if(studentsNs!==expectedStudents||lessonsNs!==expectedLessons||dbId!==expectedDb||r2!==expectedR2) throw new Error('Legacy Operations production binding drift detected.');
if(readModelsNs!==expectedReadModels) throw new Error(`Student READ_MODELS_KV drift: ${readModelsNs}`);
if(browserStudent!==studentWorker) throw new Error(`Browser→Student topology drift: ${browserStudent}`);
const beforeRows=(await d1('SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions ORDER BY batch_key')).rows;
const beforeMap=assertRequiredRows(beforeRows,'preflight');
const missing=required.filter(r=>!beforeMap.has(r.batch_key)).map(r=>r.batch_key).sort();
if(stableStringify(missing)!==stableStringify(expectedMissing)) throw new Error(`Preflight missing-set drift: ${JSON.stringify(missing)} expected ${JSON.stringify(expectedMissing)}`);
const beforeAccess=await snapshotStudentAccess(studentsNs,readModelsNs);
const beforeById=new Map(beforeAccess.map(r=>[r.id,r]));
const baseline={generatedAt:new Date().toISOString(),apply,topology:{opsWorker,browserWorker,studentWorker,browserStudent,opsDeploy,browserDeploy,studentDeploy},bindings:{studentsNs,lessonsNs,dbId,r2,readModelsNs},batchDefinitions:beforeRows,missing,currentStudents:beforeAccess.length,ayla:{state:state(beforeById.get('ayla0108')?.payload,'Y4E1'),english11:viewOpen(beforeById.get('ayla0108')?.payload,'english-year4-11plus')},reina:{y5m1:state(beforeById.get('rei0710')?.payload,'Y5M1'),y5m2:state(beforeById.get('rei0710')?.payload,'Y5M2'),y4e1:state(beforeById.get('rei0710')?.payload,'Y4E1'),level2:viewOpen(beforeById.get('rei0710')?.payload,'maths-level2'),english11:viewOpen(beforeById.get('rei0710')?.payload,'english-year4-11plus')}};
fs.writeFileSync('/tmp/cp12-batch-registry-before.json',JSON.stringify(baseline,null,2));
console.log(JSON.stringify({marker:'CP12_BATCH_REGISTRY_PREFLIGHT_PASS',apply,missing,topology:baseline.topology,bindings:baseline.bindings,currentStudents:beforeAccess.length,ayla:baseline.ayla,reina:baseline.reina},null,2));
if(!apply){console.log('CP12_BATCH_REGISTRY_DRY_RUN_ONLY');process.exit(0);}

const inserted=[];
try {
  // Recheck immediately before the first production write.
  const immediate=(await d1('SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions ORDER BY batch_key')).rows;
  const immediateMap=assertRequiredRows(immediate,'immediate-prewrite');
  const immediateMissing=required.filter(r=>!immediateMap.has(r.batch_key)).map(r=>r.batch_key).sort();
  if(stableStringify(immediateMissing)!==stableStringify(expectedMissing)) throw new Error('Immediate prewrite missing-set changed; aborting.');
  const freshBrowser=await workerSettings(browserWorker), freshStudent=await workerSettings(studentWorker), freshOps=await workerSettings(opsWorker);
  if(clean(binding(freshBrowser,'STAGING_API').service||binding(freshBrowser,'STUDENT_API').service)!==studentWorker)throw new Error('Immediate Browser→Student topology drift.');
  if(clean(binding(freshStudent,'READ_MODELS_KV').namespace_id)!==expectedReadModels)throw new Error('Immediate Student KV drift.');
  if(clean(binding(freshOps,'DB').database_id||binding(freshOps,'DB').id)!==expectedDb)throw new Error('Immediate Operations D1 drift.');
  console.log('CP12_BATCH_REGISTRY_IMMEDIATE_PREWRITE_PASS');

  for(const key of expectedMissing){
    const r=requiredByKey.get(key);
    await d1('INSERT INTO batch_definitions (batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [r.batch_key,r.academic_year,r.subject,r.school_year,r.stream,r.maths_level,r.active_from,r.active_to]);
    inserted.push(key);
  }
  const afterInsert=(await d1('SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions ORDER BY batch_key')).rows;
  const afterMap=assertRequiredRows(afterInsert,'post-insert');
  if(afterMap.size!==required.length)throw new Error(`Expected ${required.length} canonical batch definitions after insert, found ${afterMap.size}.`);
  console.log(`CP12_BATCH_REGISTRY_D1_INSERT_PASS inserted=${inserted.length} total=${afterMap.size}`);

  runBackfill('apply');
  const afterAccess=await snapshotStudentAccess(studentsNs,readModelsNs); const afterById=new Map(afterAccess.map(r=>[r.id,r]));
  if(afterAccess.length!==beforeAccess.length)throw new Error('Current-student population changed during repair.');
  for(const before of beforeAccess){const after=afterById.get(before.id);if(!after)throw new Error('Student scope disappeared during repair.');if(stableStringify(before.payload.snapshot.lessonAccess)!==stableStringify(after.payload.snapshot.lessonAccess))throw new Error(`Lesson-access widening/narrowing detected for ${before.scopeId.slice(0,8)}.`);}
  const ayla=afterById.get('ayla0108'); if(!ayla)throw new Error('Ayla current profile missing after repair.');
  if(state(ayla.payload,'Y4E1')!=='FULL'||!viewOpen(ayla.payload,'english-year4-11plus'))throw new Error('Ayla repair anchor failed.');
  const reina=afterById.get('rei0710'); if(!reina)throw new Error('Reina current profile missing after repair.');
  if(stableStringify(beforeById.get('rei0710')?.payload)!==stableStringify(reina.payload))throw new Error('Reina access model changed unexpectedly.');
  if(state(reina.payload,'Y5M1')!=='FULL'||state(reina.payload,'Y5M2')!=='PRELESSON_ONLY'||state(reina.payload,'Y4E1')!=='FULL'||!viewOpen(reina.payload,'maths-level2')||!viewOpen(reina.payload,'english-year4-11plus'))throw new Error('Reina regression anchor failed.');
  const expectedViews={
    aar1811:['maths-year6'], abi3007:['english-year4'], ame0503:['maths-year6'], ann3009:['maths-level3','english-year5-11plus'], ava2007:['maths-year5'], ayla0108:['english-year4-11plus'], conn2209:['maths-year6'], dha2806:['maths-level2','english-year4-11plus']
  };
  for(const [id,views] of Object.entries(expectedViews)){const row=afterById.get(id);if(!row)throw new Error(`Expected current student missing: ${id}`);for(const v of views)if(!viewOpen(row.payload,v))throw new Error(`Expected repaired view ${v} absent for ${row.scopeId.slice(0,8)}.`);}
  const report={marker:'CP12_BATCH_REGISTRY_REPAIR_PASS',generatedAt:new Date().toISOString(),inserted,canonicalDefinitionCount:afterMap.size,currentStudents:afterAccess.length,noLessonAccessChanges:true,ayla:{y4e1:state(ayla.payload,'Y4E1'),englishYear4ElevenPlus:viewOpen(ayla.payload,'english-year4-11plus')},reina:{y5m1:state(reina.payload,'Y5M1'),y5m2:state(reina.payload,'Y5M2'),y4e1:state(reina.payload,'Y4E1'),level2:viewOpen(reina.payload,'maths-level2'),english11:viewOpen(reina.payload,'english-year4-11plus')},topology:baseline.topology,bindings:baseline.bindings};
  fs.writeFileSync('/tmp/cp12-batch-registry-after.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} catch (error) {
  console.error(`CP12 batch-registry repair failed: ${error?.stack || error}`);
  if(inserted.length){
    try { await removeInserted(inserted); console.error(`Rolled back ${inserted.length} inserted batch definitions.`); runBackfill('rollback'); console.error('Prepared access snapshots rebuilt after rollback.'); }
    catch (rollbackError){ console.error(`ROLLBACK FAILURE: ${rollbackError?.stack || rollbackError}`); }
  }
  throw error;
}
