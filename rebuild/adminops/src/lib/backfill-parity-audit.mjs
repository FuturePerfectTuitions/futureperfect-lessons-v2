import {
  VIEW_DEFINITIONS,
  clean,
  norm,
  fullLibraryViewIds,
  sortedViewIds,
  viewDefinition,
  viewIdForBatch
} from '../../../shared/read-models/view-registry.mjs';

const COUNTERPART_VIEW = Object.freeze({
  'maths-year2':'english-year2', 'maths-year3':'english-year3', 'maths-year4':'english-year4',
  'maths-year5':'english-year5', 'maths-year6':'english-year6',
  'maths-level1':'english-year4-11plus', 'maths-level2':'english-year5-11plus',
  'english-year2':'maths-year2', 'english-year3':'maths-year3', 'english-year4':'maths-year4',
  'english-year5':'maths-year5', 'english-year6':'maths-year6',
  'english-year4-11plus':'maths-level1', 'english-year5-11plus':'maths-level2'
});

function asDate(value) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function academicYearStart(asOfDate) {
  const date = asDate(asOfDate);
  if (!date) return '';
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return `${month >= 9 ? year : year - 1}-09-01`;
}

function assignmentStarted(row, asOfDate) {
  const from = asDate(row?.effective_from ?? row?.effectiveFrom);
  return !from || from <= asOfDate;
}

function assignmentCurrent(row, asOfDate) {
  if (!assignmentStarted(row, asOfDate)) return false;
  const to = asDate(row?.effective_to ?? row?.effectiveTo);
  const activeFrom = asDate(row?.batch_active_from ?? row?.batchActiveFrom ?? row?.active_from ?? row?.activeFrom);
  const activeTo = asDate(row?.batch_active_to ?? row?.batchActiveTo ?? row?.active_to ?? row?.activeTo);
  return (!to || asOfDate < to) && (!activeFrom || activeFrom <= asOfDate) && (!activeTo || asOfDate < activeTo);
}

function legacyBatchViewId(value) {
  const key = clean(value).toUpperCase();
  let match = key.match(/^Y([2-6])M(?:O)?$/);
  if (match) return `maths-year${match[1]}`;
  match = key.match(/^Y([2-6])E(?:O)?$/);
  if (match) return `english-year${match[1]}`;
  match = key.match(/^Y([4-6])(?:11|M11|11M).*$/);
  if (match) return `maths-level${Number(match[1]) - 3}`;
  match = key.match(/^Y([45])(?:E11|11E).*$/);
  if (match) return `english-year${match[1]}-11plus`;
  return '';
}

function rowBatchKey(row) {
  return clean(row?.source_batch_code ?? row?.sourceBatchCode ?? row?.batch_key ?? row?.batchKey);
}

function batchDefinitionMap(definitions = []) {
  const map = new Map();
  for (const row of Array.isArray(definitions) ? definitions : []) {
    const key = clean(row?.batch_key ?? row?.batchKey);
    if (key) map.set(key, row);
  }
  return map;
}

function historicalHintSet(user) {
  return new Set((Array.isArray(user?.historicalViews) ? user.historicalViews : [])
    .map(norm).filter(viewId => VIEW_DEFINITIONS[viewId]));
}

function lessonIdFromRow(row) {
  return clean(row?.lesson_id ?? row?.lessonId);
}

function candidateViewForAccessRow(row, catalogue, definitions, hints = new Set()) {
  const direct = norm(row?.viewId ?? row?.view_id);
  if (VIEW_DEFINITIONS[direct]) return direct;
  const batchKey = rowBatchKey(row);
  if (batchKey && definitions.has(batchKey)) {
    const resolved = viewIdForBatch(definitions.get(batchKey));
    if (resolved) return resolved;
  }
  if (batchKey) {
    const resolved = legacyBatchViewId(batchKey);
    if (resolved) return resolved;
  }
  const candidates = catalogue?.lessonToViews?.[lessonIdFromRow(row)] || [];
  if (candidates.length === 1) return candidates[0];
  const hinted = candidates.filter(viewId => hints.has(viewId));
  return hinted.length === 1 ? hinted[0] : '';
}

function syntheticAssignmentForView(viewId) {
  const definition = viewDefinition(viewId);
  if (!definition) return null;
  return {
    batch_key: `__legacy_profile__:${viewId}`,
    subject: definition.subject,
    school_year: definition.schoolYear,
    stream: definition.stream,
    maths_level: definition.mathsLevel || null,
    effective_from: '',
    effective_to: null,
    batch_active_from: '',
    batch_active_to: null,
    __parity_source: 'legacy-profile-batch'
  };
}

function manualCoreIds(user) {
  const ids = new Set();
  for (const value of Array.isArray(user?.manualAccess?.coreLessons) ? user.manualAccess.coreLessons : []) {
    if (clean(value)) ids.add(clean(value));
  }
  const legacy = user?.manualLessonAccess;
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    for (const [lessonId, modes] of Object.entries(legacy)) {
      if (Array.isArray(modes) && modes.map(norm).includes('core') && clean(lessonId)) ids.add(clean(lessonId));
    }
  }
  return [...ids].sort();
}

function manualVrIds(user) {
  const ids = new Set();
  for (const value of Array.isArray(user?.manualAccess?.vrLessons) ? user.manualAccess.vrLessons : []) {
    if (clean(value)) ids.add(clean(value));
  }
  const legacy = user?.manualLessonAccess;
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    for (const [lessonId, modes] of Object.entries(legacy)) {
      if (Array.isArray(modes) && modes.map(norm).includes('vr') && clean(lessonId)) ids.add(clean(lessonId));
    }
  }
  return [...ids].sort();
}

function blockedIds(user) {
  return new Set((Array.isArray(user?.blockedLessons) ? user.blockedLessons : []).map(clean).filter(Boolean));
}

function actualViewIdsForInput(input, catalogue, asOfDate) {
  const user = input?.user || {};
  const definitions = batchDefinitionMap(input?.batchDefinitions);
  const hints = historicalHintSet(user);
  const actual = new Set(fullLibraryViewIds(Array.isArray(user?.fullLibraries) ? user.fullLibraries : []));

  for (const batch of Array.isArray(user?.batches) ? user.batches : []) {
    const viewId = legacyBatchViewId(batch);
    if (viewId) actual.add(viewId);
  }
  for (const row of Array.isArray(input?.batchAssignments) ? input.batchAssignments : []) {
    if (!assignmentStarted(row, asOfDate)) continue;
    const viewId = viewIdForBatch(row) || legacyBatchViewId(row?.batch_key);
    if (viewId) actual.add(viewId);
  }
  for (const row of [
    ...(Array.isArray(input?.entitlements) ? input.entitlements : []),
    ...(Array.isArray(input?.onlinePreLessonEntitlements) ? input.onlinePreLessonEntitlements : [])
  ]) {
    const viewId = candidateViewForAccessRow(row, catalogue, definitions, hints);
    if (viewId) actual.add(viewId);
  }
  for (const lessonId of manualCoreIds(user)) {
    const candidates = catalogue?.lessonToViews?.[lessonId] || [];
    const hinted = candidates.filter(viewId => hints.has(viewId));
    if (hinted.length === 1) actual.add(hinted[0]);
    else {
      const normal = candidates.filter(viewId => VIEW_DEFINITIONS[viewId]?.stream === 'normal');
      if (normal.length === 1) actual.add(normal[0]);
    }
  }
  return sortedViewIds([...actual]);
}

function automaticPreviewViewIds(actualViewIds) {
  const actual = new Set(actualViewIds);
  const maths = actualViewIds.filter(viewId => VIEW_DEFINITIONS[viewId]?.subject === 'maths');
  const english = actualViewIds.filter(viewId => VIEW_DEFINITIONS[viewId]?.subject === 'english');
  if (maths.length && english.length) return [];
  const source = maths.length ? maths : english;
  return sortedViewIds(source.map(viewId => COUNTERPART_VIEW[viewId]).filter(viewId => viewId && !actual.has(viewId)));
}

function prepareAccessInputForParity(input, catalogue, options = {}) {
  const asOfDate = asDate(options.asOfDate || input?.asOfDate);
  if (!asOfDate) throw new Error('A deterministic YYYY-MM-DD asOfDate is required.');
  const user = input?.user && typeof input.user === 'object' ? input.user : {};
  const hints = historicalHintSet(user);
  const definitions = batchDefinitionMap(input?.batchDefinitions);

  const annotate = rows => (Array.isArray(rows) ? rows : []).map(row => {
    if (norm(row?.viewId ?? row?.view_id)) return { ...row };
    const resolved = candidateViewForAccessRow(row, catalogue, definitions, hints);
    return resolved ? { ...row, viewId: resolved } : { ...row };
  });

  const assignments = (Array.isArray(input?.batchAssignments) ? input.batchAssignments : []).map(row => ({ ...row }));
  const assignmentViews = new Set(assignments.map(row => viewIdForBatch(row) || legacyBatchViewId(row?.batch_key)).filter(Boolean));
  const activeAssignmentViews = new Set(assignments
    .filter(row => assignmentCurrent(row, asOfDate))
    .map(row => viewIdForBatch(row) || legacyBatchViewId(row?.batch_key))
    .filter(Boolean));
  for (const batch of Array.isArray(user?.batches) ? user.batches : []) {
    const viewId = legacyBatchViewId(batch);
    if (!viewId || activeAssignmentViews.has(viewId)) continue;
    const synthetic = syntheticAssignmentForView(viewId);
    if (synthetic) assignments.push(synthetic);
  }
  for (const viewId of fullLibraryViewIds(Array.isArray(user?.fullLibraries) ? user.fullLibraries : [])) {
    // Production treats a Full Library view as current unless it also has an
    // explicitly ended assignment. Preserve that presentation rule without
    // inventing lesson entitlement rows.
    if (assignmentViews.has(viewId)) continue;
    const synthetic = syntheticAssignmentForView(viewId);
    if (synthetic) assignments.push({ ...synthetic, __parity_source:'full-library-presentation' });
  }

  const normalizedEntitlements = annotate(input?.entitlements);
  const normalizedPreLesson = annotate(input?.onlinePreLessonEntitlements);
  for (const row of Array.isArray(input?.temporaryLessonAccess) ? input.temporaryLessonAccess : []) {
    const lessonId = lessonIdFromRow(row);
    if (!lessonId) continue;
    const resolved = candidateViewForAccessRow(row, catalogue, definitions, hints);
    if (row?.core !== false || row?.vr === true) {
      normalizedEntitlements.push({
        lesson_id:lessonId,
        core_access:row?.core !== false ? 1 : 0,
        vr_access:row?.vr === true ? 1 : 0,
        source:clean(row?.source || 'temporary') || 'temporary',
        ...(resolved ? { viewId:resolved } : {})
      });
    } else if (row?.preLessonOnly === true) {
      normalizedPreLesson.push({
        lesson_id:lessonId,
        source:clean(row?.source || 'temporary') || 'temporary',
        ...(resolved ? { viewId:resolved } : {})
      });
    }
  }

  const normalized = {
    ...(input || {}),
    user: { ...user },
    batchAssignments: assignments,
    entitlements: normalizedEntitlements,
    onlinePreLessonEntitlements: normalizedPreLesson
  };

  if (!Array.isArray(user?.upsellViews)) {
    const actual = actualViewIdsForInput(normalized, catalogue, asOfDate);
    normalized.user.upsellViews = automaticPreviewViewIds(actual);
  }
  return normalized;
}

function expectedLessonAccess(input, catalogue) {
  const user = input?.user || {};
  const fullViews = new Set(fullLibraryViewIds(Array.isArray(user?.fullLibraries) ? user.fullLibraries : []));
  const core = new Set();
  const vr = new Set();
  const pre = new Set();
  const blocked = blockedIds(user);

  for (const [lessonId, views] of Object.entries(catalogue?.lessonToViews || {})) {
    if ((views || []).some(viewId => fullViews.has(viewId))) core.add(lessonId);
  }
  for (const row of Array.isArray(input?.entitlements) ? input.entitlements : []) {
    const lessonId = lessonIdFromRow(row);
    if (!lessonId) continue;
    if (Number(row?.core_access ?? row?.coreAccess ?? 1) !== 0) core.add(lessonId);
    if (Number(row?.vr_access ?? row?.vrAccess ?? 0) === 1) vr.add(lessonId);
  }
  for (const id of manualCoreIds(user)) core.add(id);
  for (const id of manualVrIds(user)) vr.add(id);
  for (const row of Array.isArray(input?.onlinePreLessonEntitlements) ? input.onlinePreLessonEntitlements : []) {
    const lessonId = lessonIdFromRow(row);
    if (lessonId) pre.add(lessonId);
  }
  for (const row of Array.isArray(input?.temporaryLessonAccess) ? input.temporaryLessonAccess : []) {
    const lessonId = lessonIdFromRow(row);
    if (!lessonId) continue;
    if (row?.core !== false) core.add(lessonId);
    if (row?.vr === true) vr.add(lessonId);
    if (row?.preLessonOnly === true) pre.add(lessonId);
  }

  const ids = new Set([...core, ...vr, ...pre, ...blocked]);
  const result = {};
  for (const lessonId of [...ids].sort()) {
    const isBlocked = blocked.has(lessonId);
    result[lessonId] = {
      core: !isBlocked && core.has(lessonId),
      vr: !isBlocked && vr.has(lessonId),
      preLessonOnly: !isBlocked && !core.has(lessonId) && pre.has(lessonId),
      blocked: isBlocked
    };
  }
  return result;
}

function expectedViews(input, catalogue, asOfDate, lessonAccess) {
  const user = input?.user || {};
  const definitions = batchDefinitionMap(input?.batchDefinitions);
  const hints = historicalHintSet(user);
  const map = new Map();
  const add = (viewId, current = false, source = 'history') => {
    if (!VIEW_DEFINITIONS[viewId]) return;
    const existing = map.get(viewId) || { viewId, current:false, lockedPreview:false, source };
    existing.current ||= current;
    map.set(viewId, existing);
  };

  for (const viewId of fullLibraryViewIds(Array.isArray(user?.fullLibraries) ? user.fullLibraries : [])) add(viewId, true, 'fullLibrary');
  for (const batch of Array.isArray(user?.batches) ? user.batches : []) add(legacyBatchViewId(batch), true, 'legacyBatch');
  for (const row of Array.isArray(input?.batchAssignments) ? input.batchAssignments : []) {
    if (!assignmentStarted(row, asOfDate)) continue;
    add(viewIdForBatch(row) || legacyBatchViewId(row?.batch_key), assignmentCurrent(row, asOfDate), 'batchAssignment');
  }
  const academicStart = academicYearStart(asOfDate);
  for (const row of [
    ...(Array.isArray(input?.entitlements) ? input.entitlements : []),
    ...(Array.isArray(input?.onlinePreLessonEntitlements) ? input.onlinePreLessonEntitlements : [])
  ]) {
    const viewId = candidateViewForAccessRow(row, catalogue, definitions, hints);
    if (!viewId) continue;
    const lessonDate = asDate(row?.source_lesson_date ?? row?.sourceLessonDate ?? row?.lesson_date ?? row?.lessonDate);
    add(viewId, !lessonDate || lessonDate >= academicStart, 'lessonAccess');
  }
  for (const lessonId of manualCoreIds(user)) {
    const candidates = catalogue?.lessonToViews?.[lessonId] || [];
    const hinted = candidates.filter(viewId => hints.has(viewId));
    if (hinted.length === 1) add(hinted[0], false, 'manual');
    else {
      const normal = candidates.filter(viewId => VIEW_DEFINITIONS[viewId]?.stream === 'normal');
      if (normal.length === 1) add(normal[0], false, 'manual');
    }
  }

  const actual = sortedViewIds([...map.keys()]);
  const preview = Array.isArray(user?.upsellViews)
    ? sortedViewIds(user.upsellViews).filter(viewId => !map.has(viewId))
    : automaticPreviewViewIds(actual);
  for (const viewId of preview) map.set(viewId, { viewId, current:true, lockedPreview:true, source:'preview' });

  const rows = [];
  for (const viewId of sortedViewIds([...map.keys()])) {
    const state = map.get(viewId);
    const lessons = catalogue?.views?.[viewId]?.lessons || [];
    const open = state.lockedPreview ? 0 : lessons.filter(row => {
      const access = lessonAccess[row.lessonId];
      return access && !access.blocked && (access.core || access.preLessonOnly);
    }).length;
    rows.push({
      viewId,
      current:Boolean(state.current || state.lockedPreview),
      group:(state.current || state.lockedPreview) ? 'current' : 'previous',
      lockedPreview:Boolean(state.lockedPreview),
      visibleLessonCount:lessons.length,
      openLessonCount:open,
      lockedLessonCount:Math.max(0, lessons.length - open)
    });
  }
  return rows;
}

function buildAuthoritativeParityOracle(input, catalogue, options = {}) {
  const asOfDate = asDate(options.asOfDate || input?.asOfDate);
  if (!asOfDate) throw new Error('A deterministic YYYY-MM-DD asOfDate is required.');
  const lessonAccess = expectedLessonAccess(input, catalogue);
  return {
    asOfDate,
    lessonAccess,
    views: expectedViews(input, catalogue, asOfDate, lessonAccess)
  };
}

function lessonState(value) {
  return {
    core:Boolean(value?.core), vr:Boolean(value?.vr),
    preLessonOnly:Boolean(value?.preLessonOnly), blocked:Boolean(value?.blocked)
  };
}

function viewState(value) {
  return {
    current:Boolean(value?.current), group:clean(value?.group), lockedPreview:Boolean(value?.lockedPreview),
    visibleLessonCount:Number(value?.visibleLessonCount || 0), openLessonCount:Number(value?.openLessonCount || 0),
    lockedLessonCount:Number(value?.lockedLessonCount || 0)
  };
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function diffAccessParity(snapshot, oracle, options = {}) {
  const differences = [];
  const actualAccess = snapshot?.lessonAccess || {};
  const lessonIds = [...new Set([...Object.keys(actualAccess), ...Object.keys(oracle?.lessonAccess || {})])].sort();
  for (const lessonId of lessonIds) {
    const expected = lessonState(oracle?.lessonAccess?.[lessonId]);
    const actual = lessonState(actualAccess[lessonId]);
    if (!same(expected, actual)) differences.push({ id:`lesson:${lessonId}`, kind:'lesson-access', expected, actual });
  }

  const expectedViews = new Map((oracle?.views || []).map(row => [row.viewId, viewState(row)]));
  const actualViews = new Map((snapshot?.views || []).map(row => [row.viewId, viewState(row)]));
  const viewIds = sortedViewIds([...expectedViews.keys(), ...actualViews.keys()]);
  for (const viewId of viewIds) {
    const expected = expectedViews.get(viewId) || null;
    const actual = actualViews.get(viewId) || null;
    if (!same(expected, actual)) differences.push({ id:`view:${viewId}`, kind:'view-access', expected, actual });
  }

  const explanations = options.explanations && typeof options.explanations === 'object' ? options.explanations : {};
  const explained = [];
  const unexplained = [];
  for (const difference of differences) {
    const reason = clean(explanations[difference.id] || explanations[difference.kind]);
    if (reason) explained.push({ ...difference, explanation:reason });
    else unexplained.push(difference);
  }
  return { differences, explained, unexplained, pass:unexplained.length === 0 };
}

function expectedResourceSignatures(record) {
  const core = record?.core && typeof record.core === 'object' ? record.core : {};
  const pre = Array.isArray(record?.preLessonSheets) ? record.preLessonSheets : (Array.isArray(core.preLessonSheets) ? core.preLessonSheets : []);
  const homeworks = Array.isArray(record?.homeworks) ? record.homeworks : (Array.isArray(core.homeworks) ? core.homeworks : []);
  const other = Array.isArray(record?.otherResources) ? record.otherResources : (Array.isArray(core.otherResources) ? core.otherResources : []);
  const key = value => clean(value?.r2Key || value?.r2 || value?.objectKey || value?.storageKey || value?.key);
  const out = [];
  for (const item of pre) if (key(item)) out.push(`prelesson|0|${key(item)}`);
  for (const pair of homeworks) {
    const homework = pair?.homework && typeof pair.homework === 'object' ? pair.homework : pair;
    if (key(homework)) out.push(`homework|0|${key(homework)}`);
    if (key(pair?.answerPack)) out.push(`answer-pack|1|${key(pair.answerPack)}`);
  }
  for (const item of other) if (key(item)) out.push(`other|0|${key(item)}`);
  return out.sort();
}

function auditLessonResourceParity(record, compiledResources = []) {
  const expected = expectedResourceSignatures(record);
  const actual = (Array.isArray(compiledResources) ? compiledResources : [])
    .map(item => `${clean(item?.type)}|${item?.protected ? 1 : 0}|${clean(item?.objectKey)}`)
    .filter(value => !value.endsWith('|'))
    .sort();
  return { pass:same(expected, actual), expected, actual };
}

export {
  academicYearStart,
  assignmentCurrent,
  legacyBatchViewId,
  candidateViewForAccessRow,
  automaticPreviewViewIds,
  prepareAccessInputForParity,
  buildAuthoritativeParityOracle,
  diffAccessParity,
  expectedResourceSignatures,
  auditLessonResourceParity
};
