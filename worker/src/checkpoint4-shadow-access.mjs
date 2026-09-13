const VIEW_DEFINITIONS = Object.freeze({
  'maths-year2': { subject:'maths', label:'Year 2', rank:20, schoolYear:2, stream:'normal', fullLibraryIds:['MATHS_Y2_FULL'] },
  'maths-year3': { subject:'maths', label:'Year 3', rank:30, schoolYear:3, stream:'normal', fullLibraryIds:['MATHS_Y3_FULL'] },
  'maths-year4': { subject:'maths', label:'Year 4', rank:40, schoolYear:4, stream:'normal', fullLibraryIds:['MATHS_Y4_FULL'] },
  'maths-level1': { subject:'maths', label:'L1', rank:41, schoolYear:4, stream:'11plus', mathsLevel:1, fullLibraryIds:['MATHS_L1_FULL'] },
  'maths-year5': { subject:'maths', label:'Year 5', rank:50, schoolYear:5, stream:'normal', fullLibraryIds:['MATHS_Y5_FULL'] },
  'maths-level2': { subject:'maths', label:'L2', rank:51, schoolYear:5, stream:'11plus', mathsLevel:2, fullLibraryIds:['MATHS_L2_FULL'] },
  'maths-year6': { subject:'maths', label:'Year 6', rank:60, schoolYear:6, stream:'normal', fullLibraryIds:['MATHS_Y6_FULL'] },
  'maths-level3': { subject:'maths', label:'L3', rank:61, schoolYear:6, stream:'11plus', mathsLevel:3, fullLibraryIds:['MATHS_L3_FULL'] },
  'english-year2': { subject:'english', label:'Year 2', rank:20, schoolYear:2, stream:'normal', fullLibraryIds:['ENGLISH_Y2_FULL'] },
  'english-year3': { subject:'english', label:'Year 3', rank:30, schoolYear:3, stream:'normal', fullLibraryIds:['ENGLISH_Y3_FULL'] },
  'english-year4': { subject:'english', label:'Year 4', rank:40, schoolYear:4, stream:'normal', fullLibraryIds:['ENGLISH_Y4_FULL'] },
  'english-year4-11plus': { subject:'english', label:'Year 4 11+', rank:41, schoolYear:4, stream:'11plus', fullLibraryIds:['ENGLISH_Y4_11PLUS_FULL'] },
  'english-year5': { subject:'english', label:'Year 5', rank:50, schoolYear:5, stream:'normal', fullLibraryIds:['ENGLISH_Y5_FULL'] },
  'english-year5-11plus': { subject:'english', label:'Year 5 11+', rank:51, schoolYear:5, stream:'11plus', fullLibraryIds:['ENGLISH_Y5_11PLUS_FULL'] },
  'english-year6': { subject:'english', label:'Year 6', rank:60, schoolYear:6, stream:'normal', fullLibraryIds:['ENGLISH_Y6_FULL'] }
});

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const asDate = value => /^\d{4}-\d{2}-\d{2}$/.test(clean(value)) ? clean(value) : '';

function sortedViewIds(values = []) {
  return [...new Set(values.map(norm).filter(id => VIEW_DEFINITIONS[id]))].sort((left,right) => {
    const a = VIEW_DEFINITIONS[left];
    const b = VIEW_DEFINITIONS[right];
    return a.subject.localeCompare(b.subject) || a.rank - b.rank || left.localeCompare(right);
  });
}

function viewIdForBatch(row) {
  const subject = norm(row?.subject);
  const stream = norm(row?.stream);
  const year = Number(row?.school_year ?? row?.schoolYear ?? 0);
  const level = Number(row?.maths_level ?? row?.mathsLevel ?? 0);
  if (subject === 'maths') {
    if (stream === '11plus') {
      const resolved = level >= 1 && level <= 3 ? level : year - 3;
      return VIEW_DEFINITIONS[`maths-level${resolved}`] ? `maths-level${resolved}` : '';
    }
    return VIEW_DEFINITIONS[`maths-year${year}`] ? `maths-year${year}` : '';
  }
  if (subject === 'english') {
    if (stream === '11plus') return (year === 4 || year === 5) ? `english-year${year}-11plus` : '';
    return VIEW_DEFINITIONS[`english-year${year}`] ? `english-year${year}` : '';
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
    return VIEW_DEFINITIONS[`english-year${year}`] ? `english-year${year}` : '';
  }
  if (subject === 'english') {
    if (stream === '11plus') {
      const resolved = level >= 1 && level <= 3 ? level : year - 3;
      return VIEW_DEFINITIONS[`maths-level${resolved}`] ? `maths-level${resolved}` : '';
    }
    return VIEW_DEFINITIONS[`maths-year${year}`] ? `maths-year${year}` : '';
  }
  return '';
}

function assignmentStarted(row, asOfDate) {
  const from = asDate(row?.effective_from ?? row?.effectiveFrom);
  return !from || from <= asOfDate;
}

function activeAssignments(rows, asOfDate) {
  return (Array.isArray(rows) ? rows : []).filter(row => {
    if (!assignmentStarted(row, asOfDate)) return false;
    const to = asDate(row?.effective_to ?? row?.effectiveTo);
    if (to && asOfDate >= to) return false;
    const batchFrom = asDate(row?.batch_active_from ?? row?.batchActiveFrom);
    const batchTo = asDate(row?.batch_active_to ?? row?.batchActiveTo);
    if (batchFrom && batchFrom > asOfDate) return false;
    return !batchTo || asOfDate < batchTo;
  });
}

function fullLibraryViewIds(user = {}) {
  const libraries = new Set((Array.isArray(user.fullLibraries) ? user.fullLibraries : []).map(value => clean(value).toUpperCase()));
  return sortedViewIds(Object.entries(VIEW_DEFINITIONS)
    .filter(([,def]) => (def.fullLibraryIds || []).some(id => libraries.has(id)))
    .map(([id]) => id));
}

function manualCoreLessonIds(user = {}) {
  const ids = new Set();
  for (const value of Array.isArray(user?.manualAccess?.coreLessons) ? user.manualAccess.coreLessons : []) {
    const id = clean(value); if (id) ids.add(id);
  }
  const legacy = user?.manualLessonAccess;
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    for (const [lessonId,modes] of Object.entries(legacy)) {
      if (Array.isArray(modes) && modes.map(norm).includes('core')) ids.add(clean(lessonId));
    }
  }
  return [...ids].filter(Boolean).sort();
}

function manualVrLessonIds(user = {}) {
  const ids = new Set();
  for (const value of Array.isArray(user?.manualAccess?.vrLessons) ? user.manualAccess.vrLessons : []) {
    const id = clean(value); if (id) ids.add(id);
  }
  const legacy = user?.manualLessonAccess;
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    for (const [lessonId,modes] of Object.entries(legacy)) {
      if (Array.isArray(modes) && modes.map(norm).includes('vr')) ids.add(clean(lessonId));
    }
  }
  return [...ids].filter(Boolean).sort();
}

function blockedLessonIds(user = {}) {
  return [...new Set((Array.isArray(user.blockedLessons) ? user.blockedLessons : []).map(clean).filter(Boolean))].sort();
}

function batchDefinitionLookup(definitions = []) {
  const map = new Map();
  for (const row of Array.isArray(definitions) ? definitions : []) {
    const key = clean(row?.batch_key ?? row?.batchKey);
    if (key) map.set(key, row);
  }
  return map;
}

function viewIdFromAccessRow(row, catalogue, definitions) {
  const direct = norm(row?.viewId ?? row?.view_id);
  if (VIEW_DEFINITIONS[direct]) return direct;
  const sourceBatch = clean(row?.source_batch_code ?? row?.sourceBatchCode ?? row?.batch_key ?? row?.batchKey);
  if (sourceBatch && definitions.has(sourceBatch)) {
    const resolved = viewIdForBatch(definitions.get(sourceBatch));
    if (resolved) return resolved;
  }
  const lessonId = clean(row?.lesson_id ?? row?.lessonId);
  const candidates = catalogue?.lessonToViews?.[lessonId] || [];
  return candidates.length === 1 ? candidates[0] : '';
}

function compileAccessSnapshot(input, catalogue, options = {}) {
  if (!catalogue || typeof catalogue !== 'object') throw new Error('Prepared global catalogue is required.');
  const asOfDate = asDate(options.asOfDate || input?.asOfDate);
  if (!asOfDate) throw new Error('A deterministic YYYY-MM-DD asOfDate is required.');
  const user = input?.user && typeof input.user === 'object' ? input.user : {};
  const assignments = Array.isArray(input?.batchAssignments) ? input.batchAssignments : [];
  const currentRows = activeAssignments(assignments, asOfDate);
  const currentViews = sortedViewIds(currentRows.map(viewIdForBatch).filter(Boolean));
  const historyViews = sortedViewIds(assignments.filter(row => assignmentStarted(row, asOfDate)).map(viewIdForBatch).filter(Boolean));
  const fullViews = fullLibraryViewIds(user);
  const definitions = batchDefinitionLookup(input?.batchDefinitions);
  const accessViews = new Set();
  for (const row of [...(input?.entitlements || []), ...(input?.onlinePreLessonEntitlements || [])]) {
    const viewId = viewIdFromAccessRow(row, catalogue, definitions);
    if (viewId) accessViews.add(viewId);
  }
  for (const lessonId of manualCoreLessonIds(user)) {
    const candidates = (catalogue?.lessonToViews?.[lessonId] || []).filter(viewId => VIEW_DEFINITIONS[viewId]?.stream === 'normal');
    if (candidates.length === 1) accessViews.add(candidates[0]);
  }
  const actualViews = sortedViewIds([...currentViews, ...historyViews, ...fullViews, ...accessViews]);
  const actualSet = new Set(actualViews);
  let previewViews;
  if (Array.isArray(user.upsellViews)) {
    previewViews = sortedViewIds(user.upsellViews).filter(id => !actualSet.has(id));
  } else {
    const previews = [];
    for (const row of currentRows) {
      const id = counterpartViewId(row);
      if (id && !actualSet.has(id)) previews.push(id);
    }
    previewViews = sortedViewIds(previews);
  }

  const entitlementCore = new Set((input?.entitlements || []).filter(r => Number(r?.core_access ?? r?.coreAccess ?? 1) !== 0).map(r => clean(r?.lesson_id ?? r?.lessonId)).filter(Boolean));
  const entitlementVr = new Set((input?.entitlements || []).filter(r => Number(r?.vr_access ?? r?.vrAccess ?? 0) === 1).map(r => clean(r?.lesson_id ?? r?.lessonId)).filter(Boolean));
  const prelesson = new Set((input?.onlinePreLessonEntitlements || []).map(r => clean(r?.lesson_id ?? r?.lessonId)).filter(Boolean));
  const manualCore = new Set(manualCoreLessonIds(user));
  const manualVr = new Set(manualVrLessonIds(user));
  const blocked = new Set(blockedLessonIds(user));
  const fullSet = new Set(fullViews);
  const allLessonIds = new Set([
    ...Object.keys(catalogue?.lessonToViews || {}), ...entitlementCore, ...entitlementVr,
    ...prelesson, ...manualCore, ...manualVr, ...blocked
  ]);
  const lessonAccess = {};
  for (const lessonId of [...allLessonIds].sort()) {
    const views = catalogue?.lessonToViews?.[lessonId] || [];
    const full = views.some(id => fullSet.has(id));
    const isBlocked = blocked.has(lessonId);
    const core = full || entitlementCore.has(lessonId) || manualCore.has(lessonId);
    const vr = entitlementVr.has(lessonId) || manualVr.has(lessonId);
    const preLessonOnly = !core && prelesson.has(lessonId);
    if (!core && !vr && !preLessonOnly && !isBlocked) continue;
    const sources = [];
    if (full) sources.push('full-library');
    if (entitlementCore.has(lessonId) || entitlementVr.has(lessonId)) sources.push('earned');
    if (manualCore.has(lessonId) || manualVr.has(lessonId)) sources.push('manual');
    if (prelesson.has(lessonId)) sources.push('online-prelesson');
    lessonAccess[lessonId] = {
      core: isBlocked ? false : core,
      vr: isBlocked ? false : vr,
      preLessonOnly: isBlocked ? false : preLessonOnly,
      blocked: isBlocked,
      sources: [...new Set(sources)].sort()
    };
  }

  function openCount(viewId) {
    const lessons = catalogue?.catalogues?.[viewId]?.lessons || catalogue?.views?.[viewId]?.lessons || [];
    return lessons.reduce((count,row) => {
      const state = lessonAccess[row.lessonId];
      return count + (state && !state.blocked && (state.core || state.preLessonOnly) ? 1 : 0);
    }, 0);
  }
  const currentSet = new Set(currentViews);
  const previewSet = new Set(previewViews);
  const views = sortedViewIds([...actualViews, ...previewViews]).map(viewId => {
    const def = VIEW_DEFINITIONS[viewId];
    const catalogueView = catalogue?.catalogues?.[viewId] || catalogue?.views?.[viewId] || {};
    const count = Number(catalogueView.lessonCount || 0);
    const preview = previewSet.has(viewId);
    const current = currentSet.has(viewId) || preview;
    const open = preview ? 0 : openCount(viewId);
    return {
      viewId,
      subject:def.subject,
      label:def.label,
      current,
      group:current ? 'current' : 'previous',
      lockedPreview:preview,
      catalogueAvailable:count > 0,
      visibleLessonCount:count,
      openLessonCount:open,
      lockedLessonCount:Math.max(0,count-open)
    };
  });

  const specialAreas = [...new Set([
    ...(Array.isArray(user.specialAccess) ? user.specialAccess : []),
    ...(Array.isArray(user?.manualAccess?.specialBuckets) ? user.manualAccess.specialBuckets : [])
  ].map(value => clean(value).toUpperCase()).filter(Boolean))].sort();

  return {
    schemaVersion:1,
    kind:'prepared-access-snapshot',
    asOfDate,
    account:{
      firstName:clean(user.firstName || user.name),
      status:norm(user.accountStatus || 'active') || 'active',
      expiresOn:asDate(user.expiresOn || user.expires) || null
    },
    views,
    fullViewIds:fullViews,
    specialAreas,
    lessonAccess
  };
}

function compileAccessReadModel(input, globalReadModel, scopeId, asOfDate) {
  const id = clean(scopeId);
  if (!id) throw new Error('Opaque access scope ID is required.');
  const snapshot = compileAccessSnapshot(input, globalReadModel, { asOfDate });
  const text = JSON.stringify(snapshot);
  for (const forbidden of ['loginPassword','answerPassword','portalUserId','pword','appass']) {
    if (text.includes(forbidden)) throw new Error(`Sensitive access field leaked: ${forbidden}`);
  }
  return { schemaVersion:1, kind:'prepared-access-read-model', scopeId:id, snapshot };
}

async function deriveOpaqueScopeId(portalUserIdNorm, secret) {
  const user = norm(portalUserIdNorm);
  if (!user || !clean(secret)) throw new Error('User and scope secret are required.');
  const domain = `rebuild-shadow-scope-v1:${user}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(secret)), { name:'HMAC', hash:'SHA-256' }, false, ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(domain)));
  const hex = [...sig].map(byte => byte.toString(16).padStart(2,'0')).join('');
  return `u-${hex.slice(0,40)}`;
}

export {
  clean,
  norm,
  VIEW_DEFINITIONS,
  viewIdForBatch,
  compileAccessSnapshot,
  compileAccessReadModel,
  deriveOpaqueScopeId
};
