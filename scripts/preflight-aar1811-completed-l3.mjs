import { compileAccessScopeV2 } from '../rebuild/adminops/src/lib/access-compiler-v2.mjs';
import { PREPARED_CATALOGUE } from '../rebuild/student/src/prepared-catalogue.generated.js';

const token=String(process.env.CLOUDFLARE_API_TOKEN||'').trim();
const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const studentsNs=String(process.env.STUDENTS_KV_ID||'').trim();
const db=String(process.env.DB_ID||'').trim();
const asOf='2026-09-28';
const id='aar1811';
if(!token||!account||!studentsNs||!db) throw new Error('PRODUCTION_READ_INPUTS_REQUIRED');
if(!PREPARED_CATALOGUE) throw new Error('PREPARED_CATALOGUE_REQUIRED');
const base='https://api.cloudflare.com/client/v4';
const auth={Authorization:`Bearer ${token}`};

async function cfJson(path,init={}){
  const r=await fetch(`${base}${path}`,{...init,headers:{...auth,...(init.headers||{})}});
  const b=await r.json().catch(()=>null);
  if(!r.ok||b?.success!==true) throw new Error(`CF_FAILED:${r.status}:${path}`);
  return b;
}
async function d1(sql,params=[]){
  if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql)) throw new Error('READ_ONLY_SQL_ONLY');
  const b=await cfJson(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql,params})});
  return (Array.isArray(b.result)?b.result[0]:b.result)?.results||[];
}
async function kvJson(key){
  const r=await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${studentsNs}/values/${encodeURIComponent(key)}`,{headers:auth});
  if(!r.ok) throw new Error(`KV_GET_FAILED:${r.status}`);
  return r.json();
}
const user=await kvJson(`user:${id}`);
const [defs,assignments,entitlements,pre]=await Promise.all([
  d1('SELECT batch_key,academic_year,subject,school_year,stream,maths_level,active_from,active_to FROM batch_definitions ORDER BY batch_key'),
  d1('SELECT a.assignment_id,a.batch_key,a.effective_from,a.effective_to,b.subject,b.school_year,b.stream,b.maths_level,b.active_from AS batch_active_from,b.active_to AS batch_active_to FROM student_batch_assignments a LEFT JOIN batch_definitions b ON b.batch_key=a.batch_key WHERE a.portal_user_id_norm=? ORDER BY a.effective_from,a.assignment_id',[id]),
  d1('SELECT lesson_id,core_access,vr_access,source,source_batch_code,source_lesson_date,first_granted_at,last_confirmed_at FROM lesson_entitlements WHERE portal_user_id_norm=? ORDER BY source_lesson_date,lesson_id',[id]),
  d1('SELECT lesson_id,batch_key,lesson_date,vr_access,source_row_id,first_granted_at,last_confirmed_at FROM online_prelesson_entitlements WHERE portal_user_id_norm=? ORDER BY lesson_date,lesson_id',[id])
]);

const full=new Set((user.fullLibraries||[]).map(v=>String(v).toUpperCase()));
for(const required of ['MATHS_L1_FULL','MATHS_L2_FULL']) if(!full.has(required)) throw new Error(`MISSING_EXISTING_${required}`);
if(!full.has('MATHS_Y3_FULL')) throw new Error('EXPECTED_Y3_SOURCE_NOT_PRESENT');
if(!full.has('MATHS_Y6_FULL')) throw new Error('EXPECTED_Y6_SOURCE_NOT_PRESENT');
if(full.has('MATHS_L3_FULL')) throw new Error('L3_ALREADY_PRESENT_UNEXPECTED');
if((user.specialAccess||[]).includes('MATHS_11PLUS_QUIZ_L3_COMPLETED')) throw new Error('COMPLETED_L3_ALREADY_PRESENT_UNEXPECTED');

const activeY6=assignments.filter(r=>r.batch_key==='Y611FM' && (!r.effective_to || asOf<r.effective_to));
if(activeY6.length!==1) throw new Error(`EXPECTED_ONE_ACTIVE_Y611FM:${activeY6.length}`);
const simulatedUser=structuredClone(user);
simulatedUser.fullLibraries=[...(user.fullLibraries||[]).filter(v=>!['MATHS_Y3_FULL','MATHS_Y6_FULL'].includes(String(v).toUpperCase())),'MATHS_L3_FULL'];
simulatedUser.specialAccess=[...new Set([...(user.specialAccess||[]),'MATHS_11PLUS_QUIZ_L3_COMPLETED'])];
const simulatedAssignments=assignments.map(r=>r.assignment_id===activeY6[0].assignment_id?{...r,effective_to:asOf}:r);
const input={asOfDate:asOf,user:simulatedUser,batchDefinitions:defs,batchAssignments:simulatedAssignments,entitlements,onlinePreLessonEntitlements:pre};
const payload=compileAccessScopeV2(input,PREPARED_CATALOGUE,{asOfDate:asOf});
const views=(payload?.snapshot?.views||[]).filter(v=>v.subject==='maths'&&!v.lockedPreview);
const ids=new Set(views.map(v=>v.viewId));
for(const wanted of ['maths-level1','maths-level2','maths-level3','maths-sats']) if(!ids.has(wanted)) throw new Error(`MISSING_TARGET_VIEW:${wanted}`);
for(const forbidden of ['maths-year3','maths-year6']) if(ids.has(forbidden)) throw new Error(`FORBIDDEN_VIEW_PRESENT:${forbidden}`);
const access=payload?.snapshot?.lessonAccess||{};
function counts(viewId){
  const lessons=PREPARED_CATALOGUE.views?.[viewId]?.lessons||[];
  const open=lessons.filter(x=>access[x.lessonId]?.core).length;
  return {total:lessons.length,open,locked:lessons.length-open};
}
const result={
  views:views.map(v=>({viewId:v.viewId,label:v.label,current:v.current,group:v.group})),
  l1:counts('maths-level1'),l2:counts('maths-level2'),l3:counts('maths-level3'),sats:counts('maths-sats'),
  specialAccess:simulatedUser.specialAccess,
  activeMathsAssignments:simulatedAssignments.filter(r=>String(r.subject).toLowerCase()==='maths'&&(!r.effective_to||asOf<r.effective_to)).map(r=>r.batch_key),
  satsSourceEntitlements:entitlements.filter(r=>/^Y6M(5[1-9]|6[0-9])$/.test(String(r.lesson_id))).map(r=>r.lesson_id)
};
for(const k of ['l1','l2','l3']) if(result[k].total<1||result[k].open!==result[k].total) throw new Error(`${k.toUpperCase()}_NOT_FULL:${JSON.stringify(result[k])}`);
if(result.sats.total!==19||result.sats.open!==1||result.sats.locked!==18) throw new Error(`SATS_NOT_1_OF_19:${JSON.stringify(result.sats)}`);
if(result.activeMathsAssignments.length!==0) throw new Error(`ACTIVE_MATHS_ASSIGNMENT_REMAINS:${result.activeMathsAssignments}`);
console.log(JSON.stringify(result));
console.log('AAR1811_COMPLETED_L3_TARGET_PREFLIGHT_PASS');
