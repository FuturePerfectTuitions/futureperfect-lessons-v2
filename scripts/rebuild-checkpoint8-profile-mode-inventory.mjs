import fs from 'node:fs';
import { compileGlobalScope, globalToCatalogue } from '../rebuild/adminops/src/lib/compiler.mjs';
import { viewIdForBatch } from '../rebuild/shared/read-models/view-registry.mjs';

const clean=v=>String(v??'').trim(), norm=v=>clean(v).toLowerCase();
const token=clean(process.env.CLOUDFLARE_API_TOKEN), account=clean(process.env.CLOUDFLARE_ACCOUNT_ID), worker=clean(process.env.WORKER_NAME||'fpt-portal-v2-worker');
const retiredCatalogIds=new Set(clean(process.env.RETIRED_CATALOG_LESSON_IDS).split(',').map(clean).filter(Boolean));
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
const definitions=await d1(dbId,'SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions ORDER BY batch_key');
const defMap=new Map(definitions.map(row=>[clean(row.batch_key),row]));
const report=JSON.parse(fs.readFileSync('/tmp/cp12-entitlement-population-audit.json','utf8'));
const missingDefs=new Map(), affected=[], retired=[];
for(const student of report.students||[]){
  const visible=new Set(Object.entries(student.expectedViews||{}).filter(([,v])=>v?.lockedPreview!==true).map(([id])=>id));
  const issues=[], retiredIssues=[];
  for(const row of student.sourceEntitlements||[]){
    const lessonId=clean(row.lessonId), batchKey=clean(row.sourceBatchCode), candidates=catalogue.lessonToViews?.[lessonId]||[], definition=defMap.get(batchKey)||null;
    if(batchKey&&!definition)missingDefs.set(batchKey,(missingDefs.get(batchKey)||0)+1);
    const mapped=definition?viewIdForBatch(definition):(candidates.length===1?candidates[0]:'');
    const routed=candidates.some(view=>visible.has(view));
    if((Number(row.coreAccess||0)!==0||Number(row.vrAccess||0)===1)&&!routed){
      const detail={lessonId,batchKey,batchDefinitionPresent:Boolean(definition),mappedView:mapped||null,candidateViews:candidates,visibleViews:[...visible].sort(),coreAccess:Number(row.coreAccess||0),vrAccess:Number(row.vrAccess||0),sourceLessonDate:clean(row.sourceLessonDate)};
      if(retiredCatalogIds.has(lessonId)&&candidates.length===0){
        const record=await kv(lessonsNs,`lesson:${lessonId}`);
        retiredIssues.push({kind:'RETIRED_CATALOGUE_ENTITLEMENT',...detail,lessonRecordExists:Boolean(record),lessonTitle:clean(record?.title),lessonRecordActive:record?.active===true,classificationBasis:'explicitly retired from current authoritative curriculum; historical entitlement retained in D1 but is not a live-catalogue route defect'});
      }else{
        issues.push({kind:'FULL_ENTITLEMENT_NO_VISIBLE_VIEW',...detail});
      }
    }
  }
  for(const row of student.onlinePreLessonEntitlements||[]){
    const lessonId=clean(row.lessonId), batchKey=clean(row.batchKey), candidates=catalogue.lessonToViews?.[lessonId]||[], definition=defMap.get(batchKey)||null;
    if(batchKey&&!definition)missingDefs.set(batchKey,(missingDefs.get(batchKey)||0)+1);
    const mapped=definition?viewIdForBatch(definition):(candidates.length===1?candidates[0]:'');
    const routed=candidates.some(view=>visible.has(view));
    if(!routed)issues.push({kind:'PRELESSON_ENTITLEMENT_NO_VISIBLE_VIEW',lessonId,batchKey,batchDefinitionPresent:Boolean(definition),mappedView:mapped||null,candidateViews:candidates,visibleViews:[...visible].sort(),lessonDate:clean(row.lessonDate)});
  }
  if(issues.length)affected.push({portalUserId:student.portalUserId,firstName:student.firstName,issues});
  if(retiredIssues.length)retired.push({portalUserId:student.portalUserId,firstName:student.firstName,retiredEntitlements:retiredIssues});
}
const out={marker:'CP12_ENTITLEMENT_ROUTE_AUDIT',generatedAt:new Date().toISOString(),readOnly:true,batchDefinitionCount:definitions.length,batchDefinitions:definitions.map(row=>({...row,mappedView:viewIdForBatch(row)||null})),missingReferencedBatchDefinitions:[...missingDefs.entries()].sort().map(([batchKey,rowCount])=>({batchKey,rowCount})),liveRouteDefectCount:affected.reduce((n,x)=>n+x.issues.length,0),affectedStudentCount:affected.length,affectedStudentIds:affected.map(x=>x.portalUserId),retiredCatalogueEntitlementCount:retired.reduce((n,x)=>n+x.retiredEntitlements.length,0),retiredCatalogueStudentCount:retired.length,retired,affected};
fs.writeFileSync('/tmp/cp12-entitlement-route-audit.json',JSON.stringify(out,null,2));console.log(JSON.stringify({marker:out.marker,batchDefinitionCount:out.batchDefinitionCount,missingReferencedBatchDefinitions:out.missingReferencedBatchDefinitions,liveRouteDefectCount:out.liveRouteDefectCount,affectedStudentCount:out.affectedStudentCount,affectedStudentIds:out.affectedStudentIds,retiredCatalogueEntitlementCount:out.retiredCatalogueEntitlementCount,retiredCatalogueStudentCount:out.retiredCatalogueStudentCount,retired:out.retired,affected:out.affected},null,2));
if(out.liveRouteDefectCount!==0||out.affectedStudentCount!==0||out.missingReferencedBatchDefinitions.length!==0)throw new Error('Unexplained live entitlement-route defects remain.');
