import phase7Worker from './index-phase7.js';

const SESSION_COOKIE = 'fpt_v2_session';
const ANSWER_CONTENT_WINDOW_MS = 2 * 60 * 1000;
const ANSWER_VIEW_LEASE_MS = 30 * 60 * 1000;
const ANSWER_RATE_WINDOW_MS = 60 * 1000;
const ANSWER_RATE_MAX = 10;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

function allowedOrigins(env) {
  return new Set([
    'https://futureperfecttuitions.github.io',
    ...String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  ]);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'Content-Type',
    Vary: 'Origin'
  };
}

function browserOriginAllowed(request, env) {
  const origin = request.headers.get('Origin') || '';
  return Boolean(origin && allowedOrigins(env).has(origin));
}

function json(body, init = {}) {
  const headers = new Headers(init.headers || {});
  for (const [key, value] of Object.entries(JSON_HEADERS)) headers.set(key, value);
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { ...init, headers });
}

function jsonLike(response, body) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(JSON_HEADERS)) headers.set(key, value);
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { status: response.status, headers });
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

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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
  return (
    password.length === 4 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password)
  );
}

function normalisePortalUserId(value) {
  return String(value || '').trim().toLowerCase();
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

function makeResourceKey(lessonId, kind, index) {
  return `${encodeURIComponent(String(lessonId))}~${kind}~${index}`;
}

function parseResourceKey(resourceKey) {
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
  return { lessonId, kind, index };
}

function resolveOrdinaryAnswerResource(record, resourceKey) {
  const parsed = parseResourceKey(resourceKey);
  if (!parsed || String(record?.lessonId || '') !== parsed.lessonId) return null;

  const core = record?.core || {};
  const homeworks = Array.isArray(record?.homeworks)
    ? record.homeworks
    : (Array.isArray(core.homeworks) ? core.homeworks : []);
  const pair = homeworks[parsed.index - 1];
  const answerPack = pair?.answerPack || null;
  const r2Key = String(answerPack?.r2Key || answerPack?.r2 || '').trim();
  if (!r2Key) return null;

  return {
    resourceKey,
    lessonId: parsed.lessonId,
    kind: 'answer',
    displayName: String(answerPack.displayName || answerPack.name || 'Answer Pack').trim() || 'Answer Pack',
    r2Key,
    protected: true
  };
}

async function requestPhase7Json(request, env, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = '';
  const internalRequest = new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  });
  const response = await phase7Worker.fetch(internalRequest, env);
  let body = null;
  try {
    body = await response.json();
  } catch (_) {}
  return { response, body };
}

async function currentSessionSummary(request, env) {
  const { response, body } = await requestPhase7Json(request, env, '/api/v1/student/session');
  if (!response.ok || !body?.ok) {
    return { error: body?.error || 'SESSION_INVALID', status: response.status || 401 };
  }
  if (body.accountLocked) return { error: 'ACCOUNT_LOCKED', status: 403 };
  return {
    portalUserIdNorm: normalisePortalUserId(body.portalUserId),
    firstName: String(body.firstName || ''),
    idleExpiresAt: String(body.idleExpiresAt || '')
  };
}

async function noTouchSession(request, env) {
  const rawToken = parseCookies(request)[SESSION_COOKIE] || '';
  if (!rawToken) return { error: 'SESSION_INVALID', status: 401 };

  const sessionTokenHash = await sha256Hex(rawToken);
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
  const user = await env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type: 'json' });
  if (!user) return { error: 'SESSION_INVALID', status: 401 };
  if (accountLocked(user)) return { error: 'ACCOUNT_LOCKED', status: 403 };

  return { session, sessionTokenHash, portalUserIdNorm, user };
}

async function visibleLessonContext(request, env, viewId, lessonId) {
  if (!viewId) return { error: 'VIEW_REQUIRED', status: 400 };

  const path = `/api/v1/student/views/${encodeURIComponent(viewId)}/lessons`;
  const { response, body } = await requestPhase7Json(request, env, path);
  if (!response.ok || !body?.ok) {
    return { error: body?.error || 'LESSON_ACCESS_CHECK_FAILED', status: response.status || 500 };
  }

  const visible = (Array.isArray(body.lessons) ? body.lessons : [])
    .find(item => String(item?.lessonId || '') === String(lessonId));
  if (!visible) return { error: 'LESSON_NOT_VISIBLE', status: 404 };
  if (visible.locked) return { error: 'LESSON_LOCKED', status: 403 };

  const record = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
  if (!record || record.active === false) return { error: 'LESSON_NOT_FOUND', status: 404 };
  return { visible, record };
}

async function passwordFingerprint(sessionTokenHash, password) {
  return sha256Hex(`fpt-answer-password-v1\u0000${sessionTokenHash}\u0000${String(password)}`);
}

async function checkRateLimit(env, sessionTokenHash) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const row = await env.DB.prepare(
    `SELECT window_started_at, attempt_count
     FROM answer_password_rate_limits
     WHERE session_token_hash = ?`
  )
    .bind(sessionTokenHash)
    .first();

  const windowStartedMs = Date.parse(row?.window_started_at || '');
  const expiredWindow = !Number.isFinite(windowStartedMs) || now - windowStartedMs >= ANSWER_RATE_WINDOW_MS;

  if (!row || expiredWindow) {
    await env.DB.prepare(
      `INSERT INTO answer_password_rate_limits (session_token_hash, window_started_at, attempt_count)
       VALUES (?, ?, 1)
       ON CONFLICT(session_token_hash) DO UPDATE SET
         window_started_at = excluded.window_started_at,
         attempt_count = 1`
    )
      .bind(sessionTokenHash, nowIso)
      .run();
    return { allowed: true };
  }

  if (Number(row.attempt_count || 0) >= ANSWER_RATE_MAX) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((ANSWER_RATE_WINDOW_MS - (now - windowStartedMs)) / 1000)
    );
    return { allowed: false, retryAfterSeconds };
  }

  await env.DB.prepare(
    `UPDATE answer_password_rate_limits
     SET attempt_count = attempt_count + 1
     WHERE session_token_hash = ?`
  )
    .bind(sessionTokenHash)
    .run();
  return { allowed: true };
}

async function augmentLessonDetail(request, env) {
  const response = await phase7Worker.fetch(request, env);
  if (!response.ok) return response;

  let body = null;
  try {
    body = await response.json();
  } catch {
    return response;
  }
  if (!body?.ok || !body.lesson || body.lesson.locked) return jsonLike(response, body);

  const lessonId = String(body.lesson.lessonId || '').trim();
  if (!lessonId || !Array.isArray(body.lesson.homeworks)) return jsonLike(response, body);

  body.lesson.homeworks = body.lesson.homeworks.map((pair, index) => {
    const answerPack = pair?.answerPack;
    if (!answerPack?.protected || answerPack.available === false) return pair;
    return {
      ...pair,
      answerPack: {
        ...answerPack,
        resourceKey: makeResourceKey(lessonId, 'answer', index + 1),
        locked: false,
        protected: true,
        passwordRequired: true
      }
    };
  });

  return jsonLike(response, body);
}

async function handleAuthorize(request, env, resourceKey) {
  const cors = corsHeaders(request, env);
  if (!browserOriginAllowed(request, env)) {
    return json({ error: 'FORBIDDEN_ORIGIN' }, { status: 403, headers: cors });
  }

  const parsed = parseResourceKey(resourceKey);
  if (!parsed) return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });

  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  if (!viewId) return json({ error: 'VIEW_REQUIRED' }, { status: 400, headers: cors });

  const session = await currentSessionSummary(request, env);
  if (session.error) return json({ error: session.error }, { status: session.status, headers: cors });

  const rawSessionToken = parseCookies(request)[SESSION_COOKIE] || '';
  if (!rawSessionToken) return json({ error: 'SESSION_INVALID' }, { status: 401, headers: cors });
  const sessionTokenHash = await sha256Hex(rawSessionToken);

  const rate = await checkRateLimit(env, sessionTokenHash);
  if (!rate.allowed) {
    const headers = new Headers(cors);
    headers.set('Retry-After', String(rate.retryAfterSeconds));
    return json({ error: 'TOO_MANY_ATTEMPTS' }, { status: 429, headers });
  }

  const context = await visibleLessonContext(request, env, viewId, parsed.lessonId);
  if (context.error) return json({ error: context.error }, { status: context.status, headers: cors });

  const resource = resolveOrdinaryAnswerResource(context.record, resourceKey);
  if (!resource) return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });

  const exists = await env.MATERIALS_R2.head(resource.r2Key);
  if (!exists) return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });

  let body = null;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'INVALID_REQUEST' }, { status: 400, headers: cors });
  }

  const suppliedPassword = String(body?.password || '');
  const user = await env.STUDENTS_KV.get(`user:${session.portalUserIdNorm}`, { type: 'json' });
  const currentPassword = String(user?.answerPassword || '');
  if (!user || accountLocked(user) || !validFourCharacterPassword(currentPassword)) {
    return json({ error: 'ANSWER_PASSWORD_UNAVAILABLE' }, { status: 403, headers: cors });
  }

  const matches = validFourCharacterPassword(suppliedPassword)
    ? await timingSafeStringEqual(suppliedPassword, currentPassword)
    : false;
  if (!matches) {
    return json({ error: 'ANSWER_PASSWORD_INCORRECT' }, { status: 403, headers: cors });
  }

  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = base64Url(tokenBytes);
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const contentExpiresAt = new Date(now.getTime() + ANSWER_CONTENT_WINDOW_MS);
  const leaseExpiresAt = new Date(now.getTime() + ANSWER_VIEW_LEASE_MS);
  const fingerprint = await passwordFingerprint(sessionTokenHash, currentPassword);

  await env.DB.prepare(
    `DELETE FROM answer_view_tokens WHERE lease_expires_at <= ?`
  )
    .bind(now.toISOString())
    .run();

  await env.DB.prepare(
    `INSERT INTO answer_view_tokens (
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
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  )
    .bind(
      tokenHash,
      sessionTokenHash,
      session.portalUserIdNorm,
      parsed.lessonId,
      resourceKey,
      viewId,
      fingerprint,
      now.toISOString(),
      contentExpiresAt.toISOString(),
      leaseExpiresAt.toISOString()
    )
    .run();

  return json(
    {
      ok: true,
      token,
      viewerPath: `/api/v1/student/answer-view/${encodeURIComponent(token)}`,
      contentExpiresAt: contentExpiresAt.toISOString(),
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      watermark: `${session.portalUserIdNorm} — Future Perfect Tuitions`,
      displayName: resource.displayName
    },
    { status: 200, headers: cors }
  );
}

async function loadAnswerToken(env, token) {
  if (!token) return null;
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
  return row ? { ...row, tokenHash } : null;
}

async function validateAnswerLease(request, env, tokenRow) {
  if (!tokenRow) return { error: 'ANSWER_VIEW_INVALID', status: 410 };
  const leaseExpiresMs = Date.parse(tokenRow.lease_expires_at || '');
  if (!Number.isFinite(leaseExpiresMs) || Date.now() >= leaseExpiresMs) {
    return { error: 'ANSWER_VIEW_EXPIRED', status: 410 };
  }

  const auth = await noTouchSession(request, env);
  if (auth.error) return auth;
  if (
    auth.sessionTokenHash !== tokenRow.session_token_hash ||
    auth.portalUserIdNorm !== normalisePortalUserId(tokenRow.portal_user_id_norm)
  ) {
    return { error: 'ANSWER_VIEW_INVALID', status: 410 };
  }

  const currentPassword = String(auth.user?.answerPassword || '');
  if (!validFourCharacterPassword(currentPassword)) {
    return { error: 'ANSWER_VIEW_INVALID', status: 410 };
  }
  const fingerprint = await passwordFingerprint(auth.sessionTokenHash, currentPassword);
  if (!(await timingSafeStringEqual(fingerprint, String(tokenRow.password_fingerprint || '')))) {
    return { error: 'ANSWER_VIEW_INVALID', status: 410 };
  }

  return { auth };
}

async function handleAnswerViewStatus(request, env, tokenRow) {
  const cors = corsHeaders(request, env);
  const lease = await validateAnswerLease(request, env, tokenRow);
  if (lease.error) return json({ error: lease.error }, { status: lease.status, headers: cors });
  if (!tokenRow.used_at) {
    return json({ error: 'ANSWER_VIEW_NOT_OPEN' }, { status: 409, headers: cors });
  }
  return json({ ok: true, leaseExpiresAt: tokenRow.lease_expires_at }, { status: 200, headers: cors });
}

async function handleAnswerView(request, env, token) {
  const cors = corsHeaders(request, env);
  if (!browserOriginAllowed(request, env)) {
    return json({ error: 'FORBIDDEN_ORIGIN' }, { status: 403, headers: cors });
  }

  const tokenRow = await loadAnswerToken(env, token);
  const url = new URL(request.url);
  if (url.searchParams.get('status') === '1') {
    return handleAnswerViewStatus(request, env, tokenRow);
  }

  const lease = await validateAnswerLease(request, env, tokenRow);
  if (lease.error) return json({ error: lease.error }, { status: lease.status, headers: cors });
  if (tokenRow.used_at) {
    return json({ error: 'ANSWER_VIEW_ALREADY_OPENED' }, { status: 410, headers: cors });
  }

  const contentExpiresMs = Date.parse(tokenRow.content_expires_at || '');
  if (!Number.isFinite(contentExpiresMs) || Date.now() >= contentExpiresMs) {
    return json({ error: 'ANSWER_VIEW_EXPIRED' }, { status: 410, headers: cors });
  }

  const context = await visibleLessonContext(
    request,
    env,
    String(tokenRow.view_id || ''),
    String(tokenRow.lesson_id || '')
  );
  if (context.error) return json({ error: context.error }, { status: context.status, headers: cors });

  const resource = resolveOrdinaryAnswerResource(context.record, String(tokenRow.resource_key || ''));
  if (!resource) return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });

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
    return json({ error: 'ANSWER_VIEW_ALREADY_OPENED' }, { status: 410, headers: cors });
  }

  const object = await env.MATERIALS_R2.get(resource.r2Key);
  if (!object || !object.body) {
    return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }

  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('content-type', headers.get('content-type') || 'application/pdf');
  headers.set('content-disposition', 'inline');
  headers.set('cache-control', 'private, no-store, max-age=0');
  headers.set('pragma', 'no-cache');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.body, { status: 200, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return phase7Worker.fetch(request, env, ctx);

    const lessonMatch = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
    if (lessonMatch && request.method === 'GET') {
      return augmentLessonDetail(request, env);
    }

    const authorizeMatch = url.pathname.match(
      /^\/api\/v1\/student\/resources\/([^/]+)\/answer\/authorize$/
    );
    if (authorizeMatch && request.method === 'POST') {
      return handleAuthorize(request, env, decodeURIComponent(authorizeMatch[1]));
    }

    const answerViewMatch = url.pathname.match(/^\/api\/v1\/student\/answer-view\/([^/]+)$/);
    if (answerViewMatch && request.method === 'GET') {
      return handleAnswerView(request, env, decodeURIComponent(answerViewMatch[1]));
    }

    return phase7Worker.fetch(request, env, ctx);
  }
};
