import { compileAccessScope as compileBaseAccessScope } from './compiler.mjs';
import {
  assignmentCurrent,
  authoritativeBatchViewId
} from './backfill-parity-audit.mjs';
import { clean, isSatsLessonId, viewIdForBatch } from '../../../shared/read-models/view-registry.mjs';

const ACCESS_COMPILER_V2_MARKER = 'y6-l3-sats-programme-neutral-access-v2';
const upper = value => clean(value).toUpperCase();
const lessonId = row => clean(row?.lesson_id ?? row?.lessonId);

function definitionMap(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = upper(row?.batch_key ?? row?.batchKey);
    if (key) map.set(key, row);
  }
  return map;
}

function stripTeachingSource(row, forcedViewId = '') {
  const next = { ...(row || {}) };
  delete next.source_batch_code;
  delete next.sourceBatchCode;
  delete next.batch_key;
  delete next.batchKey;
  delete next.viewId;
  delete next.view_id;
  if (clean(forcedViewId)) next.viewId = clean(forcedViewId);
  return next;
}

function equivalentAssignmentViews(input) {
  return (Array.isArray(input?.batchAssignments) ? input.batchAssignments : [])
    .map(viewIdForBatch)
    .filter(id => id === 'maths-year6' || id === 'maths-level3');
}

function currentEquivalentProgramme(input, asOfDate) {
  const ids = [...new Set((Array.isArray(input?.batchAssignments) ? input.batchAssignments : [])
    .filter(row => assignmentCurrent(row, asOfDate))
    .map(viewIdForBatch)
    .filter(id => id === 'maths-year6' || id === 'maths-level3'))];
  if (ids.length > 1) throw new Error('D1_YEAR6_L3_PROGRAMME_COLLISION');
  return ids[0] || '';
}

function explicitDualFullLibrary(input) {
  const full = new Set((input?.user?.fullLibraries || []).map(upper));
  return full.has('MATHS_Y6_FULL') && full.has('MATHS_L3_FULL');
}

function normaliseProgrammeNeutralAccess(input, asOfDate) {
  const definitions = definitionMap(input?.batchDefinitions);
  const currentProgramme = currentEquivalentProgramme(input, asOfDate);
  const hasEquivalentD1History = equivalentAssignmentViews(input).length > 0;
  const sourceUser = input?.user && typeof input.user === 'object' ? input.user : {};

  const profileBatches = (Array.isArray(sourceUser.batches) ? sourceUser.batches : []).filter(value => {
    if (!hasEquivalentD1History) return true;
    const key = upper(value);
    if (!key || !definitions.has(key)) return true;
    const viewId = authoritativeBatchViewId(key, definitions);
    return viewId !== 'maths-year6' && viewId !== 'maths-level3';
  });

  const sanitise = row => {
    const id = lessonId(row);
    if (isSatsLessonId(id)) return stripTeachingSource(row, currentProgramme || 'maths-sats');
    if (!currentProgramme) return { ...(row || {}) };
    const batch = clean(row?.source_batch_code ?? row?.sourceBatchCode ?? row?.batch_key ?? row?.batchKey);
    const sourceView = authoritativeBatchViewId(batch, definitions);
    if ((sourceView === 'maths-year6' || sourceView === 'maths-level3') && sourceView !== currentProgramme) {
      return stripTeachingSource(row, currentProgramme);
    }
    return { ...(row || {}) };
  };

  return {
    ...(input || {}),
    user:{ ...sourceUser, batches:profileBatches },
    entitlements:(Array.isArray(input?.entitlements) ? input.entitlements : []).map(sanitise),
    onlinePreLessonEntitlements:(Array.isArray(input?.onlinePreLessonEntitlements) ? input.onlinePreLessonEntitlements : []).map(sanitise)
  };
}

function collisionDiagnostic(input, normalized, payload, asOfDate) {
  const definitions = definitionMap(input?.batchDefinitions);
  const equivalent = value => {
    const id = authoritativeBatchViewId(value, definitions);
    return id === 'maths-year6' || id === 'maths-level3' ? id : '';
  };
  const rowViews = rows => [...new Set((Array.isArray(rows) ? rows : []).map(row => {
    const direct = clean(row?.viewId ?? row?.view_id);
    if (direct === 'maths-year6' || direct === 'maths-level3') return direct;
    return equivalent(row?.source_batch_code ?? row?.sourceBatchCode ?? row?.batch_key ?? row?.batchKey);
  }).filter(Boolean))].sort();
  return {
    outputCurrent:(payload?.snapshot?.views || []).filter(view => view?.current && !view?.lockedPreview)
      .map(view => view?.viewId).filter(id => id === 'maths-year6' || id === 'maths-level3').sort(),
    d1Current:[...new Set((input?.batchAssignments || []).filter(row => assignmentCurrent(row, asOfDate)).map(viewIdForBatch)
      .filter(id => id === 'maths-year6' || id === 'maths-level3'))].sort(),
    d1History:[...new Set(equivalentAssignmentViews(input))].sort(),
    profileOriginal:[...new Set((input?.user?.batches || []).map(equivalent).filter(Boolean))].sort(),
    profileNormalized:[...new Set((normalized?.user?.batches || []).map(equivalent).filter(Boolean))].sort(),
    entitlementViews:rowViews(normalized?.entitlements),
    preLessonViews:rowViews(normalized?.onlinePreLessonEntitlements),
    fullLibraries:[...new Set((input?.user?.fullLibraries || []).map(value => upper(value))
      .filter(value => value === 'MATHS_Y6_FULL' || value === 'MATHS_L3_FULL'))].sort()
  };
}

function demoteDualFullLibraryViews(input, payload, asOfDate) {
  if (!explicitDualFullLibrary(input)) return payload;
  const views = payload?.snapshot?.views;
  if (!Array.isArray(views)) return payload;
  const currentD1 = currentEquivalentProgramme(input, asOfDate);
  for (const view of views) {
    if (view?.viewId !== 'maths-year6' && view?.viewId !== 'maths-level3') continue;
    if (currentD1 && view.viewId === currentD1) continue;
    view.current = false;
    view.group = 'previous';
  }
  return payload;
}

function compileAccessScopeV2(input, catalogue, options = {}) {
  const asOfDate = clean(options.asOfDate || input?.asOfDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new Error('A deterministic YYYY-MM-DD asOfDate is required.');
  const normalized = normaliseProgrammeNeutralAccess(input, asOfDate);
  let payload = compileBaseAccessScope(normalized, catalogue, { ...options, asOfDate });
  payload = demoteDualFullLibraryViews(input, payload, asOfDate);
  const current = (payload?.snapshot?.views || []).filter(view => view?.current && !view?.lockedPreview &&
    (view?.viewId === 'maths-year6' || view?.viewId === 'maths-level3'));
  if (current.length > 1) {
    throw new Error(`COMPILED_YEAR6_L3_PROGRAMME_COLLISION:${JSON.stringify(collisionDiagnostic(input, normalized, payload, asOfDate))}`);
  }
  return payload;
}

export {
  ACCESS_COMPILER_V2_MARKER,
  equivalentAssignmentViews,
  currentEquivalentProgramme,
  explicitDualFullLibrary,
  normaliseProgrammeNeutralAccess,
  collisionDiagnostic,
  demoteDualFullLibraryViews,
  compileAccessScopeV2
};
