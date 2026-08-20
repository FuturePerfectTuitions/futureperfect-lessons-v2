const json = (body, init = {}) => {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { ...init, headers });
};

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = new Set(
    String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  );

  if (!origin || !allowed.has(origin)) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '600'
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      if (!Object.keys(cors).length) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({
        ok: true,
        service: 'fpt-portal-v2-worker',
        environment: env.ENVIRONMENT || 'development',
        studentLoginEnabled: false,
        timestamp: new Date().toISOString()
      }, { status: 200, headers: cors });
    }

    if (url.pathname.startsWith('/api/')) {
      return json({
        error: 'NOT_IMPLEMENTED',
        message: 'Portal V2 API route not implemented yet.'
      }, { status: 501, headers: cors });
    }

    return json({
      service: 'fpt-portal-v2-worker',
      message: 'Future Perfect Tuitions Portal V2 Worker'
    }, { status: 200, headers: cors });
  }
};
