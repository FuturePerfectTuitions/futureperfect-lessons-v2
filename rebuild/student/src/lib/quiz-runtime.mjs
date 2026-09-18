import {
  AuthTokenError,
  TOKEN_ISSUER,
  sessionTokenFromCookie,
  verifySessionToken
} from '../../../shared/auth/auth-core.mjs';
import { opaqueAccessScopeId } from './access-scope.mjs';
import { kvReadStore, resolveCurrentScope, sha256Hex } from './read-model-resolver.mjs';

const QUIZ_URL = 'https://quiz.futureperfect.education/';
const QUIZ_VIEW_ID = 'maths-level3';
const API_V2_SOURCE = 'portal-api-v2-live-l3-view-v1';
const TTL_MS = 90_000;
const ADMIN_USER_ID = 'admin';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

function allowedOrigins(env) {
  return new Set([
    'https://futureperfecttuitions.github.io',
    ...String(env?.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
  ]);
}

function trustedOrigin(request, env) {
  const origin = clean(request.headers.get('origin'));
  return Boolean(origin && allowedOrigins(env).has(origin));
}

function applyCors(response, request, env) {
  const origin = clean(request.headers.get('origin'));
  if (!origin || !allowedOrigins(env).has(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-credentials', 'true');
  headers.append('vary', 'Origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function preflight(request, env) {
  if (!trustedOrigin(request, env)) return json({ ok: false, error: 'FORBIDDEN_ORIGIN' }, 403);
  return applyCors(new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
      'access-control-max-age': '600',
      'cache-control': 'private, no-store'
    }
  }), request, env);
}

function requireSecret(env, key) {
  const value = String(env?.[key] ?? '');
  if (!value) throw new Error(`${key}_UNAVAILABLE`);
  return value;
}

function londonDate(nowValue = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(Number(nowValue)));
}

function accountLocked(snapshotValue, nowValue = Date.now()) {
  const account = snapshotValue?.account || {};
  const status = norm(account.status || 'active');
  const expiresOn = clean(account.expiresOn);
  const expired = /^\d{4}-\d{2}-\d{2}$/.test(expiresOn)
    ? londonDate(nowValue) > expiresOn
    : false;
  return status !== 'active' || expired;
}

function isTrial(snapshotValue) {
  return snapshotValue?.account?.trial === true;
}

function viewById(snapshotValue, viewId) {
  return (Array.isArray(snapshotValue?.views) ? snapshotValue.views : [])
    .find(view => clean(view?.viewId) === clean(viewId)) || null;
}

function exactEligibleL3View(snapshotValue, global) {
  const view = viewById(snapshotValue, QUIZ_VIEW_ID);
  const catalogue = global?.payload?.catalogues?.[QUIZ_VIEW_ID] || null;
  if (!view || !catalogue) return null;
  if (norm(view.subject) !== 'maths') return null;
  if (view.current !== true || norm(view.group) !== 'current') return null;
  if (view.lockedPreview === true || view.catalogueAvailable !== true) return null;
  if (norm(catalogue.subject) !== 'maths') return null;
  if (norm(catalogue.stream) !== '11plus') return null;
  if (Number(catalogue.mathsLevel) !== 3) return null;
  return { view, catalogue };
}

function releasedL3LessonCodes(snapshotValue, catalogue) {
  const out = [];
  for (const row of Array.isArray(catalogue?.lessons) ? catalogue.lessons : []) {
    const lessonId = clean(row?.lessonId);
    const state = snapshotValue?.lessonAccess?.[lessonId] || null;
    if (!state || state.blocked === true || state.core !== true) continue;
    const code = [row?.lessonId, row?.displayLessonId]
      .map(clean)
      .find(value => /^L3T\dM\d+$/i.test(value));
    if (code) out.push(code.toUpperCase());
  }
  return [...new Set(out)];
}

async function verifiedPortalContext(request, env, nowValue = Date.now()) {
  const token = sessionTokenFromCookie(request.headers.get('cookie'));
  if (!token) throw new AuthTokenError('session_missing');
  const session = await verifySessionToken({
    secret: requireSecret(env, 'AUTH_SIGNING_SECRET'),
    token,
    now: nowValue
  });
  if (norm(session.sub) === ADMIN_USER_ID) return { eligible: false, reason: 'ADMIN_EXCLUDED' };

  const scopeId = await opaqueAccessScopeId(session.sub, requireSecret(env, 'ACCESS_SCOPE_SECRET'));
  const store = kvReadStore(env?.READ_MODELS_KV);
  const [access, global] = await Promise.all([
    resolveCurrentScope(store, `access:${scopeId}`),
    resolveCurrentScope(store, 'global')
  ]);
  if (access?.payload?.kind !== 'prepared-access-read-model' || access.payload.scopeId !== scopeId) {
    throw new Error('ACCESS_READ_MODEL_INVALID');
  }
  if (global?.payload?.kind !== 'prepared-global-read-model') {
    throw new Error('GLOBAL_READ_MODEL_INVALID');
  }

  const snapshotValue = access.payload.snapshot || null;
  if (!snapshotValue || accountLocked(snapshotValue, nowValue) || isTrial(snapshotValue)) {
    return { eligible: false, reason: isTrial(snapshotValue) ? 'TRIAL_EXCLUDED' : 'ACCOUNT_INACTIVE' };
  }

  const level3 = exactEligibleL3View(snapshotValue, global);
  if (!level3) return { eligible: false, reason: 'NO_CURRENT_L3_MATHS_ACCESS' };

  const lessonCodes = releasedL3LessonCodes(snapshotValue, level3.catalogue);
  return {
    eligible: true,
    session,
    token,
    snapshot: snapshotValue,
    access,
    global,
    level3,
    lessonCodes
  };
}

function launchCode() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function eligibility(request, env) {
  try {
    const context = await verifiedPortalContext(request, env);
    return applyCors(json({
      ok: true,
      eligible: context.eligible === true,
      label: '11+ Practice'
    }), request, env);
  } catch (error) {
    if (error instanceof AuthTokenError) {
      return applyCors(json({ ok: false, eligible: false, error: 'AUTH_REQUIRED' }, 401), request, env);
    }
    return applyCors(json({ ok: false, eligible: false, error: 'ELIGIBILITY_UNAVAILABLE' }, 503), request, env);
  }
}

async function launch(request, env) {
  if (!trustedOrigin(request, env)) {
    return applyCors(json({ ok: false, error: 'FORBIDDEN_ORIGIN' }, 403), request, env);
  }
  try {
    const now = new Date();
    const context = await verifiedPortalContext(request, env, now.getTime());
    if (!context.eligible) return applyCors(json({ ok: false, error: 'NOT_ELIGIBLE' }, 403), request, env);
    if (!env?.DB?.prepare) return applyCors(json({ ok: false, error: 'LAUNCH_STORE_UNAVAILABLE' }, 503), request, env);

    const rawCode = launchCode();
    const [codeHash, portalSessionTokenHash] = await Promise.all([
      sha256Hex(rawCode),
      sha256Hex(context.token)
    ]);
    const expires = new Date(now.getTime() + TTL_MS);
    const releaseContext = {
      l3Eligible: true,
      l2Inherited: true,
      releasedL3LessonCodes: context.lessonCodes,
      source: API_V2_SOURCE,
      portalSessionIssuer: TOKEN_ISSUER,
      portalSessionKind: 'session',
      portalSessionExpiresAt: new Date(context.session.exp * 1000).toISOString(),
      portalAccessModelVersion: clean(context.access?.version),
      portalGlobalModelVersion: clean(context.global?.version),
      portalViewId: QUIZ_VIEW_ID
    };

    await env.DB.prepare(`
      INSERT INTO quiz_launch_codes(
        code_hash,
        portal_user_id_norm,
        portal_session_token_hash,
        release_context_json,
        created_at,
        expires_at,
        used_at
      ) VALUES(?,?,?,?,?,?,NULL)
    `).bind(
      codeHash,
      norm(context.session.sub),
      portalSessionTokenHash,
      JSON.stringify(releaseContext),
      now.toISOString(),
      expires.toISOString()
    ).run();

    return applyCors(json({
      ok: true,
      launchUrl: `${QUIZ_URL}launch?code=${encodeURIComponent(rawCode)}`,
      expiresAt: expires.toISOString()
    }), request, env);
  } catch (error) {
    if (error instanceof AuthTokenError) {
      return applyCors(json({ ok: false, error: 'AUTH_REQUIRED' }, 401), request, env);
    }
    return applyCors(json({ ok: false, error: 'LAUNCH_UNAVAILABLE' }, 503), request, env);
  }
}

export function createQuizRuntime(nextRuntime) {
  if (!nextRuntime || typeof nextRuntime.fetch !== 'function') throw new TypeError('nextRuntime.fetch is required');
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const quizRoute = url.pathname === '/api/v2/student/quiz/eligibility'
        || url.pathname === '/api/v2/student/quiz/launch';
      if (!quizRoute) return nextRuntime.fetch(request, env);
      if (request.method === 'OPTIONS') return preflight(request, env);
      if (url.pathname === '/api/v2/student/quiz/eligibility' && request.method === 'GET') {
        return eligibility(request, env);
      }
      if (url.pathname === '/api/v2/student/quiz/launch' && request.method === 'POST') {
        return launch(request, env);
      }
      return applyCors(json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405), request, env);
    }
  };
}
