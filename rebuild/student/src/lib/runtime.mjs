import {
  AuthTokenError,
  CAPABILITY_MAX_AGE_SECONDS,
  clearSessionCookie,
  createAuthenticatedSession,
  issueCapability,
  sessionTokenFromCookie,
  verifyCapability,
  verifySessionToken
} from '../../../shared/auth/auth-core.mjs';
import { authorizeAnswerPackOpen } from '../../../shared/auth/answer-pack-authorization.mjs';
import { opaqueAccessScopeId } from './access-scope.mjs';
import { kvReadStore, resolveCurrentScope, sha256Hex } from './read-model-resolver.mjs';
import { environmentAdapters } from './runtime-adapters.mjs';
import { videoForView } from '../../../shared/read-models/video.mjs';
import { resourceVisibleForView } from '../../../shared/read-models/resource-visibility.mjs';

export const CHECKPOINT = 6;
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const ADMIN_USER_ID = 'admin';

function isAdminPrincipal(value) {
  return norm(value) === ADMIN_USER_ID;
}

function adminAccount() {
  return {
    firstName: 'Admin',
    status: 'active',
    expiresOn: null,
    role: 'admin',
    superuser: true
  };
}

function adminView(view) {
  if (!view || typeof view !== 'object') return null;
  const lessonCount = Math.max(0, Number(view.lessonCount ?? view.visibleLessonCount ?? 0));
  return {
    ...view,
    current: true,
    group: 'current',
    lockedPreview: false,
    catalogueAvailable: lessonCount > 0,
    visibleLessonCount: lessonCount,
    openLessonCount: lessonCount,
    lockedLessonCount: 0,
    source: 'adminSuperuser'
  };
}

function adminViews(global) {
  return (Array.isArray(global?.payload?.navigation) ? global.payload.navigation : [])
    .map(adminView)
    .filter(Boolean);
}

function adminViewById(global, viewId) {
  const id = clean(viewId);
  return adminViews(global).find(view => clean(view?.viewId) === id) || null;
}

function adminAccessVersion(global) {
  const version = clean(global?.version);
  if (!version) throw new Error('GLOBAL_READ_MODEL_INVALID');
  return `admin:${version}`;
}

function adminPresentationState() {
  return {
    open: true,
    locked: false,
    accessMode: 'full',
    vrAvailable: true,
    blocked: false,
    sources: ['admin-superuser']
  };
}

function allowedOrigins(env) {
  return new Set([
    'https://futureperfecttuitions.github.io',
    ...String(env?.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
  ]);
}

function browserOriginAllowed(request, env) {
  const origin = request.headers.get('origin') || '';
  return Boolean(origin && allowedOrigins(env).has(origin));
}

function applyCors(response, request, env) {
  const origin = request.headers.get('origin') || '';
  if (!origin || !allowedOrigins(env).has(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-credentials', 'true');
  headers.set('access-control-expose-headers', 'Content-Type, Location, X-FPT-Rebuild-Checkpoint');
  headers.append('vary', 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function preflight(request, env) {
  if (request.method !== 'OPTIONS') return null;
  if (!browserOriginAllowed(request, env)) return json({ ok: false, error: 'FORBIDDEN_ORIGIN' }, 403);
  const headers = new Headers({
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'access-control-max-age': '600',
    'cache-control': 'private, no-store'
  });
  return applyCors(new Response(null, { status: 204, headers }), request, env);
}

function requiresTrustedOrigin(url, method) {
  if (method !== 'POST') return false;
  return url.pathname === '/api/v2/auth/login'
    || url.pathname === '/api/v2/auth/logout'
    || /^\/api\/v2\/student\/lessons\/[^/]+\/resources\/[^/]+\/open$/.test(url.pathname);
}

function json(body, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'x-fpt-rebuild-checkpoint': String(CHECKPOINT)
  });
  for (const [key, value] of Object.entries(extraHeaders || {})) headers.set(key, value);
  return new Response(JSON.stringify(body), { status, headers });
}

function redirect(location, status = 302) {
  return new Response(null, {
    status,
    headers: {
      location,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'x-fpt-rebuild-checkpoint': String(CHECKPOINT)
    }
  });
}

function publicError(error) {
  if (error instanceof AuthTokenError) return json({ ok: false, error: 'AUTH_REQUIRED' }, 401);
  const code = clean(error?.message || 'RUNTIME_UNAVAILABLE');
  const known = new Map([
    ['READ_MODEL_POINTER_UNAVAILABLE', 503],
    ['READ_MODEL_NO_VERIFIED_VERSION', 503],
    ['ACCESS_READ_MODEL_INVALID', 503],
    ['GLOBAL_READ_MODEL_INVALID', 503],
    ['LESSON_DETAIL_INVALID', 503],
    ['STUDENT_STORE_UNAVAILABLE', 503],
    ['ANSWER_RATE_STORE_UNAVAILABLE', 503],
    ['ANSWER_RATE_SESSION_REQUIRED', 503],
    ['VIDEO_TARGET_INVALID', 503]
  ]);
  return json({ ok: false, error: known.has(code) ? code : 'RUNTIME_UNAVAILABLE' }, known.get(code) || 503);
}

function requireSecret(env, key) {
  const value = String(env?.[key] ?? '');
  if (!value) throw new Error(`${key}_UNAVAILABLE`);
  return value;
}

async function parseJson(request, maxBytes = 4096) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('REQUEST_TOO_LARGE');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('REQUEST_TOO_LARGE');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error('REQUEST_JSON_INVALID'); }
}

async function verifiedSession(request, env, now) {
  const token = sessionTokenFromCookie(request.headers.get('cookie'));
  if (!token) throw new AuthTokenError('session_missing');
  return verifySessionToken({ secret: requireSecret(env, 'AUTH_SIGNING_SECRET'), token, now });
}

async function accessScopeForSession(session, env) {
  return opaqueAccessScopeId(session.sub, requireSecret(env, 'ACCESS_SCOPE_SECRET'));
}

async function resolveAccess(env, session) {
  const store = kvReadStore(env?.READ_MODELS_KV);
  const scopeId = await accessScopeForSession(session, env);
  const access = await resolveCurrentScope(store, `access:${scopeId}`);
  if (access?.payload?.kind !== 'prepared-access-read-model' || access.payload.scopeId !== scopeId) {
    throw new Error('ACCESS_READ_MODEL_INVALID');
  }
  return access;
}

async function resolveGlobal(env) {
  const global = await resolveCurrentScope(kvReadStore(env?.READ_MODELS_KV), 'global');
  if (global?.payload?.kind !== 'prepared-global-read-model') throw new Error('GLOBAL_READ_MODEL_INVALID');
  return global;
}

async function resolveLessonDetail(env, lessonId) {
  const detail = await resolveCurrentScope(kvReadStore(env?.READ_MODELS_KV), `lesson:${clean(lessonId)}`);
  if (detail?.payload?.kind !== 'prepared-lesson-detail' || clean(detail.payload.lessonId) !== clean(lessonId)) {
    throw new Error('LESSON_DETAIL_INVALID');
  }
  return detail;
}

function londonDate(nowValue = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(Number(nowValue)));
}

function preparedAccountLocked(snapshotValue, nowValue = Date.now()) {
  const account = snapshotValue?.account || {};
  const status = norm(account.status || 'active');
  const expiresOn = clean(account.expiresOn);
  const expired = /^\d{4}-\d{2}-\d{2}$/.test(expiresOn) ? londonDate(nowValue) > expiresOn : false;
  return status !== 'active' || expired;
}

function accountLockedResponse() {
  return json({ ok:false, error:'ACCOUNT_LOCKED' }, 403);
}

function snapshot(access) { return access?.payload?.snapshot || null; }
function visibleView(snapshotValue, viewId) {
  const id = clean(viewId);
  return (Array.isArray(snapshotValue?.views) ? snapshotValue.views : []).find(view => clean(view?.viewId) === id) || null;
}
function lessonState(snapshotValue, lessonId) { return snapshotValue?.lessonAccess?.[clean(lessonId)] || null; }
function presentationState(snapshotValue, view, lessonId) {
  const state = lessonState(snapshotValue, lessonId);
  const blocked = state?.blocked === true;
  const preview = view?.lockedPreview === true;
  const full = !preview && !blocked && state?.core === true;
  const preLessonOnly = !preview && !blocked && !full && state?.preLessonOnly === true;
  const vr = !preview && !blocked && state?.vr === true;
  const open = full || preLessonOnly;
  return { open, locked: !open, accessMode: full ? 'full' : (preLessonOnly ? 'prelesson-only' : 'locked'), vrAvailable: vr, blocked, sources: open && Array.isArray(state?.sources) ? state.sources : [] };
}
function viewCatalogue(global, viewId) { return global?.payload?.catalogues?.[clean(viewId)] || null; }
function safeLessonRow(row, state) { return { lessonId:clean(row?.lessonId), displayLessonId:clean(row?.displayLessonId), title:clean(row?.title), description:String(row?.description||''), order:Number(row?.order||0), ...state }; }
function selectLesson(global, snapshotValue, lessonId, requestedViewId) {
  const id=clean(lessonId), requested=clean(requestedViewId);
  const candidates=Array.isArray(global?.payload?.lessonToViews?.[id]) ? global.payload.lessonToViews[id] : [];
  const visible=candidates.filter(viewId=>visibleView(snapshotValue,viewId));
  const viewId=requested || (visible.length===1?visible[0]:'');
  if(!viewId||!visible.includes(viewId))return null;
  const view=visibleView(snapshotValue,viewId), catalogue=viewCatalogue(global,viewId);
  const row=(Array.isArray(catalogue?.lessons)?catalogue.lessons:[]).find(item=>clean(item?.lessonId)===id);
  return row ? {view,row} : null;
}

function selectAdminLesson(global, lessonId, requestedViewId) {
  const id=clean(lessonId), requested=clean(requestedViewId);
  const candidates=Array.isArray(global?.payload?.lessonToViews?.[id]) ? global.payload.lessonToViews[id] : [];
  const viewId=requested || (candidates.length===1?candidates[0]:'');
  if(!viewId||!candidates.includes(viewId))return null;
  const view=adminViewById(global,viewId), catalogue=viewCatalogue(global,viewId);
  const row=(Array.isArray(catalogue?.lessons)?catalogue.lessons:[]).find(item=>clean(item?.lessonId)===id);
  return view && row ? {view,row} : null;
}

function resourceAllowed(resource, state, viewId) {
  if (!state?.open || state.blocked) return false;
  if (!resourceVisibleForView(resource, viewId, state)) return false;
  if (state.accessMode === 'prelesson-only') return clean(resource?.type) === 'prelesson';
  return true;
}

async function resourceIdFor(lessonId, resource) {
  const material = `${clean(lessonId)}\n${clean(resource?.type)}\n${clean(resource?.objectKey || resource?.targetUrl)}`;
  return `r-${(await sha256Hex(material)).slice(0, 32)}`;
}

async function availableResources(detail, state, viewId) {
  const rows = [];
  const video = state?.accessMode === 'full' ? videoForView(detail?.payload?.videoVariants, viewId) : null;
  if (video?.targetUrl) rows.push({ type: 'video', displayName: video.displayName || 'Lesson Video', targetUrl: video.targetUrl });
  for (const resource of Array.isArray(detail?.payload?.resources) ? detail.payload.resources : []) {
    if (resourceAllowed(resource, state, viewId)) rows.push(resource);
  }
  return rows;
}

async function resourceRows(detail, state, viewId) {
  const rows = [];
  for (const resource of await availableResources(detail, state, viewId)) {
    rows.push({
      resourceId: await resourceIdFor(detail.payload.lessonId, resource),
      type: clean(resource.type),
      displayName: clean(resource.displayName),
      protected: resource.protected === true
    });
  }
  return rows;
}

async function selectResource(detail, state, viewId, resourceId) {
  for (const resource of await availableResources(detail, state, viewId)) {
    if (await resourceIdFor(detail.payload.lessonId, resource) === clean(resourceId)) return resource;
  }
  return null;
}

function capabilityType(resource) {
  const type = norm(resource?.type);
  if (type === 'answer-pack' || resource?.protected === true) return 'answer-view';
  if (type === 'video') return 'video';
  return 'download';
}

function deliveryUrl(request, { token, viewId, lessonId, resourceId }) {
  const url = new URL('/api/v2/student/resource', request.url);
  url.searchParams.set('cap', token);
  url.searchParams.set('viewId', viewId);
  url.searchParams.set('lessonId', lessonId);
  url.searchParams.set('resourceId', resourceId);
  return `${url.pathname}${url.search}`;
}

async function authorisedLesson(env, session, viewId, lessonId, { includeDetail = true, nowValue = Date.now() } = {}) {
  if (isAdminPrincipal(session?.sub)) {
    const global = await resolveGlobal(env);
    const selected = selectAdminLesson(global, lessonId, viewId);
    if (!selected) return { error: json({ ok:false, error:'LESSON_NOT_AVAILABLE' },404) };
    const state = adminPresentationState();
    const detail = includeDetail ? await resolveLessonDetail(env, lessonId) : null;
    return {
      global,
      access: { version: adminAccessVersion(global), usedFallback: global.usedFallback === true },
      snap: null,
      selected,
      state,
      detail,
      principal: 'admin'
    };
  }

  const [global, access] = await Promise.all([resolveGlobal(env), resolveAccess(env, session)]);
  const snap = snapshot(access);
  if (preparedAccountLocked(snap, nowValue)) return { error: accountLockedResponse() };
  const selected = selectLesson(global, snap, lessonId, viewId);
  if (!selected) return { error: json({ ok:false, error:'LESSON_NOT_AVAILABLE' },404) };
  const state = presentationState(snap, selected.view, selected.row.lessonId);
  if (!state.open || selected.view.lockedPreview === true) {
    return { global, access, snap, selected, state, detail:null };
  }
  const detail = includeDetail ? await resolveLessonDetail(env, lessonId) : null;
  return { global, access, snap, selected, state, detail };
}

export function createStudentRuntime(overrides = {}) {
  const fixedNow = overrides.now;
  const now = () => typeof fixedNow === 'function' ? fixedNow() : (fixedNow ?? Date.now());

  return {
    async fetch(request, env) {
      const adapters = { ...environmentAdapters(env, { now }), ...overrides };
      const url = new URL(request.url);
      const preflightResponse = preflight(request, env);
      if (preflightResponse) return preflightResponse;
      if (requiresTrustedOrigin(url, request.method) && !browserOriginAllowed(request, env)) {
        return json({ok:false,error:'FORBIDDEN_ORIGIN'}, 403);
      }
      const execute = async () => {
        try {
        if (url.pathname === '/health' && request.method === 'GET') {
          return json({
            ok:true, checkpoint:CHECKPOINT, runtime:'student', environment:clean(env?.ENVIRONMENT||'unknown'), productionTarget:false,
            preparedReadModels:{ kvBound:Boolean(env?.READ_MODELS_KV&&typeof env.READ_MODELS_KV.get==='function') },
            auth:{ signedCookie:true, studentStoreBound:Boolean(env?.STUDENTS_KV?.get), d1SessionLookup:false, activityWrites:false },
            resources:{ r2Bound:Boolean(env?.MATERIALS_R2?.get), answerPasswordLiveStore:Boolean(env?.STUDENTS_KV?.get), answerRateStoreBound:Boolean(env?.DB?.prepare), directScreenPalRedirect:true, r2HeadFanout:false }
          });
        }

        if (url.pathname === '/api/v2/auth/login') {
          if (request.method !== 'POST') return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
          const body = await parseJson(request);
          const username = norm(body.username);
          const password = String(body.password ?? '');
          if (!username || !password) return json({ok:false,error:'LOGIN_REQUIRED'},400);
          const verified = await adapters.authenticateCredentials({ username, password, request });
          if (!verified?.ok || !clean(verified.userId)) return json({ok:false,error:'LOGIN_INVALID'},401);
          const issued = await createAuthenticatedSession({ secret:requireSecret(env,'AUTH_SIGNING_SECRET'), userId:verified.userId, now:now() });

          if (isAdminPrincipal(verified.userId)) {
            return json({
              ok:true,
              checkpoint:CHECKPOINT,
              expiresAt:issued.session.exp,
              account:adminAccount(),
              accountLocked:false,
              principal:'admin'
            }, 200, { 'set-cookie': issued.setCookie });
          }

          const access = await resolveAccess(env, issued.session);
          const snap = snapshot(access);
          return json({ ok:true, checkpoint:CHECKPOINT, expiresAt:issued.session.exp, account:snap?.account||{}, accountLocked:preparedAccountLocked(snap, now()), modelVersion:access.version }, 200, { 'set-cookie': issued.setCookie });
        }

        if (url.pathname === '/api/v2/auth/logout') {
          if (request.method !== 'POST') return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
          return json({ok:true},200,{'set-cookie':clearSessionCookie()});
        }

        const session = await verifiedSession(request, env, now());

        if (url.pathname === '/api/v2/student/home' && request.method === 'GET') {
          if (isAdminPrincipal(session.sub)) {
            const global = await resolveGlobal(env);
            return json({
              ok:true,
              checkpoint:CHECKPOINT,
              runtime:'student',
              source:'prepared-global-read-model',
              modelVersion:global.version,
              usedFallback:global.usedFallback,
              account:adminAccount(),
              accountLocked:false,
              role:'admin',
              superuser:true,
              views:adminViews(global)
            });
          }
          const access=await resolveAccess(env,session), snap=snapshot(access), accountLocked=preparedAccountLocked(snap,now());
          return json({ok:true,checkpoint:CHECKPOINT,runtime:'student',source:'prepared-access-read-model',modelVersion:access.version,usedFallback:access.usedFallback,account:snap?.account||{},accountLocked,views:accountLocked?[]:(Array.isArray(snap?.views)?snap.views:[])});
        }

        const subjectMatch=url.pathname.match(/^\/api\/v2\/student\/subjects\/([^/]+)$/);
        if(subjectMatch&&request.method==='GET'){
          const subject=norm(decodeURIComponent(subjectMatch[1]));
          if(!['maths','english'].includes(subject))return json({ok:false,error:'SUBJECT_NOT_AVAILABLE'},404);
          if (isAdminPrincipal(session.sub)) {
            const global=await resolveGlobal(env);
            const views=adminViews(global).filter(view=>norm(view?.subject)===subject);
            return json({ok:true,subject,modelVersion:global.version,source:'prepared-global-read-model',role:'admin',superuser:true,views});
          }
          const access=await resolveAccess(env,session),snap=snapshot(access);
          if(preparedAccountLocked(snap,now()))return accountLockedResponse();
          const views=(Array.isArray(snap?.views)?snap.views:[]).filter(view=>norm(view?.subject)===subject);
          return json({ok:true,subject,modelVersion:access.version,views});
        }

        const viewMatch=url.pathname.match(/^\/api\/v2\/student\/views\/([^/]+)\/lessons$/);
        if(viewMatch&&request.method==='GET'){
          const viewId=decodeURIComponent(viewMatch[1]);
          if (isAdminPrincipal(session.sub)) {
            const global=await resolveGlobal(env);
            const view=adminViewById(global,viewId),catalogue=viewCatalogue(global,viewId);
            if(!view||!catalogue)return json({ok:false,error:'VIEW_NOT_AVAILABLE'},404);
            const lessons=(Array.isArray(catalogue.lessons)?catalogue.lessons:[]).map(row=>safeLessonRow(row,adminPresentationState()));
            return json({
              ok:true,
              source:'prepared-global-read-model',
              modelVersions:{global:global.version,access:adminAccessVersion(global)},
              usedFallback:{global:global.usedFallback,access:false},
              role:'admin',
              superuser:true,
              view,
              lessonCount:lessons.length,
              lessons
            });
          }
          const [global,access]=await Promise.all([resolveGlobal(env),resolveAccess(env,session)]),snap=snapshot(access);
          if(preparedAccountLocked(snap,now()))return accountLockedResponse();
          const view=visibleView(snap,viewId),catalogue=viewCatalogue(global,viewId);
          if(!view||!catalogue)return json({ok:false,error:'VIEW_NOT_AVAILABLE'},404);
          const lessons=(Array.isArray(catalogue.lessons)?catalogue.lessons:[]).map(row=>safeLessonRow(row,presentationState(snap,view,row.lessonId)));
          return json({ok:true,source:'prepared-read-models',modelVersions:{global:global.version,access:access.version},usedFallback:{global:global.usedFallback,access:access.usedFallback},view,lessonCount:lessons.length,lessons});
        }

        const lessonMatch=url.pathname.match(/^\/api\/v2\/student\/lessons\/([^/]+)$/);
        if(lessonMatch&&request.method==='GET'){
          const lessonId=decodeURIComponent(lessonMatch[1]);
          const auth=await authorisedLesson(env,session,url.searchParams.get('viewId'),lessonId,{nowValue:now()});
          if(auth.error)return auth.error;
          const resources=auth.detail ? await resourceRows(auth.detail,auth.state,auth.selected.view.viewId) : [];
          return json({ok:true,source:'prepared-read-models',modelVersions:{global:auth.global.version,access:auth.access.version,lesson:auth.detail?.version||null},view:{viewId:auth.selected.view.viewId,label:auth.selected.view.label,lockedPreview:auth.selected.view.lockedPreview===true},lesson:safeLessonRow(auth.selected.row,auth.state),resourcesIncluded:Boolean(auth.detail),resources});
        }

        const openMatch=url.pathname.match(/^\/api\/v2\/student\/lessons\/([^/]+)\/resources\/([^/]+)\/open$/);
        if(openMatch&&(request.method==='GET'||request.method==='POST')){
          const lessonId=decodeURIComponent(openMatch[1]), resourceId=decodeURIComponent(openMatch[2]), viewId=clean(url.searchParams.get('viewId'));
          const auth=await authorisedLesson(env,session,viewId,lessonId,{nowValue:now()});
          if(auth.error)return auth.error;
          if(!auth.detail||!auth.state.open)return json({ok:false,error:'RESOURCE_NOT_AVAILABLE'},404);
          const resource=await selectResource(auth.detail,auth.state,auth.selected.view.viewId,resourceId);
          if(!resource)return json({ok:false,error:'RESOURCE_NOT_AVAILABLE'},404);
          const type=capabilityType(resource);
          if(type==='answer-view'){
            if(request.method!=='POST')return json({ok:false,error:'ANSWER_PASSWORD_REQUIRED'},405);
            const body=await parseJson(request);
            if(!String(body?.password||''))return json({ok:false,error:'ANSWER_PASSWORD_REQUIRED'},400);
            const result=await authorizeAnswerPackOpen({secret:requireSecret(env,'AUTH_SIGNING_SECRET'),session,request:{password:body.password,viewId,lessonId,resourceId,accessVersion:auth.access.version},checkRateLimit:adapters.checkRateLimit,validateCurrentPassword:adapters.validateCurrentPassword,recordFailedAttempt:adapters.recordFailedAttempt,clearFailedAttempts:adapters.clearFailedAttempts,now:now()});
            if(!result.ok)return json({ok:false,error:result.code,retryAfterSeconds:result.retryAfterSeconds??undefined},result.status);
            return json({ok:true,kind:'answer-view',viewerUrl:deliveryUrl(request,{token:result.token,viewId,lessonId,resourceId}),expiresAt:result.capability.exp});
          }
          if(request.method!=='GET')return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
          const issued=await issueCapability({secret:requireSecret(env,'AUTH_SIGNING_SECRET'),session,type,viewId,lessonId,resourceId,accessVersion:auth.access.version,ttlSeconds:CAPABILITY_MAX_AGE_SECONDS,now:now()});
          return redirect(deliveryUrl(request,{token:issued.token,viewId,lessonId,resourceId}));
        }

        if(url.pathname==='/api/v2/student/resource'&&request.method==='GET'){
          const token=clean(url.searchParams.get('cap')), viewId=clean(url.searchParams.get('viewId')), lessonId=clean(url.searchParams.get('lessonId')), resourceId=clean(url.searchParams.get('resourceId'));
          if(!token||!viewId||!lessonId||!resourceId)return json({ok:false,error:'CAPABILITY_REQUIRED'},400);
          const auth=await authorisedLesson(env,session,viewId,lessonId,{nowValue:now()});
          if(auth.error)return auth.error;
          if(!auth.detail||!auth.state.open)return json({ok:false,error:'RESOURCE_NOT_AVAILABLE'},404);
          const resource=await selectResource(auth.detail,auth.state,auth.selected.view.viewId,resourceId);
          if(!resource)return json({ok:false,error:'RESOURCE_NOT_AVAILABLE'},404);
          const type=capabilityType(resource);
          await verifyCapability({secret:requireSecret(env,'AUTH_SIGNING_SECRET'),token,expected:{type,userId:session.sub,sessionId:session.sid,viewId,lessonId,resourceId,accessVersion:auth.access.version},now:now()});
          if(type==='video')return adapters.deliverVideo({resource,session,request,viewId,lessonId,resourceId});
          return adapters.deliverResource({resource,session,request,viewId,lessonId,resourceId,answerPack:type==='answer-view'});
        }

        return json({ok:false,error:'NOT_FOUND'},404);
        } catch(error) {
          const code=clean(error?.message);
          if(code==='REQUEST_TOO_LARGE')return json({ok:false,error:code},413);
          if(code==='REQUEST_JSON_INVALID')return json({ok:false,error:code},400);
          return publicError(error);
        }
      };
      return applyCors(await execute(), request, env);
    }
  };
}
