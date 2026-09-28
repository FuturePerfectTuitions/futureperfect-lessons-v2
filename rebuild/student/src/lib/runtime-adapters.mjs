import { timingSafeEqualText } from '../../../shared/auth/auth-core.mjs';
import { sha256Hex } from './read-model-resolver.mjs';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const ANSWER_RATE_WINDOW_MS = 60 * 1000;
const ANSWER_RATE_MAX_FAILURES = 10;
const SCREENPAL_HOSTS = new Set(['screenpal.com', 'www.screenpal.com', 'go.screenpal.com']);

function validFourCharacterPassword(value) {
  const password = String(value || '');
  return password.length === 4 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password);
}

function isDevelopment(env) {
  return norm(env?.ENVIRONMENT || 'development') === 'development';
}

function developmentAllowlist(env) {
  return new Set(String(env?.DEV_LOGIN_ALLOWLIST || '').split(',').map(norm).filter(Boolean));
}

function loginPermittedForUser(env, userId) {
  if (isDevelopment(env)) return developmentAllowlist(env).has(norm(userId));
  return norm(env?.STUDENT_LOGIN_ENABLED) === 'true';
}

function londonToday(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(now));
}

function accountLocked(user, now = Date.now()) {
  const status = norm(user?.status || 'active');
  const expires = clean(user?.expires);
  const expired = /^\d{4}-\d{2}-\d{2}$/.test(expires) ? londonToday(now) > expires : false;
  return status !== 'active' || expired;
}

async function currentUser(env, userId) {
  if (!env?.STUDENTS_KV || typeof env.STUDENTS_KV.get !== 'function') throw new Error('STUDENT_STORE_UNAVAILABLE');
  const user = await env.STUDENTS_KV.get(`user:${norm(userId)}`, { type: 'json' });
  return user && typeof user === 'object' ? user : null;
}

function requireRateDb(env) {
  if (!env?.DB || typeof env.DB.prepare !== 'function') throw new Error('ANSWER_RATE_STORE_UNAVAILABLE');
  return env.DB;
}

async function answerRateKey(sessionId) {
  if (!clean(sessionId)) throw new Error('ANSWER_RATE_SESSION_REQUIRED');
  return sha256Hex(`fpt-cp6-answer-rate-v1\u0000${clean(sessionId)}`);
}

async function readRateRow(env, key) {
  return requireRateDb(env).prepare(
    `SELECT window_started_at, attempt_count
     FROM answer_password_rate_limits
     WHERE session_token_hash = ?`
  ).bind(key).first();
}

function rateState(row, nowMs) {
  const startedMs = Date.parse(row?.window_started_at || '');
  const active = Boolean(row) && Number.isFinite(startedMs) && nowMs - startedMs < ANSWER_RATE_WINDOW_MS;
  const count = active ? Math.max(0, Number(row?.attempt_count || 0)) : 0;
  return { active, startedMs, count };
}

function safeScreenPalTarget(value) {
  try {
    const url = new URL(clean(value));
    if (url.protocol !== 'https:' || !SCREENPAL_HOSTS.has(url.hostname.toLowerCase())) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function jsonError(error, status) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
  });
}

export function environmentAdapters(env, options = {}) {
  const now = () => typeof options.now === 'function' ? Number(options.now()) : Date.now();
  return {
    async authenticateCredentials({ username, password }) {
      const userId = norm(username);
      if (!userId || !validFourCharacterPassword(password) || !loginPermittedForUser(env, userId)) return { ok: false };
      const user = await currentUser(env, userId);
      if (!user || !validFourCharacterPassword(user?.p)) return { ok: false };
      const valid = await timingSafeEqualText(String(password), String(user.p));
      return valid ? { ok: true, userId } : { ok: false };
    },

    async checkRateLimit({ sessionId }) {
      const nowMs = now();
      const key = await answerRateKey(sessionId);
      const state = rateState(await readRateRow(env, key), nowMs);
      if (!state.active || state.count < ANSWER_RATE_MAX_FAILURES) return { allowed: true };
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((ANSWER_RATE_WINDOW_MS - (nowMs - state.startedMs)) / 1000))
      };
    },

    async validateCurrentPassword({ userId, password }) {
      const user = await currentUser(env, userId);
      if (!user || accountLocked(user, now())) return false;
      const currentPassword = String(user?.answerPassword || '');
      if (!validFourCharacterPassword(currentPassword) || !validFourCharacterPassword(password)) return false;
      return timingSafeEqualText(String(password), currentPassword);
    },

    async recordFailedAttempt({ sessionId }) {
      const nowMs = now();
      const nowIso = new Date(nowMs).toISOString();
      const key = await answerRateKey(sessionId);
      const state = rateState(await readRateRow(env, key), nowMs);
      if (!state.active) {
        await requireRateDb(env).prepare(
          `INSERT INTO answer_password_rate_limits (session_token_hash, window_started_at, attempt_count)
           VALUES (?, ?, 1)
           ON CONFLICT(session_token_hash) DO UPDATE SET
             window_started_at = excluded.window_started_at,
             attempt_count = 1`
        ).bind(key, nowIso).run();
        return;
      }
      await requireRateDb(env).prepare(
        `UPDATE answer_password_rate_limits
         SET attempt_count = attempt_count + 1
         WHERE session_token_hash = ?`
      ).bind(key).run();
    },

    async clearFailedAttempts({ sessionId }) {
      const key = await answerRateKey(sessionId);
      await requireRateDb(env).prepare(
        `DELETE FROM answer_password_rate_limits WHERE session_token_hash = ?`
      ).bind(key).run();
    },

    async deliverResource({ resource, answerPack }) {
      if (!env?.MATERIALS_R2 || typeof env.MATERIALS_R2.get !== 'function') return jsonError('RESOURCE_STORE_UNAVAILABLE', 503);
      const object = await env.MATERIALS_R2.get(resource.objectKey);
      if (!object?.body) return jsonError('RESOURCE_NOT_FOUND', 404);
      const headers = new Headers();
      if (typeof object.writeHttpMetadata === 'function') object.writeHttpMetadata(headers);
      if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
      headers.set('cache-control', 'private, no-store');
      headers.set('x-content-type-options', 'nosniff');
      const safeName = clean(resource.displayName).replace(/[\r\n"\\/]+/g, '-').slice(0, 120) || 'resource';
      headers.set('content-disposition', `${answerPack ? 'inline' : 'attachment'}; filename="${safeName}"`);
      if (answerPack) headers.set('content-security-policy', "default-src 'none'; frame-ancestors 'self'");
      return new Response(object.body, { status: 200, headers });
    },

    async deliverVideo({ resource }) {
      const target = safeScreenPalTarget(resource?.targetUrl);
      if (!target) return jsonError('VIDEO_TARGET_INVALID', 503);
      return new Response(null, {
        status: 302,
        headers: { location: target, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
      });
    }
  };
}

export {
  ANSWER_RATE_MAX_FAILURES,
  ANSWER_RATE_WINDOW_MS,
  accountLocked,
  loginPermittedForUser,
  safeScreenPalTarget,
  validFourCharacterPassword
};
