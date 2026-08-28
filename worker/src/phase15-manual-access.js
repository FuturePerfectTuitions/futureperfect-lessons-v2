import phase12Worker from './index-phase12.js';
import { PHASE11_NAVIGATION_MANIFEST } from './phase11-navigation-manifest.generated.js';
import { validBundledManifest } from './phase11-navigation-cache.js';

// Phase 15: manual individual core-lesson access is an independent access source.
// It must be able to surface the corresponding historical ordinary Year view
// without creating D1 entitlement rows or student batch membership. The overlay
// below is request-local only; Phase 12 still owns authoritative Current/Previous
// grouping from effective-dated D1 assignments.
const MANUAL_CORE_VIEW_RULES = Object.freeze({
  'maths-year2': Object.freeze({
    subject: 'maths', schoolYear: 2, batches: ['Y2M'], curricula: ['MATHS_Y2'], order: 20
  }),
  'maths-year3': Object.freeze({
    subject: 'maths', schoolYear: 3, batches: ['Y3M'], curricula: ['MATHS_Y3'], order: 30
  }),
  'maths-year4': Object.freeze({
    subject: 'maths', schoolYear: 4, batches: ['Y4M'], curricula: ['MATHS_L1'], order: 40
  }),
  'maths-year5': Object.freeze({
    subject: 'maths', schoolYear: 5, batches: ['Y5M'], curricula: ['MATHS_L2'], order: 50
  }),
  'maths-year6': Object.freeze({
    subject: 'maths', schoolYear: 6, batches: ['Y6M'], curricula: ['MATHS_L3', 'MATHS_Y6_EXTRA'], order: 60
  }),
  'english-year2': Object.freeze({
    subject: 'english', schoolYear: 2, batches: ['Y2E'], curricula: ['ENGLISH_Y2'], order: 20
  }),
  'english-year3': Object.freeze({
    subject: 'english', schoolYear: 3, batches: ['Y3E'], curricula: ['ENGLISH_Y3'], order: 30
  }),
  'english-year4': Object.freeze({
    subject: 'english', schoolYear: 4, batches: ['Y4E'], curricula: ['ENGLISH_Y4'], order: 40
  }),
  'english-year5': Object.freeze({
    subject: 'english', schoolYear: 5, batches: ['Y5E'], curricula: ['ENGLISH_Y5'], order: 50
  }),
  'english-year6': Object.freeze({
    subject: 'english', schoolYear: 6, batches: ['Y6E'], curricula: ['ENGLISH_Y6'], order: 60
  })
});

function responseLikeJson(response, body) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function normaliseUserKey(key) {
  const match = String(key || '').match(/^user:(.+)$/);
  return match ? String(match[1] || '').trim().toLowerCase() : '';
}

function manualCoreIds(user) {
  return new Set(
    Array.isArray(user?.manualAccess?.coreLessons)
      ? user.manualAccess.coreLessons.map(value => String(value || '').trim()).filter(Boolean)
      : []
  );
}

function manifestSupportsManualView(rule, manualIds, manifest = PHASE11_NAVIGATION_MANIFEST) {
  if (!rule || !manualIds.size || !validBundledManifest(manifest)) return false;
  for (const curriculumCode of rule.curricula) {
    const lessonIds = manifest.curricula?.[curriculumCode]?.lessonIds || [];
    for (const lessonId of lessonIds) {
      if (!manualIds.has(String(lessonId))) continue;
      const record = manifest.lessons?.[lessonId];
      if (record && record.active !== false) return true;
    }
  }
  return false;
}

function manualAccessCoversView(user, targetViewId, manifest = PHASE11_NAVIGATION_MANIFEST) {
  const rule = MANUAL_CORE_VIEW_RULES[String(targetViewId || '').trim().toLowerCase()];
  return Boolean(rule && manifestSupportsManualView(rule, manualCoreIds(user), manifest));
}

function manualAccessViewIds(user, manifest = PHASE11_NAVIGATION_MANIFEST) {
  const ids = [];
  for (const [viewId, rule] of Object.entries(MANUAL_CORE_VIEW_RULES)) {
    if (manifestSupportsManualView(rule, manualCoreIds(user), manifest)) ids.push(viewId);
  }
  return ids;
}

function manualAccessOverlayUserForView(user, targetViewId, manifest = PHASE11_NAVIGATION_MANIFEST) {
  const rule = MANUAL_CORE_VIEW_RULES[String(targetViewId || '').trim().toLowerCase()];
  if (!user || !rule || !manualAccessCoversView(user, targetViewId, manifest)) return user;
  return {
    ...user,
    schoolYear: rule.schoolYear,
    batches: [...rule.batches]
  };
}

function manualAccessAwareEnv(env, targetViewId) {
  if (!env?.STUDENTS_KV || !MANUAL_CORE_VIEW_RULES[String(targetViewId || '').trim().toLowerCase()]) {
    return env;
  }
  const original = env.STUDENTS_KV;
  const kv = new Proxy(original, {
    get(target, prop) {
      if (prop !== 'get') {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (key, options) => {
        const value = await target.get(key, options);
        const portalUserIdNorm = normaliseUserKey(key);
        if (!portalUserIdNorm || value == null) return value;
        const wantsJson = options?.type === 'json';
        let user = value;
        if (!wantsJson) {
          try { user = JSON.parse(String(value)); } catch { return value; }
        }
        const overlaid = manualAccessOverlayUserForView(user, targetViewId);
        return wantsJson ? overlaid : JSON.stringify(overlaid);
      };
    }
  });
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'STUDENTS_KV') return kv;
      // This request-local synthetic presentation must be evaluated from the
      // overlaid authoritative user read rather than an earlier session projection.
      if (prop === 'PHASE12_BYPASS_SESSION_PROFILE') return true;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function targetViewIdForRequest(request) {
  const url = new URL(request.url);
  const viewMatch = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
  if (viewMatch) {
    try { return decodeURIComponent(viewMatch[1]).trim().toLowerCase(); } catch { return ''; }
  }
  return String(url.searchParams.get('viewId') || '').trim().toLowerCase();
}

function viewSubject(viewId) {
  return MANUAL_CORE_VIEW_RULES[viewId]?.subject || '';
}

function replaceOrAddView(body, viewId, candidate) {
  const subject = viewSubject(viewId);
  if (!subject || !candidate || !Array.isArray(body?.subjects)) return;
  const block = body.subjects.find(item => String(item?.subject || '').toLowerCase() === subject);
  if (!block) return;
  if (!Array.isArray(block.views)) block.views = [];
  const index = block.views.findIndex(item => String(item?.viewId || '').toLowerCase() === viewId);
  if (index >= 0) block.views[index] = candidate;
  else block.views.push(candidate);
  block.views.sort((left, right) => {
    const leftOrder = MANUAL_CORE_VIEW_RULES[String(left?.viewId || '').toLowerCase()]?.order ?? 999;
    const rightOrder = MANUAL_CORE_VIEW_RULES[String(right?.viewId || '').toLowerCase()]?.order ?? 999;
    return leftOrder - rightOrder || String(left?.viewId || '').localeCompare(String(right?.viewId || ''));
  });
}

async function mergeManualAccessHome(request, env, ctx) {
  const response = await phase12Worker.fetch(request, env, ctx);
  if (!response.ok) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body?.ok || !Array.isArray(body.subjects)) return response;

  const portalUserIdNorm = String(body?.student?.portalUserId || '').trim().toLowerCase();
  if (!portalUserIdNorm || !env?.STUDENTS_KV) return response;
  const user = await env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type: 'json' });
  if (!user) return response;

  const targetViews = manualAccessViewIds(user);
  if (!targetViews.length) return response;

  for (const viewId of targetViews) {
    const runtimeEnv = manualAccessAwareEnv(env, viewId);
    const alternative = await phase12Worker.fetch(request, runtimeEnv, ctx);
    if (!alternative.ok) continue;
    const alternativeBody = await alternative.clone().json().catch(() => null);
    const subject = viewSubject(viewId);
    const candidate = alternativeBody?.subjects
      ?.find(item => String(item?.subject || '').toLowerCase() === subject)
      ?.views
      ?.find(item => String(item?.viewId || '').toLowerCase() === viewId);
    if (candidate) replaceOrAddView(body, viewId, candidate);
  }

  return responseLikeJson(response, body);
}

async function retryManualAccessRoute(request, env, ctx, response) {
  if (response.status !== 404) return response;
  const viewId = targetViewIdForRequest(request);
  if (!MANUAL_CORE_VIEW_RULES[viewId]) return response;
  const runtimeEnv = manualAccessAwareEnv(env, viewId);
  return phase12Worker.fetch(request, runtimeEnv, ctx);
}

export {
  MANUAL_CORE_VIEW_RULES,
  manualAccessCoversView,
  manualAccessViewIds,
  manualAccessOverlayUserForView,
  targetViewIdForRequest
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/v1/student/home') {
      return mergeManualAccessHome(request, env, ctx);
    }
    const response = await phase12Worker.fetch(request, env, ctx);
    return retryManualAccessRoute(request, env, ctx, response);
  }
};
