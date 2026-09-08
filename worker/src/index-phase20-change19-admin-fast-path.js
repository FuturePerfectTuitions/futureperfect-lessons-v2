import adminSuperuserWorker from './index-phase20-change18-admin-superuser.js';

const SESSION_COOKIE = 'fpt_v2_session';
const ADMIN_ID = 'admin';

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

async function sha256Hex(value) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)))
  );
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function authenticatedAdminSession(request, env) {
  if (!env?.DB) return false;
  const token = parseCookies(request)[SESSION_COOKIE] || '';
  if (!token) return false;
  try {
    const tokenHash = await sha256Hex(token);
    const row = await env.DB.prepare(
      `SELECT portal_user_id_norm
       FROM student_sessions
       WHERE token_hash = ?
         AND revoked_at IS NULL
         AND idle_expires_at > ?`
    ).bind(tokenHash, new Date().toISOString()).first();
    return String(row?.portal_user_id_norm || '').trim().toLowerCase() === ADMIN_ID;
  } catch {
    return false;
  }
}

function adminFastEnv(env) {
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'ADMIN_SUPERUSER_FAST_PATH') return true;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Login itself has no authenticated session yet and must stay untouched.
    if (url.pathname === '/api/v1/student/auth/login') {
      return adminSuperuserWorker.fetch(request, env, ctx);
    }

    // Only the already-authenticated Admin session receives the performance hint.
    // The hint tells Change 16 not to rebuild /home (and therefore every Admin
    // Full Library) before serving a single requested year/level lesson list.
    if (
      url.pathname.startsWith('/api/v1/student/') &&
      await authenticatedAdminSession(request, env)
    ) {
      return adminSuperuserWorker.fetch(request, adminFastEnv(env), ctx);
    }

    return adminSuperuserWorker.fetch(request, env, ctx);
  }
};

export { authenticatedAdminSession, adminFastEnv };
