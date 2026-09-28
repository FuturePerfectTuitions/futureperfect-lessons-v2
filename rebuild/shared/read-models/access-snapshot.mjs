import {
  VIEW_DEFINITIONS,
  clean,
  norm,
  counterpartViewId,
  fullLibraryViewIds,
  sortedViewIds,
  viewIdForBatch
} from './view-registry.mjs';

function asDate(value) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function isActiveWindow(row, asOfDate) {
  const from = asDate(row?.effective_from ?? row?.effectiveFrom ?? row?.active_from ?? row?.activeFrom);
  const to = asDate(row?.effective_to ?? row?.effectiveTo ?? row?.active_to ?? row?.activeTo);
  if (from && from > asOfDate) return false;
  return !to || asOfDate < to;
}

function assignmentStarted(row, asOfDate) {
  const from = asDate(row?.effective_from ?? row?.effectiveFrom);
  return !from || from <= asOfDate;
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

function entitlementLessonIds(entitlements) {
  return [...new Set((Array.isArray(entitlements) ? entitlements : [])
    .filter(row => Number(row?.core_access ?? row?.coreAccess ?? 1) !== 0)
    .map(row => clean(row?.lesson_id ?? row?.lessonId))
    .filter(Boolean))].sort();
}

function vrEntitlementLessonIds(entitlements) {
  return [...new Set((Array.isArray(entitlements) ? entitlements : [])
    .filter(row => Number(row?.vr_access ?? row?.vrAccess ?? 0) === 1)
    .map(row => clean(row?.lesson_id ?? row?.lessonId))
    .filter(Boolean))].sort();
}

function preLessonOnlyIds(rows) {
  return [...new Set((Array.isArray(rows) ? rows : [])
    .map(row => clean(row?.lesson_id ?? row?.lessonId))
    .filter(Boolean))].sort();
}

function manualCoreLessonIds(user) {
  const ids = new Set();
  for (const value of Array.isArray(user?.manualAccess?.coreLessons) ? user.manualAccess.coreLessons : []) {
    const id = clean(value);
    if (id) ids.add(id);
  }
  const legacy = user?.manualLessonAccess;
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    for (const [lessonId, modes] of Object.entries(legacy)) {
      if (Array.isArray(modes) && modes.map(norm).includes('core')) ids.add(clean(lessonId));
    }
  }
  return [...ids].filter(Boolean).sort();
}

function manualVrLessonIds(user) {
  const ids = new Set();
  for (const value of Array.isArray(user?.manualAccess?.vrLessons) ? user.manualAccess.vrLessons : []) {
    const id = clean(value);
    if (id) ids.add(id);
  }
  const legacy = user?.manualLessonAccess;
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    for (const [lessonId, modes] of Object.entries(legacy)) {
      if (Array.isArray(modes) && modes.map(norm).includes('vr')) ids.add(clean(lessonId));
    }
  }
  return [...ids].filter(Boolean).sort();
}

function blockedLessonIds(user) {
  return [...new Set((Array.isArray(user?.blockedLessons) ? user.blockedLessons : [])
    .map(clean)
    .filter(Boolean))].sort();
}

function configuredPreviewViewIds(user, currentRows) {
  if (Array.isArray(user?.upsellViews)) {
    return sortedViewIds(user.upsellViews);
  }
  const actual = new Set(currentRows.map(viewIdForBatch).filter(Boolean));
  const previews = [];
  for (const row of currentRows) {
    const counterpart = counterpartViewId(row);
    if (counterpart && !actual.has(counterpart)) previews.push(counterpart);
  }
  return sortedViewIds(previews);
}

function batchDefinitionLookup(definitions = []) {
  const map = new Map();
  for (const row of Array.isArray(definitions) ? definitions : []) {
    const key = clean(row?.batch_key ?? row?.batchKey);
    if (key) map.set(key, row);
  }
  return map;
}

function viewIdFromAccessRow(row, catalogue, batchDefinitions) {
  const direct = norm(row?.viewId ?? row?.view_id);
  if (VIEW_DEFINITIONS[direct]) return direct;
  const sourceBatch = clean(row?.source_batch_code ?? row?.sourceBatchCode ?? row?.batch_key ?? row?.batchKey);
  if (sourceBatch && batchDefinitions.has(sourceBatch)) {
    const resolved = viewIdForBatch(batchDefinitions.get(sourceBatch));
    if (resolved) return resolved;
  }
  const lessonId = clean(row?.lesson_id ?? row?.lessonId);
  const candidates = catalogue?.lessonToViews?.[lessonId] || [];
  return candidates.length === 1 ? candidates[0] : '';
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

  // Manual core access is deliberately presentation-only and historically
  // surfaces the corresponding ordinary Year view, not an ambiguous 11+ view
  // that happens to share the same canonical curriculum.
  for (const lessonId of manualCoreLessonIds(input?.user || {})) {
    const candidates = (catalogue?.lessonToViews?.[lessonId] || [])
      .filter(viewId => VIEW_DEFINITIONS[viewId]?.stream === 'normal');
    if (candidates.length === 1) views.add(candidates[0]);
  }
  return sortedViewIds([...views]);
}

function lessonAccessMap({
  catalogue,
  fullViews,
  entitlementIds,
  vrEntitlementIds,
  manualCoreIds,
  manualVrIds,
  preLessonIds,
  temporaryLessonAccess,
  blockedIds
}) {
  const full = new Set(fullViews);
  const earned = new Set(entitlementIds);
  const earnedVr = new Set(vrEntitlementIds);
  const manualCore = new Set(manualCoreIds);
  const manualVr = new Set(manualVrIds);
  const preOnly = new Set(preLessonIds);
  const blocked = new Set(blockedIds);
  const temp = new Map();
  for (const row of Array.isArray(temporaryLessonAccess) ? temporaryLessonAccess : []) {
    const lessonId = clean(row?.lessonId ?? row?.lesson_id);
    if (!lessonId) continue;
    temp.set(lessonId, {
      core: row?.core !== false,
      vr: row?.vr === true,
      preLessonOnly: row?.preLessonOnly === true,
      source: clean(row?.source || 'temporary') || 'temporary'
    });
  }

  const allLessonIds = new Set([
    ...Object.keys(catalogue?.lessonToViews || {}),
    ...earned,
    ...earnedVr,
    ...manualCore,
    ...manualVr,
    ...preOnly,
    ...temp.keys(),
    ...blocked
  ]);
  const access = {};
  for (const lessonId of [...allLessonIds].sort()) {
    const views = catalogue?.lessonToViews?.[lessonId] || [];
    const fullLibrary = views.some(viewId => full.has(viewId));
    const temporary = temp.get(lessonId);
    const core = fullLibrary || earned.has(lessonId) || manualCore.has(lessonId) || Boolean(temporary?.core);
    const vr = earnedVr.has(lessonId) || manualVr.has(lessonId) || Boolean(temporary?.vr);
    const preLessonOnly = !core && (preOnly.has(lessonId) || Boolean(temporary?.preLessonOnly));
    const isBlocked = blocked.has(lessonId);
    if (!core && !vr && !preLessonOnly && !isBlocked) continue;

    const sources = [];
    if (fullLibrary) sources.push('full-library');
    if (earned.has(lessonId)) sources.push('earned');
    if (manualCore.has(lessonId) || manualVr.has(lessonId)) sources.push('manual');
    if (preOnly.has(lessonId)) sources.push('online-prelesson');
    if (temporary) sources.push(temporary.source);

    access[lessonId] = {
      core: isBlocked ? false : core,
      vr: isBlocked ? false : vr,
      preLessonOnly: isBlocked ? false : preLessonOnly,
      blocked: isBlocked,
      sources: [...new Set(sources)].sort()
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
  if (!catalogue || catalogue.kind !== 'prepared-catalogue') {
    throw new Error('Prepared catalogue is required.');
  }
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
  const blockedIds = blockedLessonIds(user);
  const previewViews = configuredPreviewViewIds(user, currentRows);

  const accessDerivedViews = accessDerivedViewIds(input, catalogue);
  const visibleActualViews = sortedViewIds([
    ...currentViews,
    ...historyViews,
    ...fullViews,
    ...accessDerivedViews
  ]);

  const access = lessonAccessMap({
    catalogue,
    fullViews,
    entitlementIds,
    vrEntitlementIds,
    manualCoreIds,
    manualVrIds,
    preLessonIds,
    temporaryLessonAccess: input?.temporaryLessonAccess,
    blockedIds
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
      subject: definition.subject,
      label: definition.label,
      current,
      group: current ? 'current' : 'previous',
      lockedPreview: preview,
      catalogueAvailable: catalogueCount > 0,
      visibleLessonCount: catalogueCount,
      openLessonCount: open,
      lockedLessonCount: Math.max(0, catalogueCount - open),
      ...(preview ? { source: Array.isArray(user.upsellViews) ? 'configuredUpsell' : 'crossSubjectPreview' } : {})
    };
  });

  const specialAreas = [...new Set([
    ...(Array.isArray(user.specialAccess) ? user.specialAccess : []),
    ...(Array.isArray(user.manualAccess?.specialBuckets) ? user.manualAccess.specialBuckets : [])
  ].map(value => clean(value).toUpperCase()).filter(Boolean))].sort();

  return {
    schemaVersion: 1,
    kind: 'prepared-access-snapshot',
    asOfDate,
    account: {
      firstName: clean(user.firstName || user.name),
      status: norm(user.accountStatus || 'active') || 'active',
      expiresOn: asDate(user.expiresOn || user.expires) || null
    },
    views,
    fullViewIds: fullViews,
    specialAreas,
    lessonAccess: access
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

export {
  asDate,
  isActiveWindow,
  activeAssignments,
  historicalAssignmentViewIds,
  entitlementLessonIds,
  manualCoreLessonIds,
  configuredPreviewViewIds,
  batchDefinitionLookup,
  viewIdFromAccessRow,
  accessDerivedViewIds,
  compileAccessSnapshot,
  assertNoSensitiveSnapshotFields
};
