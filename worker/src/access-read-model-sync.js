// Canonical importer -> prepared access read-model reconciliation.
//
// The public rebuilt Portal reads per-student prepared access snapshots from
// READ_MODELS_KV. The legacy/admin importer still owns the canonical D1 access
// mutation. This module recompiles the affected student's prepared access model
// from canonical post-write state and publishes it atomically before the import
// is reported as successful.
//
// Access semantics below are intentionally aligned with the frozen rebuild
// compiler used for the production cutover. Keep changes regression-tested.

const READ_MODEL_SCHEMA_VERSION = 1;
const READ_MODEL_KEY_PREFIX = 'rm:v1';
const SCOPE_SALT_KEY = 'meta:scope-salt';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

const VIEW_DEFINITIONS = Object.freeze({
  'maths-year2': Object.freeze({ viewId:'maths-year2', subject:'maths', label:'Year 2', rank:20, schoolYear:2, stream:'normal', fullLibraryIds:Object.freeze(['MATHS_Y2_FULL']) }),
  'maths-year3': Object.freeze({ viewId:'maths-year3', subject:'maths', label:'Year 3', rank:30, schoolYear:3, stream:'normal', fullLibraryIds:Object.freeze(['MATHS_Y3_FULL']) }),
  'maths-year4': Object.freeze({ viewId:'maths-year4', subject:'maths', label:'Year 4', rank:40, schoolYear:4, stream:'normal', fullLibraryIds:Object.freeze(['MATHS_Y4_FULL']) }),
  'maths-level1': Object.freeze({ viewId:'maths-level1', subject:'maths', label:'L1', rank:41, schoolYear:4, stream:'11plus', mathsLevel:1, fullLibraryIds:Object.freeze(['MATHS_L1_FULL']) }),
  'maths-year5': Object.freeze({ viewId:'maths-year5', subject:'maths', label:'Year 5', rank:50, schoolYear:5, stream:'normal', fullLibraryIds:Object.freeze(['MATHS_Y5_FULL']) }),
  'maths-level2': Object.freeze({ viewId:'maths-level2', subject:'maths', label:'L2', rank:51, schoolYear:5, stream:'11plus', mathsLevel:2, fullLibraryIds:Object.freeze(['MATHS_L2_FULL']) }),
  'maths-year6': Object.freeze({ viewId:'maths-year6', subject:'maths', label:'Year 6', rank:60, schoolYear:6, stream:'normal', fullLibraryIds:Object.freeze(['MATHS_Y6_FULL']) }),
  'maths-level3': Object.freeze({ viewId:'maths-level3', subject:'maths', label:'L3', rank:61, schoolYear:6, stream:'11plus', mathsLevel:3, fullLibraryIds:Object.freeze(['MATHS_L3_FULL']) }),
  'english-year2': Object.freeze({ viewId:'english-year2', subject:'english', label:'Year 2', rank:20, schoolYear:2, stream:'normal', fullLibraryIds:Object.freeze(['ENGLISH_Y2_FULL']) }),
  'english-year3': Object.freeze({ viewId:'english-year3', subject:'english', label:'Year 3', rank:30, schoolYear:3, stream:'normal', fullLibraryIds:Object.freeze(['ENGLISH_Y3_FULL']) }),
  'english-year4': Object.freeze({ viewId:'english-year4', subject:'english', label:'Year 4', rank:40, schoolYear:4, stream:'normal', fullLibraryIds:Object.freeze(['ENGLISH_Y4_FULL']) }),
  'english-year4-11plus': Object.freeze({ viewId:'english-year4-11plus', subject:'english', label:'Year 4 11+', rank:41, schoolYear:4, stream:'11plus', fullLibraryIds:Object.freeze(['ENGLISH_Y4_11PLUS_FULL']) }),
  'english-year5': Object.freeze({ viewId:'english-year5', subject:'english', label:'Year 5', rank:50, schoolYear:5, stream:'normal', fullLibraryIds:Object.freeze(['ENGLISH_Y5_FULL']) }),
  'english-year5-11plus': Object.freeze({ viewId:'english-year5-11plus', subject:'english', label:'Year 5 11+', rank:51, schoolYear:5, stream:'11plus', fullLibraryIds:Object.freeze(['ENGLISH_Y5_11PLUS_FULL']) }),
  'english-year6': Object.freeze({ viewId:'english-year6', subject:'english', label:'Year 6', rank:60, schoolYear:6, stream:'normal', fullLibraryIds:Object.freeze(['ENGLISH_Y6_FULL']) })
});
const VIEW_IDS = Object.freeze(Object.keys(VIEW_DEFINITIONS));

function viewDefinition(viewId) {
  return VIEW_DEFINITIONS[norm(viewId)] || null;
}

function viewIdForBatch(row) {
  const subject = norm(row?.subject);
  const stream = norm(row?.stream);
  const year = Number(row?.school_year ?? row?.schoolYear ?? 0);
  const level = Number(row?.maths_level ?? row?.mathsLevel ?? 0);
  if (subject === 'maths') {
    if (stream === '11plus') {
      const resolved = level >= 1 && level <= 3 ? level : year - 3;
      return viewDefinition(`maths-level${resolved}`)?.viewId || '';
    }
    return viewDefinition(`maths-year${year}`)?.viewId || '';
  }
  if (subject === 'english') {
    if (stream === '11plus') {
      if (year !== 4 && year !== 5) return '';
      return viewDefinition(`english-year${year}-11plus`)?.viewId || '';
    }
    return viewDefinition(`english-year${year}`)?.viewId || '';
  }
  return '';
}

function counterpartViewId(row) {
  const subject = norm(row?.subject);
  const stream = norm(row?.stream);
  const year = Number(row?.school_year ?? row?.schoolYear ?? 0);
  const level = Number(row?.maths_level ?? row?.mathsLevel ?? 0);
  if (subject === 'maths') {
    if (stream === '11plus' && (year === 4 || year === 5)) return `english-year${year}-11plus`;
    return viewDefinition(`english-year${year}`)?.viewId || '';
  }
  if (subject === 'english') {
    if (stream === '11plus') {
      const resolved = level >= 1 && level <= 3 ? level : year - 3;
      return viewDefinition(`maths-level${resolved}`)?.viewId || '';
    }
    return viewDefinition(`maths-year${year}`)?.viewId || '';
  }
  return '';
}

function sortedViewIds(values = VIEW_IDS) {
  return [...new Set(values.map(norm).filter(id => VIEW_DEFINITIONS[id]))]
    .sort((left, right) => {
      const a = VIEW_DEFINITIONS[left];
      const b = VIEW_DEFINITIONS[right];
      return a.subject.localeCompare(b.subject) || a.rank - b.rank || left.localeCompare(right);
    });
}

function fullLibraryViewIds(values = []) {
  const libraries = new Set(values.map(value => clean(value).toUpperCase()).filter(Boolean));
  return sortedViewIds(VIEW_IDS.filter(viewId =>
    (VIEW_DEFINITIONS[viewId].fullLibraryIds || []).some(value => libraries.has(String(value).toUpperCase()))
  ));
}

function asDate(value) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function academicYearStart(date) {
  const d = asDate(date);
  if (!d) return '';
  const year = Number(d.slice(0, 4));
  return `${Number(d.slice(5, 7)) >= 9 ? year : year - 1}-09-01`;
}

function assignmentStarted(row, date) {
  const from = asDate(row?.effective_from ?? row?.effectiveFrom);
  return !from || from <= date;
}

function isActiveWindow(row, asOfDate) {
  const from = asDate(row?.effective_from ?? row?.effectiveFrom ?? row?.active_from ?? row?.activeFrom);
  const to = asDate(row?.effective_to ?? row?.effectiveTo ?? row?.active_to ?? row?.activeTo);
  if (from && from > asOfDate) return false;
  return !to || asOfDate < to;
}

function assignmentCurrent(row, date) {
  if (!assignmentStarted(row, date)) return false;
  const to = asDate(row?.effective_to ?? row?.effectiveTo);
  const activeFrom = asDate(row?.batch_active_from ?? row?.batchActiveFrom ?? row?.active_from ?? row?.activeFrom);
  const activeTo = asDate(row?.batch_active_to ?? row?.batchActiveTo ?? row?.active_to ?? row?.activeTo);
  return (!to || date < to) && (!activeFrom || activeFrom <= date) && (!activeTo || date < activeTo);
}

function activeAssignments(assignments, asOfDate) {
  return (Array.isArray(assignments) ? assignments : []).filter(row => {
    if (!assignmentStarted(row, asOfDate) || !isActiveWindow(row, asOfDate)) return false;
    const batchFrom = asDate(row?.batch_active_from ?? row?.batchActiveFrom);
    const batchTo = asDate(row?.batch_active_to ?? row?.batchActiveTo);
    if (batchFrom && batchFrom > asOfDate) return false;
    return !batchTo || asOfDate < batchTo;
  });
}

function historicalAssignmentViewIds(assignments, asOfDate) {
  return sortedViewIds((Array.isArray(assignments) ? assignments : [])
    .filter(row => assignmentStarted(row, asOfDate))
    .map(viewIdForBatch)
    .filter(Boolean));
}

function legacyBatchViewId(value) {
  const key = clean(value).toUpperCase();
  let match = key.match(/^Y([2-6])M(?:O)?(?:[_-].*)?$/);
  if (match) return `maths-year${match[1]}`;
  match = key.match(/^Y([2-6])(?:F|O)?M(?:[_-].*)?$/);
  if (match && !key.includes('11')) return `maths-year${match[1]}`;
  match = key.match(/^Y([2-6])E(?:O)?(?:[_-].*)?$/);
  if (match) return `english-year${match[1]}`;
  match = key.match(/^Y([2-6])(?:F|O)?E(?:[_-].*)?$/);
  if (match && !key.includes('11')) return `english-year${match[1]}`;
  match = key.match(/^Y([4-6]).*11.*M/);
  if (match) return `maths-level${Number(match[1]) - 3}`;
  match = key.match(/^Y([45]).*11.*E/);
  return match ? `english-year${match[1]}-11plus` : '';
}

function batchDefinitionLookup(definitions = []) {
  const map = new Map();
  for (const row of Array.isArray(definitions) ? definitions : []) {
    const key = clean(row?.batch_key ?? row?.batchKey);
    if (key) map.set(key, row);
  }
  return map;
}

function historicalHints(user) {
  return new Set((Array.isArray(user?.historicalViews) ? user.historicalViews : [])
    .map(norm).filter(id => VIEW_DEFINITIONS[id]));
}

function inferViewIdFromLessonAndBatch(row, catalogue) {
  const direct = norm(row?.viewId ?? row?.view_id);
  if (VIEW_DEFINITIONS[direct]) return direct;
  const lessonId = clean(row?.lesson_id ?? row?.lessonId);
  const candidates = (catalogue?.lessonToViews?.[lessonId] || []).filter(id => VIEW_DEFINITIONS[id]);
  if (candidates.length === 1) return candidates[0];

  const batch = clean(row?.source_batch_code ?? row?.sourceBatchCode ?? row?.batch_key ?? row?.batchKey);
  const legacy = legacyBatchViewId(batch);
  if (legacy && candidates.includes(legacy)) return legacy;

  const elevenPlus = /11/.test(batch);
  if (elevenPlus) {
    const matching = candidates.filter(id => id.includes('-11plus') || /^maths-level[1-3]$/.test(id));
    if (matching.length === 1) return matching[0];
  } else {
    const matching = candidates.filter(id => /^english-year[2-6]$/.test(id) || /^maths-year[2-6]$/.test(id));
    if (matching.length === 1) return matching[0];
  }
  return '';
}

function candidateViewForAccessRow(row, catalogue, definitions, historical = new Set()) {
  const direct = norm(row?.viewId ?? row?.view_id);
  if (VIEW_DEFINITIONS[direct]) return direct;
  const batch = clean(row?.source_batch_code ?? row?.sourceBatchCode ?? row?.batch_key ?? row?.batchKey);
  if (batch && definitions.has(batch)) {
    const id = viewIdForBatch(definitions.get(batch));
    if (id) return id;
  }
  const inferred = inferViewIdFromLessonAndBatch(row, catalogue);
  if (inferred) return inferred;
  const lessonId = clean(row?.lesson_id ?? row?.lessonId);
  const candidates = catalogue?.lessonToViews?.[lessonId] || [];
  const hinted = candidates.filter(id => historical.has(id));
  return hinted.length === 1 ? hinted[0] : '';
}

function manualIds(user, mode) {
  const field = mode === 'core' ? 'coreLessons' : 'vrLessons';
  const ids = new Set(Array.isArray(user?.manualAccess?.[field])
    ? user.manualAccess[field].map(clean).filter(Boolean) : []);
  const legacy = user?.manualLessonAccess;
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    for (const [id, modes] of Object.entries(legacy)) {
      if (Array.isArray(modes) && modes.map(norm).includes(mode) && clean(id)) ids.add(clean(id));
    }
  }
  return [...ids].sort();
}

function syntheticAssignment(viewId, source) {
  const definition = viewDefinition(viewId);
  if (!definition) return null;
  return {
    batch_key:`__reconcile__:${viewId}`,
    subject:definition.subject,
    school_year:definition.schoolYear,
    stream:definition.stream,
    maths_level:definition.mathsLevel || null,
    effective_from:'',
    effective_to:null,
    batch_active_from:'',
    batch_active_to:null,
    __reconcile_source:source
  };
}

const COUNTERPART = Object.freeze({
  'maths-year2':'english-year2','maths-year3':'english-year3','maths-year4':'english-year4','maths-year5':'english-year5','maths-year6':'english-year6',
  'maths-level1':'english-year4-11plus','maths-level2':'english-year5-11plus',
  'english-year2':'maths-year2','english-year3':'maths-year3','english-year4':'maths-year4','english-year5':'maths-year5','english-year6':'maths-year6',
  'english-year4-11plus':'maths-level1','english-year5-11plus':'maths-level2'
});

function automaticPreviewViewIds(actualIds) {
  const actual = new Set(actualIds);
  const maths = actualIds.filter(id => VIEW_DEFINITIONS[id]?.subject === 'maths');
  const english = actualIds.filter(id => VIEW_DEFINITIONS[id]?.subject === 'english');
  if (maths.length && english.length) return [];
  return sortedViewIds((maths.length ? maths : english)
    .map(id => COUNTERPART[id]).filter(id => id && !actual.has(id)));
}

function actualViewIds(input, catalogue, date) {
  const user = input?.user || {};
  const definitions = batchDefinitionLookup(input?.batchDefinitions);
  const historical = historicalHints(user);
  const out = new Set(fullLibraryViewIds(user.fullLibraries || []));
  for (const batch of user.batches || []) {
    const id = legacyBatchViewId(batch);
    if (id) out.add(id);
  }
  for (const row of input?.batchAssignments || []) {
    if (!assignmentStarted(row, date)) continue;
    const id = viewIdForBatch(row) || legacyBatchViewId(row?.batch_key);
    if (id) out.add(id);
  }
  for (const row of [
    ...(input?.entitlements || []),
    ...(input?.onlinePreLessonEntitlements || []),
    ...(input?.temporaryLessonAccess || [])
  ]) {
    const id = candidateViewForAccessRow(row, catalogue, definitions, historical);
    if (id) out.add(id);
  }
  for (const id of manualIds(user, 'core')) {
    const candidates = catalogue?.lessonToViews?.[id] || [];
    const hinted = candidates.filter(viewId => historical.has(viewId));
    const normal = candidates.filter(viewId => VIEW_DEFINITIONS[viewId]?.stream === 'normal');
    if (hinted.length === 1) out.add(hinted[0]);
    else if (normal.length === 1) out.add(normal[0]);
  }
  return sortedViewIds([...out]);
}

function prepareAccessInputForParity(input, catalogue, options = {}) {
  const date = asDate(options.asOfDate || input?.asOfDate);
  if (!date) throw new Error('A deterministic YYYY-MM-DD asOfDate is required.');
  const user = input?.user && typeof input.user === 'object' ? input.user : {};
  const definitions = batchDefinitionLookup(input?.batchDefinitions);
  const historical = historicalHints(user);
  const assignments = (input?.batchAssignments || []).map(row => ({ ...row }));
  const annotate = rows => (rows || []).map(row => {
    const id = candidateViewForAccessRow(row, catalogue, definitions, historical);
    return id && !norm(row?.viewId ?? row?.view_id) ? { ...row, viewId:id } : { ...row };
  });

  const assignmentViews = new Set(assignments.map(row => viewIdForBatch(row) || legacyBatchViewId(row?.batch_key)).filter(Boolean));
  const activeViews = new Set(assignments.filter(row => assignmentCurrent(row, date))
    .map(row => viewIdForBatch(row) || legacyBatchViewId(row?.batch_key)).filter(Boolean));

  for (const batch of user.batches || []) {
    const id = legacyBatchViewId(batch);
    if (id && !activeViews.has(id)) {
      const row = syntheticAssignment(id, 'legacy-profile-batch');
      if (row) { assignments.push(row); activeViews.add(id); }
    }
  }

  for (const id of fullLibraryViewIds(user.fullLibraries || [])) {
    if (!assignmentViews.has(id)) {
      const row = syntheticAssignment(id, 'full-library-presentation');
      if (row) { assignments.push(row); activeViews.add(id); }
    }
  }

  const entitlements = annotate(input?.entitlements);
  const preLesson = annotate(input?.onlinePreLessonEntitlements);
  for (const row of input?.temporaryLessonAccess || []) {
    const id = clean(row?.lesson_id ?? row?.lessonId);
    const viewId = candidateViewForAccessRow(row, catalogue, definitions, historical);
    if (!id) continue;
    if (row?.core !== false || row?.vr === true) {
      entitlements.push({
        lesson_id:id,
        core_access:row?.core !== false ? 1 : 0,
        vr_access:row?.vr === true ? 1 : 0,
        source:clean(row?.source || 'temporary') || 'temporary',
        ...(viewId ? { viewId } : {})
      });
    } else if (row?.preLessonOnly === true) {
      preLesson.push({
        lesson_id:id,
        source:clean(row?.source || 'temporary') || 'temporary',
        ...(viewId ? { viewId } : {})
      });
    }
  }

  const yearStart = academicYearStart(date);
  for (const row of [...entitlements, ...preLesson]) {
    const viewId = candidateViewForAccessRow(row, catalogue, definitions, historical);
    if (!viewId || activeViews.has(viewId)) continue;
    const releaseDate = asDate(row?.source_lesson_date ?? row?.sourceLessonDate ?? row?.lesson_date ?? row?.lessonDate);
    if (releaseDate && releaseDate < yearStart) continue;
    const synthetic = syntheticAssignment(viewId, 'current-release-presentation');
    if (synthetic) { assignments.push(synthetic); activeViews.add(viewId); }
  }

  const normalized = {
    ...(input || {}),
    user:{ ...user },
    batchAssignments:assignments,
    entitlements,
    onlinePreLessonEntitlements:preLesson
  };
  if (!Array.isArray(user.upsellViews)) {
    normalized.user.upsellViews = automaticPreviewViewIds(actualViewIds(normalized, catalogue, date));
  }
  return normalized;
}

function entitlementLessonIds(entitlements) {
  return [...new Set((Array.isArray(entitlements) ? entitlements : [])
    .filter(row => Number(row?.core_access ?? row?.coreAccess ?? 1) !== 0)
    .map(row => clean(row?.lesson_id ?? row?.lessonId)).filter(Boolean))].sort();
}

function vrEntitlementLessonIds(entitlements) {
  return [...new Set((Array.isArray(entitlements) ? entitlements : [])
    .filter(row => Number(row?.vr_access ?? row?.vrAccess ?? 0) === 1)
    .map(row => clean(row?.lesson_id ?? row?.lessonId)).filter(Boolean))].sort();
}

function preLessonOnlyIds(rows) {
  return [...new Set((Array.isArray(rows) ? rows : [])
    .map(row => clean(row?.lesson_id ?? row?.lessonId)).filter(Boolean))].sort();
}

function preLessonVrLessonIds(rows) {
  return [...new Set((Array.isArray(rows) ? rows : [])
    .filter(row => Number(row?.vr_access ?? row?.vrAccess ?? 0) === 1)
    .map(row => clean(row?.lesson_id ?? row?.lessonId)).filter(Boolean))].sort();
}

function manualCoreLessonIds(user) { return manualIds(user, 'core'); }
function manualVrLessonIds(user) { return manualIds(user, 'vr'); }

function blockedLessonIds(user) {
  return [...new Set((Array.isArray(user?.blockedLessons) ? user.blockedLessons : [])
    .map(clean).filter(Boolean))].sort();
}

function configuredPreviewViewIds(user, currentRows) {
  if (Array.isArray(user?.upsellViews)) return sortedViewIds(user.upsellViews);
  const actual = new Set(currentRows.map(viewIdForBatch).filter(Boolean));
  const previews = [];
  for (const row of currentRows) {
    const counterpart = counterpartViewId(row);
    if (counterpart && !actual.has(counterpart)) previews.push(counterpart);
  }
  return sortedViewIds(previews);
}

function viewIdFromAccessRow(row, catalogue, batchDefinitions) {
  const direct = norm(row?.viewId ?? row?.view_id);
  if (VIEW_DEFINITIONS[direct]) return direct;
  const sourceBatch = clean(row?.source_batch_code ?? row?.sourceBatchCode ?? row?.batch_key ?? row?.batchKey);
  if (sourceBatch && batchDefinitions.has(sourceBatch)) {
    const resolved = viewIdForBatch(batchDefinitions.get(sourceBatch));
    if (resolved) return resolved;
  }
  return inferViewIdFromLessonAndBatch(row, catalogue);
}

function accessDerivedViewIds(input, catalogue) {
  const definitions = batchDefinitionLookup(input?.batchDefinitions);
  const views = new Set();
  for (const row of [
    ...(Array.isArray(input?.entitlements) ? input.entitlements : []),
    ...(Array.isArray(input?.onlinePreLessonEntitlements) ? input.onlinePreLessonEntitlements : [])
  ]) {
    const viewId = viewIdFromAccessRow(row, catalogue, definitions);
    if (viewId) views.add(viewId);
  }

  for (const lessonId of manualCoreLessonIds(input?.user || {})) {
    const candidates = (catalogue?.lessonToViews?.[lessonId] || [])
      .filter(viewId => VIEW_DEFINITIONS[viewId]?.stream === 'normal');
    if (candidates.length === 1) views.add(candidates[0]);
  }
  return sortedViewIds([...views]);
}

function lessonAccessMap({ catalogue, fullViews, entitlementIds, vrEntitlementIds, manualCoreIds, manualVrIds, preLessonIds, preLessonVrIds, temporaryLessonAccess, blockedIds }) {
  const full = new Set(fullViews);
  const earned = new Set(entitlementIds);
  const earnedVr = new Set(vrEntitlementIds);
  const manualCore = new Set(manualCoreIds);
  const manualVr = new Set(manualVrIds);
  const preOnly = new Set(preLessonIds);
  const preVr = new Set(preLessonVrIds);
  const blocked = new Set(blockedIds);
  const temporary = new Map();

  for (const row of Array.isArray(temporaryLessonAccess) ? temporaryLessonAccess : []) {
    const lessonId = clean(row?.lessonId ?? row?.lesson_id);
    if (!lessonId) continue;
    temporary.set(lessonId, {
      core:row?.core !== false,
      vr:row?.vr === true,
      preLessonOnly:row?.preLessonOnly === true,
      source:clean(row?.source || 'temporary') || 'temporary'
    });
  }

  const allLessonIds = new Set([
    ...Object.keys(catalogue?.lessonToViews || {}),
    ...earned, ...earnedVr, ...manualCore, ...manualVr, ...preOnly, ...preVr, ...temporary.keys(), ...blocked
  ]);
  const access = {};
  for (const lessonId of [...allLessonIds].sort()) {
    const views = catalogue?.lessonToViews?.[lessonId] || [];
    const fullLibrary = views.some(viewId => full.has(viewId));
    const temp = temporary.get(lessonId);
    const core = fullLibrary || earned.has(lessonId) || manualCore.has(lessonId) || Boolean(temp?.core);
    const vr = earnedVr.has(lessonId) || preVr.has(lessonId) || manualVr.has(lessonId) || Boolean(temp?.vr);
    const preLessonOnly = !core && (preOnly.has(lessonId) || Boolean(temp?.preLessonOnly));
    const isBlocked = blocked.has(lessonId);
    if (!core && !vr && !preLessonOnly && !isBlocked) continue;

    const sources = [];
    if (fullLibrary) sources.push('full-library');
    if (earned.has(lessonId)) sources.push('earned');
    if (manualCore.has(lessonId) || manualVr.has(lessonId)) sources.push('manual');
    if (preOnly.has(lessonId)) sources.push('online-prelesson');
    if (temp) sources.push(temp.source);

    access[lessonId] = {
      core:isBlocked ? false : core,
      vr:isBlocked ? false : vr,
      preLessonOnly:isBlocked ? false : preLessonOnly,
      blocked:isBlocked,
      sources:[...new Set(sources)].sort()
    };
  }
  return access;
}

function openCountForView(catalogue, viewId, access) {
  const lessons = catalogue?.views?.[viewId]?.lessons || [];
  return lessons.reduce((count, row) => {
    const state = access[row.lessonId];
    return count + (state && !state.blocked && (state.core || state.preLessonOnly) ? 1 : 0);
  }, 0);
}

function compileAccessSnapshot(input, catalogue, options = {}) {
  if (!catalogue || catalogue.kind !== 'prepared-catalogue') throw new Error('Prepared catalogue is required.');
  const asOfDate = asDate(options.asOfDate || input?.asOfDate);
  if (!asOfDate) throw new Error('A deterministic YYYY-MM-DD asOfDate is required.');

  const user = input?.user && typeof input.user === 'object' ? input.user : {};
  const currentRows = activeAssignments(input?.batchAssignments, asOfDate);
  const currentViews = sortedViewIds(currentRows.map(viewIdForBatch).filter(Boolean));
  const historyViews = historicalAssignmentViewIds(input?.batchAssignments, asOfDate);
  const fullViews = fullLibraryViewIds(Array.isArray(user.fullLibraries) ? user.fullLibraries : []);
  const entitlementIds = entitlementLessonIds(input?.entitlements);
  const vrEntitlementIds = vrEntitlementLessonIds(input?.entitlements);
  const manualCoreIds = manualCoreLessonIds(user);
  const manualVrIds = manualVrLessonIds(user);
  const preLessonIds = preLessonOnlyIds(input?.onlinePreLessonEntitlements);
  const preLessonVrIds = preLessonVrLessonIds(input?.onlinePreLessonEntitlements);
  const blockedIds = blockedLessonIds(user);
  const previewViews = configuredPreviewViewIds(user, currentRows);

  const accessDerivedViews = accessDerivedViewIds(input, catalogue);
  const visibleActualViews = sortedViewIds([...currentViews, ...historyViews, ...fullViews, ...accessDerivedViews]);

  const access = lessonAccessMap({
    catalogue, fullViews, entitlementIds, vrEntitlementIds, manualCoreIds, manualVrIds,
    preLessonIds, preLessonVrIds, temporaryLessonAccess:input?.temporaryLessonAccess, blockedIds
  });

  const currentSet = new Set(currentViews);
  const actualSet = new Set(visibleActualViews);
  const previewSet = new Set(previewViews.filter(viewId => !actualSet.has(viewId)));
  const ordered = sortedViewIds([...actualSet, ...previewSet]);
  const views = ordered.map(viewId => {
    const definition = VIEW_DEFINITIONS[viewId];
    const catalogueCount = Number(catalogue.views?.[viewId]?.lessonCount || 0);
    const preview = previewSet.has(viewId);
    const current = currentSet.has(viewId) || preview;
    const open = preview ? 0 : openCountForView(catalogue, viewId, access);
    return {
      viewId,
      subject:definition.subject,
      label:definition.label,
      current,
      group:current ? 'current' : 'previous',
      lockedPreview:preview,
      catalogueAvailable:catalogueCount > 0,
      visibleLessonCount:catalogueCount,
      openLessonCount:open,
      lockedLessonCount:Math.max(0, catalogueCount - open),
      ...(preview ? { source:Array.isArray(user.upsellViews) ? 'configuredUpsell' : 'crossSubjectPreview' } : {})
    };
  });

  const specialAreas = [...new Set([
    ...(Array.isArray(user.specialAccess) ? user.specialAccess : []),
    ...(Array.isArray(user.manualAccess?.specialBuckets) ? user.manualAccess.specialBuckets : [])
  ].map(value => clean(value).toUpperCase()).filter(Boolean))].sort();

  return {
    schemaVersion:1,
    kind:'prepared-access-snapshot',
    asOfDate,
    account:{
      firstName:clean(user.firstName || user.name),
      status:norm(user.accountStatus || user.status || 'active') || 'active',
      expiresOn:asDate(user.expiresOn || user.expires) || null
    },
    views,
    fullViewIds:fullViews,
    specialAreas,
    lessonAccess:access
  };
}

function assertNoSensitiveSnapshotFields(snapshot) {
  const forbidden = /(password|loginPassword|answerPassword|email|token|cookie|session|portalUserId|uname|pword|appass)/i;
  const stack = [snapshot];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.test(key)) throw new Error(`Prepared access snapshot contains forbidden field: ${key}`);
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return true;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
  return out;
}

function stableStringify(value) { return JSON.stringify(stableValue(value)); }

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function encodedScope(scope) {
  const value = clean(scope);
  if (!value) throw new Error('A non-empty read-model scope is required.');
  return encodeURIComponent(value).replace(/%/g, '_');
}

function pointerKey(scope) { return `${READ_MODEL_KEY_PREFIX}:scope:${encodedScope(scope)}:current`; }

function versionKey(scope, version) {
  const value = clean(version);
  if (!value) throw new Error('A non-empty version is required.');
  return `${READ_MODEL_KEY_PREFIX}:scope:${encodedScope(scope)}:version:${encodeURIComponent(value).replace(/%/g, '_')}`;
}

async function readJson(store, key) {
  const raw = await store.get(key);
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch { return null; }
}

async function verifiedEnvelope(store, scope, candidate) {
  if (!candidate?.version || !candidate?.sha256) return null;
  const raw = await store.get(versionKey(scope, candidate.version));
  if (raw == null) return null;
  const text = typeof raw === 'string' ? raw : stableStringify(raw);
  let envelope;
  try { envelope = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (envelope?.schemaVersion !== READ_MODEL_SCHEMA_VERSION || envelope?.kind !== 'prepared-read-model-envelope') return null;
  if (clean(envelope.scope) !== clean(scope) || clean(envelope.version) !== clean(candidate.version)) return null;
  const payloadSha256 = await sha256Hex(stableStringify(envelope.payload));
  if (payloadSha256 !== clean(envelope.sha256) || payloadSha256 !== clean(candidate.sha256)) return null;
  const envelopeSha256 = await sha256Hex(text);
  if (candidate.envelopeSha256 && envelopeSha256 !== candidate.envelopeSha256) return null;
  return { envelope, payloadSha256, envelopeSha256 };
}

async function resolveCurrentScope(store, scope) {
  const pointer = await readJson(store, pointerKey(scope));
  if (!pointer || pointer.kind !== 'prepared-read-model-pointer') throw new Error('READ_MODEL_POINTER_UNAVAILABLE');
  for (const candidate of [pointer.current, pointer.previous]) {
    if (!candidate?.version) continue;
    const verified = await verifiedEnvelope(store, scope, candidate);
    if (verified) {
      return {
        scope:clean(scope),
        version:clean(candidate.version),
        sha256:clean(candidate.sha256),
        envelopeSha256:verified.envelopeSha256,
        payload:verified.envelope.payload,
        usedFallback:clean(candidate.version) !== clean(pointer.current?.version),
        pointer
      };
    }
  }
  throw new Error('READ_MODEL_NO_VERIFIED_VERSION');
}

async function publishScopeAtomic(store, options = {}) {
  const scope = clean(options.scope);
  const payload = options.payload;
  if (!scope || payload == null) throw new Error('scope and payload are required.');

  const payloadText = stableStringify(payload);
  const payloadSha256 = await sha256Hex(payloadText);
  const current = await resolveCurrentScope(store, scope).catch(() => null);
  if (current && current.sha256 === payloadSha256) {
    return { scope, version:current.version, payloadSha256, envelopeSha256:current.envelopeSha256, previousVersion:current.pointer?.previous?.version || null, reused:true };
  }

  const version = clean(options.version) || payloadSha256.slice(0, 24);
  const previousPointer = await readJson(store, pointerKey(scope));
  const envelope = { schemaVersion:1, kind:'prepared-read-model-envelope', scope, version, sha256:payloadSha256, payload };
  const envelopeText = stableStringify(envelope);
  const envelopeSha256 = await sha256Hex(envelopeText);
  const candidate = { version, sha256:payloadSha256, envelopeSha256 };

  await store.put(versionKey(scope, version), envelopeText);
  if (!(await verifiedEnvelope(store, scope, candidate))) throw new Error('Candidate read-model version did not verify after write.');

  const previous = previousPointer?.current?.version ? {
    version:clean(previousPointer.current.version),
    sha256:clean(previousPointer.current.sha256),
    envelopeSha256:clean(previousPointer.current.envelopeSha256)
  } : null;
  const pointer = {
    schemaVersion:1,
    kind:'prepared-read-model-pointer',
    scope,
    current:candidate,
    previous,
    updatedAt:clean(options.updatedAt) || new Date().toISOString()
  };
  await store.put(pointerKey(scope), stableStringify(pointer));
  const confirmed = await readJson(store, pointerKey(scope));
  if (clean(confirmed?.current?.version) !== version || clean(confirmed?.current?.sha256) !== payloadSha256) {
    throw new Error('Current-version pointer did not verify after write.');
  }
  return { scope, version, payloadSha256, envelopeSha256, previousVersion:previous?.version || null, pointer, reused:false };
}

function kvBindingStore(binding) {
  if (!binding || typeof binding.get !== 'function' || typeof binding.put !== 'function') {
    throw new Error('READ_MODELS_KV binding with get/put is required.');
  }
  return {
    async get(key) { return binding.get(key); },
    async put(key, value) { return binding.put(key, value); }
  };
}

async function opaqueAccessScopeId(portalUserIdNorm, secret) {
  const user = norm(portalUserIdNorm);
  if (!user) throw new Error('A normalized Portal User ID is required to derive an opaque scope.');
  const keyText = clean(secret);
  if (!keyText) throw new Error('An access scope secret is required.');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(keyText), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`rebuild-shadow-scope-v1:${user}`)));
  return `u-${[...signature].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 40)}`;
}

function globalToCatalogue(global) {
  if (!global || global.kind !== 'prepared-global-read-model') throw new Error('GLOBAL_READ_MODEL_INVALID');
  return {
    schemaVersion:1,
    kind:'prepared-catalogue',
    source:global.source,
    navigation:global.navigation,
    views:global.catalogues,
    lessonToViews:global.lessonToViews
  };
}

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'
  }).format(new Date());
}

async function allRows(statement) {
  const result = await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function optionalAllRows(statement) {
  try { return await allRows(statement); } catch { return []; }
}

async function loadStudentAccessInput(env, portalUserIdNorm, catalogue, asOfDate = londonToday()) {
  const userId = norm(portalUserIdNorm);
  if (!userId) throw new Error('PORTAL_USER_ID_REQUIRED');
  const user = await env.STUDENTS_KV.get(`user:${userId}`, { type:'json' });
  if (!user) throw new Error('STUDENT_NOT_FOUND');

  const [batchDefinitions, batchAssignments, entitlements, preLesson] = await Promise.all([
    optionalAllRows(env.DB.prepare(
      `SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to
       FROM batch_definitions`
    )),
    optionalAllRows(env.DB.prepare(
      `SELECT a.portal_user_id_norm, a.batch_key, a.effective_from, a.effective_to,
              b.subject, b.school_year, b.stream, b.maths_level,
              b.active_from AS batch_active_from, b.active_to AS batch_active_to
       FROM student_batch_assignments a
       LEFT JOIN batch_definitions b ON b.batch_key = a.batch_key
       WHERE a.portal_user_id_norm = ?`
    ).bind(userId)),
    allRows(env.DB.prepare(
      `SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source,
              first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date
       FROM lesson_entitlements
       WHERE portal_user_id_norm = ?`
    ).bind(userId)),
    allRows(env.DB.prepare(
      `SELECT portal_user_id_norm, lesson_id, batch_key, lesson_date, vr_access,
              source_row_id, first_granted_at, last_confirmed_at
       FROM online_prelesson_entitlements
       WHERE portal_user_id_norm = ?`
    ).bind(userId))
  ]);

  const annotate = rows => rows.map(row => {
    const viewId = inferViewIdFromLessonAndBatch(row, catalogue);
    return viewId ? { ...row, viewId } : row;
  });

  return {
    asOfDate,
    user,
    batchDefinitions,
    batchAssignments,
    entitlements:annotate(entitlements),
    onlinePreLessonEntitlements:annotate(preLesson)
  };
}

function compileAccessScope(input, catalogue, scopeId, asOfDate) {
  const sourceUser = input?.user && typeof input.user === 'object' ? input.user : {};
  const normalizedInput = prepareAccessInputForParity({
    ...(input || {}),
    user:{
      ...sourceUser,
      accountStatus:clean(sourceUser.accountStatus || sourceUser.status || 'active') || 'active'
    }
  }, catalogue, { asOfDate });
  const snapshot = compileAccessSnapshot(normalizedInput, catalogue, { asOfDate });
  assertNoSensitiveSnapshotFields(snapshot);
  return {
    schemaVersion:1,
    kind:'prepared-access-read-model',
    scopeId,
    manualSpecialAreas:[...new Set((Array.isArray(sourceUser?.manualAccess?.specialBuckets) ? sourceUser.manualAccess.specialBuckets : [])
      .map(value => clean(value).toUpperCase()).filter(Boolean))].sort(),
    snapshot
  };
}

function assertCanonicalAccessProjected(input, compiled) {
  const blocked = new Set((Array.isArray(input?.user?.blockedLessons) ? input.user.blockedLessons : []).map(clean));
  const full = new Set((input?.entitlements || [])
    .filter(row => Number(row?.core_access ?? row?.coreAccess ?? 0) === 1)
    .map(row => clean(row?.lesson_id ?? row?.lessonId)).filter(Boolean));
  const pre = new Set((input?.onlinePreLessonEntitlements || [])
    .map(row => clean(row?.lesson_id ?? row?.lessonId)).filter(Boolean));
  const preVr = new Set((input?.onlinePreLessonEntitlements || [])
    .filter(row => Number(row?.vr_access ?? row?.vrAccess ?? 0) === 1)
    .map(row => clean(row?.lesson_id ?? row?.lessonId)).filter(Boolean));
  const access = compiled?.snapshot?.lessonAccess || {};
  for (const lessonId of full) {
    const state = access[lessonId];
    if (blocked.has(lessonId)) {
      if (!state?.blocked || state?.core) throw new Error(`READ_MODEL_BLOCKED_FULL_PARITY_FAILED:${lessonId}`);
    } else if (!state?.core || state?.preLessonOnly) {
      throw new Error(`READ_MODEL_FULL_PARITY_FAILED:${lessonId}`);
    }
  }
  for (const lessonId of pre) {
    if (full.has(lessonId)) continue;
    const state = access[lessonId];
    if (blocked.has(lessonId)) {
      if (!state?.blocked || state?.preLessonOnly) throw new Error(`READ_MODEL_BLOCKED_PRELESSON_PARITY_FAILED:${lessonId}`);
    } else if (!state?.preLessonOnly || state?.core) {
      throw new Error(`READ_MODEL_PRELESSON_PARITY_FAILED:${lessonId}`);
    } else if (preVr.has(lessonId) && !state?.vr) {
      throw new Error(`READ_MODEL_PRELESSON_VR_PARITY_FAILED:${lessonId}`);
    }
  }
}

async function assertReadModelReconciliationReady(env) {
  if (!env?.READ_MODELS_KV || !env?.STUDENTS_KV || !env?.DB) {
    throw new Error('READ_MODEL_RECONCILIATION_NOT_CONFIGURED');
  }
  const store = kvBindingStore(env.READ_MODELS_KV);
  const scopeSalt = clean(await env.READ_MODELS_KV.get(SCOPE_SALT_KEY));
  if (!/^[0-9a-f]{64}$/i.test(scopeSalt)) throw new Error('READ_MODEL_SCOPE_SALT_INVALID');
  const global = await resolveCurrentScope(store, 'global');
  globalToCatalogue(global.payload);
  return { ok:true, globalVersion:global.version };
}

async function refreshStudentAccessReadModel(env, portalUserIdNorm, options = {}) {
  if (!env?.READ_MODELS_KV || !env?.STUDENTS_KV || !env?.DB) {
    throw new Error('READ_MODEL_RECONCILIATION_NOT_CONFIGURED');
  }
  const store = kvBindingStore(env.READ_MODELS_KV);
  const scopeSalt = clean(await env.READ_MODELS_KV.get(SCOPE_SALT_KEY));
  if (!/^[0-9a-f]{64}$/i.test(scopeSalt)) throw new Error('READ_MODEL_SCOPE_SALT_INVALID');

  const global = await resolveCurrentScope(store, 'global');
  const catalogue = globalToCatalogue(global.payload);
  const asOfDate = clean(options.asOfDate) || londonToday();
  const input = await loadStudentAccessInput(env, portalUserIdNorm, catalogue, asOfDate);
  const scopeId = await opaqueAccessScopeId(portalUserIdNorm, scopeSalt);
  const payload = compileAccessScope(input, catalogue, scopeId, asOfDate);
  assertCanonicalAccessProjected(input, payload);

  const published = await publishScopeAtomic(store, {
    scope:`access:${scopeId}`,
    payload,
    updatedAt:new Date().toISOString()
  });
  return {
    ok:true,
    portalUserIdNorm:norm(portalUserIdNorm),
    scopeId,
    version:published.version,
    sha256:published.payloadSha256,
    reused:published.reused === true
  };
}

export {
  VIEW_DEFINITIONS,
  SCOPE_SALT_KEY,
  legacyBatchViewId,
  inferViewIdFromLessonAndBatch,
  prepareAccessInputForParity,
  compileAccessSnapshot,
  compileAccessScope,
  assertCanonicalAccessProjected,
  stableStringify,
  sha256Hex,
  pointerKey,
  versionKey,
  publishScopeAtomic,
  resolveCurrentScope,
  opaqueAccessScopeId,
  globalToCatalogue,
  assertReadModelReconciliationReady,
  refreshStudentAccessReadModel
};
