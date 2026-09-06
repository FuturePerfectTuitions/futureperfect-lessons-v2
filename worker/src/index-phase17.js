import phase13Worker from './index-phase13.js';

function json(body, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { ...init, headers });
}

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
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,Accept',
    'Access-Control-Max-Age': '600'
  };
}

function normalisePortalUserId(value) {
  return String(value || '').trim().toLowerCase();
}

function productionLoginAllowlist(env) {
  return new Set(
    String(env.PROD_LOGIN_ALLOWLIST || '')
      .split(',')
      .map(normalisePortalUserId)
      .filter(Boolean)
  );
}

async function productionLoginGuard(request, env, url) {
  if (String(env.ENVIRONMENT || 'development').trim().toLowerCase() === 'development') return null;
  if (request.method !== 'POST' || url.pathname !== '/api/v1/student/auth/login') return null;
  if (String(env.STUDENT_LOGIN_ENABLED || '').trim().toLowerCase() !== 'true') return null;

  let body = null;
  try {
    body = await request.clone().json();
  } catch {
    return null;
  }

  const portalUserIdNorm = normalisePortalUserId(body?.username);
  const allowlist = productionLoginAllowlist(env);
  if (portalUserIdNorm && allowlist.has(portalUserIdNorm)) return null;

  return json(
    { error: 'INVALID_LOGIN' },
    { status: 401, headers: corsHeaders(request, env) }
  );
}

function explicitScreenPalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (!['screenpal.com', 'www.screenpal.com', 'go.screenpal.com'].includes(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parseSpecialResourceKey(resourceKey) {
  const parts = String(resourceKey || '').split('~');
  if (parts.length !== 3 || parts[0] !== 'special') return null;
  try {
    return {
      bucketId: decodeURIComponent(parts[1]),
      itemId: decodeURIComponent(parts[2])
    };
  } catch {
    return null;
  }
}

async function requireExplicitSpecialVideoMetadata(request, env, response, resourceKey) {
  if (!response.ok) return response;

  const parsed = parseSpecialResourceKey(resourceKey);
  if (!parsed || parsed.bucketId === 'MOCKS') return response;

  let body;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  if (!body?.ok || !body?.embedUrl) return response;

  const catalogue = await env.LESSONS_KV.get(`special:${parsed.bucketId}`, { type: 'json' });
  const items = Array.isArray(catalogue?.items) ? catalogue.items : [];
  const item = items.find(candidate => String(candidate?.id || '').trim() === parsed.itemId);
  const explicit = explicitScreenPalUrl(item?.video?.embedUrl);

  if (!item || item?.type === 'separator' || !explicit || explicit !== String(body.embedUrl)) {
    return json(
      { error: 'SPECIAL_RESOURCE_NOT_FOUND' },
      { status: 404, headers: response.headers }
    );
  }

  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const loginGuard = await productionLoginGuard(request, env, url);
    if (loginGuard) return loginGuard;

    const specialVideo = url.pathname.match(/^\/api\/v1\/student\/special-resources\/([^/]+)\/video$/);
    const response = await phase13Worker.fetch(request, env);

    if (request.method === 'GET' && specialVideo) {
      return requireExplicitSpecialVideoMetadata(
        request,
        env,
        response,
        decodeURIComponent(specialVideo[1])
      );
    }

    return response;
  }
};
