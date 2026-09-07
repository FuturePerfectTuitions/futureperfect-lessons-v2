import phase20Worker from './index-phase20-change7.js';
import { buildPreview } from './phase21-admin-import-preview.js';
import { confirmImport, timingSafeTextEqual } from './phase21-admin-import-confirm.js';
import { clean } from './phase21-admin-import-core.js';

const ADMIN_PREFIX = '/api/v1/admin/lesson-releases';
const ADMIN_SCOPE = 'lesson-release-import';
const ADMIN_SESSION_TTL_SECONDS = 20 * 60;

function allowedOrigins(env) {
  return new Set([
    'https://futureperfecttuitions.github.io',
    ...String(env?.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
  ]);
}

function adminCorsHeaders(request, env) {
  const origin = String(request.headers.get('Origin') || '');
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,Accept',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  };
}

function json(body, init = {}, request = null, env = null) {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  if (request && env) {
    for (const [key, value] of Object.entries(adminCorsHeaders(request, env))) headers.set(key, value);
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

function allowedAdminOrigin(request, env) {
  const origin = String(request.headers.get('Origin') || '');
  return Boolean(origin && allowedOrigins(env).has(origin));
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

function textToBase64Url(value) {
  return bytesToBase64Url(new TextEncoder().encode(String(value)));
}

function base64UrlToText(value) {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

async function adminHmacKey(sessionSecret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(sessionSecret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signAdminSession(sessionSecret, origin) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    scope: ADMIN_SCOPE,
    origin,
    iat: now,
    exp: now + ADMIN_SESSION_TTL_SECONDS,
    nonce: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)))
  };
  const encoded = textToBase64Url(JSON.stringify(payload));
  const key = await adminHmacKey(sessionSecret);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded)));
  return { token: `${encoded}.${bytesToBase64Url(signature)}`, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

async function verifyAdminSession(token, sessionSecret, origin) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return false;
  let payload;
  try { payload = JSON.parse(base64UrlToText(parts[0])); } catch { return false; }
  const now = Math.floor(Date.now() / 1000);
  if (payload?.v !== 1 || payload?.scope !== ADMIN_SCOPE || payload?.origin !== origin) return false;
  if (!Number.isFinite(payload?.iat) || !Number.isFinite(payload?.exp)) return false;
  if (payload.iat > now + 60 || payload.exp <= now || payload.exp - payload.iat !== ADMIN_SESSION_TTL_SECONDS) return false;
  try {
    const key = await adminHmacKey(sessionSecret);
    return await crypto.subtle.verify('HMAC', key, base64UrlToBytes(parts[1]), new TextEncoder().encode(parts[0]));
  } catch {
    return false;
  }
}

function bearerToken(request) {
  const match = String(request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function adminConfiguration(env) {
  const password = String(env?.ADMIN_IMPORT_PASSWORD || '');
  const sessionSecret = String(env?.ADMIN_IMPORT_SESSION_SECRET || '');
  return {
    password,
    sessionSecret,
    configured: password.length >= 16 && sessionSecret.length >= 32
  };
}

async function requireAdmin(request, env) {
  const config = adminConfiguration(env);
  if (!config.configured) return { error: 'ADMIN_IMPORT_NOT_CONFIGURED', status: 503 };
  const token = bearerToken(request);
  const origin = String(request.headers.get('Origin') || '');
  if (!token || !(await verifyAdminSession(token, config.sessionSecret, origin))) {
    return { error: 'ADMIN_SESSION_INVALID', status: 401 };
  }
  return { ok: true };
}

async function requestJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function handleLogin(request, env) {
  const config = adminConfiguration(env);
  if (!config.configured) {
    return json({ ok: false, error: 'ADMIN_IMPORT_NOT_CONFIGURED' }, { status: 503 }, request, env);
  }
  const body = await requestJson(request);
  const supplied = String(body?.password || '');
  if (!supplied || !(await timingSafeTextEqual(supplied, config.password))) {
    return json({ ok: false, error: 'ADMIN_LOGIN_FAILED' }, { status: 401 }, request, env);
  }
  const origin = String(request.headers.get('Origin') || '');
  return json({ ok: true, ...(await signAdminSession(config.sessionSecret, origin)) }, { status: 200 }, request, env);
}

async function handlePreview(request, env) {
  const body = await requestJson(request);
  if (typeof body?.csv !== 'string') {
    return json({ ok: false, error: 'CSV_REQUIRED' }, { status: 400 }, request, env);
  }
  const preview = await buildPreview(env, body.csv, body.filename);
  if (preview.error) {
    return json({ ok: false, error: preview.error, message: preview.message }, { status: 400 }, request, env);
  }
  return json({
    ok: true,
    filename: preview.filename,
    digest: preview.digest,
    rows: preview.publicRows,
    summary: preview.summary
  }, { status: 200 }, request, env);
}

async function handleConfirm(request, env) {
  const body = await requestJson(request);
  if (typeof body?.csv !== 'string' || !clean(body?.digest)) {
    return json({ ok: false, error: 'CSV_AND_PREVIEW_DIGEST_REQUIRED' }, { status: 400 }, request, env);
  }
  const result = await confirmImport(env, body.csv, body.digest, body.filename);
  if (result.error) {
    return json({ ok: false, error: result.error, message: result.message }, { status: result.status || 400 }, request, env);
  }
  return json(result, { status: 200 }, request, env);
}

export { ADMIN_PREFIX, adminConfiguration, signAdminSession, verifyAdminSession };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(ADMIN_PREFIX)) return phase20Worker.fetch(request, env, ctx);

    if (request.method === 'OPTIONS') {
      if (!allowedAdminOrigin(request, env)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: adminCorsHeaders(request, env) });
    }
    if (!allowedAdminOrigin(request, env)) {
      return json({ ok: false, error: 'FORBIDDEN_ORIGIN' }, { status: 403 });
    }
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405 }, request, env);
    }
    if (url.pathname === `${ADMIN_PREFIX}/login`) return handleLogin(request, env);

    const auth = await requireAdmin(request, env);
    if (!auth.ok) return json({ ok: false, error: auth.error }, { status: auth.status }, request, env);
    if (url.pathname === `${ADMIN_PREFIX}/preview`) return handlePreview(request, env);
    if (url.pathname === `${ADMIN_PREFIX}/confirm`) return handleConfirm(request, env);
    return json({ ok: false, error: 'NOT_FOUND' }, { status: 404 }, request, env);
  }
};
