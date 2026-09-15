import fs from 'node:fs';
import { compileLessonDetail } from '../rebuild/adminops/src/lib/compiler.mjs';
import { stableStringify, sha256Hex, versionKey } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const clean = value => String(value ?? '').trim();
const action = clean(process.env.CP12_METADATA_ACTION || 'apply').toLowerCase();
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const lessonsKv = clean(process.env.EXPECTED_LESSONS_KV);
const readKv = clean(process.env.EXPECTED_READ_MODELS_KV);
const runId = clean(process.env.GITHUB_RUN_ID || 'manual');
const backupPath = clean(process.env.CP12_METADATA_BACKUP || '/tmp/cp12-resource-ui-pointer-backup.json');
const reportPath = clean(process.env.CP12_METADATA_REPORT || '/tmp/cp12-resource-ui-metadata-report.json');

if (!account || !token || !readKv) throw new Error('Cloudflare account/token and READ_MODELS_KV are required.');
if (action !== 'rollback' && !lessonsKv) throw new Error('LESSONS_KV is required for metadata publication.');

const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const authHeaders = { Authorization: `Bearer ${token}` };
const allowedGroups = new Set(['core-prelesson','core-homework','core-other','core-cumulative','core-answers','elevenplus-prelesson','elevenplus-homework','elevenplus-cumulative','elevenplus-answers','vr-prelesson','vr-homework','vr-answers']);

async function cf(path, options = {}) {
  const response = await fetch(`${api}${path}`, { ...options, headers:{ ...authHeaders, ...(options.headers || {}) } });
  const text = await response.text(); let body=null; try { body=JSON.parse(text); } catch {}
  if (!response.ok || body?.success !== true) throw new Error(`Cloudflare request failed ${response.status}: ${path}`);
  return body;
}
async function kvRaw(ns,key){const r=await fetch(`${api}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{headers:authHeaders});if(r.status===404)return null;if(!r.ok)throw new Error(`KV read failed ${r.status}:${key}`);return r.text();}
async function kvJson(ns,key){const text=await kvRaw(ns,key);return text==null?null:JSON.parse(text);}
async function listKeys(ns,prefix){let cursor='',out=[];do{const q=new URLSearchParams({prefix,limit:'1000'});if(cursor)q.set('cursor',cursor);const body=await cf(`/storage/kv/namespaces/${ns}/keys?${q}`);out.push(...(body.result||[]).map(x=>clean(x.name)).filter(Boolean));cursor=clean(body.result_info?.cursor);}while(cursor);return out;}
async function bulkPut(ns,rows){if(!rows.length)return;const body=await cf(`/storage/kv/namespaces/${ns}/bulk`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(rows)});if((body.result?.unsuccessful_keys||[]).length)throw new Error('KV bulk put incomplete.');}
function stripGroups(value){if(Array.isArray(value))return value.map(stripGroups);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>k!=='presentationGroup').map(([k,v])=>[k,stripGroups(v)]));return value;}

if(action==='rollback'){
  const backup=JSON.parse(fs.readFileSync(backupPath,'utf8'));
  if(backup?.marker!=='CP12_RESOURCE_UI_POINTER_BACKUP'||!Array.isArray(backup.rows)||!backup.rows.length)throw new Error('Valid metadata backup is required for rollback.');
  await bulkPut(readKv,backup.rows.map(row=>({key:row.pointerKey,value:JSON.stringify(row.pointer)})));
  for(const row of backup.rows){const now=await kvJson(readKv,row.pointerKey);if(stableStringify(now)!==stableStringify(row.pointer))throw new Error(`Rollback verification failed:${row.pointerKey}`);}
  const report={marker:'CP12_RESOURCE_UI_METADATA_ROLLBACK_PASS',status:'PASS',restoredPointers:backup.rows.length,reason:clean(process.env.CP12_ROLLBACK_REASON),sourceLessonWrites:0,accessScopesChanged:false};fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));process.exit(0);
}

const pointerKeys=(await listKeys(readKv,'rm:v1:scope:lesson_3A')).filter(k=>k.endsWith(':current')).sort();
if(pointerKeys.length<250)throw new Error(`Unexpected lesson pointer count:${pointerKeys.length}`);
const backup={marker:'CP12_RESOURCE_UI_POINTER_BACKUP',createdAt:new Date().toISOString(),runId,rows:[]};
const writes=[];let changed=0,unchanged=0,resources=0,grouped=0;
for(const pointerKey of pointerKeys){
  const pointer=await kvJson(readKv,pointerKey),scope=clean(pointer?.scope),version=clean(pointer?.current?.version);
  if(!scope.startsWith('lesson:')||!version)throw new Error(`Invalid pointer:${pointerKey}`);
  backup.rows.push({pointerKey,pointer});
  const lessonId=scope.slice(7),record=await kvJson(lessonsKv,`lesson:${lessonId}`);if(!record)throw new Error(`Missing lesson source:${lessonId}`);
  const candidate=await compileLessonDetail(record,{resourceExists:async()=>true});
  const currentKey=versionKey(scope,version),currentEnv=await kvJson(readKv,currentKey);if(!currentEnv?.payload)throw new Error(`Missing current envelope:${scope}`);
  if(stableStringify(stripGroups(currentEnv.payload))!==stableStringify(stripGroups(candidate)))throw new Error(`Non-presentationGroup drift:${scope}`);
  for(const resource of candidate.resources||[]){resources++;const group=clean(resource.presentationGroup);if(!allowedGroups.has(group))throw new Error(`Missing or invalid presentationGroup:${scope}:${group}`);grouped++;}
  if(stableStringify(currentEnv.payload)===stableStringify(candidate)){unchanged++;continue;}
  changed++;
  const payloadText=stableStringify(candidate),payloadSha=await sha256Hex(payloadText);
  const newVersion=`cp12-ui-${runId}-${lessonId}-${payloadSha.slice(0,12)}`;
  const envelope={schemaVersion:1,kind:'prepared-read-model-envelope',scope,version:newVersion,sha256:payloadSha,payload:candidate};
  const envelopeText=stableStringify(envelope),envelopeSha=await sha256Hex(envelopeText);
  const previous=pointer.current;
  const nextPointer={...pointer,current:{version:newVersion,sha256:payloadSha,envelopeSha256:envelopeSha},previous,updatedAt:new Date().toISOString()};
  writes.push({key:versionKey(scope,newVersion),value:envelopeText},{key:pointerKey(scope),value:stableStringify(nextPointer)});
}
if(resources!==grouped)throw new Error('Not all resources have presentationGroup.');
if(changed<300)throw new Error(`Unexpectedly small metadata migration:${changed}`);
fs.writeFileSync(backupPath,JSON.stringify(backup,null,2)+'\n');
for(let i=0;i<writes.length;i+=500)await bulkPut(readKv,writes.slice(i,i+500));
for(const row of backup.rows){const now=await kvJson(readKv,row.pointerKey);if(!now?.current?.version)throw new Error(`Published pointer missing:${row.pointerKey}`);}
const report={marker:'CP12_RESOURCE_UI_METADATA_APPLY_PASS',status:'PASS',publishedLessonScopes:pointerKeys.length,changedLessonScopes:changed,unchangedLessonScopes:unchanged,totalResources:resources,groupedResources:grouped,onlyPresentationGroupChanged:true,accessScopesChanged:false,sourceLessonWrites:0,backupPath};fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));