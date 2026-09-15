import assert from 'node:assert/strict';
import fs from 'node:fs';

const clean=v=>String(v??'').trim();
const base=clean(process.env.PROD_BASE||'https://lessons.futureperfect.education').replace(/\/$/,'');
const personaPath=clean(process.env.CP12_PERSONA_SECRETS||'/tmp/cp12-production-real-persona-secrets.json');
const output=clean(process.env.CP12_VR_SHAPE_OUTPUT||'/tmp/cp12-production-vr-lesson-shape.json');
const selected=JSON.parse(fs.readFileSync(personaPath,'utf8'));

function cookiePair(r){return (r.headers.get('set-cookie')||'').split(';')[0].trim();}
async function bodyJson(r){const t=await r.text();try{return JSON.parse(t);}catch{return null;}}
async function login(persona){const r=await fetch(`${base}/api/v2/auth/login`,{method:'POST',redirect:'manual',headers:{origin:new URL(base).origin,'content-type':'application/json'},body:JSON.stringify({username:persona.username,password:persona.password})});const b=await bodyJson(r);assert.equal(r.status,200,'Real-student diagnostic login failed.');assert.equal(b?.ok,true,'Real-student diagnostic login response was not ok.');const cookie=cookiePair(r);assert(cookie,'Real-student diagnostic session cookie missing.');return cookie;}
async function get(path,cookie){const r=await fetch(`${base}${path}`,{redirect:'manual',headers:{cookie}});const b=await bodyJson(r);return {r,b};}
function vrRows(detail){return (detail?.resources||[]).filter(row=>(row?.presentationScopes||[]).includes('vr'));}
function composition(rows){return {prelesson:rows.filter(row=>row.type==='prelesson').length,homework:rows.filter(row=>row.type==='homework').length,protectedAnswers:rows.filter(row=>row.type==='answer-pack'&&row.protected===true).length,answers:rows.filter(row=>row.type==='answer-pack').length};}
function fullVrShape(rows){const c=composition(rows);return rows.length>=4&&c.prelesson>=1&&c.homework>=1&&c.protectedAnswers>=2;}
function groupCounts(rows){const out={};for(const row of rows){const key=`${clean(row.presentationGroup)||'(none)'}:${clean(row.type)||'(none)'}${row.protected===true?':protected':''}`;out[key]=(out[key]||0)+1;}return out;}

const vr=selected.vr;const ordinary=selected.ordinary;
assert(vr&&ordinary,'Expected real VR and ordinary personas from prerequisite.');
assert.notEqual(clean(vr.username).toLowerCase(),'admin');assert.notEqual(clean(ordinary.username).toLowerCase(),'admin');assert.notEqual(clean(vr.username).toLowerCase(),clean(ordinary.username).toLowerCase());
const vrCookie=await login(vr);const ordinaryCookie=await login(ordinary);
const home=await get('/api/v2/student/home',vrCookie);assert.equal(home.r.status,200,'VR student home request failed.');assert.equal(home.b?.ok,true,'VR student home payload was not ok.');
const openViews=(home.b.views||[]).filter(v=>v?.lockedPreview!==true).map(v=>({viewId:clean(v.viewId),subject:clean(v.subject),label:clean(v.label)})).filter(v=>v.viewId);
const candidates=[];
for(const view of openViews){
  const list=await get(`/api/v2/student/views/${encodeURIComponent(view.viewId)}/lessons`,vrCookie);if(list.r.status!==200||list.b?.ok!==true)continue;
  for(const row of (list.b.lessons||[]).filter(x=>x?.locked===false&&x?.open===true)){
    const lessonId=clean(row.lessonId);if(!lessonId)continue;
    const got=await get(`/api/v2/student/lessons/${encodeURIComponent(lessonId)}?viewId=${encodeURIComponent(view.viewId)}`,vrCookie);if(got.r.status!==200||got.b?.ok!==true)continue;
    const rows=vrRows(got.b);if(!rows.length)continue;
    candidates.push({viewId:view.viewId,subject:view.subject,label:view.label,lessonId,vrRows:rows.length,fullVrShape:fullVrShape(rows),composition:composition(rows),groups:groupCounts(rows)});
  }
}
const canonicalCandidate=candidates.find(row=>row.fullVrShape===true)||null;
const ordinaryView=clean(ordinary.viewId||'english-year5');
const ordinaryLesson=clean(ordinary.lessonId||'Y5E2');
let ordinaryControl=null;
const ordinaryList=await get(`/api/v2/student/views/${encodeURIComponent(ordinaryView)}/lessons`,ordinaryCookie);
if(ordinaryList.r.status===200&&ordinaryList.b?.ok===true){
  const visible=(ordinaryList.b.lessons||[]).find(x=>clean(x.lessonId)===ordinaryLesson&&x?.locked===false&&x?.open===true);
  if(visible){
    const detail=await get(`/api/v2/student/lessons/${encodeURIComponent(ordinaryLesson)}?viewId=${encodeURIComponent(ordinaryView)}`,ordinaryCookie);
    if(detail.r.status===200&&detail.b?.ok===true){
      const ordinaryVr=vrRows(detail.b);const core=(detail.b.resources||[]).filter(x=>x.type!=='video'&&!((x.presentationScopes||[]).includes('vr')));
      ordinaryControl={viewId:ordinaryView,lessonId:ordinaryLesson,vrRows:ordinaryVr.length,coreRows:core.length,coreHomework:core.filter(x=>x.type==='homework').length};
    }
  }
}
const summary={marker:'CP12_PRODUCTION_VR_LESSON_SHAPE_DIAGNOSTIC_PASS',status:'PASS',productionMutation:false,openViews,openVrBearingLessons:candidates.length,candidates,canonicalCandidate,ordinaryControl,credentialsLogged:false,cookiesLogged:false,protectedReadsOnly:true};
fs.writeFileSync(output,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
