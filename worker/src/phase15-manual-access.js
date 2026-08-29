import phase12Worker from './index-phase12.js';
import {
  applyCanonicalHomeCounts,
  mergeCanonicalLockedRows
} from './index-phase12.js';
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

const SESSION_COOKIE = 'fpt_v2_session';

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

// Phase 16 WebKit/Safari compatibility for the current GitHub Pages -> Worker
// cross-site development topology. Preserve the opaque secure HttpOnly cookie
// transport and opt that same cookie into CHIPS partitioning. No session token
// is exposed to JavaScript or copied into Authorization/local storage.
function withPartitionedSessionCookie(request, response) {
  let url;
  try { url = new URL(request.url); } catch { return response; }
  if (
    !response ||
    !['/api/v1/student/auth/login', '/api/v1/student/auth/logout'].includes(url.pathname)
  ) {
    return response;
  }

  const raw = String(response.headers.get('Set-Cookie') || '');
  if (!new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=`).test(raw)) return response;

  const headers = new Headers(response.headers);
  if (!/(?:^|;\s*)Partitioned(?:;|$)/i.test(raw)) {
    headers.set('Set-Cookie', `${raw}; Partitioned`);
  }
  // Non-secret diagnostic marker. It confirms that the outer Phase 16 Worker
  // compatibility layer handled the login/logout response without disclosing
  // the opaque session value or weakening HttpOnly cookie transport.
  headers.set('X-FPT-Session-Mode', 'partitioned');
  return new Response(response.body, {
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

function isLessonListRequest(request) {
  if (request.method !== 'GET') return false;
  try {
    return /^\/api\/v1\/student\/views\/[^/]+\/lessons$/.test(new URL(request.url).pathname);
  } catch {
    return false;
  }
}

function viewSubject(viewId) {
  return MANUAL_CORE_VIEW_RULES[viewId]?.subject || '';
}

function findView(body, viewId) {
  const target = String(viewId || '').trim().toLowerCase();
  if (!target || !Array.isArray(body?.subjects)) return null;
  for (const subject of body.subjects) {
    const found = Array.isArray(subject?.views)
      ? subject.views.find(view => String(view?.viewId || '').trim().toLowerCase() === target)
      : null;
    if (found) return found;
  }
  return null;
}

// The synthetic manual-access overlay exists only to obtain the target Year's
// presentation metadata. It is not membership and therefore must never promote
// a historical view into Current. If authoritative Phase 12 already surfaced
// the same view, preserve that existing D1-derived grouping; otherwise a view
// surfaced solely by manual access is historical/Previous.
function manualCandidateWithAuthoritativeGrouping(body, candidate) {
  if (!candidate) return candidate;
  const existing = findView(body, candidate.viewId);
  const isCurrent = Boolean(existing && (existing.current === true || existing.group === 'current'));
  return {
    ...candidate,
    current: isCurrent,
    group: isCurrent ? 'current' : 'previous'
  };
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

// Phase 16: Phase 15 mutates the already-canonical Phase 12 /home body by adding
// manual-only historical views after Phase 12 has run its count pass. Re-run the
// same canonical count function after that outer merge so the newly surfaced
// view exposes the complete catalogue (manual lesson open, all others locked).
// This is a presentation-only normalization and creates no entitlement/membership.
function canonicaliseManualAccessHomeBody(body, manifest = PHASE11_NAVIGATION_MANIFEST) {
  return applyCanonicalHomeCounts(body, manifest);
}

// Defensive outer-layer normalization for an ordinary manual-access lesson list.
// Phase 12 already intends to provide the complete canonical catalogue; applying
// the same idempotent merge here ensures a Phase 15 retry/overlay can never return
// only the explicitly manual lesson and thereby hide locked canonical lessons.
function canonicaliseManualAccessLessonListBody(body, viewId, manifest = PHASE11_NAVIGATION_MANIFEST) {
  const target = String(viewId || '').trim().toLowerCase();
  if (!MANUAL_CORE_VIEW_RULES[target]) return body;
  return mergeCanonicalLockedRows(body, target, manifest);
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
    if (candidate) {
      replaceOrAddView(body, viewId, manualCandidateWithAuthoritativeGrouping(body, candidate));
    }
  }

  canonicaliseManualAccessHomeBody(body);
  return responseLikeJson(response, body);
}

async function retryManualAccessRoute(request, env, ctx, response) {
  if (response.status !== 404) return response;
  const viewId = targetViewIdForRequest(request);
  if (!MANUAL_CORE_VIEW_RULES[viewId]) return response;
  const runtimeEnv = manualAccessAwareEnv(env, viewId);
  return phase12Worker.fetch(request, runtimeEnv, ctx);
}

async function canonicaliseManualAccessLessonListResponse(request, response) {
  if (!response.ok || !isLessonListRequest(request)) return response;
  const viewId = targetViewIdForRequest(request);
  if (!MANUAL_CORE_VIEW_RULES[viewId]) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body?.ok || !Array.isArray(body.lessons)) return response;
  canonicaliseManualAccessLessonListBody(body, viewId);
  return responseLikeJson(response, body);
}

export {
  MANUAL_CORE_VIEW_RULES,
  manualAccessCoversView,
  manualAccessViewIds,
  manualAccessOverlayUserForView,
  manualCandidateWithAuthoritativeGrouping,
  canonicaliseManualAccessHomeBody,
  canonicaliseManualAccessLessonListBody,
  targetViewIdForRequest,
  withPartitionedSessionCookie
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/v1/student/home') {
      return mergeManualAccessHome(request, env, ctx);
    }
    const response = await phase12Worker.fetch(request, env, ctx);
    const retried = await retryManualAccessRoute(request, env, ctx, response);
    const canonical = await canonicaliseManualAccessLessonListResponse(request, retried);
    return withPartitionedSessionCookie(request, canonical);
  }
};
