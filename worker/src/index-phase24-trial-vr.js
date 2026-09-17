import currentWorker from './index-phase23-protected-view-stability.js';
import phase18Worker from './index-phase18-online-prelesson.js';
import { canonicalCatalogueRowsForView } from './index-phase12.js';
import { classifyPhase11AnswerIndex } from './phase11-resources.js';

const TRIAL_VR_MESSAGE = 'Trial access includes lesson descriptions, lesson videos and all VR resources for this 11+ year.';

const TRIAL_VR_RULES = Object.freeze({
  'english-year4-11plus': Object.freeze({
    schoolYear: 4,
    fullLibrary: 'ENGLISH_Y4_11PLUS_FULL',
    batch: 'Y4E11'
  }),
  'english-year5-11plus': Object.freeze({
    schoolYear: 5,
    fullLibrary: 'ENGLISH_Y5_11PLUS_FULL',
    batch: 'Y5E11'
  })
});

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const isTrialId = value => {
  const id = norm(value);
  return id.startsWith('trial') && !id.startsWith('admintrial');
};

function json(body, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

function jsonLike(response, body) {
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

async function sessionTrialContext(request, env, ctx) {
  if (!env?.STUDENTS_KV) return null;
  const url = new URL(request.url);
  url.pathname = '/api/v1/student/session';
  url.search = '';
  const response = await currentWorker.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  }), env, ctx);
  const body = await response.clone().json().catch(() => null);
  if (!response.ok || !body?.ok || body.accountLocked) return null;
  const portalUserIdNorm = norm(body.portalUserId);
  if (!isTrialId(portalUserIdNorm)) return null;
  const user = await env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type: 'json' });
  if (!user) return null;
  const allowedViews = new Set(
    (Array.isArray(user.trialViews) ? user.trialViews : []).map(norm).filter(Boolean)
  );
  return { portalUserIdNorm, user, allowedViews };
}

function eligibleTrialVrViews(context) {
  if (!context) return [];
  return [...context.allowedViews].filter(viewId => TRIAL_VR_RULES[viewId]);
}

function overlayTrialVrEnv(env, portalUserIdNorm, viewIds) {
  if (!env?.STUDENTS_KV || !portalUserIdNorm) return env;
  const rules = [...new Set(viewIds.map(norm))].map(viewId => TRIAL_VR_RULES[viewId]).filter(Boolean);
  if (!rules.length) return env;
  const source = env.STUDENTS_KV;
  const targetKey = `user:${portalUserIdNorm}`;
  const kv = new Proxy(source, {
    get(target, prop) {
      if (prop !== 'get') {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (key, options) => {
        const value = await target.get(key, options);
        if (value == null || norm(key) !== targetKey) return value;
        const wantsJson = options?.type === 'json';
        let user = value;
        if (!wantsJson) {
          try { user = JSON.parse(String(value)); } catch { return value; }
        }
        const fullLibraries = new Set(
          (Array.isArray(user.fullLibraries) ? user.fullLibraries : []).map(value => clean(value).toUpperCase()).filter(Boolean)
        );
        const batches = new Set(
          (Array.isArray(user.batches) ? user.batches : []).map(value => clean(value)).filter(Boolean)
        );
        for (const rule of rules) {
          fullLibraries.add(rule.fullLibrary);
          batches.add(rule.batch);
        }
        const overlaid = {
          ...user,
          schoolYear: rules[0].schoolYear,
          vrEligible: true,
          fullLibraries: [...fullLibraries],
          batches: [...batches]
        };
        return wantsJson ? overlaid : JSON.stringify(overlaid);
      };
    }
  });
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'STUDENTS_KV') return kv;
      if (prop === 'PHASE12_BYPASS_SESSION_PROFILE') return true;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function lessonInView(viewId, lessonId) {
  return canonicalCatalogueRowsForView(viewId).some(row => String(row.lessonId) === String(lessonId));
}

function parseResourceRequest(url) {
  const match = url.pathname.match(/^\/api\/v1\/student\/resources\/([^/]+)(?:\/(download|video|quiz)|\/answer\/authorize)?$/);
  if (!match) return null;
  let resourceKey = '';
  try { resourceKey = decodeURIComponent(match[1]); } catch { return null; }
  const parts = resourceKey.split('~');
  if (parts.length !== 3) return null;
  let lessonId = '';
  try { lessonId = decodeURIComponent(parts[0]); } catch { return null; }
  const kind = clean(parts[1]);
  const index = Number(parts[2]);
  if (!lessonId || !kind || !Number.isInteger(index) || index < 1) return null;
  return {
    lessonId,
    kind,
    index,
    action: match[2] || (url.pathname.endsWith('/answer/authorize') ? 'authorize' : 'direct')
  };
}

function isVrAnswerIndex(index) {
  if (index > 1000 && index <= 1999) return true;
  if (index > 2000 && index <= 2999) return true;
  return classifyPhase11AnswerIndex(index) === 'vrSupplementary';
}

function isVrResource(parsed) {
  if (!parsed) return false;
  if (['vrpre', 'vrhomework', 'vrprevideo', 'vrhomeworkvideo'].includes(parsed.kind)) return true;
  return parsed.kind === 'answer' && isVrAnswerIndex(parsed.index);
}

async function handleTrialVrList(request, env, ctx) {
  const response = await currentWorker.fetch(request, env, ctx);
  if (!response.ok) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body?.ok || !Array.isArray(body.lessons)) return response;
  body.lessons = body.lessons.map(lesson => ({ ...lesson, accessMessage: TRIAL_VR_MESSAGE }));
  return jsonLike(response, body);
}

async function handleTrialVrDetail(request, env, ctx, context, viewId, lessonId) {
  const baseResponse = await currentWorker.fetch(request, env, ctx);
  if (!baseResponse.ok || !lessonInView(viewId, lessonId)) return baseResponse;
  const overlayEnv = overlayTrialVrEnv(env, context.portalUserIdNorm, [viewId]);
  const vrResponse = await phase18Worker.fetch(request, overlayEnv, ctx);
  if (!vrResponse.ok) return baseResponse;
  const [baseBody, vrBody] = await Promise.all([
    baseResponse.clone().json().catch(() => null),
    vrResponse.clone().json().catch(() => null)
  ]);
  if (!baseBody?.ok || !baseBody.lesson || !vrBody?.ok || !vrBody.lesson) return baseResponse;

  baseBody.lesson.vr = vrBody.lesson.vr || null;
  if (vrBody.lesson.phase11Resources) {
    baseBody.lesson.phase11Resources = {
      ...(baseBody.lesson.phase11Resources || {}),
      vrSupplementaryAnswers: Array.isArray(vrBody.lesson.phase11Resources.vrSupplementaryAnswers)
        ? vrBody.lesson.phase11Resources.vrSupplementaryAnswers
        : []
    };
  }
  baseBody.lesson.accessMessage = TRIAL_VR_MESSAGE;
  return jsonLike(baseResponse, baseBody);
}

async function handleTrialVrResource(request, env, ctx, context, viewId, parsed) {
  if (!lessonInView(viewId, parsed.lessonId)) {
    return json({ error: 'LESSON_NOT_VISIBLE' }, 404);
  }
  const overlayEnv = overlayTrialVrEnv(env, context.portalUserIdNorm, [viewId]);
  return phase18Worker.fetch(request, overlayEnv, ctx);
}

async function handleTrialAnswerView(request, env, ctx, context) {
  const views = eligibleTrialVrViews(context);
  if (!views.length) return currentWorker.fetch(request, env, ctx);
  const overlayEnv = overlayTrialVrEnv(env, context.portalUserIdNorm, views);
  return currentWorker.fetch(request, overlayEnv, ctx);
}

async function handleAdminTrialList(request, env, ctx) {
  const response = await currentWorker.fetch(request, env, ctx);
  if (!response.ok || !env?.STUDENTS_KV) return response;

  const body = await response.clone().json().catch(() => null);
  if (!body?.ok || !Array.isArray(body.trials)) return response;

  body.trials = await Promise.all(body.trials.map(async trial => {
    const portalUserId = clean(trial?.portalUserId);
    const portalUserIdNorm = norm(portalUserId);
    if (!isTrialId(portalUserIdNorm)) return trial;

    const user = await env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type:'json' });
    if (!user) return trial;

    return {
      ...trial,
      loginPassword: clean(user.loginPassword || user.p),
      answerPassword: clean(user.answerPassword)
    };
  }));

  return jsonLike(response, body);
}

export {
  TRIAL_VR_RULES,
  isVrAnswerIndex,
  isVrResource,
  lessonInView,
  overlayTrialVrEnv
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/v1/admin/trials/list' && request.method === 'POST') {
      return handleAdminTrialList(request, env, ctx);
    }

    if (!url.pathname.startsWith('/api/v1/student/')) {
      return currentWorker.fetch(request, env, ctx);
    }

    const viewId = norm(url.searchParams.get('viewId'));
    const listMatch = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
    const detailMatch = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
    const parsedResource = parseResourceRequest(url);
    const answerView = /^\/api\/v1\/student\/answer-view\/[^/]+$/.test(url.pathname);

    if (!listMatch && !detailMatch && !parsedResource && !answerView) {
      return currentWorker.fetch(request, env, ctx);
    }

    const context = await sessionTrialContext(request, env, ctx);
    if (!context) return currentWorker.fetch(request, env, ctx);

    if (answerView && request.method === 'GET') {
      return handleTrialAnswerView(request, env, ctx, context);
    }

    if (!TRIAL_VR_RULES[viewId] || !context.allowedViews.has(viewId)) {
      return currentWorker.fetch(request, env, ctx);
    }

    if (listMatch && request.method === 'GET') {
      return handleTrialVrList(request, env, ctx);
    }

    if (detailMatch && request.method === 'GET') {
      let lessonId = '';
      try { lessonId = decodeURIComponent(detailMatch[1]); } catch { lessonId = ''; }
      return handleTrialVrDetail(request, env, ctx, context, viewId, lessonId);
    }

    if (parsedResource && isVrResource(parsedResource)) {
      return handleTrialVrResource(request, env, ctx, context, viewId, parsedResource);
    }

    return currentWorker.fetch(request, env, ctx);
  }
};