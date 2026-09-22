import {
  VIEW_DEFINITIONS,
  compileAccessScope,
  globalToCatalogue,
  opaqueAccessScopeId,
  publishScopeAtomic,
  resolveCurrentScope,
  stableStringify
} from './access-read-model-sync.js';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function londonDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'
  }).format(now);
}

async function allRows(statement) {
  const result = await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function optionalAllRows(statement) {
  try { return await allRows(statement); } catch { return []; }
}

function trialViewIds(user) {
  const values = Array.isArray(user?.trialViews) ? user.trialViews : [];
  return [...new Set(values.map(norm).filter(viewId => VIEW_DEFINITIONS[viewId]))];
}

function isTrialProfile(user) {
  const id = norm(user?.portalUserId);
  return id.startsWith('trial') && !id.startsWith('admintrial') && trialViewIds(user).length > 0;
}

function trialCompilationSource(source, catalogue) {
  if (!isTrialProfile(source?.user)) return { source, trialViews:[] };
  const views = trialViewIds(source.user);
  const fullLibraries = [];
  const vrLessons = new Set();

  for (const viewId of views) {
    const definition = VIEW_DEFINITIONS[viewId];
    fullLibraries.push(...(definition?.fullLibraryIds || []));
    if (definition?.subject === 'english' && definition?.stream === '11plus') {
      for (const row of catalogue?.views?.[viewId]?.lessons || []) {
        const lessonId = clean(row?.lessonId);
        if (lessonId) vrLessons.add(lessonId);
      }
    }
  }

  return {
    trialViews:views,
    source:{
      ...source,
      user:{
        ...source.user,
        fullLibraries:[...new Set(fullLibraries)],
        upsellViews:[],
        batches:[],
        blockedLessons:[],
        manualAccess:{
          coreLessons:[],
          vrLessons:[...vrLessons].sort(),
          specialBuckets:[]
        },
        manualLessonAccess:{},
        specialAccess:[]
      },
      batchAssignments:[],
      entitlements:[],
      onlinePreLessonEntitlements:[],
      temporaryLessonAccess:[]
    }
  };
}

function applyTrialMetadata(compiled, views) {
  if (!views.length) return compiled;
  const allowed = new Set(views);
  const snapshot = compiled?.snapshot;
  if (!snapshot || typeof snapshot !== 'object') throw new Error('TRIAL_PREPARED_SNAPSHOT_INVALID');
  snapshot.account = {
    ...(snapshot.account || {}),
    trial:true,
    trialViews:[...views]
  };
  snapshot.views = (Array.isArray(snapshot.views) ? snapshot.views : [])
    .filter(view => allowed.has(norm(view?.viewId)))
    .map(view => ({ ...view, current:true, group:'current', lockedPreview:false, source:'trial' }));
  snapshot.fullViewIds = [...views];
  snapshot.specialAreas = [];
  return compiled;
}

async function sourceForStudent(env, portalUserIdNorm, asOfDate) {
  const id = norm(portalUserIdNorm);
  if (!id) throw new Error('TRIAL_PREPARED_PORTAL_USER_REQUIRED');
  const user = await env.STUDENTS_KV.get(`user:${id}`, { type:'json' });
  if (!user || typeof user !== 'object') throw new Error('TRIAL_PREPARED_STUDENT_NOT_FOUND');

  const [batchDefinitions, batchAssignments, entitlements, onlinePreLessonEntitlements] = await Promise.all([
    optionalAllRows(env.DB.prepare(
      `SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions`
    )),
    optionalAllRows(env.DB.prepare(
      `SELECT a.portal_user_id_norm, a.batch_key, a.effective_from, a.effective_to,
              b.subject, b.school_year, b.stream, b.maths_level,
              b.active_from AS batch_active_from, b.active_to AS batch_active_to
       FROM student_batch_assignments a LEFT JOIN batch_definitions b ON b.batch_key = a.batch_key
       WHERE a.portal_user_id_norm = ?`
    ).bind(id)),
    optionalAllRows(env.DB.prepare(
      `SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source,
              first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date
       FROM lesson_entitlements WHERE portal_user_id_norm = ?`
    ).bind(id)),
    optionalAllRows(env.DB.prepare(
      `SELECT portal_user_id_norm, lesson_id, batch_key, lesson_date, vr_access,
              source_row_id, first_granted_at, last_confirmed_at
       FROM online_prelesson_entitlements WHERE portal_user_id_norm = ?`
    ).bind(id))
  ]);
  return { asOfDate, user, batchDefinitions, batchAssignments, entitlements, onlinePreLessonEntitlements };
}

function kvStore(binding) {
  if (!binding || typeof binding.get !== 'function' || typeof binding.put !== 'function') {
    throw new Error('TRIAL_PREPARED_READ_MODELS_KV_NOT_CONFIGURED');
  }
  return { get:key => binding.get(key), put:(key,value) => binding.put(key,value) };
}

async function publishTrialPreparedAccess(env, portalUserIdNorm, options = {}) {
  if (!env?.READ_MODELS_KV || !env?.STUDENTS_KV || !env?.DB) throw new Error('TRIAL_PREPARED_SOURCE_NOT_CONFIGURED');
  const store = kvStore(env.READ_MODELS_KV);
  const scopeSalt = clean(await env.READ_MODELS_KV.get('meta:scope-salt'));
  if (!/^[0-9a-f]{64}$/i.test(scopeSalt)) throw new Error('TRIAL_PREPARED_SCOPE_SALT_INVALID');
  const global = await resolveCurrentScope(store, 'global');
  const catalogue = globalToCatalogue(global.payload);
  const asOfDate = clean(options.asOfDate) || londonDate(options.now || new Date());
  const id = norm(portalUserIdNorm);
  const scopeId = await opaqueAccessScopeId(id, scopeSalt);
  const scope = `access:${scopeId}`;
  const rawSource = await sourceForStudent(env, id, asOfDate);
  const prepared = trialCompilationSource(rawSource, catalogue);
  if (!prepared.trialViews.length) throw new Error('TRIAL_PREPARED_VIEW_REQUIRED');
  const compiled = applyTrialMetadata(
    compileAccessScope(prepared.source, catalogue, scopeId, asOfDate),
    prepared.trialViews
  );

  const published = await publishScopeAtomic(store, { scope, payload:compiled, updatedAt:new Date().toISOString() });
  const verified = await resolveCurrentScope(store, scope);
  if (verified.version !== published.version || stableStringify(verified.payload) !== stableStringify(compiled)) {
    throw new Error('TRIAL_PREPARED_POST_PUBLISH_VERIFY_FAILED');
  }
  const snapshot = verified.payload?.snapshot;
  if (snapshot?.account?.trial !== true || stableStringify(snapshot.account.trialViews || []) !== stableStringify(prepared.trialViews)) {
    throw new Error('TRIAL_PREPARED_METADATA_VERIFY_FAILED');
  }
  return {
    ok:true,
    portalUserIdNorm:id,
    scopeId,
    version:verified.version,
    trialViews:prepared.trialViews,
    viewCount:Array.isArray(snapshot?.views) ? snapshot.views.length : 0,
    lessonAccessCount:Object.keys(snapshot?.lessonAccess || {}).length,
    reused:published.reused === true
  };
}

export {
  londonDate,
  trialViewIds,
  isTrialProfile,
  trialCompilationSource,
  applyTrialMetadata,
  sourceForStudent,
  publishTrialPreparedAccess
};
