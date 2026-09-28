import assert from 'node:assert/strict';

const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const token=process.env.CLOUDFLARE_API_TOKEN;
assert.ok(account&&token,'Cloudflare credentials missing');
const api=`https://api.cloudflare.com/client/v4/accounts/${account}`;
const headers={Authorization:`Bearer ${token}`};
const db='97250a54-fa91-45ad-a002-3c4566b1fc38';
const studentsKv='c9723c8806334e4ea54d1b456d31b794';
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

async function d1(sql,params=[]){
  const r=await fetch(`${api}/d1/database/${db}/query`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({sql,params})});
  const body=await r.json();
  if(!r.ok||body.success!==true) throw new Error(`D1_QUERY_FAILED:${r.status}:${JSON.stringify(body.errors||body)}`);
  return body.result?.[0]?.results||[];
}
async function kvJson(key){
  const r=await fetch(`${api}/storage/kv/namespaces/${studentsKv}/values/${encodeURIComponent(key)}`,{headers});
  if(!r.ok) throw new Error(`KV_${r.status}:${key}`);
  return JSON.parse(await r.text());
}
async function cohort(batchKey){
  const rows=await d1(`SELECT portal_user_id_norm FROM student_batch_assignments WHERE batch_key=? AND effective_from<=? AND (effective_to IS NULL OR ?<effective_to) ORDER BY portal_user_id_norm`,[batchKey,today,today]);
  const out=[];
  for(const row of rows){
    const user=await kvJson(`user:${row.portal_user_id_norm}`);
    const full=new Set((user.fullLibraries||[]).map(String));
    out.push({
      l1:full.has('MATHS_L1_FULL'),
      l2:full.has('MATHS_L2_FULL'),
      y6:full.has('MATHS_Y6_FULL'),
      l3:full.has('MATHS_L3_FULL'),
      profileSchoolYear:Number(user.schoolYear||0)||null
    });
  }
  return out;
}
function aggregate(rows){
  return {
    students:rows.length,
    l1:rows.filter(r=>r.l1).length,
    l2:rows.filter(r=>r.l2).length,
    y6:rows.filter(r=>r.y6).length,
    l3:rows.filter(r=>r.l3).length,
    l1AndL2:rows.filter(r=>r.l1&&r.l2).length,
    schoolYears:[...new Set(rows.map(r=>r.profileSchoolYear).filter(Boolean))].sort((a,b)=>a-b)
  };
}
const defs=await d1(`SELECT batch_key,subject,school_year,stream,maths_level FROM batch_definitions WHERE batch_key IN ('Y611FM','Y6FM','Y511FM','Y511OM1') ORDER BY batch_key`);
console.log('DEFINITIONS='+JSON.stringify(defs));
const y611=await cohort('Y611FM');
const y6=await cohort('Y6FM');
const y511=await cohort('Y511FM');
const y511o=await cohort('Y511OM1');
console.log('Y611FM_SIGNATURE='+JSON.stringify(aggregate(y611)));
console.log('Y6FM_SIGNATURE='+JSON.stringify(aggregate(y6)));
console.log('Y511FM_SIGNATURE='+JSON.stringify(aggregate(y511)));
console.log('Y511OM1_SIGNATURE='+JSON.stringify(aggregate(y511o)));
assert.ok(y611.length>0,'Y611FM has no active students');
assert.ok(y6.length>0,'Y6FM control has no active students');
console.log('Y611FM_COHORT_SEMANTICS_READONLY_PASS');
