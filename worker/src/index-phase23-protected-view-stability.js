import currentWorker from './index-phase20-change20-configured-upsell.js';
import { classifyPhase11AnswerIndex, phase11AnswerResource } from './phase11-resources.js';

const PROTECTED_VIEW_STABILITY_VERSION = 'phase23-protected-view-stability-v3';
const SESSION_COOKIE = 'fpt_v2_session';

function clean(value) {
  return String(value ?? '').trim();
}

function normalisePortalUserId(value) {
  return clean(value).toLowerCase();
}

function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function allowedOrigins(env) {
  return new Set([
    'https://futureperfecttuitions.github.io',
    ...String(env?.ALLOWED_ORIGINS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  ]);
}

function browserOriginAllowed(request, env) {
  const origin = request.headers.get('Origin') || '';
  return Boolean(origin && allowedOrigins(env).has(origin));
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'Content-Type, X-FPT-Protected-View-Stability, X-FPT-Protected-View-Stage',
    Vary: 'Origin'
  };
}

function json(request, env, body, status) {
  const headers = new Headers(corsHeaders(request, env));
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-fpt-protected-view-stability', PROTECTED_VIEW_STABILITY_VERSION);
  return new Response(JSON.stringify(body), { status, headers });
}

async function sha256Bytes(value) {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)))
  );
}

async function sha256Hex(value) {
  const bytes = await sha256Bytes(value);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function timingSafeStringEqual(left, right) {
  const [a, b] = await Promise.all([sha256Bytes(left), sha256Bytes(right)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function validFourCharacterPassword(value) {
  const password = String(value || '');
  return password.length === 4 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password);
}

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function accountLocked(user) {
  const status = String(user?.status || 'active').trim().toLowerCase();
  const expires = String(user?.expires || '').trim();
  const expired = /^\d{4}-\d{2}-\d{2}$/.test(expires) ? londonToday() > expires : false;
  return status !== 'active' || expired;
}

async function passwordFingerprint(sessionTokenHash, password) {
  return sha256Hex(`fpt-answer-password-v1\u0000${sessionTokenHash}\u0000${String(password)}`);
}

function parseAnswerResourceKey(resourceKey) {
  const parts = String(resourceKey || '').split('~');
  if (parts.length !== 3) return null;
  let lessonId = '';
  try {
    lessonId = decodeURIComponent(parts[0]);
  } catch {
    return null;
  }
  const kind = String(parts[1] || '');
  const index = Number(parts[2]);
  if (!lessonId || kind !== 'answer' || !Number.isInteger(index) || index < 1) return null;
  return { lessonId, index };
}

function ordinaryAnswerResource(record, index) {
  const core = record?.core || {};
  const homeworks = Array.isArray(record?.homeworks)
    ? record.homeworks
    : (Array.isArray(core?.homeworks) ? core.homeworks : []);
  const pair = homeworks[index - 1];
  const answerPack = pair?.answerPack || null;
  const r2Key = clean(answerPack?.r2Key || answerPack?.r2);
  if (!r2Key) return null;
  return {
    displayName: clean(answerPack?.displayName || answerPack?.name) || 'Answer Pack',
    r2Key
  };
}

function answerResource(record, resourceKey) {
  const parsed = parseAnswerResourceKey(resourceKey);
  if (!parsed || clean(record?.lessonId) !== parsed.lessonId) return null;

  if (classifyPhase11AnswerIndex(parsed.index)) {
    const resource = phase11AnswerResource(record, parsed.index);
    return resource?.r2Key ? resource : null;
  }
  return ordinaryAnswerResource(record, parsed.index);
}

async function loadTokenRow(env, token) {
  if (!env?.DB || !token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT
       token_hash,
       session_token_hash,
       portal_user_id_norm,
       lesson_id,
       resource_key,
       view_id,
       password_fingerprint,
       created_at,
       content_expires_at,
       lease_expires_at,
       used_at
     FROM answer_view_tokens
     WHERE token_hash = ?`
  )
    .bind(tokenHash)
    .first();
  return row || null;
}

async function validateTokenSession(request, env, tokenRow) {
  if (!tokenRow) return { error: 'ANSWER_VIEW_INVALID', status: 410 };

  const leaseExpiresMs = Date.parse(tokenRow.lease_expires_at || '');
  if (!Number.isFinite(leaseExpiresMs) || Date.now() >= leaseExpiresMs) {
    return { error: 'ANSWER_VIEW_EXPIRED', status: 410 };
  }

  const rawSessionToken = parseCookies(request)[SESSION_COOKIE] || '';
  if (!rawSessionToken) return { error: 'SESSION_INVALID', status: 401 };
  const sessionTokenHash = await sha256Hex(rawSessionToken);
  if (sessionTokenHash !== String(tokenRow.session_token_hash || '')) {
    return { error: 'ANSWER_VIEW_INVALID', status: 410 };
  }

  const session = await env.DB.prepare(
    `SELECT token_hash, portal_user_id_norm, idle_expires_at, revoked_at
     FROM student_sessions
     WHERE token_hash = ?`
  )
    .bind(sessionTokenHash)
    .first();
  if (!session || session.revoked_at) return { error: 'SESSION_INVALID', status: 401 };

  const idleExpiresMs = Date.parse(session.idle_expires_at || '');
  if (!Number.isFinite(idleExpiresMs) || Date.now() >= idleExpiresMs) {
    return { error: 'SESSION_EXPIRED', status: 401 };
  }

  const portalUserIdNorm = normalisePortalUserId(session.portal_user_id_norm);
  if (!portalUserIdNorm || portalUserIdNorm !== normalisePortalUserId(tokenRow.portal_user_id_norm)) {
    return { error: 'ANSWER_VIEW_INVALID', status: 410 };
  }

  const user = await env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type: 'json' });
  if (!user || accountLocked(user)) return { error: 'ACCOUNT_LOCKED', status: 403 };

  const currentPassword = String(user?.answerPassword || '');
  if (!validFourCharacterPassword(currentPassword)) {
    return { error: 'ANSWER_VIEW_INVALID', status: 410 };
  }
  const fingerprint = await passwordFingerprint(sessionTokenHash, currentPassword);
  if (!(await timingSafeStringEqual(fingerprint, String(tokenRow.password_fingerprint || '')))) {
    return { error: 'ANSWER_VIEW_INVALID', status: 410 };
  }

  return { sessionTokenHash, portalUserIdNorm };
}

async function protectedAnswerStatus(request, env, tokenRow) {
  const validation = await validateTokenSession(request, env, tokenRow);
  if (validation.error) return json(request, env, { error: validation.error }, validation.status);
  if (!tokenRow.used_at) return json(request, env, { error: 'ANSWER_VIEW_NOT_OPEN' }, 409);
  return json(request, env, { ok: true, leaseExpiresAt: tokenRow.lease_expires_at }, 200);
}

async function protectedAnswerPdf(request, env, tokenRow) {
  const validation = await validateTokenSession(request, env, tokenRow);
  if (validation.error) return json(request, env, { error: validation.error }, validation.status);
  if (tokenRow.used_at) return json(request, env, { error: 'ANSWER_VIEW_ALREADY_OPENED' }, 410);

  const contentExpiresMs = Date.parse(tokenRow.content_expires_at || '');
  if (!Number.isFinite(contentExpiresMs) || Date.now() >= contentExpiresMs) {
    return json(request, env, { error: 'ANSWER_VIEW_EXPIRED' }, 410);
  }

  const lessonId = clean(tokenRow.lesson_id);
  const record = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
  if (!record || record.active === false) {
    return json(request, env, { error: 'LESSON_NOT_FOUND' }, 404);
  }

  const resource = answerResource(record, String(tokenRow.resource_key || ''));
  if (!resource?.r2Key) return json(request, env, { error: 'RESOURCE_NOT_FOUND' }, 404);

  // The token exists only because the immediately preceding password-authorize
  // request already passed the live lesson/view entitlement gate. Do not perform
  // a second, differently-routed visibility check between password acceptance and
  // PDF delivery: that duplicated check is what broke L1/L2/L3 and Phase 11
  // cumulative/homework Answer Packs. Security remains bound to the same student
  // session, account, current Answer Pack password fingerprint, token lease and
  // exact resource key.
  const object = await env.MATERIALS_R2.get(resource.r2Key);
  if (!object?.body) return json(request, env, { error: 'RESOURCE_NOT_FOUND' }, 404);

  const usedAt = new Date().toISOString();
  const claim = await env.DB.prepare(
    `UPDATE answer_view_tokens
     SET used_at = ?
     WHERE token_hash = ?
       AND used_at IS NULL
       AND content_expires_at > ?
       AND lease_expires_at > ?`
  )
    .bind(usedAt, tokenRow.token_hash, usedAt, usedAt)
    .run();

  if (Number(claim?.meta?.changes || 0) !== 1) {
    return json(request, env, { error: 'ANSWER_VIEW_ALREADY_OPENED' }, 410);
  }

  const headers = new Headers(corsHeaders(request, env));
  object.writeHttpMetadata(headers);
  headers.set('content-type', headers.get('content-type') || 'application/pdf');
  headers.set('content-disposition', 'inline');
  headers.set('cache-control', 'private, no-store, max-age=0');
  headers.set('pragma', 'no-cache');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-fpt-protected-view-stability', PROTECTED_VIEW_STABILITY_VERSION);
  headers.set('x-fpt-protected-view-stage', 'direct-token-delivery');
  return new Response(object.body, { status: 200, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = request.method === 'GET'
      ? url.pathname.match(/^\/api\/v1\/student\/answer-view\/([^/]+)$/)
      : null;

    if (!match) return currentWorker.fetch(request, env, ctx);

    if (!browserOriginAllowed(request, env)) {
      return json(request, env, { error: 'FORBIDDEN_ORIGIN' }, 403);
    }

    let token = '';
    try {
      token = decodeURIComponent(match[1]);
    } catch {
      return json(request, env, { error: 'ANSWER_VIEW_INVALID' }, 410);
    }

    try {
      const tokenRow = await loadTokenRow(env, token);
      if (url.searchParams.get('status') === '1') {
        return protectedAnswerStatus(request, env, tokenRow);
      }
      return protectedAnswerPdf(request, env, tokenRow);
    } catch (error) {
      const response = json(request, env, {
        error: 'ANSWER_VIEW_DELIVERY_FAILED',
        message: String(error?.message || 'Unable to deliver protected answer.')
      }, 500);
      const headers = new Headers(response.headers);
      headers.set('x-fpt-protected-view-stage', 'direct-token-delivery-error');
      return new Response(response.body, { status: response.status, headers });
    }
  }
};
