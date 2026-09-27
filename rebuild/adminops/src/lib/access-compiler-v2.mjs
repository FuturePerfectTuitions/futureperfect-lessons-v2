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

function normaliseProgrammeNeutralAccess(input, asOfDate) {
  const definitions = definitionMap(input?.batchDefinitions);
  const currentProgramme = currentEquivalentProgramme(input, asOfDate);
  const hasEquivalentD1History = equivalentAssignmentViews(input).length > 0;
  const sourceUser = input?.user && typeof input.user === 'object' ? input.user : {};

  // D1 assignment state is authoritative for Year6/L3 whenever any D1 history
  // exists. That includes students whose equivalent assignment is now historical:
  // a stale KV profile batch must not resurrect Year6 or L3 as current. If no D1
  // equivalent assignment exists at all, profile batches remain compatibility
  // fallback and are interpreted through D1 batch_definitions where available.
  const profileBatches = (Array.isArray(sourceUser.batches) ? sourceUser.batches : []).filter(value => {
    if (!hasEquivalentD1History) return true;
    const key = upper(value);
    if (!key || !definitions.has(key)) return true;
    const viewId = authoritativeBatchViewId(key, definitions);
    return viewId !== 'maths-year6' && viewId !== 'maths-level3';
  });

  const sanitise = row => {
    const id = lessonId(row);
    if (isSatsLessonId(id)) {
      return stripTeachingSource(row, currentProgramme || 'maths-sats');
    }
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

function compileAccessScopeV2(input, catalogue, options = {}) {
  const asOfDate = clean(options.asOfDate || input?.asOfDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new Error('A deterministic YYYY-MM-DD asOfDate is required.');
  const normalized = normaliseProgrammeNeutralAccess(input, asOfDate);
  const payload = compileBaseAccessScope(normalized, catalogue, { ...options, asOfDate });
  const current = (payload?.snapshot?.views || []).filter(view => view?.current && !view?.lockedPreview &&
    (view?.viewId === 'maths-year6' || view?.viewId === 'maths-level3'));
  if (current.length > 1) throw new Error('COMPILED_YEAR6_L3_PROGRAMME_COLLISION');
  return payload;
}

export {
  ACCESS_COMPILER_V2_MARKER,
  equivalentAssignmentViews,
  currentEquivalentProgramme,
  normaliseProgrammeNeutralAccess,
  compileAccessScopeV2
};
