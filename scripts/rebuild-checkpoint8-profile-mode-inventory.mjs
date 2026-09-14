import fs from 'node:fs';
import { compileGlobalScope, globalToCatalogue } from '../rebuild/adminops/src/lib/compiler.mjs';
import { viewIdForBatch } from '../rebuild/shared/read-models/view-registry.mjs';

const clean=v=>String(v??'').trim(), norm=v=>clean(v).toLowerCase();
const token=clean(process.env.CLOUDFLARE_API_TOKEN), account=clean(process.env.CLOUDFLARE_ACCOUNT_ID), worker=clean(process.env.WORKER_NAME||'fpt-portal-v2-worker');
if(!token||!account) throw new Error('Cloudflare read-only credentials are required.');
const base='https://api.cloudflare.com/client/v4', headers={Authorization:`Bearer ${token}`};
async function request(path,options={}){const r=await fetch(`${base}${path}`,{...options,headers:{...headers,...(options.headers||{})}});const text=await r.text();let body=null;try{body=JSON.parse(text);}catch{}if(!r.ok||body?.success!==true)throw new Error(`Cloudflare read failed: ${r.status} ${path}`);return body;}
async function kv(ns,key){const r=await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{headers});if(r.status===404)return null;if(!r.ok)throw new Error(`KV read failed: ${r.status} ${key}`);return r.json().catch(()=>null);}
async function d1(db,sql){if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql))throw new Error('Read-only SQL only.');const body=await request(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql})});const first=Array.isArray(body.result)?body.result[0]:body.result;return Array.isArray(first?.results)?first.results:[];}
const settings=(await request(`/accounts/${account}/workers/scripts/${worker}/settings`)).result||{}, binding=name=>(settings.bindings||[]).find(x=>x.name===name)||{};
const lessonsNs=clean(binding('LESSONS_KV').namespace_id), dbId=clean(binding('DB').database_id||binding('DB').id);if(!lessonsNs||!dbId)throw new Error('Production LESSONS_KV/DB bindings unavailable.');
const curriculumCodes=['MATHS_Y2','MATHS_Y3','MATHS_L1','MATHS_L2','MATHS_L3','MATHS_Y6_EXTRA','ENGLISH_Y2','ENGLISH_Y3','ENGLISH_Y4','ENGLISH_Y5','ENGLISH_Y6'];
const fallback={MATHS_Y2:['maths-year2'],MATHS_Y3:['maths-year3'],MATHS_L1:['maths-year4','maths-level1'],MATHS_L2:['maths-year5','maths-level2'],MATHS_L3:['maths-level3','maths-year6'],MATHS_Y6_EXTRA:['maths-year6-extra'],ENGLISH_Y2:['english-year2'],ENGLISH_Y3:['english-year3'],ENGLISH_Y4:['english-year4','english-year4-11plus'],ENGLISH_Y5:['english-year5','english-year5-11plus'],ENGLISH_Y6:['english-year6']};
const items=raw=>Array.isArray(raw)?raw:Array.isArray(raw?.lessonIds)?raw.lessonIds:Array.isArray(raw?.lessons)?raw.lessons:Array.isArray(raw?.items)?raw.items:[];
const curricula={}, ids=new Set();
for(const code of curriculumCodes){let raw=await kv(lessonsNs,`curriculum:${code}`);if(!items(raw).length)for(const view of fallback[code]||[]){const probe=await kv(lessonsNs,`view:${view}`);if(items(probe).length){raw=probe;break;}}const rows=items(raw);curricula[code]={lessonIds:rows.map(x=>typeof x==='string'?clean(x):clean(x?.lessonId)).filter(Boolean)};for(const id of curricula[code].lessonIds)ids.add(id);}
const lessons={};for(const id of [...ids].sort()){const row=await kv(lessonsNs,`lesson:${id}`);if(row)lessons[id]=row;}
const catalogue=globalToCatalogue(compileGlobalScope({sourceType:'cp12-entitlement-route-audit',sourceRevision:'2026-09-14',curricula,lessons},{sourceType:'cp12-entitlement-route-audit',sourceRevision:'2026-09-14'}));
const definitions=await d1(dbId,'SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions');
const defMap=new Map(definitions.map(row=>[clean(row.batch_key),row]));
const report=JSON.parse(fs.readFileSync('/tmp/cp12-entitlement-population-audit.json','utf8'));
const missingDefs=new Map(), affected=[];
for(const student of report.students||[]){
  const visible=new Set(Object.entries(student.expectedViews||{}).filter(([,v])=>v?.lockedPreview!==true).map(([id])=>id));
  const issues=[];
  for(const row of student.sourceEntitlements||[]){
    const lessonId=clean(row.lessonId), batchKey=clean(row.sourceBatchCode), candidates=catalogue.lessonToViews?.[lessonId]||[], definition=defMap.get(batchKey)||null;
    if(batchKey&&!definition)missingDefs.set(batchKey,(missingDefs.get(batchKey)||0)+1);
    const mapped=definition?viewIdForBatch(definition):(candidates.length===1?candidates[0]:'');
    const routed=candidates.some(view=>visible.has(view));
    if((Number(row.coreAccess||0)!==0||Number(row.vrAccess||0)===1)&&!routed){issues.push({kind:'FULL_ENTITLEMENT_NO_VISIBLE_VIEW',lessonId,batchKey,batchDefinitionPresent:Boolean(definition),mappedView:mapped||null,candidateViews:candidates,visibleViews:[...visible].sort(),coreAccess:Number(row.coreAccess||0),vrAccess:Number(row.vrAccess||0),sourceLessonDate:clean(row.sourceLessonDate)});}
  }
  for(const row of student.onlinePreLessonEntitlements||[]){
    const lessonId=clean(row.lessonId), batchKey=clean(row.batchKey), candidates=catalogue.lessonToViews?.[lessonId]||[], definition=defMap.get(batchKey)||null;
    if(batchKey&&!definition)missingDefs.set(batchKey,(missingDefs.get(batchKey)||0)+1);
    const mapped=definition?viewIdForBatch(definition):(candidates.length===1?candidates[0]:'');
    const routed=candidates.some(view=>visible.has(view));
    if(!routed)issues.push({kind:'PRELESSON_ENTITLEMENT_NO_VISIBLE_VIEW',lessonId,batchKey,batchDefinitionPresent:Boolean(definition),mappedView:mapped||null,candidateViews:candidates,visibleViews:[...visible].sort(),lessonDate:clean(row.lessonDate)});
  }
  if(issues.length)affected.push({portalUserId:student.portalUserId,firstName:student.firstName,issues});
}
const out={marker:'CP12_ENTITLEMENT_ROUTE_AUDIT',generatedAt:new Date().toISOString(),readOnly:true,batchDefinitionCount:definitions.length,missingReferencedBatchDefinitions:[...missingDefs.entries()].sort().map(([batchKey,rowCount])=>({batchKey,rowCount})),affectedStudentCount:affected.length,affectedStudentIds:affected.map(x=>x.portalUserId),affected};
fs.writeFileSync('/tmp/cp12-entitlement-route-audit.json',JSON.stringify(out,null,2));console.log(JSON.stringify({marker:out.marker,batchDefinitionCount:out.batchDefinitionCount,missingReferencedBatchDefinitions:out.missingReferencedBatchDefinitions,affectedStudentCount:out.affectedStudentCount,affectedStudentIds:out.affectedStudentIds,affected:out.affected},null,2));
