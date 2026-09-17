import currentWorker from './index-phase23-protected-view-stability.js';
import phase18Worker from './index-phase18-online-prelesson.js';
import { canonicalCatalogueRowsForView } from './index-phase12.js';
import { classifyPhase11AnswerIndex } from './phase11-resources.js';

const TRIAL_VR_MESSAGE = 'Trial access includes lesson descriptions, lesson videos and all VR resources for this 11+ year.';
const PROVISION_TOKEN_SHA256 = '7a3e3457252ef0150f546eceea08e33af743ff82c34c543f5065b12e006250d3';
const PROVISION_PATH = '/__ops/provision-trialeva';

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

async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeHexEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function randomChoice(chars) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return chars[values[0] % chars.length];
}

function randomPassword(exclude = new Set()) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = `${upper}${lower}${digits}`;
  for (;;) {
    const chars = [randomChoice(upper), randomChoice(lower), randomChoice(digits), randomChoice(all)];
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const values = new Uint32Array(1);
      crypto.getRandomValues(values);
      const j = values[0] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    const candidate = chars.join('');
    if (candidate !== 'Csl1' && !exclude.has(candidate)) return candidate;
  }
}

async function cleanStaleTrialState(env, portalUserIdNorm) {
  if (!env?.DB) return;
  const sessions = await env.DB.prepare(
    `SELECT token_hash FROM student_sessions WHERE portal_user_id_norm = ?`
  ).bind(portalUserIdNorm).all();
  const tokenHashes = Array.isArray(sessions?.results)
    ? sessions.results.map(row => clean(row?.token_hash)).filter(Boolean)
    : [];
  for (const tokenHash of tokenHashes) {
    await env.DB.prepare(`DELETE FROM student_session_profiles WHERE token_hash = ?`).bind(tokenHash).run();
    await env.DB.prepare(`DELETE FROM student_session_windows WHERE token_hash = ?`).bind(tokenHash).run();
  }
  await env.DB.prepare(`DELETE FROM student_sessions WHERE portal_user_id_norm = ?`).bind(portalUserIdNorm).run();
  await env.DB.prepare(`DELETE FROM trial_login_consumptions WHERE portal_user_id_norm = ?`).bind(portalUserIdNorm).run();
}

async function provisionTrialEva(request, env) {
  if (request.method !== 'GET') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  if (!env?.STUDENTS_KV || !env?.DB) return json({ error: 'BINDINGS_UNAVAILABLE' }, 503);
  const url = new URL(request.url);
  const supplied = clean(url.searchParams.get('token'));
  const digest = await sha256Hex(supplied);
  if (!supplied || !timingSafeHexEqual(digest, PROVISION_TOKEN_SHA256)) {
    return json({ error: 'NOT_FOUND' }, 404);
  }

  const portalUserId = 'TrialEva';
  const portalUserIdNorm = 'trialeva';
  const key = `user:${portalUserIdNorm}`;
  const existing = await env.STUDENTS_KV.get(key, { type: 'json' });
  if (existing) {
    return json({ error: 'ACCOUNT_ALREADY_EXISTS', portalUserId }, 409);
  }

  const loginPassword = randomPassword();
  const answerPassword = randomPassword(new Set([loginPassword]));
  const record = {
    schemaVersion: 1,
    portalUserId,
    firstName: 'Eva',
    name: 'Eva',
    p: loginPassword,
    loginPassword,
    answerPassword,
    status: 'active',
    accountStatus: 'active',
    expires: '',
    expiresOn: null,
    schoolYear: 4,
    vrEligible: true,
    mathsYears: [],
    vrBuckets: [],
    entitlements: {},
    batches: [],
    fullLibraries: [],
    manualAccess: { coreLessons: [], vrLessons: [], specialBuckets: [] },
    manualLessonAccess: {},
    specialAccess: [],
    trialViews: ['maths-level1', 'maths-level2', 'english-year4-11plus']
  };

  await cleanStaleTrialState(env, portalUserIdNorm);
  await env.STUDENTS_KV.put(key, JSON.stringify(record));
  const readback = await env.STUDENTS_KV.get(key, { type: 'json' });
  const consumption = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM trial_login_consumptions WHERE portal_user_id_norm = ?`
  ).bind(portalUserIdNorm).first();

  const verified = Boolean(
    readback &&
    readback.portalUserId === portalUserId &&
    readback.p === loginPassword &&
    readback.answerPassword === answerPassword &&
    Array.isArray(readback.trialViews) &&
    readback.trialViews.join('|') === 'maths-level1|maths-level2|english-year4-11plus' &&
    Number(consumption?.count || 0) === 0
  );
  if (!verified) return json({ error: 'PROVISION_VERIFY_FAILED' }, 500);

  return json({
    ok: true,
    portalUserId,
    loginPassword,
    answerPassword,
    trialViews: readback.trialViews,
    oneLoginUnused: true
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

    if (url.pathname === PROVISION_PATH) {
      return provisionTrialEva(request, env);
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