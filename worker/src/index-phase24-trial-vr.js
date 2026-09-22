import currentWorker from './index-phase23-protected-view-stability.js';
import phase18Worker from './index-phase18-online-prelesson.js';
import { canonicalCatalogueRowsForView } from './index-phase12.js';
import { classifyPhase11AnswerIndex } from './phase11-resources.js';

const TRIAL_RUNTIME_ACCESS_VERSION = 'trial-runtime-access-v2';
const TRIAL_VR_MESSAGE = 'Trial access includes lesson descriptions, lesson videos and all VR resources for this 11+ year.';

const TRIAL_VIEW_RULES = Object.freeze({
  'maths-year2': Object.freeze({ subject:'maths', label:'Year 2', rank:20, schoolYear:2, fullLibrary:'MATHS_Y2_FULL', batch:'Y2M' }),
  'maths-year3': Object.freeze({ subject:'maths', label:'Year 3', rank:30, schoolYear:3, fullLibrary:'MATHS_Y3_FULL', batch:'Y3M' }),
  'maths-year4': Object.freeze({ subject:'maths', label:'Year 4', rank:40, schoolYear:4, fullLibrary:'MATHS_Y4_FULL', batch:'Y4M' }),
  'maths-level1': Object.freeze({ subject:'maths', label:'L1', rank:41, schoolYear:4, fullLibrary:'MATHS_L1_FULL', batch:'Y4M11' }),
  'maths-year5': Object.freeze({ subject:'maths', label:'Year 5', rank:50, schoolYear:5, fullLibrary:'MATHS_Y5_FULL', batch:'Y5M' }),
  'maths-level2': Object.freeze({ subject:'maths', label:'L2', rank:51, schoolYear:5, fullLibrary:'MATHS_L2_FULL', batch:'Y5M11' }),
  'maths-year6': Object.freeze({ subject:'maths', label:'Year 6', rank:60, schoolYear:6, fullLibrary:'MATHS_Y6_FULL', batch:'Y6M' }),
  'maths-level3': Object.freeze({ subject:'maths', label:'L3', rank:61, schoolYear:6, fullLibrary:'MATHS_L3_FULL', batch:'Y6M11' }),
  'english-year2': Object.freeze({ subject:'english', label:'Year 2', rank:20, schoolYear:2, fullLibrary:'ENGLISH_Y2_FULL', batch:'Y2E' }),
  'english-year3': Object.freeze({ subject:'english', label:'Year 3', rank:30, schoolYear:3, fullLibrary:'ENGLISH_Y3_FULL', batch:'Y3E' }),
  'english-year4': Object.freeze({ subject:'english', label:'Year 4', rank:40, schoolYear:4, fullLibrary:'ENGLISH_Y4_FULL', batch:'Y4E' }),
  'english-year4-11plus': Object.freeze({ subject:'english', label:'Year 4 11+', rank:41, schoolYear:4, fullLibrary:'ENGLISH_Y4_11PLUS_FULL', batch:'Y4E11', vr:true }),
  'english-year5': Object.freeze({ subject:'english', label:'Year 5', rank:50, schoolYear:5, fullLibrary:'ENGLISH_Y5_FULL', batch:'Y5E' }),
  'english-year5-11plus': Object.freeze({ subject:'english', label:'Year 5 11+', rank:51, schoolYear:5, fullLibrary:'ENGLISH_Y5_11PLUS_FULL', batch:'Y5E11', vr:true }),
  'english-year6': Object.freeze({ subject:'english', label:'Year 6', rank:60, schoolYear:6, fullLibrary:'ENGLISH_Y6_FULL', batch:'Y6E' })
});

const TRIAL_VR_RULES = Object.freeze(Object.fromEntries(
  Object.entries(TRIAL_VIEW_RULES).filter(([, rule]) => rule.vr === true)
));

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
  headers.set('x-fpt-trial-runtime-access', TRIAL_RUNTIME_ACCESS_VERSION);
  return new Response(JSON.stringify(body), { status, headers });
}

function jsonLike(response, body) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-fpt-trial-runtime-access', TRIAL_RUNTIME_ACCESS_VERSION);
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
    (Array.isArray(user.trialViews) ? user.trialViews : [])
      .map(norm)
      .filter(viewId => TRIAL_VIEW_RULES[viewId])
  );
  if (!allowedViews.size) return null;
  return { portalUserIdNorm, user, allowedViews };
}

function eligibleTrialVrViews(context) {
  if (!context) return [];
  return [...context.allowedViews].filter(viewId => TRIAL_VR_RULES[viewId]);
}

function overlayTrialAccessEnv(env, portalUserIdNorm, viewIds) {
  if (!env?.STUDENTS_KV || !portalUserIdNorm) return env;
  const selected = [...new Set((Array.isArray(viewIds) ? viewIds : []).map(norm))]
    .filter(viewId => TRIAL_VIEW_RULES[viewId]);
  const rules = selected.map(viewId => TRIAL_VIEW_RULES[viewId]);
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
        const overlaid = {
          ...user,
          schoolYear: rules.length === 1 ? rules[0].schoolYear : user.schoolYear,
          vrEligible: rules.some(rule => rule.vr === true),
          fullLibraries: [...new Set(rules.map(rule => rule.fullLibrary).filter(Boolean))],
          batches: [...new Set(rules.map(rule => rule.batch).filter(Boolean))],
          upsellViews: [],
          trialViews: selected
        };
        return wantsJson ? overlaid : JSON.stringify(overlaid);
      };
    }
  });
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'STUDENTS_KV') return kv;
      if (prop === 'PHASE12_BYPASS_SESSION_PROFILE') return true;
      if (prop === 'TRIAL_RUNTIME_ACCESS_VERSION') return TRIAL_RUNTIME_ACCESS_VERSION;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function overlayTrialVrEnv(env, portalUserIdNorm, viewIds) {
  return overlayTrialAccessEnv(env, portalUserIdNorm, viewIds);
}

function findHomeView(body, viewId) {
  for (const subject of Array.isArray(body?.subjects) ? body.subjects : []) {
    const view = (Array.isArray(subject?.views) ? subject.views : [])
      .find(item => norm(item?.viewId) === norm(viewId));
    if (view) return view;
  }
  return null;
}

function trialHomeSummary(viewId, sourceView = null) {
  const rule = TRIAL_VIEW_RULES[norm(viewId)];
  if (!rule) return null;
  const count = canonicalCatalogueRowsForView(viewId).length;
  return {
    ...(sourceView && typeof sourceView === 'object' ? sourceView : {}),
    viewId:norm(viewId),
    subject:rule.subject,
    label:clean(sourceView?.label) || rule.label,
    catalogueAvailable:count > 0,
    visibleLessonCount:count,
    openLessonCount:count,
    lockedLessonCount:0,
    lockedPreview:false,
    current:true,
    group:'current',
    source:'trial'
  };
}

function reconcileTrialHomeBody(body, allowedViews, resolvedViews = new Map()) {
  if (!body || typeof body !== 'object') return body;
  if (!Array.isArray(body.subjects)) body.subjects = [];
  const selected = [...new Set((Array.isArray(allowedViews) ? allowedViews : [...(allowedViews || [])]).map(norm))]
    .filter(viewId => TRIAL_VIEW_RULES[viewId]);

  for (const subjectName of ['maths', 'english']) {
    let subject = body.subjects.find(item => norm(item?.subject) === subjectName);
    if (!subject) {
      subject = { subject:subjectName, label:subjectName === 'maths' ? 'Maths' : 'English', views:[] };
      body.subjects.push(subject);
    }
    subject.views = selected
      .filter(viewId => TRIAL_VIEW_RULES[viewId].subject === subjectName)
      .sort((left, right) => TRIAL_VIEW_RULES[left].rank - TRIAL_VIEW_RULES[right].rank || left.localeCompare(right))
      .map(viewId => trialHomeSummary(viewId, resolvedViews.get(viewId)))
      .filter(Boolean);
  }
  return body;
}

async function handleTrialHome(request, env, ctx, context) {
  const baseResponse = await currentWorker.fetch(request, env, ctx);
  if (!baseResponse.ok) return baseResponse;
  const body = await baseResponse.clone().json().catch(() => null);
  if (!body?.ok) return baseResponse;

  const resolved = new Map();
  for (const viewId of context.allowedViews) {
    const overlayEnv = overlayTrialAccessEnv(env, context.portalUserIdNorm, [viewId]);
    const response = await currentWorker.fetch(request, overlayEnv, ctx);
    if (!response.ok) continue;
    const altBody = await response.clone().json().catch(() => null);
    const view = findHomeView(altBody, viewId);
    if (view) resolved.set(viewId, view);
  }

  reconcileTrialHomeBody(body, context.allowedViews, resolved);
  body.trial = true;
  body.trialViews = [...context.allowedViews];
  return jsonLike(baseResponse, body);
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

async function handleTrialList(request, env, ctx, context, viewId) {
  const overlayEnv = overlayTrialAccessEnv(env, context.portalUserIdNorm, [viewId]);
  const response = await currentWorker.fetch(request, overlayEnv, ctx);
  if (!response.ok || !TRIAL_VR_RULES[viewId]) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body?.ok || !Array.isArray(body.lessons)) return response;
  body.lessons = body.lessons.map(lesson => ({ ...lesson, accessMessage: TRIAL_VR_MESSAGE }));
  return jsonLike(response, body);
}

async function handleTrialDetail(request, env, ctx, context, viewId, lessonId) {
  const overlayEnv = overlayTrialAccessEnv(env, context.portalUserIdNorm, [viewId]);
  const baseResponse = await currentWorker.fetch(request, overlayEnv, ctx);
  if (!TRIAL_VR_RULES[viewId] || !baseResponse.ok || !lessonInView(viewId, lessonId)) return baseResponse;

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

async function handleTrialResource(request, env, ctx, context, viewId, parsed) {
  if (!lessonInView(viewId, parsed.lessonId)) {
    return json({ error: 'LESSON_NOT_VISIBLE' }, 404);
  }
  const overlayEnv = overlayTrialAccessEnv(env, context.portalUserIdNorm, [viewId]);
  if (TRIAL_VR_RULES[viewId] && isVrResource(parsed)) {
    return phase18Worker.fetch(request, overlayEnv, ctx);
  }
  return currentWorker.fetch(request, overlayEnv, ctx);
}

async function handleTrialAnswerView(request, env, ctx, context) {
  const views = [...context.allowedViews];
  if (!views.length) return currentWorker.fetch(request, env, ctx);
  const overlayEnv = overlayTrialAccessEnv(env, context.portalUserIdNorm, views);
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
  TRIAL_RUNTIME_ACCESS_VERSION,
  TRIAL_VIEW_RULES,
  TRIAL_VR_RULES,
  eligibleTrialVrViews,
  isVrAnswerIndex,
  isVrResource,
  lessonInView,
  overlayTrialAccessEnv,
  overlayTrialVrEnv,
  reconcileTrialHomeBody,
  trialHomeSummary
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

    const listMatch = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
    const detailMatch = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
    const parsedResource = parseResourceRequest(url);
    const answerView = /^\/api\/v1\/student\/answer-view\/[^/]+$/.test(url.pathname);
    const homeOrNavigation = request.method === 'GET' &&
      (url.pathname === '/api/v1/student/home' || url.pathname === '/api/v1/student/navigation');

    if (!homeOrNavigation && !listMatch && !detailMatch && !parsedResource && !answerView) {
      return currentWorker.fetch(request, env, ctx);
    }

    const context = await sessionTrialContext(request, env, ctx);
    if (!context) return currentWorker.fetch(request, env, ctx);

    if (homeOrNavigation) {
      return handleTrialHome(request, env, ctx, context);
    }

    if (answerView && request.method === 'GET') {
      return handleTrialAnswerView(request, env, ctx, context);
    }

    let viewId = norm(url.searchParams.get('viewId'));
    if (listMatch) {
      try { viewId = norm(decodeURIComponent(listMatch[1])); } catch { viewId = ''; }
    }
    if (!viewId || !TRIAL_VIEW_RULES[viewId] || !context.allowedViews.has(viewId)) {
      return currentWorker.fetch(request, env, ctx);
    }

    if (listMatch && request.method === 'GET') {
      return handleTrialList(request, env, ctx, context, viewId);
    }

    if (detailMatch && request.method === 'GET') {
      let lessonId = '';
      try { lessonId = decodeURIComponent(detailMatch[1]); } catch { lessonId = ''; }
      return handleTrialDetail(request, env, ctx, context, viewId, lessonId);
    }

    if (parsedResource) {
      return handleTrialResource(request, env, ctx, context, viewId, parsedResource);
    }

    return currentWorker.fetch(request, env, ctx);
  }
};
