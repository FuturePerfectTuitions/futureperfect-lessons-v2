import {
  sessionTokenFromCookie,
  verifySessionToken
} from '../../../shared/auth/auth-core.mjs';
import { opaqueAccessScopeId } from './access-scope.mjs';
import { kvReadStore, resolveCurrentScope, sha256Hex } from './read-model-resolver.mjs';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const TRIAL_ENDED_MESSAGE = 'Trial access ended, please contact Future Perfect Tuitions to continue accessing content';
const TRIAL_VR_VIEWS = new Set(['english-year4-11plus', 'english-year5-11plus']);

function trialAccount(account) {
  return account?.trial === true && Array.isArray(account?.trialViews) && account.trialViews.length > 0;
}

function trialViews(account) {
  return new Set((Array.isArray(account?.trialViews) ? account.trialViews : []).map(norm).filter(Boolean));
}

function resourceScopes(resource) {
  const values = Array.isArray(resource?.presentationScopes) ? resource.presentationScopes : [];
  const scopes = [...new Set(values.map(value => clean(value)).filter(Boolean))];
  return scopes.length ? scopes : ['core'];
}

function trialResourceAllowed(resource, viewId, account) {
  if (!trialAccount(account) || !trialViews(account).has(norm(viewId))) return false;
  if (norm(resource?.type) === 'video') return true;
  return TRIAL_VR_VIEWS.has(norm(viewId)) && resourceScopes(resource).includes('vr');
}

function jsonLike(response, body, status = response.status, { dropCookie = false } = {}) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'private, no-store');
  headers.delete('content-length');
  if (dropCookie) headers.delete('set-cookie');
  return new Response(JSON.stringify(body), { status, headers });
}

async function trialContext(request, env) {
  try {
    const token = sessionTokenFromCookie(request.headers.get('cookie'));
    if (!token || !env?.AUTH_SIGNING_SECRET || !env?.ACCESS_SCOPE_SECRET || !env?.READ_MODELS_KV) return null;
    const session = await verifySessionToken({
      secret:String(env.AUTH_SIGNING_SECRET),
      token,
      now:Date.now()
    });
    if (!session?.sub || norm(session.sub) === 'admin') return null;
    const scopeId = await opaqueAccessScopeId(session.sub, String(env.ACCESS_SCOPE_SECRET));
    const access = await resolveCurrentScope(kvReadStore(env.READ_MODELS_KV), `access:${scopeId}`);
    const snapshot = access?.payload?.snapshot;
    if (access?.payload?.kind !== 'prepared-access-read-model' || !trialAccount(snapshot?.account)) return null;
    return { session, access, snapshot, account:snapshot.account };
  } catch {
    return null;
  }
}

async function consumeTrialLogin(env, portalUserId, setCookie) {
  if (!env?.DB || typeof env.DB.prepare !== 'function') throw new Error('TRIAL_CONSUMPTION_STORE_UNAVAILABLE');
  const id = norm(portalUserId);
  if (!id.startsWith('trial') || id.startsWith('admintrial')) throw new Error('TRIAL_ID_INVALID');
  const cookie = clean(setCookie);
  const tokenMatch = cookie.match(/(?:^|[,;]\s*)fpt_session=([^;]+)/i);
  const fingerprint = await sha256Hex(tokenMatch?.[1] || `trial:${id}:${Date.now()}`);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO trial_login_consumptions (portal_user_id_norm, consumed_at, first_session_token_hash)
     VALUES (?, ?, ?)
     ON CONFLICT(portal_user_id_norm) DO NOTHING`
  ).bind(id, now, fingerprint).run();
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
  return changes === 1;
}

async function handleTrialLogin(baseRuntime, request, env) {
  const requestCopy = request.clone();
  const response = await baseRuntime.fetch(request, env);
  if (!response.ok) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body?.ok || !trialAccount(body?.account)) return response;

  const credentials = await requestCopy.json().catch(() => ({}));
  const portalUserId = norm(credentials?.username);
  try {
    const consumed = await consumeTrialLogin(env, portalUserId, response.headers.get('set-cookie') || '');
    if (consumed) return response;
    return jsonLike(response, {
      ok:false,
      error:'TRIAL_ACCESS_ENDED',
      message:TRIAL_ENDED_MESSAGE
    }, 403, { dropCookie:true });
  } catch {
    return jsonLike(response, {
      ok:false,
      error:'TRIAL_LOGIN_UNAVAILABLE'
    }, 503, { dropCookie:true });
  }
}

async function filterTrialLessonDetail(baseRuntime, request, env, url) {
  const response = await baseRuntime.fetch(request, env);
  if (!response.ok) return response;
  const context = await trialContext(request, env);
  if (!context) return response;
  const viewId = norm(url.searchParams.get('viewId'));
  if (!trialViews(context.account).has(viewId)) return response;

  const body = await response.clone().json().catch(() => null);
  if (!body?.ok || !body?.lesson || !Array.isArray(body?.resources)) return response;
  body.resources = body.resources.filter(resource => trialResourceAllowed(resource, viewId, context.account));
  body.trial = {
    active:true,
    videoOnlyCore:true,
    vrIncluded:TRIAL_VR_VIEWS.has(viewId)
  };
  return jsonLike(response, body);
}

async function trialResourcePermission(baseRuntime, request, env, url, context) {
  const match = url.pathname.match(/^\/api\/v2\/student\/lessons\/([^/]+)\/resources\/([^/]+)\/open$/);
  if (!match) return { handled:false };
  const viewId = norm(url.searchParams.get('viewId'));
  if (!trialViews(context.account).has(viewId)) return { handled:true, response:null };

  let lessonId = '';
  let resourceId = '';
  try {
    lessonId = decodeURIComponent(match[1]);
    resourceId = decodeURIComponent(match[2]);
  } catch {
    return { handled:true, response:null };
  }

  const detailUrl = new URL(`/api/v2/student/lessons/${encodeURIComponent(lessonId)}`, request.url);
  detailUrl.searchParams.set('viewId', viewId);
  const detailResponse = await baseRuntime.fetch(new Request(detailUrl.toString(), {
    method:'GET',
    headers:request.headers
  }), env);
  if (!detailResponse.ok) return { handled:true, response:detailResponse };
  const detailBody = await detailResponse.clone().json().catch(() => null);
  const resource = (Array.isArray(detailBody?.resources) ? detailBody.resources : [])
    .find(item => clean(item?.resourceId) === clean(resourceId));
  if (!resource || !trialResourceAllowed(resource, viewId, context.account)) {
    return {
      handled:true,
      response:jsonLike(detailResponse, { ok:false, error:'RESOURCE_NOT_AVAILABLE' }, 404)
    };
  }
  return { handled:true, response:null, allowed:true };
}

function createTrialRuntime(baseRuntime) {
  if (!baseRuntime || typeof baseRuntime.fetch !== 'function') throw new Error('Base Student runtime is required.');
  return {
    async fetch(request, env) {
      const url = new URL(request.url);

      if (url.pathname === '/api/v2/auth/login' && request.method === 'POST') {
        return handleTrialLogin(baseRuntime, request, env);
      }

      const detailMatch = url.pathname.match(/^\/api\/v2\/student\/lessons\/[^/]+$/);
      if (detailMatch && request.method === 'GET') {
        return filterTrialLessonDetail(baseRuntime, request, env, url);
      }

      const openMatch = url.pathname.match(/^\/api\/v2\/student\/lessons\/[^/]+\/resources\/[^/]+\/open$/);
      if (openMatch) {
        const context = await trialContext(request, env);
        if (context) {
          const permission = await trialResourcePermission(baseRuntime, request, env, url, context);
          if (permission.response) return permission.response;
          if (permission.handled && !permission.allowed) {
            const base = await baseRuntime.fetch(request, env);
            return jsonLike(base, { ok:false, error:'RESOURCE_NOT_AVAILABLE' }, 404);
          }
        }
      }

      return baseRuntime.fetch(request, env);
    }
  };
}

export {
  TRIAL_ENDED_MESSAGE,
  TRIAL_VR_VIEWS,
  trialAccount,
  trialViews,
  resourceScopes,
  trialResourceAllowed,
  consumeTrialLogin,
  createTrialRuntime
};