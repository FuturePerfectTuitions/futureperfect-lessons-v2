import { VIEW_DEFINITIONS, clean, norm, fullLibraryViewIds, sortedViewIds, viewDefinition, viewIdForBatch } from '../../../shared/read-models/view-registry.mjs';

const COUNTERPART = Object.freeze({
  'maths-year2':'english-year2','maths-year3':'english-year3','maths-year4':'english-year4','maths-year5':'english-year5','maths-year6':'english-year6',
  'maths-level1':'english-year4-11plus','maths-level2':'english-year5-11plus',
  'english-year2':'maths-year2','english-year3':'maths-year3','english-year4':'maths-year4','english-year5':'maths-year5','english-year6':'maths-year6',
  'english-year4-11plus':'maths-level1','english-year5-11plus':'maths-level2'
});
const asDate = v => /^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : '';
const lessonId = row => clean(row?.lesson_id ?? row?.lessonId);
const rowBatch = row => clean(row?.source_batch_code ?? row?.sourceBatchCode ?? row?.batch_key ?? row?.batchKey);

function academicYearStart(date) {
  const d = asDate(date); if (!d) return '';
  const y = Number(d.slice(0,4)); return `${Number(d.slice(5,7)) >= 9 ? y : y-1}-09-01`;
}
function assignmentStarted(row, date) { const from=asDate(row?.effective_from ?? row?.effectiveFrom); return !from || from <= date; }
function assignmentCurrent(row, date) {
  if (!assignmentStarted(row,date)) return false;
  const to=asDate(row?.effective_to ?? row?.effectiveTo), af=asDate(row?.batch_active_from ?? row?.batchActiveFrom ?? row?.active_from ?? row?.activeFrom), at=asDate(row?.batch_active_to ?? row?.batchActiveTo ?? row?.active_to ?? row?.activeTo);
  return (!to || date < to) && (!af || af <= date) && (!at || date < at);
}
function legacyBatchViewId(value) {
  const key=clean(value).toUpperCase(); let m=key.match(/^Y([2-6])M(?:O)?$/); if(m) return `maths-year${m[1]}`;
  m=key.match(/^Y([2-6])E(?:O)?$/); if(m) return `english-year${m[1]}`;
  m=key.match(/^Y([4-6])(?:11|M11|11M).*$/); if(m) return `maths-level${Number(m[1])-3}`;
  m=key.match(/^Y([45])(?:E11|11E).*$/); return m ? `english-year${m[1]}-11plus` : '';
}
function definitionMap(rows=[]) { return new Map((Array.isArray(rows)?rows:[]).map(r=>[clean(r?.batch_key ?? r?.batchKey),r]).filter(([k])=>k)); }
function hints(user) { return new Set((Array.isArray(user?.historicalViews)?user.historicalViews:[]).map(norm).filter(id=>VIEW_DEFINITIONS[id])); }
function candidateViewForAccessRow(row,catalogue,defs,historical=new Set()) {
  const direct=norm(row?.viewId ?? row?.view_id); if(VIEW_DEFINITIONS[direct]) return direct;
  const batch=rowBatch(row); if(batch && defs.has(batch)) { const id=viewIdForBatch(defs.get(batch)); if(id) return id; }
  if(batch) { const id=legacyBatchViewId(batch); if(id) return id; }
  const candidates=catalogue?.lessonToViews?.[lessonId(row)] || []; if(candidates.length===1) return candidates[0];
  const hinted=candidates.filter(id=>historical.has(id)); return hinted.length===1 ? hinted[0] : '';
}
function manualIds(user,mode) {
  const field=mode==='core'?'coreLessons':'vrLessons', ids=new Set(Array.isArray(user?.manualAccess?.[field]) ? user.manualAccess[field].map(clean).filter(Boolean) : []);
  const legacy=user?.manualLessonAccess; if(legacy && typeof legacy==='object' && !Array.isArray(legacy)) for(const [id,modes] of Object.entries(legacy)) if(Array.isArray(modes) && modes.map(norm).includes(mode) && clean(id)) ids.add(clean(id));
  return [...ids].sort();
}
function syntheticAssignment(viewId,source) {
  const d=viewDefinition(viewId); if(!d) return null;
  return {batch_key:`__parity__:${viewId}`,subject:d.subject,school_year:d.schoolYear,stream:d.stream,maths_level:d.mathsLevel||null,effective_from:'',effective_to:null,batch_active_from:'',batch_active_to:null,__parity_source:source};
}
function automaticPreviewViewIds(actualIds) {
  const actual=new Set(actualIds), maths=actualIds.filter(id=>VIEW_DEFINITIONS[id]?.subject==='maths'), english=actualIds.filter(id=>VIEW_DEFINITIONS[id]?.subject==='english');
  if(maths.length && english.length) return [];
  return sortedViewIds((maths.length?maths:english).map(id=>COUNTERPART[id]).filter(id=>id && !actual.has(id)));
}
function actualViewIds(input,catalogue,date) {
  const user=input?.user||{}, defs=definitionMap(input?.batchDefinitions), historical=hints(user), out=new Set(fullLibraryViewIds(user.fullLibraries||[]));
  for(const b of user.batches||[]) { const id=legacyBatchViewId(b); if(id) out.add(id); }
  for(const row of input?.batchAssignments||[]) if(assignmentStarted(row,date)) { const id=viewIdForBatch(row)||legacyBatchViewId(row?.batch_key); if(id) out.add(id); }
  for(const row of [...(input?.entitlements||[]),...(input?.onlinePreLessonEntitlements||[]),...(input?.temporaryLessonAccess||[])]) { const id=candidateViewForAccessRow(row,catalogue,defs,historical); if(id) out.add(id); }
  for(const id of manualIds(user,'core')) { const c=catalogue?.lessonToViews?.[id]||[], h=c.filter(v=>historical.has(v)), n=c.filter(v=>VIEW_DEFINITIONS[v]?.stream==='normal'); if(h.length===1) out.add(h[0]); else if(n.length===1) out.add(n[0]); }
  return sortedViewIds([...out]);
}

function prepareAccessInputForParity(input,catalogue,options={}) {
  const date=asDate(options.asOfDate||input?.asOfDate); if(!date) throw new Error('A deterministic YYYY-MM-DD asOfDate is required.');
  const user=input?.user&&typeof input.user==='object'?input.user:{}, defs=definitionMap(input?.batchDefinitions), historical=hints(user), assignments=(input?.batchAssignments||[]).map(r=>({...r}));
  const annotate=rows=>(rows||[]).map(row=>{ const id=candidateViewForAccessRow(row,catalogue,defs,historical); return id && !norm(row?.viewId??row?.view_id) ? {...row,viewId:id} : {...row}; });
  const assignmentViews=new Set(assignments.map(r=>viewIdForBatch(r)||legacyBatchViewId(r?.batch_key)).filter(Boolean));
  const activeViews=new Set(assignments.filter(r=>assignmentCurrent(r,date)).map(r=>viewIdForBatch(r)||legacyBatchViewId(r?.batch_key)).filter(Boolean));
  for(const b of user.batches||[]) { const id=legacyBatchViewId(b); if(id && !activeViews.has(id)) { const row=syntheticAssignment(id,'legacy-profile-batch'); if(row){assignments.push(row);activeViews.add(id);} } }
  for(const id of fullLibraryViewIds(user.fullLibraries||[])) if(!assignmentViews.has(id)) { const row=syntheticAssignment(id,'full-library-presentation'); if(row){assignments.push(row);activeViews.add(id);} }

  const ent=annotate(input?.entitlements), pre=annotate(input?.onlinePreLessonEntitlements);
  for(const row of input?.temporaryLessonAccess||[]) {
    const id=lessonId(row), view=candidateViewForAccessRow(row,catalogue,defs,historical); if(!id) continue;
    if(row?.core!==false || row?.vr===true) ent.push({lesson_id:id,core_access:row?.core!==false?1:0,vr_access:row?.vr===true?1:0,source:clean(row?.source||'temporary')||'temporary',...(view?{viewId:view}:{})});
    else if(row?.preLessonOnly===true) pre.push({lesson_id:id,source:clean(row?.source||'temporary')||'temporary',...(view?{viewId:view}:{})});
  }
  const yearStart=academicYearStart(date);
  for(const row of [...ent,...pre]) {
    const view=candidateViewForAccessRow(row,catalogue,defs,historical); if(!view || activeViews.has(view)) continue;
    const d=asDate(row?.source_lesson_date??row?.sourceLessonDate??row?.lesson_date??row?.lessonDate); if(d && d<yearStart) continue;
    const synthetic=syntheticAssignment(view,'current-release-presentation'); if(synthetic){assignments.push(synthetic);activeViews.add(view);}
  }
  const normalized={...(input||{}),user:{...user},batchAssignments:assignments,entitlements:ent,onlinePreLessonEntitlements:pre};
  if(!Array.isArray(user.upsellViews)) normalized.user.upsellViews=automaticPreviewViewIds(actualViewIds(normalized,catalogue,date));
  return normalized;
}

function expectedLessonAccess(input,catalogue) {
  const user=input?.user||{}, full=new Set(fullLibraryViewIds(user.fullLibraries||[])), core=new Set(), vr=new Set(), pre=new Set(), blocked=new Set((user.blockedLessons||[]).map(clean).filter(Boolean));
  for(const [id,views] of Object.entries(catalogue?.lessonToViews||{})) if((views||[]).some(v=>full.has(v))) core.add(id);
  for(const row of input?.entitlements||[]) { const id=lessonId(row); if(!id) continue; if(Number(row?.core_access??row?.coreAccess??1)!==0) core.add(id); if(Number(row?.vr_access??row?.vrAccess??0)===1) vr.add(id); }
  for(const id of manualIds(user,'core')) core.add(id); for(const id of manualIds(user,'vr')) vr.add(id);
  for(const row of input?.onlinePreLessonEntitlements||[]) if(lessonId(row)) pre.add(lessonId(row));
  for(const row of input?.temporaryLessonAccess||[]) { const id=lessonId(row); if(!id) continue; if(row?.core!==false) core.add(id); if(row?.vr===true) vr.add(id); if(row?.preLessonOnly===true) pre.add(id); }
  const result={}; for(const id of [...new Set([...core,...vr,...pre,...blocked])].sort()) { const b=blocked.has(id); result[id]={core:!b&&core.has(id),vr:!b&&vr.has(id),preLessonOnly:!b&&!core.has(id)&&pre.has(id),blocked:b}; }
  return result;
}
function expectedViews(input,catalogue,date,access) {
  const user=input?.user||{}, defs=definitionMap(input?.batchDefinitions), historical=hints(user), map=new Map(), add=(id,current=false)=>{if(!VIEW_DEFINITIONS[id])return;const s=map.get(id)||{viewId:id,current:false,lockedPreview:false};s.current||=current;map.set(id,s);};
  for(const id of fullLibraryViewIds(user.fullLibraries||[])) add(id,true); for(const b of user.batches||[]) add(legacyBatchViewId(b),true);
  for(const row of input?.batchAssignments||[]) if(assignmentStarted(row,date)) add(viewIdForBatch(row)||legacyBatchViewId(row?.batch_key),assignmentCurrent(row,date));
  const yearStart=academicYearStart(date);
  for(const row of [...(input?.entitlements||[]),...(input?.onlinePreLessonEntitlements||[]),...(input?.temporaryLessonAccess||[])]) { const id=candidateViewForAccessRow(row,catalogue,defs,historical); if(!id) continue; const d=asDate(row?.source_lesson_date??row?.sourceLessonDate??row?.lesson_date??row?.lessonDate); add(id,!d||d>=yearStart); }
  for(const id of manualIds(user,'core')) { const c=catalogue?.lessonToViews?.[id]||[], h=c.filter(v=>historical.has(v)), n=c.filter(v=>VIEW_DEFINITIONS[v]?.stream==='normal'); if(h.length===1)add(h[0],false);else if(n.length===1)add(n[0],false); }
  const actual=sortedViewIds([...map.keys()]), preview=Array.isArray(user.upsellViews)?sortedViewIds(user.upsellViews).filter(id=>!map.has(id)):automaticPreviewViewIds(actual);
  for(const id of preview) map.set(id,{viewId:id,current:true,lockedPreview:true});
  return sortedViewIds([...map.keys()]).map(id=>{const state=map.get(id),lessons=catalogue?.views?.[id]?.lessons||[],open=state.lockedPreview?0:lessons.filter(r=>{const a=access[r.lessonId];return a&&!a.blocked&&(a.core||a.preLessonOnly);}).length;return{viewId:id,current:Boolean(state.current||state.lockedPreview),group:(state.current||state.lockedPreview)?'current':'previous',lockedPreview:Boolean(state.lockedPreview),visibleLessonCount:lessons.length,openLessonCount:open,lockedLessonCount:Math.max(0,lessons.length-open)};});
}
function buildAuthoritativeParityOracle(input,catalogue,options={}) { const date=asDate(options.asOfDate||input?.asOfDate); if(!date) throw new Error('A deterministic YYYY-MM-DD asOfDate is required.'); const access=expectedLessonAccess(input,catalogue); return{asOfDate:date,lessonAccess:access,views:expectedViews(input,catalogue,date,access)}; }
const lessonState=v=>({core:Boolean(v?.core),vr:Boolean(v?.vr),preLessonOnly:Boolean(v?.preLessonOnly),blocked:Boolean(v?.blocked)});
const viewState=v=>({current:Boolean(v?.current),group:clean(v?.group),lockedPreview:Boolean(v?.lockedPreview),visibleLessonCount:Number(v?.visibleLessonCount||0),openLessonCount:Number(v?.openLessonCount||0),lockedLessonCount:Number(v?.lockedLessonCount||0)});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function diffAccessParity(snapshot,oracle,options={}) {
  const differences=[], actual=snapshot?.lessonAccess||{}, expected=oracle?.lessonAccess||{};
  for(const id of [...new Set([...Object.keys(actual),...Object.keys(expected)])].sort()) { const e=lessonState(expected[id]),a=lessonState(actual[id]); if(!same(e,a)) differences.push({id:`lesson:${id}`,kind:'lesson-access',expected:e,actual:a}); }
  const ev=new Map((oracle?.views||[]).map(v=>[v.viewId,viewState(v)])), av=new Map((snapshot?.views||[]).map(v=>[v.viewId,viewState(v)]));
  for(const id of sortedViewIds([...ev.keys(),...av.keys()])) { const e=ev.get(id)||null,a=av.get(id)||null;if(!same(e,a))differences.push({id:`view:${id}`,kind:'view-access',expected:e,actual:a}); }
  const explanations=options.explanations&&typeof options.explanations==='object'?options.explanations:{},explained=[],unexplained=[];
  for(const d of differences){const reason=clean(explanations[d.id]||explanations[d.kind]);if(reason)explained.push({...d,explanation:reason});else unexplained.push(d);} return{differences,explained,unexplained,pass:unexplained.length===0};
}
function expectedResourceSignatures(record) {
  const core=record?.core&&typeof record.core==='object'?record.core:{},pre=Array.isArray(record?.preLessonSheets)?record.preLessonSheets:(core.preLessonSheets||[]),home=Array.isArray(record?.homeworks)?record.homeworks:(core.homeworks||[]),other=Array.isArray(record?.otherResources)?record.otherResources:(core.otherResources||[]),key=v=>clean(v?.r2Key||v?.r2||v?.objectKey||v?.storageKey||v?.key),out=[];
  for(const x of pre)if(key(x))out.push(`prelesson|0|${key(x)}`);for(const p of home){const h=p?.homework&&typeof p.homework==='object'?p.homework:p;if(key(h))out.push(`homework|0|${key(h)}`);if(key(p?.answerPack))out.push(`answer-pack|1|${key(p.answerPack)}`);}for(const x of other)if(key(x))out.push(`other|0|${key(x)}`);return out.sort();
}
function auditLessonResourceParity(record,resources=[]) { const expected=expectedResourceSignatures(record),actual=(resources||[]).map(x=>`${clean(x?.type)}|${x?.protected?1:0}|${clean(x?.objectKey)}`).filter(x=>!x.endsWith('|')).sort();return{pass:same(expected,actual),expected,actual}; }

export { academicYearStart, assignmentCurrent, legacyBatchViewId, candidateViewForAccessRow, automaticPreviewViewIds, prepareAccessInputForParity, buildAuthoritativeParityOracle, diffAccessParity, expectedResourceSignatures, auditLessonResourceParity };
