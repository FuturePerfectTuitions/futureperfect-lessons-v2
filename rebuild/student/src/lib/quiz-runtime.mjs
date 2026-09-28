import {
  AuthTokenError,
  TOKEN_ISSUER,
  sessionTokenFromCookie,
  verifySessionToken
} from '../../../shared/auth/auth-core.mjs';
import { opaqueAccessScopeId } from './access-scope.mjs';
import { kvReadStore, resolveCurrentScope, sha256Hex } from './read-model-resolver.mjs';

const QUIZ_URL = 'https://quiz.futureperfect.education/';
const VIEW_IDS = Object.freeze({ L2: 'maths-level2', L3: 'maths-level3' });
const POLICY_VERSION = 'quiz-release-context-v2.0';
const RELEASE_SOURCE = 'portal-live-maths11plus-release-v2';
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

async function activeMaths11plus(env, portalUserId, nowValue = Date.now()) {
  if (!env?.DB?.prepare) throw new Error('PORTAL_D1_UNAVAILABLE');
  const day = londonDate(nowValue);
  const result = await env.DB.prepare(`
    SELECT
      a.assignment_id,
      a.effective_from,
      (CASE
        WHEN b.maths_level BETWEEN 1 AND 3 THEN b.maths_level
        ELSE b.school_year - 3
      END) AS maths_level
    FROM student_batch_assignments a
    JOIN batch_definitions b ON b.batch_key = a.batch_key
    WHERE a.portal_user_id_norm = ?
      AND lower(b.subject) = 'maths'
      AND lower(b.stream) = '11plus'
      AND (CASE
        WHEN b.maths_level BETWEEN 1 AND 3 THEN b.maths_level
        ELSE b.school_year - 3
      END) IN (2,3)
      AND a.effective_from <= ?
      AND (a.effective_to IS NULL OR ? < a.effective_to)
      AND (b.active_from IS NULL OR b.active_from <= ?)
      AND (b.active_to IS NULL OR ? < b.active_to)
    ORDER BY a.effective_from DESC, a.assignment_id DESC
  `).bind(norm(portalUserId), day, day, day, day).all();

  const rows = Array.isArray(result?.results) ? result.results : [];
  if (!rows.length) return null;
  const levels = [...new Set(rows.map(row => Number(row?.maths_level)).filter(level => level === 2 || level === 3))];
  if (levels.length !== 1) throw new Error('AMBIGUOUS_MATHS_11PLUS_LEVEL');
  const portalAssignmentId = Number(rows[0]?.assignment_id);
  if (!Number.isSafeInteger(portalAssignmentId) || portalAssignmentId <= 0) {
    throw new Error('PORTAL_ASSIGNMENT_INVALID');
  }
  return { currentLevel: `L${levels[0]}`, portalAssignmentId };
}

function exactEligibleLevelView(snapshotValue, global, currentLevel) {
  const level = clean(currentLevel).toUpperCase();
  const viewId = VIEW_IDS[level];
  const mathsLevel = level === 'L2' ? 2 : level === 'L3' ? 3 : 0;
  if (!viewId || !mathsLevel) return null;
  const view = viewById(snapshotValue, viewId);
  const catalogue = global?.payload?.catalogues?.[viewId] || null;
  if (!view || !catalogue) return null;
  if (norm(view.subject) !== 'maths') return null;
  if (view.current !== true || norm(view.group) !== 'current') return null;
  if (view.lockedPreview === true || view.catalogueAvailable !== true) return null;
  if (norm(catalogue.subject) !== 'maths') return null;
  if (norm(catalogue.stream) !== '11plus') return null;
  if (Number(catalogue.mathsLevel) !== mathsLevel) return null;
  return { viewId, view, catalogue };
}

function releasedLessonCodes(snapshotValue, catalogue, currentLevel) {
  const level = clean(currentLevel).toUpperCase();
  const re = level === 'L2' ? /^L2T\d+M\d+$/i : level === 'L3' ? /^L3T\d+M\d+$/i : null;
  if (!re) return [];
  const out = [];
  for (const row of Array.isArray(catalogue?.lessons) ? catalogue.lessons : []) {
    const lessonId = clean(row?.lessonId);
    const state = snapshotValue?.lessonAccess?.[lessonId] || null;
    if (!state || state.blocked === true || state.core !== true || state.preLessonOnly === true) continue;
    const code = [row?.lessonId, row?.displayLessonId]
      .map(clean)
      .find(value => re.test(value));
    if (code) out.push(code.toUpperCase());
  }
  return [...new Set(out)].sort();
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

  const active = await activeMaths11plus(env, session.sub, nowValue);
  if (!active) return { eligible: false, reason: 'NO_ACTIVE_L2_L3_MATHS_ASSIGNMENT' };
  const levelView = exactEligibleLevelView(snapshotValue, global, active.currentLevel);
  if (!levelView) return { eligible: false, reason: 'CURRENT_LEVEL_ACCESS_UNVERIFIED' };

  return {
    eligible: true,
    session,
    token,
    access,
    global,
    currentLevel: active.currentLevel,
    portalAssignmentId: active.portalAssignmentId,
    levelView,
    lessonCodes: releasedLessonCodes(snapshotValue, levelView.catalogue, active.currentLevel)
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
      label: '11+ Practice',
      ...(context.eligible ? { currentLevel: context.currentLevel } : {})
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
      policyVersion: POLICY_VERSION,
      currentLevel: context.currentLevel,
      releasedL2LessonCodes: context.currentLevel === 'L2' ? context.lessonCodes : [],
      releasedL3LessonCodes: context.currentLevel === 'L3' ? context.lessonCodes : [],
      inheritedLevels: context.currentLevel === 'L3' ? ['L2'] : [],
      portalAssignmentId: context.portalAssignmentId,
      generatedAt: now.toISOString(),
      source: RELEASE_SOURCE,
      portalSessionIssuer: TOKEN_ISSUER,
      portalSessionKind: 'session',
      portalSessionExpiresAt: new Date(context.session.exp * 1000).toISOString(),
      portalAccessModelVersion: clean(context.access?.version),
      portalGlobalModelVersion: clean(context.global?.version),
      portalViewId: context.levelView.viewId
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
