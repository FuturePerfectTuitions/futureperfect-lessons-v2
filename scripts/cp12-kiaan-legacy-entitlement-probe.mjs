const clean=v=>String(v??'').trim(), norm=v=>clean(v).toLowerCase();
const token=clean(process.env.CLOUDFLARE_API_TOKEN),account=clean(process.env.CLOUDFLARE_ACCOUNT_ID),worker=clean(process.env.OPS_WORKER||'fpt-portal-v2-worker');
if(!token||!account)throw new Error('Cloudflare read-only credentials required.');
const base='https://api.cloudflare.com/client/v4',headers={Authorization:`Bearer ${token}`};
async function req(path,options={}){const r=await fetch(`${base}${path}`,{...options,headers:{...headers,...(options.headers||{})}});const text=await r.text();let body=null;try{body=JSON.parse(text);}catch{}return{r,text,body};}
async function env(path,options={}){const o=await req(path,options);if(!o.r.ok||o.body?.success!==true)throw new Error(`${o.r.status} ${path}: ${o.text.slice(0,400)}`);return o.body;}
const settings=(await env(`/accounts/${account}/workers/scripts/${worker}/settings`)).result||{};const bind=n=>(settings.bindings||[]).find(x=>x.name===n)||{};
const lessonsNs=clean(bind('LESSONS_KV').namespace_id),db=clean(bind('DB').database_id||bind('DB').id);if(!lessonsNs||!db)throw new Error('Production source bindings unavailable.');
async function kvText(key){const o=await req(`/accounts/${account}/storage/kv/namespaces/${lessonsNs}/values/${encodeURIComponent(key)}`);if(o.r.status===404)return null;if(!o.r.ok)throw new Error(`KV ${o.r.status} ${key}`);return o.text;}
async function kvJson(key){const t=await kvText(key);if(t==null)return null;return JSON.parse(t);}
async function d1(sql,params=[]){const body=await env(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql,params})});const first=Array.isArray(body.result)?body.result[0]:body.result;return Array.isArray(first?.results)?first.results:[];}
const items=raw=>Array.isArray(raw)?raw:Array.isArray(raw?.lessonIds)?raw.lessonIds:Array.isArray(raw?.lessons)?raw.lessons:Array.isArray(raw?.items)?raw.items:[];
const idOf=x=>typeof x==='string'?clean(x):clean(x?.lessonId||x?.id);
const mathsL1=await kvJson('curriculum:MATHS_L1');
const ids=items(mathsL1).map(idOf).filter(Boolean);
const lessonRows=[];for(const id of ids){const row=await kvJson(`lesson:${id}`);lessonRows.push({id,title:clean(row?.title),description:clean(row?.description),exists:Boolean(row)});}
const targetIds=['Y4M24','Y4M36'];
const targetRecords={};for(const id of targetIds)targetRecords[id]=await kvJson(`lesson:${id}`);
const directViews={};for(const view of ['maths-level1','maths-year4'])directViews[view]=await kvJson(`view:${view}`);
const entitlements=await d1(`SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source, first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date FROM lesson_entitlements WHERE lesson_id IN (?, ?) ORDER BY lesson_id, portal_user_id_norm`,targetIds);
const kiaan=await d1(`SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source, first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date FROM lesson_entitlements WHERE lower(portal_user_id_norm)=? ORDER BY lesson_id`,['kiaan1312']);
const titleMatches=lessonRows.filter(r=>/transition|fractions?\s*7|estimate|money/i.test(`${r.title} ${r.description}`));
const targetInCurriculum=Object.fromEntries(targetIds.map(id=>[id,ids.includes(id)]));
const viewMembership=Object.fromEntries(Object.entries(directViews).map(([view,raw])=>[view,Object.fromEntries(targetIds.map(id=>[id,items(raw).map(idOf).includes(id)]))]));
const out={marker:'CP12_KIAAN_LEGACY_ENTITLEMENT_PROBE_PASS',generatedAt:new Date().toISOString(),readOnly:true,bindings:{lessonsNs,db},mathsL1:{count:ids.length,first:ids.slice(0,8),last:ids.slice(-8),targetInCurriculum,titleMatches},targetRecords,viewMembership,targetEntitlements:entitlements,kiaanEntitlements:kiaan};
console.log(JSON.stringify(out,null,2));