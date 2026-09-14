import { compileAccessScope } from '../rebuild/adminops/src/lib/compiler.mjs';

const token=process.env.CLOUDFLARE_API_TOKEN||'', account=process.env.CLOUDFLARE_ACCOUNT_ID||'', worker=process.env.WORKER_NAME||'fpt-portal-v2-worker', asOf=process.env.CHECKPOINT8_AS_OF_DATE||'2026-09-13';
const cp11Gate=Boolean(process.env.CHECKPOINT11_AS_OF_DATE);
if(!token||!account) throw new Error('Cloudflare read-only credentials are required.');
const base='https://api.cloudflare.com/client/v4', headers={Authorization:`Bearer ${token}`}, clean=v=>String(v??'').trim(), norm=v=>clean(v).toLowerCase();
async function env(path){const r=await fetch(`${base}${path}`,{headers});const b=await r.json().catch(()=>null);if(!r.ok||b?.success!==true)throw new Error(`Cloudflare read failed: ${r.status}`);return b;}
async function get(ns,key){const r=await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{headers});if(r.status===404)return null;if(!r.ok)throw new Error(`KV read failed: ${r.status}`);return r.json().catch(()=>null);}
async function keys(ns,prefix){const out=[];let cursor='';do{const q=new URLSearchParams({limit:'1000',prefix});if(cursor)q.set('cursor',cursor);const b=await env(`/accounts/${account}/storage/kv/namespaces/${ns}/keys?${q}`);out.push(...(b.result||[]).map(x=>x.name).filter(Boolean));cursor=clean(b.result_info?.cursor);}while(cursor);return out;}
const settings=(await env(`/accounts/${account}/workers/scripts/${worker}/settings`)).result, binding=(settings.bindings||[]).find(x=>x.name==='STUDENTS_KV'), ns=clean(binding?.namespace_id);if(!ns)throw new Error('STUDENTS_KV binding was not resolved.');
const emptyCatalogue={schemaVersion:1,kind:'prepared-catalogue',source:{},navigation:[],views:{},lessonToViews:{}};
let audited=0,withSpecial=0,mismatches=0;const tokenCounts=new Map(),manualCounts=new Map(),directCounts=new Map();
for(const key of await keys(ns,'user:')){
  const id=norm(key.replace(/^user:/,'')),u=await get(ns,key);if(!u)continue;const role=norm(u.role||u.accountType);if(id==='admin'||role.includes('admin')||u.isAdmin===true||u.superuser===true)continue;const status=norm(u.accountStatus||u.status||'active'),expires=clean(u.expiresOn||u.expires);if(['inactive','disabled','expired','withdrawn'].includes(status)||(expires&&expires<=asOf))continue;
  audited++;
  const direct=[...new Set((Array.isArray(u.specialAccess)?u.specialAccess:[]).map(v=>clean(v).toUpperCase()).filter(Boolean))];
  const manual=[...new Set((Array.isArray(u.manualAccess?.specialBuckets)?u.manualAccess.specialBuckets:[]).map(v=>clean(v).toUpperCase()).filter(Boolean))];
  const expected=[...new Set([...direct,...manual])].sort();
  if(expected.length)withSpecial++;
  for(const value of expected)tokenCounts.set(value,(tokenCounts.get(value)||0)+1);
  for(const value of manual)manualCounts.set(value,(manualCounts.get(value)||0)+1);
  for(const value of direct)directCounts.set(value,(directCounts.get(value)||0)+1);
  const actual=compileAccessScope({asOfDate:asOf,user:u,batchDefinitions:[],batchAssignments:[],entitlements:[],onlinePreLessonEntitlements:[]},emptyCatalogue,{scopeId:'cp8-special',asOfDate:asOf}).snapshot.specialAreas;
  if(JSON.stringify(expected)!==JSON.stringify(actual))mismatches++;
}
const counts=map=>Object.fromEntries([...map.entries()].sort(([a],[b])=>a.localeCompare(b)));
const supportedForCp11=new Set(['VR_HOWTO']);
const unsupportedForCp11=[...tokenCounts.keys()].filter(value=>!supportedForCp11.has(value)).sort();
const cutoverCompatible=!cp11Gate||unsupportedForCp11.length===0;
const status=mismatches===0&&cutoverCompatible?'PASS':'FAIL';
const result={marker:'REBUILD_CHECKPOINT8_SPECIAL_AREA_PARITY',asOfDate:asOf,status,auditedCurrentProfiles:audited,profilesWithSpecialAreas:withSpecial,mismatchCount:mismatches,tokenCounts:counts(tokenCounts),manualTokenCounts:counts(manualCounts),directTokenCounts:counts(directCounts),cp11RuntimeGate:{enabled:cp11Gate,supported:[...supportedForCp11],unsupportedCurrentTokens:unsupportedForCp11,compatible:cutoverCompatible}};
console.log(JSON.stringify(result,null,2));if(status!=='PASS')process.exitCode=1;
