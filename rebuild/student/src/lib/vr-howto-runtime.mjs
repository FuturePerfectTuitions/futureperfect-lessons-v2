import {
  CAPABILITY_MAX_AGE_SECONDS,
  issueCapability,
  sessionTokenFromCookie,
  verifyCapability,
  verifySessionToken
} from '../../../shared/auth/auth-core.mjs';
import { opaqueAccessScopeId } from './access-scope.mjs';
import { kvReadStore, resolveCurrentScope, sha256Hex } from './read-model-resolver.mjs';

const VR_HOWTO_BUCKET = 'VR_HOWTO';
const VR_HOWTO_VIEW = 'special-vr-howto';
const ELIGIBLE_ENGLISH_VIEWS = new Set(['english-year4-11plus', 'english-year5-11plus']);
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function requireSecret(env, key) {
  const value = String(env?.[key] ?? '');
  if (!value) throw new Error(`${key}_UNAVAILABLE`);
  return value;
}

function londonDate(nowValue = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(Number(nowValue)));
}

function accountLocked(snapshot, nowValue = Date.now()) {
  const account = snapshot?.account || {};
  const status = norm(account.status || 'active');
  const expiresOn = clean(account.expiresOn);
  const expired = /^\d{4}-\d{2}-\d{2}$/.test(expiresOn) ? londonDate(nowValue) > expiresOn : false;
  return status !== 'active' || expired;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      ...headers
    }
  });
}

async function jsonLike(response, body) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'private, no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function safeScreenPalTarget(value) {
  try {
    const url = new URL(clean(value));
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'go.screenpal.com') return '';
    return url.toString();
  } catch {
    return '';
  }
}

async function verifiedSession(request, env) {
  const token = sessionTokenFromCookie(request.headers.get('cookie'));
  if (!token) return null;
  try {
    return await verifySessionToken({ secret: requireSecret(env, 'AUTH_SIGNING_SECRET'), token });
  } catch {
    return null;
  }
}

async function preparedContext(request, env, { requireArea = true } = {}) {
  const session = await verifiedSession(request, env);
  if (!session) return { error: json({ ok:false, error:'AUTH_REQUIRED' }, 401) };
  const store = kvReadStore(env?.READ_MODELS_KV);
  const scopeId = await opaqueAccessScopeId(session.sub, requireSecret(env, 'ACCESS_SCOPE_SECRET'));
  const access = await resolveCurrentScope(store, `access:${scopeId}`);
  const snapshot = access?.payload?.snapshot;
  if (access?.payload?.kind !== 'prepared-access-read-model' || !snapshot || access.payload.scopeId !== scopeId) {
    return { error: json({ ok:false, error:'ACCESS_READ_MODEL_INVALID' }, 503) };
  }
  if (accountLocked(snapshot)) return { error: json({ ok:false, error:'ACCOUNT_LOCKED' }, 403) };
  const specialGranted = (Array.isArray(access.payload.manualSpecialAreas) ? access.payload.manualSpecialAreas : [])
    .map(value => clean(value).toUpperCase()).includes(VR_HOWTO_BUCKET);
  const eligibleView = (Array.isArray(snapshot.views) ? snapshot.views : [])
    .filter(view => ELIGIBLE_ENGLISH_VIEWS.has(norm(view?.viewId)) && view?.lockedPreview !== true)
    .sort((left, right) => {
      const lc = left?.group === 'current' || left?.current === true ? 1 : 0;
      const rc = right?.group === 'current' || right?.current === true ? 1 : 0;
      return rc - lc || clean(right?.viewId).localeCompare(clean(left?.viewId));
    })[0] || null;
  if (!specialGranted || !eligibleView) return { session, access, snapshot, eligibleView:null, area:null };
  if (!requireArea) return { session, access, snapshot, eligibleView, area:null };
  let area;
  try {
    area = await resolveCurrentScope(store, `special:${VR_HOWTO_BUCKET}`);
  } catch {
    return { error: json({ ok:false, error:'SPECIAL_AREA_UNAVAILABLE' }, 503) };
  }
  if (area?.payload?.kind !== 'prepared-special-area' || clean(area.payload.bucketId).toUpperCase() !== VR_HOWTO_BUCKET) {
    return { error: json({ ok:false, error:'SPECIAL_AREA_UNAVAILABLE' }, 503) };
  }
  return { session, access, snapshot, eligibleView, area };
}

function videoItems(area) {
  return (Array.isArray(area?.payload?.items) ? area.payload.items : [])
    .filter(item => item?.separator !== true && safeScreenPalTarget(item?.targetUrl));
}

function virtualView(area) {
  const count = videoItems(area).length;
  return {
    viewId: VR_HOWTO_VIEW,
    subject: 'english',
    label: 'VR How To',
    current: true,
    group: 'current',
    lockedPreview: false,
    catalogueAvailable: count > 0,
    visibleLessonCount: count,
    openLessonCount: count,
    lockedLessonCount: 0,
    specialArea: VR_HOWTO_BUCKET
  };
}

function pseudoLessonId(item) {
  return `vr-howto:${clean(item?.itemId)}`;
}

function itemByLesson(area, lessonId) {
  const id = clean(lessonId);
  return videoItems(area).find(item => pseudoLessonId(item) === id) || null;
}

async function resourceId(item) {
  return `r-${(await sha256Hex(`${VR_HOWTO_BUCKET}\n${clean(item?.itemId)}\nvideo`)).slice(0, 32)}`;
}

function lessonRow(item, index = 0) {
  return {
    lessonId: pseudoLessonId(item),
    displayLessonId: '',
    title: clean(item?.title) || 'VR How To',
    description: String(item?.description || ''),
    order: Number(item?.order || index + 1),
    open: true,
    locked: false,
    accessMode: 'full',
    vrAvailable: true,
    blocked: false,
    sources: [`special:${VR_HOWTO_BUCKET}`]
  };
}

function deliveryUrl(request, { token, lessonId, resourceId: rid }) {
  const url = new URL('/api/v2/student/resource', request.url);
  url.searchParams.set('cap', token);
  url.searchParams.set('viewId', VR_HOWTO_VIEW);
  url.searchParams.set('lessonId', lessonId);
  url.searchParams.set('resourceId', rid);
  return `${url.pathname}${url.search}`;
}

async function decorateHomeOrSubject(response, request, env) {
  if (!response.ok) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body?.ok || !Array.isArray(body.views)) return response;
  const context = await preparedContext(request, env, { requireArea:true });
  if (context.error || !context.eligibleView || !context.area) return response;
  if (body.views.some(view => clean(view?.viewId) === VR_HOWTO_VIEW)) return response;
  body.views = [...body.views, virtualView(context.area)];
  return jsonLike(response, body);
}

async function handleView(request, env) {
  const context = await preparedContext(request, env, { requireArea:true });
  if (context.error) return context.error;
  if (!context.eligibleView || !context.area) return json({ ok:false, error:'VIEW_NOT_AVAILABLE' }, 404);
  const rows = videoItems(context.area).map(lessonRow);
  return json({
    ok:true,
    source:'prepared-read-models',
    modelVersions:{ access:context.access.version, special:context.area.version },
    usedFallback:{ access:context.access.usedFallback, special:context.area.usedFallback },
    view:virtualView(context.area),
    lessonCount:rows.length,
    lessons:rows
  });
}

async function handleLesson(request, env, lessonId) {
  const context = await preparedContext(request, env, { requireArea:true });
  if (context.error) return context.error;
  if (!context.eligibleView || !context.area) return json({ ok:false, error:'LESSON_NOT_AVAILABLE' }, 404);
  const item = itemByLesson(context.area, lessonId);
  if (!item) return json({ ok:false, error:'LESSON_NOT_AVAILABLE' }, 404);
  const rid = await resourceId(item);
  return json({
    ok:true,
    source:'prepared-read-models',
    modelVersions:{ access:context.access.version, special:context.area.version, lesson:context.area.version },
    view:{ viewId:VR_HOWTO_VIEW, label:'VR How To', lockedPreview:false },
    lesson:lessonRow(item),
    resourcesIncluded:true,
    resources:[{ resourceId:rid, type:'video', displayName:'View', protected:false }]
  });
}

async function handleOpen(request, env, lessonId, rid) {
  const context = await preparedContext(request, env, { requireArea:true });
  if (context.error) return context.error;
  if (!context.eligibleView || !context.area) return json({ ok:false, error:'RESOURCE_NOT_AVAILABLE' }, 404);
  const item = itemByLesson(context.area, lessonId);
  if (!item || await resourceId(item) !== clean(rid)) return json({ ok:false, error:'RESOURCE_NOT_AVAILABLE' }, 404);
  const issued = await issueCapability({
    secret:requireSecret(env,'AUTH_SIGNING_SECRET'),
    session:context.session,
    type:'video',
    viewId:VR_HOWTO_VIEW,
    lessonId:clean(lessonId),
    resourceId:clean(rid),
    accessVersion:context.access.version,
    ttlSeconds:CAPABILITY_MAX_AGE_SECONDS
  });
  return new Response(null, {
    status:302,
    headers:{
      location:deliveryUrl(request,{token:issued.token,lessonId:clean(lessonId),resourceId:clean(rid)}),
      'cache-control':'private, no-store',
      'x-content-type-options':'nosniff'
    }
  });
}

async function handleDelivery(request, env, url) {
  const lessonId = clean(url.searchParams.get('lessonId'));
  const rid = clean(url.searchParams.get('resourceId'));
  const token = clean(url.searchParams.get('cap'));
  const context = await preparedContext(request, env, { requireArea:true });
  if (context.error) return context.error;
  if (!context.eligibleView || !context.area) return json({ ok:false, error:'RESOURCE_NOT_AVAILABLE' }, 404);
  const item = itemByLesson(context.area, lessonId);
  if (!item || await resourceId(item) !== rid) return json({ ok:false, error:'RESOURCE_NOT_AVAILABLE' }, 404);
  try {
    await verifyCapability({
      secret:requireSecret(env,'AUTH_SIGNING_SECRET'), token,
      expected:{ type:'video', userId:context.session.sub, sessionId:context.session.sid, viewId:VR_HOWTO_VIEW, lessonId, resourceId:rid, accessVersion:context.access.version }
    });
  } catch {
    return json({ ok:false, error:'AUTH_REQUIRED' }, 401);
  }
  const target = safeScreenPalTarget(item.targetUrl);
  if (!target) return json({ ok:false, error:'VIDEO_TARGET_INVALID' }, 503);
  return new Response(null, {
    status:302,
    headers:{ location:target, 'cache-control':'private, no-store', 'x-content-type-options':'nosniff' }
  });
}

export function createVrHowToRuntime(baseRuntime) {
  if (!baseRuntime || typeof baseRuntime.fetch !== 'function') throw new TypeError('A base Student runtime is required.');
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/api/v2/student/home') {
        return decorateHomeOrSubject(await baseRuntime.fetch(request, env), request, env);
      }
      if (request.method === 'GET' && url.pathname === '/api/v2/student/subjects/english') {
        return decorateHomeOrSubject(await baseRuntime.fetch(request, env), request, env);
      }
      if (request.method === 'GET' && url.pathname === `/api/v2/student/views/${VR_HOWTO_VIEW}/lessons`) {
        return handleView(request, env);
      }
      const lessonMatch = url.pathname.match(/^\/api\/v2\/student\/lessons\/([^/]+)$/);
      if (request.method === 'GET' && lessonMatch && clean(url.searchParams.get('viewId')) === VR_HOWTO_VIEW) {
        return handleLesson(request, env, decodeURIComponent(lessonMatch[1]));
      }
      const openMatch = url.pathname.match(/^\/api\/v2\/student\/lessons\/([^/]+)\/resources\/([^/]+)\/open$/);
      if (request.method === 'GET' && openMatch && clean(url.searchParams.get('viewId')) === VR_HOWTO_VIEW) {
        return handleOpen(request, env, decodeURIComponent(openMatch[1]), decodeURIComponent(openMatch[2]));
      }
      if (request.method === 'GET' && url.pathname === '/api/v2/student/resource' && clean(url.searchParams.get('viewId')) === VR_HOWTO_VIEW) {
        return handleDelivery(request, env, url);
      }
      return baseRuntime.fetch(request, env);
    }
  };
}

export { VR_HOWTO_BUCKET, VR_HOWTO_VIEW };
