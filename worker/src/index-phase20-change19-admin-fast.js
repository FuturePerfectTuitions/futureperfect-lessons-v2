import adminSuperuserWorker from './index-phase20-change18-admin-superuser.js';

const clean = value => String(value ?? '').trim();

function viewScopedRequest(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/v1/student/')) return false;
  if (/^\/api\/v1\/student\/views\/[^/]+\/lessons$/.test(url.pathname)) return true;
  return Boolean(clean(url.searchParams.get('viewId')));
}

async function authenticatedAdmin(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/v1/student/session';
  url.search = '';
  const response = await adminSuperuserWorker.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  }), env, ctx);
  const body = await response.clone().json().catch(() => null);
  return Boolean(
    response.ok &&
    body?.ok &&
    body?.superuser === true &&
    String(body?.role || '').toLowerCase() === 'admin'
  );
}

function fastPathEnv(env) {
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
    if (!viewScopedRequest(request)) {
      return adminSuperuserWorker.fetch(request, env, ctx);
    }

    // Do not trust a client-supplied marker. First prove, through the normal
    // authenticated session path, that this browser session is the server-side
    // Admin superuser. Only then expose the request-local performance flag that
    // tells Change 16 to skip its redundant /home preview-suppression probe.
    if (!(await authenticatedAdmin(request, env, ctx))) {
      return adminSuperuserWorker.fetch(request, env, ctx);
    }

    return adminSuperuserWorker.fetch(request, fastPathEnv(env), ctx);
  }
};
