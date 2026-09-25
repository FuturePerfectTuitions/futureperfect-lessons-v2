const LOOKUP_PATH = '/api/v1/admin/students/lookup';
const SESSION_SCOPE = 'lesson-release-import';
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function allowedOrigin(origin, env) {
  const configured = clean(env?.ALLOWED_ORIGINS)
    .split(',').map(value => value.trim()).filter(Boolean);
  return !origin || configured.includes(origin) || origin === 'https://futureperfecttuitions.github.io';
}

function json(body, status = 200, request = null, env = null) {
  const headers = new Headers({
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'pragma':'no-cache'
  });
  const origin = request?.headers?.get('Origin') || '';
  if (origin && allowedOrigin(origin, env)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Headers', 'content-type, authorization');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function base64UrlToText(value) {
  const base64 = value.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4 - value.length % 4) % 4);
  return atob(base64);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name:'HMAC', hash:'SHA-256' },
    false,
    ['sign']
  );
  return bytesToBase64Url(new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))
  ));
}

async function timingSafeTextEqual(a, b) {
  const aa = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i += 1) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function adminSessionAuthorised(request, env) {
  const match = clean(request.headers.get('Authorization')).match(/^Bearer\s+(.+)$/i);
  if (!match || !env?.ADMIN_IMPORT_SESSION_SECRET) return false;
  const parts = match[1].split('.');
  if (parts.length !== 2) return false;
  const expected = await hmac(String(env.ADMIN_IMPORT_SESSION_SECRET), parts[0]);
  if (!(await timingSafeTextEqual(parts[1], expected))) return false;
  try {
    const payload = JSON.parse(base64UrlToText(parts[0]));
    return payload.scope === SESSION_SCOPE && Number(payload.exp) >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function validPortalId(value) {
  const id = clean(value);
  return /^[A-Za-z][A-Za-z0-9_-]{2,39}$/.test(id);
}

function credentialPresence(student) {
  return {
    loginPasswordStored:Boolean(clean(student?.loginPassword || student?.p)),
    answerPasswordStored:Boolean(clean(student?.answerPassword))
  };
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function lookupStudent(request, env) {
  const body = await readJson(request);
  const suppliedId = clean(body?.portalUserId);
  if (!validPortalId(suppliedId)) {
    return json({ ok:false, error:'INVALID_PORTAL_USER_ID' }, 400, request, env);
  }

  const student = await env.STUDENTS_KV.get(`user:${norm(suppliedId)}`, { type:'json' });
  if (!student) {
    return json({ ok:false, error:'STUDENT_NOT_FOUND' }, 404, request, env);
  }

  const presence = credentialPresence(student);
  return json({
    ok:true,
    portalUserId:clean(student.portalUserId) || suppliedId,
    firstName:clean(student.firstName || student.name),
    accountStatus:clean(student.accountStatus || student.status) || 'unknown',
    ...presence
  }, 200, request, env);
}

export async function handleAdminPortalLoginLookup(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== LOOKUP_PATH) return null;

  const origin = request.headers.get('Origin') || '';
  if (origin && !allowedOrigin(origin, env)) {
    return json({ ok:false, error:'ORIGIN_NOT_ALLOWED' }, 403, request, env);
  }
  if (request.method === 'OPTIONS') return json({ ok:true }, 200, request, env);
  if (request.method !== 'POST') return json({ ok:false, error:'METHOD_NOT_ALLOWED' }, 405, request, env);
  if (!env?.STUDENTS_KV || !env?.ADMIN_IMPORT_SESSION_SECRET) {
    return json({ ok:false, error:'PORTAL_LOOKUP_NOT_CONFIGURED' }, 503, request, env);
  }
  if (!(await adminSessionAuthorised(request, env))) {
    return json({ ok:false, error:'UNAUTHORISED' }, 401, request, env);
  }

  return lookupStudent(request, env);
}

export { LOOKUP_PATH, validPortalId, credentialPresence };
