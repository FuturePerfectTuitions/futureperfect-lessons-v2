import fs from 'node:fs';

const token=String(process.env.CLOUDFLARE_API_TOKEN||'').trim();
const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const worker=String(process.env.PROD_WORKER||process.env.WORKER_NAME||'fpt-portal-v2-worker').trim();
const asOf=String(process.env.CHECKPOINT11_AS_OF_DATE||process.env.CHECKPOINT8_AS_OF_DATE||'2026-09-14').trim();
if(!token||!account)throw new Error('Cloudflare read-only credentials are required.');
const base='https://api.cloudflare.com/client/v4',headers={Authorization:`Bearer ${token}`};
const clean=v=>String(v??'').trim(),norm=v=>clean(v).toLowerCase();
async function envelope(path){const r=await fetch(`${base}${path}`,{headers});const b=await r.json().catch(()=>null);if(!r.ok||b?.success!==true)throw new Error(`Cloudflare read failed: ${r.status} ${path}`);return b;}
async function kvText(ns,key){const r=await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{headers});if(r.status===404)return null;if(!r.ok)throw new Error(`KV read failed: ${r.status}`);return r.text();}
async function kvJson(ns,key){const text=await kvText(ns,key);if(text==null)return null;try{return JSON.parse(text);}catch{return null;}}
async function kvKeys(ns,prefix){const out=[];let cursor='';do{const q=new URLSearchParams({limit:'1000',prefix});if(cursor)q.set('cursor',cursor);const b=await envelope(`/accounts/${account}/storage/kv/namespaces/${ns}/keys?${q}`);out.push(...(b.result||[]).map(x=>x.name).filter(Boolean));cursor=clean(b.result_info?.cursor);}while(cursor);return out;}
const settings=(await envelope(`/accounts/${account}/workers/scripts/${worker}/settings`)).result||{};const binding=name=>(settings.bindings||[]).find(x=>x.name===name)||{};
const studentsNs=clean(binding('STUDENTS_KV').namespace_id),lessonsNs=clean(binding('LESSONS_KV').namespace_id);if(!studentsNs||!lessonsNs)throw new Error('Production student/lesson bindings were not resolved.');
const counts=new Map(),manualCounts=new Map(),directCounts=new Map();let currentProfiles=0,profilesWithSpecialAreas=0;
for(const key of await kvKeys(studentsNs,'user:')){const id=norm(key.replace(/^user:/,'')),user=await kvJson(studentsNs,key);if(!user)continue;const role=norm(user.role||user.accountType);if(id==='admin'||role.includes('admin')||user.isAdmin===true||user.superuser===true)continue;const status=norm(user.accountStatus||user.status||'active'),expires=clean(user.expiresOn||user.expires);if(['inactive','disabled','expired','withdrawn'].includes(status)||(expires&&expires<=asOf))continue;currentProfiles++;
 const manual=[...new Set((Array.isArray(user?.manualAccess?.specialBuckets)?user.manualAccess.specialBuckets:[]).map(v=>clean(v).toUpperCase()).filter(Boolean))];
 const direct=[...new Set((Array.isArray(user.specialAccess)?user.specialAccess:[]).map(v=>clean(v).toUpperCase()).filter(Boolean))];
 const tokens=[...new Set([...manual,...direct])];if(tokens.length)profilesWithSpecialAreas++;
 for(const special of tokens)counts.set(special,(counts.get(special)||0)+1);for(const special of manual)manualCounts.set(special,(manualCounts.get(special)||0)+1);for(const special of direct)directCounts.set(special,(directCounts.get(special)||0)+1);
}
const areas=[];for(const [special,profileCount] of [...counts.entries()].sort()){const catalogue=await kvJson(lessonsNs,`special:${special}`);const items=Array.isArray(catalogue?.items)?catalogue.items:[];const itemTypes=[...new Set(items.map(item=>clean(item?.type||(item?.video?'video':'item'))).filter(Boolean))].sort();const videoItems=items.filter(item=>Boolean(item?.video?.screenpal||item?.video?.url||item?.video?.targetUrl)).length;const r2Items=items.filter(item=>Boolean(item?.r2Key||item?.r2||item?.objectKey||item?.storageKey)).length;areas.push({bucketId:special,profileCount,manualSpecialBucketProfileCount:manualCounts.get(special)||0,directSpecialAccessProfileCount:directCounts.get(special)||0,cataloguePresent:Boolean(catalogue),active:catalogue?.active!==false,type:clean(catalogue?.type)||null,title:clean(catalogue?.title)||null,itemCount:items.length,itemTypes,videoItems,r2Items});}
const result={marker:'REBUILD_CHECKPOINT11_SPECIAL_AREA_INVENTORY_READONLY',asOfDate:asOf,currentProfiles,profilesWithSpecialAreas,areaCount:areas.length,areas,studentIdentitiesIncluded:false,productionMutation:false};
fs.writeFileSync('/tmp/checkpoint11-special-area-inventory.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
