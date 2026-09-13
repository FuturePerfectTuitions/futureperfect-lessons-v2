import { kvReadStore, resolveCurrentScope } from './lib/read-model-resolver.mjs';

const BASELINE_SOURCE_SHA = 'e4c7bde7ad9a9402136da5798d7ab690ab30322c';
const CHECKPOINT = 5;

function clean(value) {
  return String(value ?? '').trim();
}

function json(body, status = 200, cacheControl = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
      'x-fpt-rebuild-checkpoint': String(CHECKPOINT)
    }
  });
}

function syntheticScopeId(env) {
  if (clean(env?.ENVIRONMENT) !== 'staging') return '';
  const value = clean(env?.STAGING_ACCESS_SCOPE_ID);
  return /^u-[a-f0-9]{40}$/.test(value) ? value : '';
}

async function resolveModels(env, options = {}) {
  const store = kvReadStore(env?.READ_MODELS_KV);
  const scopeId = syntheticScopeId(env);
  if (!scopeId) throw new Error('STAGING_ACCESS_SCOPE_UNAVAILABLE');
  const access = await resolveCurrentScope(store, `access:${scopeId}`);
  if (access?.payload?.kind !== 'prepared-access-read-model' || access.payload.scopeId !== scopeId) {
    throw new Error('ACCESS_READ_MODEL_INVALID');
  }
  if (options.global === false) return { access };
  const global = await resolveCurrentScope(store, 'global');
  if (global?.payload?.kind !== 'prepared-global-read-model') {
    throw new Error('GLOBAL_READ_MODEL_INVALID');
  }
  return { global, access };
}

function accessSnapshot(accessResolved) {
  return accessResolved?.payload?.snapshot || null;
}

function visibleView(snapshot, viewId) {
  return (Array.isArray(snapshot?.views) ? snapshot.views : [])
    .find(view => clean(view?.viewId) === clean(viewId)) || null;
}

function lessonState(snapshot, lessonId) {
  return snapshot?.lessonAccess?.[clean(lessonId)] || null;
}

function presentationState(snapshot, view, lessonId) {
  const state = lessonState(snapshot, lessonId);
  const blocked = state?.blocked === true;
  const preview = view?.lockedPreview === true;
  const full = !preview && !blocked && state?.core === true;
  const preLessonOnly = !preview && !blocked && !full && state?.preLessonOnly === true;
  const vr = !preview && !blocked && state?.vr === true;
  const open = full || preLessonOnly;
  return {
    open,
    locked: !open,
    accessMode: full ? 'full' : (preLessonOnly ? 'prelesson-only' : 'locked'),
    vrAvailable: vr,
    blocked,
    sources: open && Array.isArray(state?.sources) ? state.sources : []
  };
}

function viewCatalogue(globalResolved, viewId) {
  return globalResolved?.payload?.catalogues?.[clean(viewId)] || null;
}

function safeLessonRow(row, state) {
  return {
    lessonId: clean(row?.lessonId),
    displayLessonId: clean(row?.displayLessonId),
    title: clean(row?.title),
    description: String(row?.description || ''),
    order: Number(row?.order || 0),
    ...state
  };
}

function selectLesson(globalResolved, snapshot, lessonId, requestedViewId) {
  const id = clean(lessonId);
  const requested = clean(requestedViewId);
  const candidates = Array.isArray(globalResolved?.payload?.lessonToViews?.[id])
    ? globalResolved.payload.lessonToViews[id]
    : [];
  const visible = candidates.filter(viewId => visibleView(snapshot, viewId));
  const viewId = requested || (visible.length === 1 ? visible[0] : '');
  if (!viewId || !visible.includes(viewId)) return null;
  const view = visibleView(snapshot, viewId);
  const catalogue = viewCatalogue(globalResolved, viewId);
  const row = (Array.isArray(catalogue?.lessons) ? catalogue.lessons : [])
    .find(item => clean(item?.lessonId) === id);
  if (!row) return null;
  return { view, row };
}

function errorResponse(error) {
  const code = clean(error?.message || 'READ_MODEL_UNAVAILABLE');
  const safe = new Set([
    'READ_MODEL_POINTER_UNAVAILABLE',
    'READ_MODEL_NO_VERIFIED_VERSION',
    'STAGING_ACCESS_SCOPE_UNAVAILABLE',
    'ACCESS_READ_MODEL_INVALID',
    'GLOBAL_READ_MODEL_INVALID'
  ]).has(code) ? code : 'READ_MODEL_UNAVAILABLE';
  return json({ ok: false, error: safe }, 503);
}

async function handleHome(env) {
  try {
    const { access } = await resolveModels(env, { global: false });
    const snapshot = accessSnapshot(access);
    return json({
      ok: true,
      checkpoint: CHECKPOINT,
      runtime: 'student',
      source: 'prepared-access-read-model',
      modelVersion: access.version,
      usedFallback: access.usedFallback,
      account: snapshot?.account || {},
      views: Array.isArray(snapshot?.views) ? snapshot.views : []
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function handleViewLessons(env, viewId) {
  try {
    const { global, access } = await resolveModels(env);
    const snapshot = accessSnapshot(access);
    const view = visibleView(snapshot, viewId);
    const catalogue = viewCatalogue(global, viewId);
    if (!view || !catalogue) return json({ ok: false, error: 'VIEW_NOT_AVAILABLE' }, 404);
    const lessons = (Array.isArray(catalogue.lessons) ? catalogue.lessons : [])
      .map(row => safeLessonRow(row, presentationState(snapshot, view, row.lessonId)));
    return json({
      ok: true,
      checkpoint: CHECKPOINT,
      source: 'prepared-read-models',
      modelVersions: { global: global.version, access: access.version },
      usedFallback: { global: global.usedFallback, access: access.usedFallback },
      view,
      lessonCount: lessons.length,
      lessons
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function handleLesson(env, lessonId, requestedViewId) {
  try {
    const { global, access } = await resolveModels(env);
    const snapshot = accessSnapshot(access);
    const selected = selectLesson(global, snapshot, lessonId, requestedViewId);
    if (!selected) return json({ ok: false, error: 'LESSON_NOT_AVAILABLE' }, 404);
    const state = presentationState(snapshot, selected.view, selected.row.lessonId);
    return json({
      ok: true,
      checkpoint: CHECKPOINT,
      source: 'prepared-read-models',
      modelVersions: { global: global.version, access: access.version },
      view: {
        viewId: selected.view.viewId,
        label: selected.view.label,
        lockedPreview: selected.view.lockedPreview === true
      },
      lesson: safeLessonRow(selected.row, state),
      resourcesIncluded: false
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function handleSpecialAreas(env, viewId) {
  try {
    const { access } = await resolveModels(env, { global: false });
    const snapshot = accessSnapshot(access);
    const view = visibleView(snapshot, viewId);
    if (!view) return json({ ok: false, error: 'VIEW_NOT_AVAILABLE' }, 404);
    return json({
      ok: true,
      checkpoint: CHECKPOINT,
      source: 'prepared-access-read-model',
      modelVersion: access.version,
      usedFallback: access.usedFallback,
      viewId: view.viewId,
      lockedPreview: view.lockedPreview === true,
      specialAreas: view.lockedPreview === true ? [] : (Array.isArray(snapshot?.specialAreas) ? snapshot.specialAreas : [])
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);

    if (url.pathname === '/health') {
      return json({
        ok: true,
        checkpoint: CHECKPOINT,
        runtime: 'student',
        environment: clean(env?.ENVIRONMENT || 'unknown'),
        deploymentIdentity: clean(env?.DEPLOYMENT_IDENTITY),
        baselineSourceSha: BASELINE_SOURCE_SHA,
        productionTarget: false,
        preparedReadModels: {
          kvBound: Boolean(env?.READ_MODELS_KV && typeof env.READ_MODELS_KV.get === 'function'),
          syntheticAccessScopeConfigured: Boolean(syntheticScopeId(env)),
          d1Bound: false,
          r2Bound: false,
          productionStudentsKvBound: false
        }
      });
    }

    if (url.pathname === '/read-models/status') {
      try {
        const { global, access } = await resolveModels(env);
        const snapshot = accessSnapshot(access);
        return json({
          ok: true,
          checkpoint: CHECKPOINT,
          global: {
            version: global.version,
            sha256: global.sha256,
            usedFallback: global.usedFallback,
            views: Array.isArray(global.payload.navigation) ? global.payload.navigation.length : 0,
            uniqueLessons: Object.keys(global.payload.lessonToViews || {}).length
          },
          access: {
            version: access.version,
            sha256: access.sha256,
            usedFallback: access.usedFallback,
            visibleViews: Array.isArray(snapshot?.views) ? snapshot.views.length : 0,
            lessonAccessRows: Object.keys(snapshot?.lessonAccess || {}).length
          }
        });
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (url.pathname === '/api/v2/student/home') return handleHome(env);

    const specialMatch = url.pathname.match(/^\/api\/v2\/student\/views\/([^/]+)\/special-areas$/);
    if (specialMatch) return handleSpecialAreas(env, decodeURIComponent(specialMatch[1]));

    const viewMatch = url.pathname.match(/^\/api\/v2\/student\/views\/([^/]+)\/lessons$/);
    if (viewMatch) return handleViewLessons(env, decodeURIComponent(viewMatch[1]));

    const lessonMatch = url.pathname.match(/^\/api\/v2\/student\/lessons\/([^/]+)$/);
    if (lessonMatch) {
      return handleLesson(env, decodeURIComponent(lessonMatch[1]), url.searchParams.get('viewId'));
    }

    return json({ ok: false, error: 'NOT_FOUND' }, 404);
  }
};
