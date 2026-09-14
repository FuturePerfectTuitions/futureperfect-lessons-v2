import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { stableStringify, pointerKey, versionKey } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const clean=v=>String(v??'').trim(), norm=v=>clean(v).toLowerCase();
const token=clean(process.env.CLOUDFLARE_API_TOKEN), account=clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const apply=clean(process.env.CP12_BATCH_REGISTRY_APPLY)==='1', asOf=clean(process.env.CP12_AS_OF_DATE||'2026-09-14');
const opsWorker=clean(process.env.OPS_WORKER||'fpt-portal-v2-worker');
const browserWorker=clean(process.env.BROWSER_WORKER||'fpt-portal-v2-rebuild-browser-prod');
const studentWorker=clean(process.env.STUDENT_WORKER||'fpt-portal-v2-rebuild-student-prod');
const studentsNsExpected=clean(process.env.EXPECTED_STUDENTS_KV_ID||'c9723c8806334e4ea54d1b456d31b794');
const lessonsNsExpected=clean(process.env.EXPECTED_LESSONS_KV_ID||'49619b1a24b244bc8aaa6223fcd24e80');
const dbExpected=clean(process.env.EXPECTED_D1_ID||'97250a54-fa91-45ad-a002-3c4566b1fc38');
const readModelsExpected=clean(process.env.EXPECTED_READ_MODELS_KV_ID||'77b35165c8694087bc1b0515c35a7e89');
const r2Expected=clean(process.env.EXPECTED_R2||'fpt-materials-dev');
if(!token||!account)throw new Error('Cloudflare credentials required.');

const required=[
 {batch_key:'Y3FE',academic_year:'2026-27',subject:'english',school_year:3,stream:'normal',maths_level:null,active_from:'2026-09-10',active_to:null},
 {batch_key:'Y3FM',academic_year:'2026-27',subject:'maths',school_year:3,stream:'normal',maths_level:null,active_from:'2026-09-07',active_to:null},
 {batch_key:'Y4FE',academic_year:'2026-27',subject:'english',school_year:4,stream:'normal',maths_level:null,active_from:'2026-09-11',active_to:null},
 {batch_key:'Y411FE',academic_year:'2026-27',subject:'english',school_year:4,stream:'11plus',maths_level:null,active_from:'2026-09-11',active_to:null},
 {batch_key:'Y411FM',academic_year:'2026-27',subject:'maths',school_year:4,stream:'11plus',maths_level:2,active_from:'2026-09-07',active_to:null},
 {batch_key:'Y411OE',academic_year:'2026-27',subject:'english',school_year:4,stream:'11plus',maths_level:null,active_from:'2026-09-10',active_to:null},
 {batch_key:'Y411OM',academic_year:'2026-27',subject:'maths',school_year:4,stream:'11plus',maths_level:2,active_from:'2026-09-07',active_to:null},
 {batch_key:'Y5FM',academic_year:'2026-27',subject:'maths',school_year:5,stream:'normal',maths_level:null,active_from:'2026-09-09',active_to:null},
 {batch_key:'Y5OE',academic_year:'2026-27',subject:'english',school_year:5,stream:'normal',maths_level:null,active_from:'2026-09-11',active_to:null},
 {batch_key:'Y511FE',academic_year:'2026-27',subject:'english',school_year:5,stream:'11plus',maths_level:null,active_from:'2026-09-12',active_to:null},
 {batch_key:'Y511FM',academic_year:'2026-27',subject:'maths',school_year:5,stream:'11plus',maths_level:3,active_from:'2026-09-08',active_to:null},
 {batch_key:'Y511OE1',academic_year:'2026-27',subject:'english',school_year:5,stream:'11plus',maths_level:null,active_from:'2026-09-07',active_to:null},
 {batch_key:'Y511OM1',academic_year:'2026-27',subject:'maths',school_year:5,stream:'11plus',maths_level:3,active_from:'2026-09-09',active_to:null},
 {batch_key:'Y6FE',academic_year:'2026-27',subject:'english',school_year:6,stream:'normal',maths_level:null,active_from:'2026-09-10',active_to:null},
 {batch_key:'Y6FM',academic_year:'2026-27',subject:'maths',school_year:6,stream:'normal',maths_level:null,active_from:'2026-09-08',active_to:null},
 {batch_key:'Y6OE',academic_year:'2026-27',subject:'english',school_year:6,stream:'normal',maths_level:null,active_from:'2026-09-07',active_to:null},
 {batch_key:'Y611FM',academic_year:'2026-27',subject:'maths',school_year:6,stream:'normal',maths_level:null,active_from:'2026-09-12',active_to:null}
];
const requiredMap=new Map(required.map(r=>[r.batch_key,r]));
const expectedMissing=['Y411FE','Y411FM','Y4FE','Y511OE1','Y511OM1','Y5FM','Y5OE','Y611FM','Y6FE','Y6FM'].sort();

const base='https://api.cloudflare.com/client/v4', headers={Authorization:`Bearer ${token}`};
async function req(path,options={}){const response=await fetch(`${base}${path}`,{...options,headers:{...headers,...(options.headers||{})}});const text=await response.text();let body=null;try{body=JSON.parse(text);}catch{}return{response,text,body};}
async function env(path,options={}){const out=await req(path,options);if(!out.response.ok||out.body?.success!==true)throw new Error(`Cloudflare ${out.response.status} ${path}: ${out.text.slice(0,400)}`);return out.body;}
async function settings(name){return (await env(`/accounts/${account}/workers/scripts/${name}/settings`)).result||{};}
function bind(s,n){return(s.bindings||[]).find(x=>x.name===n)||{};}
async function deployment(name){const body=await env(`/accounts/${account}/workers/scripts/${name}/deployments`);const rows=Array.isArray(body.result?.deployments)?body.result.deployments:Array.isArray(body.result)?body.result:[];const d=rows[0]||{};return{id:clean(d.id),versions:(d.versions||[]).map(v=>({id:clean(v.version_id||v.id),percentage:Number(v.percentage??0)}))};}
async function d1(sql,params=[]){const body=await env(`/accounts/${account}/d1/database/${dbExpected}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql,params})});const first=Array.isArray(body.result)?body.result[0]:body.result;return Array.isArray(first?.results)?first.results:[];}
async function kvText(ns,key){const out=await req(`/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`);if(out.response.status===404)return null;if(!out.response.ok)throw new Error(`KV read ${out.response.status}: ${key}`);return out.text;}
async function kvJson(ns,key){const t=await kvText(ns,key);if(t==null)return null;return JSON.parse(t);}
async function kvKeys(ns,prefix){const keys=[];let cursor='';do{const q=new URLSearchParams({limit:'1000',prefix});if(cursor)q.set('cursor',cursor);const body=await env(`/accounts/${account}/storage/kv/namespaces/${ns}/keys?${q}`);keys.push(...(body.result||[]).map(x=>x.name).filter(Boolean));cursor=clean(body.result_info?.cursor);}while(cursor);return keys;}
function canon(r){return{batch_key:clean(r.batch_key),academic_year:clean(r.academic_year),subject:norm(r.subject),school_year:Number(r.school_year),stream:norm(r.stream),maths_level:r.maths_level==null?null:Number(r.maths_level),active_from:clean(r.active_from),active_to:r.active_to==null||clean(r.active_to)===''?null:clean(r.active_to)};}
function validateDefinitions(rows,stage){const m=new Map(rows.map(r=>[clean(r.batch_key),canon(r)]));const unexpected=[...m.keys()].filter(k=>!requiredMap.has(k));if(unexpected.length)throw new Error(`${stage}: unexpected batch definitions ${unexpected.join(',')}`);for(const[k,v]of m){const e=requiredMap.get(k);if(stableStringify(v)!==stableStringify(e))throw new Error(`${stage}: conflicting ${k}`);}return m;}
function openView(payload,id){return(payload?.snapshot?.views||[]).some(v=>v.viewId===id&&v.lockedPreview!==true);}
function lessonState(payload,id){const s=payload?.snapshot?.lessonAccess?.[id];if(!s)return'LOCKED';if(s.blocked)return'BLOCKED';if(s.core)return'FULL';if(s.preLessonOnly)return'PRELESSON_ONLY';if(s.vr)return'VR_ONLY';return'LOCKED';}
async function accessPopulation(studentsNs,readModelsNs){const salt=clean(await kvText(readModelsNs,'meta:scope-salt'));if(!/^[0-9a-f]{64}$/i.test(salt))throw new Error('Scope salt invalid.');const out=[];for(const key of(await kvKeys(studentsNs,'user:')).sort()){const id=norm(key.replace(/^user:/,''));const user=await kvJson(studentsNs,key);if(!user)continue;const role=norm(user.role||user.accountType),status=norm(user.accountStatus||user.status||'active'),expires=clean(user.expiresOn||user.expires);if(id==='admin'||role.includes('admin')||user.isAdmin===true||user.superuser===true)continue;if(['inactive','disabled','expired','withdrawn'].includes(status)||(expires&&expires<=asOf))continue;const scopeId=await opaqueAccessScopeId(id,salt),scope=`access:${scopeId}`,ptr=await kvJson(readModelsNs,pointerKey(scope));if(!ptr?.current?.version)throw new Error(`Missing pointer ${scopeId.slice(0,8)}`);const envelope=await kvJson(readModelsNs,versionKey(scope,ptr.current.version));if(!envelope?.payload?.snapshot)throw new Error(`Missing payload ${scopeId.slice(0,8)}`);out.push({id,scopeId,payload:envelope.payload});}return out;}
function runBackfill(tag){console.log(`${tag}: invoking existing CP11 canonical compiler/publisher`);execFileSync(process.execPath,['scripts/rebuild-checkpoint11-backfill.mjs'],{stdio:'inherit',env:{...process.env,PROD_WORKER:opsWorker,PROD_SHADOW_KV_ID:readModelsExpected,EXPECTED_STUDENTS_KV_ID:studentsNsExpected,EXPECTED_LESSONS_KV_ID:lessonsNsExpected,EXPECTED_PROD_D1_ID:dbExpected,CHECKPOINT11_AS_OF_DATE:asOf}});}

const [ops,browser,student,opsDep,browserDep,studentDep]=await Promise.all([settings(opsWorker),settings(browserWorker),settings(studentWorker),deployment(opsWorker),deployment(browserWorker),deployment(studentWorker)]);
const studentsNs=clean(bind(ops,'STUDENTS_KV').namespace_id),lessonsNs=clean(bind(ops,'LESSONS_KV').namespace_id),db=clean(bind(ops,'DB').database_id||bind(ops,'DB').id),r2=clean(bind(ops,'MATERIALS_R2').bucket_name||bind(ops,'MATERIALS_R2').bucket),readModelsNs=clean(bind(student,'READ_MODELS_KV').namespace_id),browserStudent=clean(bind(browser,'STAGING_API').service||bind(browser,'STUDENT_API').service);
if(studentsNs!==studentsNsExpected||lessonsNs!==lessonsNsExpected||db!==dbExpected||r2!==r2Expected||readModelsNs!==readModelsExpected||browserStudent!==studentWorker)throw new Error('Production topology/binding drift.');
const schema=await d1('PRAGMA table_info(batch_definitions)');
const schemaNames=schema.map(x=>clean(x.name));
const exactSchema=['batch_key','academic_year','subject','school_year','stream','maths_level','active_from','active_to','created_at','updated_at'];
if(stableStringify(schemaNames)!==stableStringify(exactSchema))throw new Error(`batch_definitions schema drift: ${JSON.stringify(schemaNames)}`);
const beforeRows=await d1('SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions ORDER BY batch_key');
const beforeDefs=validateDefinitions(beforeRows,'preflight');
const missing=required.filter(r=>!beforeDefs.has(r.batch_key)).map(r=>r.batch_key).sort();
if(stableStringify(missing)!==stableStringify(expectedMissing))throw new Error(`Missing-set drift ${JSON.stringify(missing)}`);
const before=await accessPopulation(studentsNs,readModelsNs),beforeMap=new Map(before.map(r=>[r.id,r]));
const anchor={ayla:{y4e1:lessonState(beforeMap.get('ayla0108')?.payload,'Y4E1'),english11:openView(beforeMap.get('ayla0108')?.payload,'english-year4-11plus')},reina:{y5m1:lessonState(beforeMap.get('rei0710')?.payload,'Y5M1'),y5m2:lessonState(beforeMap.get('rei0710')?.payload,'Y5M2'),y4e1:lessonState(beforeMap.get('rei0710')?.payload,'Y4E1'),l2:openView(beforeMap.get('rei0710')?.payload,'maths-level2'),english11:openView(beforeMap.get('rei0710')?.payload,'english-year4-11plus')}};
const baseline={marker:'CP12_BATCH_REGISTRY_V2_PREFLIGHT_PASS',generatedAt:new Date().toISOString(),apply,missing,schema,topology:{opsDep,browserDep,studentDep,browserStudent},bindings:{studentsNs,lessonsNs,db,r2,readModelsNs},students:before.length,anchor};
fs.writeFileSync('/tmp/cp12-batch-registry-v2-before.json',JSON.stringify(baseline,null,2));console.log(JSON.stringify(baseline,null,2));
if(!apply)process.exit(0);

const inserted=[];
try{
  const freshRows=await d1('SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions ORDER BY batch_key');
  const freshDefs=validateDefinitions(freshRows,'immediate-prewrite');const freshMissing=required.filter(r=>!freshDefs.has(r.batch_key)).map(r=>r.batch_key).sort();if(stableStringify(freshMissing)!==stableStringify(expectedMissing))throw new Error('Immediate missing-set drift.');
  const [freshOps,freshBrowser,freshStudent]=await Promise.all([settings(opsWorker),settings(browserWorker),settings(studentWorker)]);if(clean(bind(freshOps,'DB').database_id||bind(freshOps,'DB').id)!==dbExpected||clean(bind(freshStudent,'READ_MODELS_KV').namespace_id)!==readModelsExpected||clean(bind(freshBrowser,'STAGING_API').service||bind(freshBrowser,'STUDENT_API').service)!==studentWorker)throw new Error('Immediate topology drift.');
  const stamp=new Date().toISOString();
  for(const key of expectedMissing){const r=requiredMap.get(key);await d1('INSERT INTO batch_definitions (batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',[r.batch_key,r.academic_year,r.subject,r.school_year,r.stream,r.maths_level,r.active_from,r.active_to,stamp,stamp]);inserted.push(key);}
  const afterInsert=await d1('SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions ORDER BY batch_key');const afterDefs=validateDefinitions(afterInsert,'post-insert');if(afterDefs.size!==required.length)throw new Error(`Expected ${required.length} definitions, found ${afterDefs.size}`);
  console.log(`CP12_BATCH_REGISTRY_V2_INSERT_PASS ${inserted.length}`);
  runBackfill('apply');
  const after=await accessPopulation(studentsNs,readModelsNs),afterMap=new Map(after.map(r=>[r.id,r]));if(after.length!==before.length)throw new Error('Current student count changed.');
  for(const b of before){const a=afterMap.get(b.id);if(!a)throw new Error('Student disappeared.');if(stableStringify(b.payload.snapshot.lessonAccess)!==stableStringify(a.payload.snapshot.lessonAccess))throw new Error(`Lesson-access matrix changed for scope ${b.scopeId.slice(0,8)}`);}
  const expectedViews={aar1811:['maths-year6'],abi3007:['english-year4'],ame0503:['maths-year6'],ann3009:['maths-level3','english-year5-11plus'],ava2007:['maths-year5'],ayla0108:['english-year4-11plus'],conn2209:['maths-year6'],dha2806:['maths-level2','english-year4-11plus']};
  for(const[id,views]of Object.entries(expectedViews)){const a=afterMap.get(id);if(!a)throw new Error(`Expected current student missing ${id}`);for(const view of views)if(!openView(a.payload,view))throw new Error(`Missing repaired view ${view} for ${a.scopeId.slice(0,8)}`);}
  const ayla=afterMap.get('ayla0108'),reina=afterMap.get('rei0710');if(lessonState(ayla?.payload,'Y4E1')!=='FULL'||!openView(ayla?.payload,'english-year4-11plus'))throw new Error('Ayla anchor failed.');if(stableStringify(beforeMap.get('rei0710')?.payload)!==stableStringify(reina?.payload))throw new Error('Reina payload changed.');
  const result={marker:'CP12_BATCH_REGISTRY_V2_REPAIR_PASS',generatedAt:new Date().toISOString(),inserted,definitionCount:afterDefs.size,currentStudents:after.length,noLessonAccessMatrixChanges:true,ayla:{y4e1:lessonState(ayla.payload,'Y4E1'),english11:openView(ayla.payload,'english-year4-11plus')},reina:{y5m1:lessonState(reina.payload,'Y5M1'),y5m2:lessonState(reina.payload,'Y5M2'),y4e1:lessonState(reina.payload,'Y4E1'),l2:openView(reina.payload,'maths-level2'),english11:openView(reina.payload,'english-year4-11plus')}};fs.writeFileSync('/tmp/cp12-batch-registry-v2-after.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){console.error(error?.stack||error);if(inserted.length){try{for(const key of [...inserted].reverse())await d1('DELETE FROM batch_definitions WHERE batch_key = ?',[key]);runBackfill('rollback');console.error(`CP12_BATCH_REGISTRY_V2_ROLLBACK_PASS removed=${inserted.length}`);}catch(rb){console.error(`CP12_BATCH_REGISTRY_V2_ROLLBACK_FAILURE ${rb?.stack||rb}`);}}throw error;}
