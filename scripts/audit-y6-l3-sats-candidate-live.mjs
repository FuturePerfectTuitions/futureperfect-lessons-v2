import crypto from 'node:crypto';
import { compileAccessScope } from '../rebuild/adminops/src/lib/compiler.mjs';
import { viewIdForBatch, fullLibraryViewIds, isSatsLessonId } from '../rebuild/shared/read-models/view-registry.mjs';
import { PREPARED_CATALOGUE } from '../rebuild/student/src/prepared-catalogue.generated.js';

const token=String(process.env.CLOUDFLARE_API_TOKEN||'').trim();
const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const studentsNs=String(process.env.STUDENTS_KV_ID||'').trim();
const db=String(process.env.DB_ID||'').trim();
const asOf=String(process.env.AS_OF_DATE||'2026-09-27').trim();
if(!token||!account||!studentsNs||!db) throw new Error('Cloudflare read-only inputs are required.');
const base='https://api.cloudflare.com/client/v4';
const headers={Authorization:`Bearer ${token}`};
const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toLowerCase();
const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(clean(v))?clean(v):'';
async function tag(value){return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0,12);}
async function cf(path,init={}){const r=await fetch(`${base}${path}`,{...init,headers:{...headers,...(init.headers||{})}});const b=await r.json().catch(()=>null);if(!r.ok||b?.success!==true)throw new Error(`CF_READ_FAILED:${r.status}`);return b;}
async function kv(key){const r=await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${studentsNs}/values/${encodeURIComponent(key)}`,{headers});if(r.status===404)return null;if(!r.ok)throw new Error(`KV_READ_FAILED:${r.status}`);return r.json();}
async function d1(sql,params=[]){if(!/^\s*(SELECT|PRAGMA)\b/i.test(sql))throw new Error('READ_ONLY_SQL_ONLY');const b=await cf(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql,params})});const x=Array.isArray(b.result)?b.result[0]:b.result;return x?.results||[];}
function started(row){const f=date(row?.effective_from);return !f||f<=asOf;}
function current(row){const f=date(row?.effective_from),t=date(row?.effective_to),bf=date(row?.batch_active_from),bt=date(row?.batch_active_to);return (!f||f<=asOf)&&(!t||asOf<t)&&(!bf||bf<=asOf)&&(!bt||asOf<bt);}
function lessonId(row){return clean(row?.lesson_id??row?.lessonId);}

if(PREPARED_CATALOGUE?.kind!=='prepared-catalogue') throw new Error('CANDIDATE_CATALOGUE_MISSING');
if(PREPARED_CATALOGUE.navigation.length!==16) throw new Error(`CANDIDATE_VIEW_COUNT:${PREPARED_CATALOGUE.navigation.length}`);
if(PREPARED_CATALOGUE.views?.['maths-year6']?.label!=='Lessons') throw new Error('YEAR6_LABEL_NOT_LESSONS');
if(PREPARED_CATALOGUE.views?.['maths-level3']?.label!=='L3') throw new Error('L3_LABEL_CHANGED');
if(PREPARED_CATALOGUE.views?.['maths-sats']?.label!=='SATS') throw new Error('SATS_LABEL_MISSING');
const satsCatalogueIds=(PREPARED_CATALOGUE.views?.['maths-sats']?.lessons||[]).map(x=>x.lessonId);
if(!satsCatalogueIds.length||satsCatalogueIds.some(id=>!isSatsLessonId(id))) throw new Error('SATS_CATALOGUE_NOT_CANONICAL');
if((PREPARED_CATALOGUE.views?.['maths-year6']?.lessons||[]).some(x=>isSatsLessonId(x.lessonId))) throw new Error('SATS_LEAKED_INTO_YEAR6_LESSONS');

const defs=await d1('SELECT batch_key,academic_year,subject,school_year,stream,maths_level,active_from,active_to FROM batch_definitions ORDER BY batch_key');
const targets=await d1(`SELECT DISTINCT a.portal_user_id_norm FROM student_batch_assignments a JOIN batch_definitions b ON b.batch_key=a.batch_key WHERE (a.effective_from IS NULL OR a.effective_from='' OR a.effective_from<=?) AND (a.effective_to IS NULL OR a.effective_to='' OR ?<a.effective_to) AND (b.active_from IS NULL OR b.active_from='' OR b.active_from<=?) AND (b.active_to IS NULL OR b.active_to='' OR ?<b.active_to) AND lower(b.subject)='maths' AND ((lower(b.stream)='normal' AND CAST(b.school_year AS INTEGER)=6) OR (lower(b.stream)='11plus' AND CAST(b.maths_level AS INTEGER)=3)) ORDER BY a.portal_user_id_norm`,[asOf,asOf,asOf,asOf]);
if(targets.length!==9) throw new Error(`CURRENT_Y6_EQUIVALENT_ROSTER_CHANGED:${targets.length}`);

const results=[];
for(const target of targets){
  const id=norm(target.portal_user_id_norm), pseudonym=await tag(id), user=await kv(`user:${id}`);
  if(!user) throw new Error(`MISSING_PROFILE:${pseudonym}`);
  const assignments=await d1('SELECT a.batch_key,a.effective_from,a.effective_to,b.subject,b.school_year,b.stream,b.maths_level,b.active_from AS batch_active_from,b.active_to AS batch_active_to FROM student_batch_assignments a JOIN batch_definitions b ON b.batch_key=a.batch_key WHERE a.portal_user_id_norm=? ORDER BY a.effective_from,a.batch_key',[id]);
  const entitlements=await d1('SELECT lesson_id,core_access,vr_access,source,source_batch_code,source_lesson_date,first_granted_at,last_confirmed_at FROM lesson_entitlements WHERE portal_user_id_norm=? ORDER BY source_lesson_date,lesson_id',[id]);
  const pre=await d1('SELECT lesson_id,batch_key,lesson_date,first_granted_at FROM online_prelesson_entitlements WHERE portal_user_id_norm=? ORDER BY lesson_date,lesson_id',[id]);
  const relevantCurrent=assignments.filter(current).map(row=>viewIdForBatch(row)).filter(view=>view==='maths-year6'||view==='maths-level3');
  const expectedTeaching=[...new Set(relevantCurrent)];
  if(expectedTeaching.length!==1) throw new Error(`D1_PROGRAMME_NOT_SINGLE:${pseudonym}:${expectedTeaching.join(',')}`);
  const compiled=compileAccessScope({asOfDate:asOf,user,batchDefinitions:defs,batchAssignments:assignments,entitlements,onlinePreLessonEntitlements:pre},PREPARED_CATALOGUE,{scopeId:`candidate:${pseudonym}`,asOfDate:asOf}).snapshot;
  const currentMaths=compiled.views.filter(v=>v.subject==='maths'&&v.current&&!v.lockedPreview);
  const teaching=currentMaths.filter(v=>v.viewId==='maths-year6'||v.viewId==='maths-level3');
  if(teaching.length!==1||teaching[0].viewId!==expectedTeaching[0]) throw new Error(`PROGRAMME_IDENTITY_MISMATCH:${pseudonym}:${expectedTeaching[0]}:${teaching.map(v=>v.viewId).join(',')}`);
  if(currentMaths.some(v=>v.viewId==='maths-year6')&&currentMaths.some(v=>v.viewId==='maths-level3')) throw new Error(`Y6_L3_COLLISION:${pseudonym}`);
  if(teaching[0].viewId==='maths-year6'&&teaching[0].label!=='Lessons') throw new Error(`YEAR6_LABEL_MISMATCH:${pseudonym}`);
  if(teaching[0].viewId==='maths-level3'&&teaching[0].label!=='L3') throw new Error(`L3_LABEL_MISMATCH:${pseudonym}`);
  const blocked=new Set((Array.isArray(user.blockedLessons)?user.blockedLessons:[]).map(clean));
  const satsEnt=entitlements.filter(r=>Number(r.core_access??1)!==0&&isSatsLessonId(lessonId(r)));
  const satsPre=pre.filter(r=>isSatsLessonId(lessonId(r)));
  const satsExpected=satsEnt.length+satsPre.length>0;
  const satsView=currentMaths.find(v=>v.viewId==='maths-sats');
  if(Boolean(satsView)!==satsExpected) throw new Error(`SATS_VISIBILITY_MISMATCH:${pseudonym}:${satsExpected}`);
  if(satsView&&satsView.label!=='SATS') throw new Error(`SATS_LABEL_MISMATCH:${pseudonym}`);
  for(const row of entitlements){
    const lid=lessonId(row); if(!lid||Number(row.core_access??1)===0) continue;
    const state=compiled.lessonAccess[lid];
    if(!blocked.has(lid)&&!state?.core) throw new Error(`CORE_ENTITLEMENT_LOST:${pseudonym}:${lid}`);
  }
  for(const row of pre){
    const lid=lessonId(row); if(!lid||blocked.has(lid)) continue;
    const state=compiled.lessonAccess[lid];
    if(!state||(!state.core&&!state.preLessonOnly)) throw new Error(`PRELESSON_ENTITLEMENT_LOST:${pseudonym}:${lid}`);
  }
  for(const viewId of fullLibraryViewIds(user.fullLibraries||[])){
    if(!compiled.views.some(v=>v.viewId===viewId)) throw new Error(`FULL_LIBRARY_VIEW_LOST:${pseudonym}:${viewId}`);
  }
  const historical=assignments.filter(row=>started(row)&&!current(row)).map(viewIdForBatch).filter(Boolean);
  for(const viewId of historical){if(!compiled.views.some(v=>v.viewId===viewId)) throw new Error(`HISTORICAL_VIEW_LOST:${pseudonym}:${viewId}`);}
  results.push({pseudonym,programme:teaching[0].viewId,sats:satsExpected,satsOpen:satsView?.openLessonCount||0,maths:currentMaths.map(v=>({viewId:v.viewId,label:v.label,open:v.openLessonCount,locked:v.lockedLessonCount}))});
}

const summary={
  marker:'Y6_L3_SATS_LIVE_READONLY_PASS',
  asOfDate:asOf,
  students:results.length,
  normalYear6:results.filter(r=>r.programme==='maths-year6').length,
  level3:results.filter(r=>r.programme==='maths-level3').length,
  sats:results.filter(r=>r.sats).length,
  noSats:results.filter(r=>!r.sats).length,
  collisions:0,
  candidateViews:PREPARED_CATALOGUE.navigation.length,
  satsCatalogueLessons:satsCatalogueIds.length,
  rows:results
};
console.log(JSON.stringify(summary,null,2));