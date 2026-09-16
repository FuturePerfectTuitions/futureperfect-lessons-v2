import fs from 'node:fs';
import { compileAccessScope, globalToCatalogue } from '../rebuild/adminops/src/lib/compiler.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { stableStringify, pointerKey, versionKey } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const clean=v=>String(v??'').trim(), norm=v=>clean(v).toLowerCase();
const account=clean(process.env.CLOUDFLARE_ACCOUNT_ID), token=clean(process.env.CLOUDFLARE_API_TOKEN);
const worker=clean(process.env.LEGACY_WORKER||'fpt-portal-v2-worker');
const readKv=clean(process.env.READ_MODELS_KV_ID||'77b35165c8694087bc1b0515c35a7e89');
const today=clean(process.env.AS_OF_DATE)||new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
if(!account||!token)throw new Error('Cloudflare credentials required');
const base='https://api.cloudflare.com/client/v4',headers={Authorization:`Bearer ${token}`};
async function req(path,opt={}){const r=await fetch(base+path,{...opt,headers:{...headers,...(opt.headers||{})}});const text=await r.text();let body=null;try{body=JSON.parse(text)}catch{}return{r,text,body}}
async function envp(path,opt={}){const o=await req(path,opt);if(!o.r.ok||o.body?.success!==true)throw new Error(`${o.r.status} ${path}`);return o.body.result}
async function kvText(ns,key){const o=await req(`/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`);if(o.r.status===404)return null;if(!o.r.ok)throw new Error(`KV ${o.r.status} ${key}`);return o.text}
async function kvJson(ns,key){const t=await kvText(ns,key);return t==null?null:JSON.parse(t)}
async function kvKeys(ns,prefix){const result=await envp(`/accounts/${account}/storage/kv/namespaces/${ns}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000`);return (result||[]).map(x=>x.name).filter(Boolean)}
async function d1(db,sql){if(!/^\s*SELECT\b/i.test(sql))throw new Error('read-only only');const result=await envp(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql})});const first=Array.isArray(result)?result[0]:result;return Array.isArray(first?.results)?first.results:[]}
function group(rows){const m=new Map();for(const row of rows){const id=norm(row.portal_user_id_norm);if(!id)continue;const a=m.get(id)||[];a.push(row);m.set(id,a)}return m}
function currentStudent(id,u){const role=norm(u?.role||u?.accountType);if(id==='admin'||role.includes('admin')||u?.isAdmin===true||u?.superuser===true)return false;const status=norm(u?.accountStatus||u?.status||'active'),expires=clean(u?.expiresOn||u?.expires);return !['inactive','disabled','expired','withdrawn'].includes(status)&&(!expires||expires>today)}
function clone(v){return JSON.parse(JSON.stringify(v))}
function removeAsOf(v){const x=clone(v);if(x?.snapshot&&typeof x.snapshot==='object')delete x.snapshot.asOfDate;return x}
function diffPaths(a,b,path='',out=[]){
  if(out.length>=40)return out;
  if(Object.is(a,b))return out;
  const aa=a&&typeof a==='object',bb=b&&typeof b==='object';
  if(!aa||!bb){out.push(path||'$');return out}
  if(Array.isArray(a)!==Array.isArray(b)){out.push(path||'$');return out}
  if(Array.isArray(a)){
    if(a.length!==b.length)out.push(`${path||'$'}.length`);
    const n=Math.min(a.length,b.length);for(let i=0;i<n&&out.length<40;i++)diffPaths(a[i],b[i],`${path}[${i}]`,out);return out;
  }
  const keys=[...new Set([...Object.keys(a),...Object.keys(b)])].sort();
  for(const k of keys){if(out.length>=40)break;if(!(k in a)||!(k in b)){out.push(path?`${path}.${k}`:k);continue}diffPaths(a[k],b[k],path?`${path}.${k}`:k,out)}return out;
}

const settings=await envp(`/accounts/${account}/workers/scripts/${encodeURIComponent(worker)}/settings`),bind=n=>(settings.bindings||[]).find(x=>x.name===n)||{};
const students=clean(bind('STUDENTS_KV').namespace_id),db=clean(bind('DB').database_id||bind('DB').id);if(!students||!db)throw new Error('source bindings missing');
const salt=clean(await kvText(readKv,'meta:scope-salt'));if(!/^[0-9a-f]{64}$/i.test(salt))throw new Error('salt bad');
const gp=await kvJson(readKv,pointerKey('global')),gv=clean(gp?.current?.version),ge=await kvJson(readKv,versionKey('global',gv));const catalogue=globalToCatalogue(ge.payload);
const [defs,assign,ents,pre]=await Promise.all([
 d1(db,'SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions'),
 d1(db,'SELECT a.portal_user_id_norm, a.batch_key, a.effective_from, a.effective_to, b.subject, b.school_year, b.stream, b.maths_level, b.active_from AS batch_active_from, b.active_to AS batch_active_to FROM student_batch_assignments a JOIN batch_definitions b ON b.batch_key=a.batch_key'),
 d1(db,'SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source, first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date FROM lesson_entitlements'),
 d1(db,'SELECT portal_user_id_norm, lesson_id, batch_key, lesson_date, vr_access, source_row_id, first_granted_at, last_confirmed_at FROM online_prelesson_entitlements')
]);
const ba=group(assign),be=group(ents),bp=group(pre),rows=[];
for(const key of (await kvKeys(students,'user:')).sort()){
 const id=norm(key.replace(/^user:/,'')),user=await kvJson(students,key);if(!user||!currentStudent(id,user))continue;
 const scopeId=await opaqueAccessScopeId(id,salt),scope=`access:${scopeId}`,p=await kvJson(readKv,pointerKey(scope)),ver=clean(p?.current?.version),e=ver?await kvJson(readKv,versionKey(scope,ver)):null,actual=e?.payload||null;
 const input={asOfDate:today,user,batchDefinitions:defs,batchAssignments:ba.get(id)||[],entitlements:be.get(id)||[],onlinePreLessonEntitlements:bp.get(id)||[]};
 const expectedToday=compileAccessScope(input,catalogue,{scopeId,asOfDate:today});
 const actualDate=clean(actual?.snapshot?.asOfDate)||today;
 const expectedAtActualDate=compileAccessScope({...input,asOfDate:actualDate},catalogue,{scopeId,asOfDate:actualDate});
 const exactToday=actual!=null&&stableStringify(actual)===stableStringify(expectedToday);
 const semanticToday=actual!=null&&stableStringify(removeAsOf(actual))===stableStringify(removeAsOf(expectedToday));
 const sameDate=actual!=null&&stableStringify(actual)===stableStringify(expectedAtActualDate);
 const paths=actual?diffPaths(actual,expectedToday):['$missing'];
 const semanticPaths=paths.filter(x=>x!=='snapshot.asOfDate');
 rows.push({portalUserIdNorm:id,actualDate,exactToday,semanticToday,sameDate,classification:exactToday?'EXACT_CURRENT':semanticToday?'DATE_ONLY':sameDate?'DATE_BOUNDARY_EFFECT':'SOURCE_DRIFT',diffPaths:paths.slice(0,20),semanticDiffPaths:semanticPaths.slice(0,20),assignmentCount:(ba.get(id)||[]).length,entitlementCount:(be.get(id)||[]).length,preLessonCount:(bp.get(id)||[]).length});
}
const counts={};for(const r of rows)counts[r.classification]=(counts[r.classification]||0)+1;
const report={marker:'FIX_IMPORTER_PREPARED_ACCESS_DIFF_DIAGNOSTIC',readOnly:true,today,currentStudents:rows.length,counts,rows};
fs.writeFileSync('/tmp/fix-importer-prepared-access-diff.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
