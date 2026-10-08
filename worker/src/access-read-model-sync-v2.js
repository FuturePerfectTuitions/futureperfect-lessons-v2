import {
  SCOPE_SALT_KEY,
  legacyBatchViewId,
  isYear6SatsLessonId,
  compileAccessScope as compileLegacyAccessScope,
  assertCanonicalAccessProjected,
  publishScopeAtomic,
  resolveCurrentScope,
  opaqueAccessScopeId,
  globalToCatalogue
} from './access-read-model-sync.js';

const ACCESS_READ_MODEL_SYNC_V2_MARKER = 'd1-authoritative-sats-presentation-v2';
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const upper = value => clean(value).toUpperCase();
const lessonId = row => clean(row?.lesson_id ?? row?.lessonId);

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'
  }).format(new Date());
}

function asDate(value) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function currentAssignment(row, asOfDate) {
  const from = asDate(row?.effective_from ?? row?.effectiveFrom);
  const to = asDate(row?.effective_to ?? row?.effectiveTo);
  const batchFrom = asDate(row?.batch_active_from ?? row?.batchActiveFrom ?? row?.active_from ?? row?.activeFrom);
  const batchTo = asDate(row?.batch_active_to ?? row?.batchActiveTo ?? row?.active_to ?? row?.activeTo);
  return (!from || from <= asOfDate) && (!to || asOfDate < to) &&
    (!batchFrom || batchFrom <= asOfDate) && (!batchTo || asOfDate < batchTo);
}

function structuredViewId(row) {
  const subject = norm(row?.subject);
  const stream = norm(row?.stream);
  const year = Number(row?.school_year ?? row?.schoolYear ?? 0);
  const level = Number(row?.maths_level ?? row?.mathsLevel ?? 0);
  if (subject === 'maths') {
    if (stream === '11plus') {
      const resolved = level >= 1 && level <= 3 ? level : year - 3;
      return resolved >= 1 && resolved <= 3 ? `maths-level${resolved}` : '';
    }
    return year >= 2 && year <= 6 ? `maths-year${year}` : '';
  }
  if (subject === 'english') {
    if (stream === '11plus') return year === 4 || year === 5 ? `english-year${year}-11plus` : '';
    return year >= 2 && year <= 6 ? `english-year${year}` : '';
  }
  return '';
}

function definitionMap(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = upper(row?.batch_key ?? row?.batchKey);
    if (key) map.set(key, row);
  }
  return map;
}

function authoritativeBatchViewId(value, definitions) {
  const key = upper(value);
  if (!key) return '';
  if (definitions.has(key)) return structuredViewId(definitions.get(key));
  return legacyBatchViewId(key);
}

function currentEquivalentProgramme(input, asOfDate) {
  const ids = [...new Set((Array.isArray(input?.batchAssignments) ? input.batchAssignments : [])
    .filter(row => currentAssignment(row, asOfDate))
    .map(structuredViewId)
    .filter(id => id === 'maths-year6' || id === 'maths-level3'))];
  if (ids.length > 1) throw new Error('D1_YEAR6_L3_PROGRAMME_COLLISION');
  return ids[0] || '';
}

function explicitDualFullLibrary(input) {
  const full = new Set((input?.user?.fullLibraries || []).map(upper));
  return full.has('MATHS_Y6_FULL') && full.has('MATHS_L3_FULL');
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

function normaliseAuthoritativeInput(input, asOfDate) {
  const definitions = definitionMap(input?.batchDefinitions);
  const assignments = (Array.isArray(input?.batchAssignments) ? input.batchAssignments : []).map(row => ({ ...row }));
  const equivalentHistory = assignments
    .map(structuredViewId)
    .filter(id => id === 'maths-year6' || id === 'maths-level3');
  const currentProgramme = currentEquivalentProgramme(input, asOfDate);
  const hasEquivalentD1History = equivalentHistory.length > 0;

  // D1 assignment state is authoritative whenever Year6/L3 history exists,
  // including after an assignment has ended. Known stale KV profile batches must
  // not resurrect either equivalent curriculum as current. Undefined legacy
  // batches remain fallback. If D1 has no equivalent assignment history at all,
  // a known profile batch may still synthesize its D1-defined shape for parity.
  const sourceUser = input?.user && typeof input.user === 'object' ? input.user : {};
  const legacyFallbackBatches = [];
  const assignmentKeys = new Set(assignments.map(row => upper(row?.batch_key ?? row?.batchKey)).filter(Boolean));
  for (const value of Array.isArray(sourceUser.batches) ? sourceUser.batches : []) {
    const key = upper(value);
    if (!key) continue;
    const definition = definitions.get(key);
    if (!definition) {
      legacyFallbackBatches.push(value);
      continue;
    }
    const definedView = structuredViewId(definition);
    if (hasEquivalentD1History && (definedView === 'maths-year6' || definedView === 'maths-level3')) {
      continue;
    }
    if (!assignmentKeys.has(key)) {
      assignments.push({
        ...definition,
        batch_key:key,
        effective_from:'',
        effective_to:null,
        batch_active_from:definition.active_from ?? definition.activeFrom ?? '',
        batch_active_to:definition.active_to ?? definition.activeTo ?? null,
        __reconcile_source:'d1-defined-profile-batch'
      });
      assignmentKeys.add(key);
    }
  }

  const sanitiseAccessRow = row => {
    const lid = lessonId(row);
    if (isYear6SatsLessonId(lid)) {
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
    user:{ ...sourceUser, batches:legacyFallbackBatches },
    batchAssignments:assignments,
    entitlements:(Array.isArray(input?.entitlements) ? input.entitlements : []).map(sanitiseAccessRow),
    onlinePreLessonEntitlements:(Array.isArray(input?.onlinePreLessonEntitlements) ? input.onlinePreLessonEntitlements : []).map(sanitiseAccessRow)
  };
}

function hasSatsPresentationAccess(input) {
  return (Array.isArray(input?.entitlements) ? input.entitlements : [])
    .some(row => Number(row?.core_access ?? row?.coreAccess ?? 1) !== 0 && isYear6SatsLessonId(lessonId(row))) ||
    (Array.isArray(input?.onlinePreLessonEntitlements) ? input.onlinePreLessonEntitlements : [])
      .some(row => isYear6SatsLessonId(lessonId(row)));
}

function demoteDualFullLibraryViews(snapshot, originalInput, asOfDate) {
  if (!Array.isArray(snapshot?.views)) return;
  // Programme membership is not conferred by Full Library access. A lone
  // MATHS_L3_FULL may open shared Y6 canonical lesson IDs and cause the legacy
  // compiler to manufacture *both* Year 6 and L3 as current. That must not
  // abort unrelated English releases with COMPILED_YEAR6_L3_PROGRAMME_COLLISION.
  // Prefer actual D1 current assignment; retain the existing D1-defined KV
  // profile fallback for legacy students with no assignment history.
  const currentProgramme = currentEquivalentProgramme(originalInput, asOfDate) ||
    currentEquivalentProgramme(normaliseAuthoritativeInput(originalInput, asOfDate), asOfDate);
  const fullLibraries = new Set((originalInput?.user?.fullLibraries || []).map(upper));
  const hasEquivalentFullLibrary =
    fullLibraries.has('MATHS_Y6_FULL') || fullLibraries.has('MATHS_L3_FULL');
  if (!currentProgramme && !hasEquivalentFullLibrary) return;

  for (const view of snapshot.views) {
    const id = norm(view?.viewId);
    if (id !== 'maths-year6' && id !== 'maths-level3') continue;
    if (currentProgramme && id === currentProgramme) continue;
    // Never discard lessonAccess, entitlements or the catalogue. Previous is
    // presentation metadata only and all explicitly granted resources remain.
    view.current = false;
    view.group = 'previous';
  }
}

function decorateAuthoritativeSnapshot(payload, originalInput, catalogue, asOfDate) {
  const snapshot = payload?.snapshot;
  if (!snapshot || !Array.isArray(snapshot.views)) throw new Error('READ_MODEL_COMPILED_SNAPSHOT_INVALID');

  for (const view of snapshot.views) {
    if (norm(view?.viewId) === 'maths-year6') view.label = 'Lessons';
    if (norm(view?.viewId) === 'maths-level3') view.label = 'L3';
  }
  snapshot.views = snapshot.views.filter(view => norm(view?.viewId) !== 'maths-sats');

  if (hasSatsPresentationAccess(originalInput)) {
    const lessons = Array.isArray(catalogue?.views?.['maths-sats']?.lessons)
      ? catalogue.views['maths-sats'].lessons : [];
    if (!lessons.length) throw new Error('SATS_PRESENTATION_CATALOGUE_MISSING');
    const open = lessons.reduce((count, row) => {
      const state = snapshot.lessonAccess?.[clean(row?.lessonId)];
      return count + (state && !state.blocked && (state.core || state.preLessonOnly) ? 1 : 0);
    }, 0);
    const sats = {
      viewId:'maths-sats',
      subject:'maths',
      label:'SATS',
      current:true,
      group:'current',
      lockedPreview:false,
      catalogueAvailable:true,
      visibleLessonCount:lessons.length,
      openLessonCount:open,
      lockedLessonCount:Math.max(0, lessons.length - open)
    };
    const teachingIndex = snapshot.views.findIndex(view => {
      const id = norm(view?.viewId);
      return view?.current && (id === 'maths-year6' || id === 'maths-level3');
    });
    snapshot.views.splice(teachingIndex >= 0 ? teachingIndex + 1 : snapshot.views.length, 0, sats);
  }

  // Full Library is access, not current programme identity. Preserve both
  // catalogues but show any non-D1 equivalent Full Library view under Previous.
  demoteDualFullLibraryViews(snapshot, originalInput, asOfDate);

  const currentTeaching = snapshot.views.filter(view => view?.current && !view?.lockedPreview &&
    (norm(view?.viewId) === 'maths-year6' || norm(view?.viewId) === 'maths-level3'));
  if (currentTeaching.length > 1) throw new Error('COMPILED_YEAR6_L3_PROGRAMME_COLLISION');
  return payload;
}

function compileAuthoritativeAccessScope(input, catalogue, scopeId, asOfDate) {
  const normalized = normaliseAuthoritativeInput(input, asOfDate);
  const payload = compileLegacyAccessScope(normalized, catalogue, scopeId, asOfDate);
  return decorateAuthoritativeSnapshot(payload, input, catalogue, asOfDate);
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

async function allRows(statement) {
  const result = await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function optionalAllRows(statement) {
  try { return await allRows(statement); } catch { return []; }
}

async function loadStudentAccessInput(env, portalUserIdNorm, asOfDate = londonToday()) {
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

  return { asOfDate, user, batchDefinitions, batchAssignments, entitlements, onlinePreLessonEntitlements:preLesson };
}

async function assertReadModelReconciliationReady(env) {
  if (!env?.READ_MODELS_KV || !env?.STUDENTS_KV || !env?.DB) throw new Error('READ_MODEL_RECONCILIATION_NOT_CONFIGURED');
  const store = kvBindingStore(env.READ_MODELS_KV);
  const scopeSalt = clean(await env.READ_MODELS_KV.get(SCOPE_SALT_KEY));
  if (!/^[0-9a-f]{64}$/i.test(scopeSalt)) throw new Error('READ_MODEL_SCOPE_SALT_INVALID');
  const global = await resolveCurrentScope(store, 'global');
  const catalogue = globalToCatalogue(global.payload);
  if (!catalogue?.views?.['maths-sats'] || catalogue.views['maths-year6']?.label !== 'Lessons') {
    throw new Error('READ_MODEL_GLOBAL_PROGRAMME_MODEL_NOT_V2');
  }
  return { ok:true, globalVersion:global.version, marker:ACCESS_READ_MODEL_SYNC_V2_MARKER };
}

async function refreshStudentAccessReadModel(env, portalUserIdNorm, options = {}) {
  if (!env?.READ_MODELS_KV || !env?.STUDENTS_KV || !env?.DB) throw new Error('READ_MODEL_RECONCILIATION_NOT_CONFIGURED');
  const store = kvBindingStore(env.READ_MODELS_KV);
  const scopeSalt = clean(await env.READ_MODELS_KV.get(SCOPE_SALT_KEY));
  if (!/^[0-9a-f]{64}$/i.test(scopeSalt)) throw new Error('READ_MODEL_SCOPE_SALT_INVALID');

  const global = await resolveCurrentScope(store, 'global');
  const catalogue = globalToCatalogue(global.payload);
  if (!catalogue?.views?.['maths-sats'] || catalogue.views['maths-year6']?.label !== 'Lessons') {
    throw new Error('READ_MODEL_GLOBAL_PROGRAMME_MODEL_NOT_V2');
  }

  const asOfDate = clean(options.asOfDate) || londonToday();
  const input = await loadStudentAccessInput(env, portalUserIdNorm, asOfDate);
  const scopeId = await opaqueAccessScopeId(portalUserIdNorm, scopeSalt);
  const payload = compileAuthoritativeAccessScope(input, catalogue, scopeId, asOfDate);
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
    reused:published.reused === true,
    marker:ACCESS_READ_MODEL_SYNC_V2_MARKER
  };
}

export {
  ACCESS_READ_MODEL_SYNC_V2_MARKER,
  authoritativeBatchViewId,
  currentEquivalentProgramme,
  explicitDualFullLibrary,
  normaliseAuthoritativeInput,
  hasSatsPresentationAccess,
  demoteDualFullLibraryViews,
  decorateAuthoritativeSnapshot,
  compileAuthoritativeAccessScope,
  loadStudentAccessInput,
  assertReadModelReconciliationReady,
  refreshStudentAccessReadModel
};