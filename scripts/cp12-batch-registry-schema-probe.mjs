const clean=v=>String(v??'').trim();
const token=clean(process.env.CLOUDFLARE_API_TOKEN), account=clean(process.env.CLOUDFLARE_ACCOUNT_ID), db=clean(process.env.EXPECTED_D1_ID||'97250a54-fa91-45ad-a002-3c4566b1fc38');
if(!token||!account||!db)throw new Error('Missing Cloudflare read-only inputs.');
const base='https://api.cloudflare.com/client/v4', headers={Authorization:`Bearer ${token}`,'content-type':'application/json'};
async function q(sql){const r=await fetch(`${base}/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers,body:JSON.stringify({sql})});const text=await r.text();let body=null;try{body=JSON.parse(text);}catch{}if(!r.ok||body?.success!==true)throw new Error(`${r.status} ${text.slice(0,500)}`);const first=Array.isArray(body.result)?body.result[0]:body.result;return Array.isArray(first?.results)?first.results:[];}
const schema=await q('PRAGMA table_info(batch_definitions)');
const rows=await q('SELECT * FROM batch_definitions ORDER BY batch_key LIMIT 10');
console.log(JSON.stringify({marker:'CP12_BATCH_REGISTRY_SCHEMA_PROBE_PASS',schema,rows},null,2));