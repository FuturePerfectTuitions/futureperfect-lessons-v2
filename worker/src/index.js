const json = (body, init = {}) => {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { ...init, headers });
};

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';

  // Keep the GitHub Pages development origin explicitly allowed even if
  // the Cloudflare dashboard variable has not yet propagated correctly.
  // Production/live origins will still be managed through ALLOWED_ORIGINS.
  const allowed = new Set([
    'https://futureperfecttuitions.github.io',
    ...String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  ]);

  if (!origin || !allowed.has(origin)) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '600'
  };
}

async function checkBindings(env) {
  const checks = {
    studentsKv: { bound: Boolean(env.STUDENTS_KV), ok: false },
    lessonsKv: { bound: Boolean(env.LESSONS_KV), ok: false },
    d1: { bound: Boolean(env.DB), ok: false },
    materialsR2: { bound: Boolean(env.MATERIALS_R2), ok: false }
  };

  try {
    if (env.STUDENTS_KV) {
      await env.STUDENTS_KV.list({ limit: 1 });
      checks.studentsKv.ok = true;
    }
  } catch (error) {
    checks.studentsKv.error = 'KV_READ_FAILED';
  }

  try {
    if (env.LESSONS_KV) {
      await env.LESSONS_KV.list({ limit: 1 });
      checks.lessonsKv.ok = true;
    }
  } catch (error) {
    checks.lessonsKv.error = 'KV_READ_FAILED';
  }

  try {
    if (env.DB) {
      const row = await env.DB.prepare('SELECT 1 AS ok').first();
      checks.d1.ok = Number(row?.ok) === 1;
    }
  } catch (error) {
    checks.d1.error = 'D1_QUERY_FAILED';
  }

  try {
    if (env.MATERIALS_R2) {
      await env.MATERIALS_R2.list({ limit: 1 });
      checks.materialsR2.ok = true;
    }
  } catch (error) {
    checks.materialsR2.error = 'R2_LIST_FAILED';
  }

  return checks;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      if (!Object.keys(cors).length) {
        return new Response(null, { status: 403 });
      }

      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      const bindings = await checkBindings(env);

      const infrastructureHealthy =
        bindings.studentsKv.ok &&
        bindings.lessonsKv.ok &&
        bindings.d1.ok &&
        bindings.materialsR2.ok;

      return json(
        {
          ok: true,
          service: 'fpt-portal-v2-worker',
          environment: env.ENVIRONMENT || 'development',
          studentLoginEnabled: false,
          infrastructureHealthy,
          bindings,
          timestamp: new Date().toISOString()
        },
        {
          status: 200,
          headers: cors
        }
      );
    }

    if (url.pathname.startsWith('/api/')) {
      return json(
        {
          error: 'NOT_IMPLEMENTED',
          message: 'Portal V2 API route not implemented yet.'
        },
        {
          status: 501,
          headers: cors
        }
      );
    }

    return json(
      {
        service: 'fpt-portal-v2-worker',
        message: 'Future Perfect Tuitions Portal V2 Worker'
      },
      {
        status: 200,
        headers: cors
      }
    );
  }
};
