import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  stableStringify,
  publishScopeAtomic,
  resolveCurrentScope
} from '../worker/src/checkpoint4-shadow-atomic.mjs';

const VIEW_DEFINITIONS = Object.freeze({
  'maths-year2': { subject:'maths', label:'Year 2', rank:20, schoolYear:2, stream:'normal', curricula:['MATHS_Y2'] },
  'maths-year3': { subject:'maths', label:'Year 3', rank:30, schoolYear:3, stream:'normal', curricula:['MATHS_Y3'] },
  'maths-year4': { subject:'maths', label:'Year 4', rank:40, schoolYear:4, stream:'normal', curricula:['MATHS_L1'] },
  'maths-level1': { subject:'maths', label:'L1', rank:41, schoolYear:4, stream:'11plus', mathsLevel:1, curricula:['MATHS_L1'] },
  'maths-year5': { subject:'maths', label:'Year 5', rank:50, schoolYear:5, stream:'normal', curricula:['MATHS_L2'] },
  'maths-level2': { subject:'maths', label:'L2', rank:51, schoolYear:5, stream:'11plus', mathsLevel:2, curricula:['MATHS_L2'] },
  'maths-year6': { subject:'maths', label:'Year 6', rank:60, schoolYear:6, stream:'normal', curricula:['MATHS_L3','MATHS_Y6_EXTRA'] },
  'maths-level3': { subject:'maths', label:'L3', rank:61, schoolYear:6, stream:'11plus', mathsLevel:3, curricula:['MATHS_L3'] },
  'english-year2': { subject:'english', label:'Year 2', rank:20, schoolYear:2, stream:'normal', curricula:['ENGLISH_Y2'] },
  'english-year3': { subject:'english', label:'Year 3', rank:30, schoolYear:3, stream:'normal', curricula:['ENGLISH_Y3'] },
  'english-year4': { subject:'english', label:'Year 4', rank:40, schoolYear:4, stream:'normal', curricula:['ENGLISH_Y4'] },
  'english-year4-11plus': { subject:'english', label:'Year 4 11+', rank:41, schoolYear:4, stream:'11plus', curricula:['ENGLISH_Y4'] },
  'english-year5': { subject:'english', label:'Year 5', rank:50, schoolYear:5, stream:'normal', curricula:['ENGLISH_Y5'] },
  'english-year5-11plus': { subject:'english', label:'Year 5 11+', rank:51, schoolYear:5, stream:'11plus', curricula:['ENGLISH_Y5'] },
  'english-year6': { subject:'english', label:'Year 6', rank:60, schoolYear:6, stream:'normal', curricula:['ENGLISH_Y6'] }
});

const outputPath = process.argv[2] || '/tmp/checkpoint4-prod-shadow-global.json';
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const lessonsNamespaceId = String(process.env.LESSONS_KV_NAMESPACE_ID || '').trim();
const targetNamespaceId = String(process.env.REBUILD_SHADOW_KV_NAMESPACE_ID || '').trim();
const targetTitle = String(process.env.REBUILD_SHADOW_KV_TITLE || 'FPT_PORTAL_V2_REBUILD_READ_MODELS_PROD_SHADOW').trim();
const versionSuffix = String(process.env.CHECKPOINT4_VERSION_SUFFIX || '').trim();
if (!token || !accountId || !lessonsNamespaceId || !targetNamespaceId) throw new Error('Cloudflare source/target inputs required.');
if (lessonsNamespaceId === targetNamespaceId) throw new Error('Production shadow KV must be isolated from LESSONS_KV.');

const clean = value => String(value ?? '').trim();
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');

async function cfJson(url) {
  const response = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
  const body = await response.json();
  if (!response.ok || body?.success === false) throw new Error(`Cloudflare API failed: ${response.status}`);
  return body;
}

async function assertNamespace(id, expectedTitle='') {
  const body = await cfJson(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${id}`);
  if (body?.result?.id !== id) throw new Error('KV namespace ID mismatch.');
  if (expectedTitle && String(body?.result?.title || '') !== expectedTitle) throw new Error('KV namespace title mismatch.');
}

function kvUrl(id,key) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${id}/values/${encodeURIComponent(key)}`;
}

async function kvJson(id,key) {
  const response = await fetch(kvUrl(id,key), { headers:{ Authorization:`Bearer ${token}` } });
  if (!response.ok) throw new Error(`KV read failed ${response.status}: ${key}`);
  return response.json();
}

function targetStore() {
  return {
    async get(key) {
      const response = await fetch(kvUrl(targetNamespaceId,key), { headers:{ Authorization:`Bearer ${token}` } });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Target KV read failed ${response.status}`);
      return response.text();
    },
    async put(key,value) {
      const response = await fetch(kvUrl(targetNamespaceId,key), {
        method:'PUT', headers:{ Authorization:`Bearer ${token}`,'content-type':'application/json; charset=utf-8' }, body:String(value)
      });
      if (!response.ok) throw new Error(`Target KV write failed ${response.status}`);
    }
  };
}

function rawItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw.lessonIds)) return raw.lessonIds;
  if (Array.isArray(raw.lessons)) return raw.lessons;
  if (Array.isArray(raw.items)) return raw.items;
  return [];
}

function lessonIds(raw) {
  return rawItems(raw).map(item => typeof item === 'string' ? clean(item) : clean(item?.lessonId)).filter(Boolean);
}

function displayId(record,viewId) {
  for (const source of [record?.displayIds, record?.displayLessonIds, record?.presentation?.displayIds]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const match = Object.entries(source).find(([key]) => clean(key).toLowerCase() === viewId.toLowerCase());
    if (match && clean(match[1])) return clean(match[1]);
  }
  return clean(record?.lessonId);
}

function safeLesson(record,viewId) {
  if (!record || record.active === false || !clean(record.lessonId)) return null;
  const shown = displayId(record,viewId);
  let title = clean(record.title);
  for (const prefix of [clean(record.lessonId),shown]) {
    if (prefix && title.toLowerCase().startsWith(`${prefix} `.toLowerCase())) title = title.slice(prefix.length + 1).trim();
  }
  return {
    lessonId:clean(record.lessonId),
    displayLessonId:shown,
    title:title || shown,
    description:String(record.description || record.desc || ''),
    order:Number.isFinite(Number(record.order)) ? Number(record.order) : Number.MAX_SAFE_INTEGER
  };
}

async function mapConcurrent(values,limit,fn) {
  const out = new Array(values.length); let next=0;
  async function run(){ while(true){ const i=next++; if(i>=values.length) return; out[i]=await fn(values[i],i); } }
  await Promise.all(Array.from({length:Math.min(limit,values.length || 1)},run)); return out;
}

await assertNamespace(lessonsNamespaceId);
await assertNamespace(targetNamespaceId,targetTitle);
const curriculumCodes = [...new Set(Object.values(VIEW_DEFINITIONS).flatMap(def => def.curricula))].sort();
const curriculumPairs = await mapConcurrent(curriculumCodes,12,async code => [code,await kvJson(lessonsNamespaceId,`curriculum:${code}`)]);
const curricula = Object.fromEntries(curriculumPairs);
for (const code of curriculumCodes) if (lessonIds(curricula[code]).length === 0) throw new Error(`Missing curriculum ${code}`);
const ids = [...new Set(curriculumCodes.flatMap(code => lessonIds(curricula[code])))].sort();
const lessonPairs = await mapConcurrent(ids,32,async id => [id,await kvJson(lessonsNamespaceId,`lesson:${id}`)]);
const lessons = Object.fromEntries(lessonPairs);
const views = {};
const navigation = [];
const lessonToViews = {};
for (const [viewId,def] of Object.entries(VIEW_DEFINITIONS)) {
  const seen = new Set(); const rows=[];
  for (const code of def.curricula) {
    for (const id of lessonIds(curricula[code])) {
      if (seen.has(id)) continue; seen.add(id);
      const row=safeLesson(lessons[id],viewId); if(row) rows.push(row);
    }
  }
  rows.sort((a,b)=>a.order-b.order || a.lessonId.localeCompare(b.lessonId));
  views[viewId]={ viewId,subject:def.subject,label:def.label,rank:def.rank,schoolYear:def.schoolYear,stream:def.stream,...(def.mathsLevel?{mathsLevel:def.mathsLevel}:{}),lessonCount:rows.length,lessons:rows };
  navigation.push({ viewId,subject:def.subject,label:def.label,rank:def.rank,schoolYear:def.schoolYear,stream:def.stream,...(def.mathsLevel?{mathsLevel:def.mathsLevel}:{}),lessonCount:rows.length });
  for(const row of rows){ if(!lessonToViews[row.lessonId]) lessonToViews[row.lessonId]=[]; lessonToViews[row.lessonId].push(viewId); }
}
for(const id of Object.keys(lessonToViews)) lessonToViews[id].sort();
navigation.sort((a,b)=>a.subject.localeCompare(b.subject)||a.rank-b.rank||a.viewId.localeCompare(b.viewId));
const sourceRevision=sha256(JSON.stringify({curricula,lessons}));
const global={ schemaVersion:1,kind:'prepared-global-read-model',source:{type:'production-lessons-kv-readonly',revision:sourceRevision},navigation,catalogues:views,lessonToViews,counts:Object.fromEntries(navigation.map(v=>[v.viewId,v.lessonCount])) };
const payloadSha256=sha256(stableStringify(global));
const version=`g-${payloadSha256.slice(0,24)}${versionSuffix?`-${versionSuffix}`:''}`;
const published=await publishScopeAtomic(targetStore(),{scope:'global',payload:global,version});
const resolved=await resolveCurrentScope(targetStore(),'global');
if(resolved.sha256!==published.payloadSha256) throw new Error('Global model verification failed.');
const evidence={ marker:'CHECKPOINT4_PROD_SHADOW_GLOBAL_PASS',sourceRevision,canonicalLessonIds:ids.length,views:navigation.length,version:published.version,payloadSha256:published.payloadSha256,envelopeSha256:published.envelopeSha256,payloadBytes:Buffer.byteLength(stableStringify(global)) };
fs.writeFileSync(outputPath,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
