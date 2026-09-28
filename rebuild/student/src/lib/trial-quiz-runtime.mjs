import {
  AuthTokenError,
  TOKEN_ISSUER,
  sessionTokenFromCookie,
  verifySessionToken
} from '../../../shared/auth/auth-core.mjs';
import { opaqueAccessScopeId } from './access-scope.mjs';
import { kvReadStore, resolveCurrentScope, sha256Hex } from './read-model-resolver.mjs';

const QUIZ_URL = 'https://quiz.futureperfect.education/';
const POLICY_VERSION = 'quiz-release-context-v2.0';
const RELEASE_SOURCE = 'portal-live-maths11plus-release-v2';
const TTL_MS = 90_000;
const L2_VIEW_ID = 'maths-level2';
const TRIAL_11PLUS_VIEWS = new Set([
  'maths-level1',
  'maths-level2',
  'maths-level3',
  'english-year4-11plus',
  'english-year5-11plus'
]);

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type':'application/json; charset=utf-8',
      'cache-control':'private, no-store',
      'x-content-type-options':'nosniff'
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
  return new Response(response.body, { status:response.status, statusText:response.statusText, headers });
}

function preflight(request, env) {
  if (!trustedOrigin(request, env)) return json({ ok:false, error:'FORBIDDEN_ORIGIN' }, 403);
  return applyCors(new Response(null, {
    status:204,
    headers:{
      'access-control-allow-methods':'GET, POST, OPTIONS',
      'access-control-allow-headers':'Content-Type',
      'access-control-max-age':'600',
      'cache-control':'private, no-store'
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
    timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'
  }).format(new Date(Number(nowValue)));
}

function accountLocked(snapshotValue, nowValue = Date.now()) {
  const account = snapshotValue?.account || {};
  const status = norm(account.status || 'active');
  const expiresOn = clean(account.expiresOn);
  const expired = /^\d{4}-\d{2}-\d{2}$/.test(expiresOn) ? londonDate(nowValue) > expiresOn : false;
  return status !== 'active' || expired;
}

function trialViews(snapshotValue) {
  const values = Array.isArray(snapshotValue?.account?.trialViews) ? snapshotValue.account.trialViews : [];
  return [...new Set(values.map(norm).filter(Boolean))];
}

function has11PlusTrialAccess(snapshotValue) {
  return trialViews(snapshotValue).some(viewId => TRIAL_11PLUS_VIEWS.has(viewId));
}

function fullL2LessonCodes(global) {
  const catalogue = global?.payload?.catalogues?.[L2_VIEW_ID] || null;
  if (!catalogue) return null;
  if (norm(catalogue.subject) !== 'maths' || norm(catalogue.stream) !== '11plus' || Number(catalogue.mathsLevel) !== 2) return null;
  const out = [];
  for (const row of Array.isArray(catalogue.lessons) ? catalogue.lessons : []) {
    const code = [row?.lessonId, row?.displayLessonId].map(clean).find(value => /^L2T\d+M\d+$/i.test(value));
    if (code) out.push(code.toUpperCase());
  }
  const codes = [...new Set(out)].sort();
  return codes.length ? codes : null;
}

async function resolveTrialContext(request, env, nowValue = Date.now()) {
  const token = sessionTokenFromCookie(request.headers.get('cookie'));
  if (!token) return { handled:false };
  let session;
  try {
    session = await verifySessionToken({ secret:requireSecret(env, 'AUTH_SIGNING_SECRET'), token, now:nowValue });
  } catch (error) {
    if (error instanceof AuthTokenError) return { handled:false };
    throw error;
  }
  const scopeId = await opaqueAccessScopeId(session.sub, requireSecret(env, 'ACCESS_SCOPE_SECRET'));
  const store = kvReadStore(env?.READ_MODELS_KV);
  const access = await resolveCurrentScope(store, `access:${scopeId}`);
  if (access?.payload?.kind !== 'prepared-access-read-model' || access.payload.scopeId !== scopeId) return { handled:false };
  const snapshotValue = access.payload.snapshot || null;
  if (snapshotValue?.account?.trial !== true) return { handled:false };

  if (!snapshotValue || accountLocked(snapshotValue, nowValue)) {
    return { handled:true, eligible:false, reason:'ACCOUNT_INACTIVE' };
  }
  if (!has11PlusTrialAccess(snapshotValue)) {
    return { handled:true, eligible:false, reason:'TRIAL_NOT_11PLUS' };
  }

  const global = await resolveCurrentScope(store, 'global');
  if (global?.payload?.kind !== 'prepared-global-read-model') throw new Error('GLOBAL_READ_MODEL_INVALID');
  const lessonCodes = fullL2LessonCodes(global);
  if (!lessonCodes) throw new Error('TRIAL_L2_CATALOGUE_INVALID');
  return {
    handled:true,
    eligible:true,
    session,
    token,
    access,
    global,
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

async function trialEligibility(request, env) {
  const context = await resolveTrialContext(request, env);
  if (!context.handled) return null;
  return applyCors(json({
    ok:true,
    eligible:context.eligible === true,
    label:'11+ Practice',
    ...(context.eligible ? { currentLevel:'L2', trialDemo:true } : {})
  }), request, env);
}

async function trialLaunch(request, env) {
  const now = new Date();
  const context = await resolveTrialContext(request, env, now.getTime());
  if (!context.handled) return null;
  if (!trustedOrigin(request, env)) return applyCors(json({ ok:false, error:'FORBIDDEN_ORIGIN' }, 403), request, env);
  if (!context.eligible) return applyCors(json({ ok:false, error:'NOT_ELIGIBLE' }, 403), request, env);
  if (!env?.DB?.prepare) return applyCors(json({ ok:false, error:'LAUNCH_STORE_UNAVAILABLE' }, 503), request, env);

  const rawCode = launchCode();
  const [codeHash, portalSessionTokenHash] = await Promise.all([sha256Hex(rawCode), sha256Hex(context.token)]);
  const expires = new Date(now.getTime() + TTL_MS);
  const releaseContext = {
    policyVersion:POLICY_VERSION,
    currentLevel:'L2',
    releasedL2LessonCodes:context.lessonCodes,
    releasedL3LessonCodes:[],
    inheritedLevels:[],
    portalAssignmentId:null,
    generatedAt:now.toISOString(),
    source:RELEASE_SOURCE,
    portalSessionIssuer:TOKEN_ISSUER,
    portalSessionKind:'session',
    portalSessionExpiresAt:new Date(context.session.exp * 1000).toISOString(),
    portalAccessModelVersion:clean(context.access?.version),
    portalGlobalModelVersion:clean(context.global?.version),
    portalViewId:L2_VIEW_ID,
    trialDemo:true
  };

  await env.DB.prepare(`
    INSERT INTO quiz_launch_codes(
      code_hash, portal_user_id_norm, portal_session_token_hash,
      release_context_json, created_at, expires_at, used_at
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
    ok:true,
    launchUrl:`${QUIZ_URL}launch?code=${encodeURIComponent(rawCode)}`,
    expiresAt:expires.toISOString()
  }), request, env);
}

export function createTrialQuizRuntime(nextRuntime) {
  if (!nextRuntime || typeof nextRuntime.fetch !== 'function') throw new TypeError('nextRuntime.fetch is required');
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const eligibilityRoute = url.pathname === '/api/v2/student/quiz/eligibility';
      const launchRoute = url.pathname === '/api/v2/student/quiz/launch';
      if (!eligibilityRoute && !launchRoute) return nextRuntime.fetch(request, env);
      if (request.method === 'OPTIONS') return preflight(request, env);
      try {
        if (eligibilityRoute && request.method === 'GET') {
          const response = await trialEligibility(request, env);
          return response || nextRuntime.fetch(request, env);
        }
        if (launchRoute && request.method === 'POST') {
          const response = await trialLaunch(request, env);
          return response || nextRuntime.fetch(request, env);
        }
      } catch {
        return applyCors(json({ ok:false, eligible:false, error:eligibilityRoute ? 'ELIGIBILITY_UNAVAILABLE' : 'LAUNCH_UNAVAILABLE' }, 503), request, env);
      }
      return nextRuntime.fetch(request, env);
    }
  };
}

export { TRIAL_11PLUS_VIEWS, has11PlusTrialAccess, fullL2LessonCodes };
