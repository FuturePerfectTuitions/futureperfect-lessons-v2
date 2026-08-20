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

async function phase2Diagnostics(env) {
  const studentKey = 'student:test0101';
  const lessonKey = 'lesson:DEV-M01';
  const viewKey = 'view:maths-year5-dev';

  const [student, lesson, view, entitlementCountRow] = await Promise.all([
    env.STUDENTS_KV.get(studentKey, { type: 'json' }),
    env.LESSONS_KV.get(lessonKey, { type: 'json' }),
    env.LESSONS_KV.get(viewKey, { type: 'json' }),
    env.DB.prepare('SELECT COUNT(*) AS count FROM lesson_entitlements').first()
  ]);

  return {
    student: {
      key: studentKey,
      found: Boolean(student),
      portalUserId: student?.portalUserId ?? null,
      firstName: student?.firstName ?? null,
      schoolYear: student?.schoolYear ?? null,
      vrEligible: student?.vrEligible ?? null,
      accountStatus: student?.accountStatus ?? null,
      batches: Array.isArray(student?.batches) ? student.batches : []
    },
    lesson: {
      key: lessonKey,
      found: Boolean(lesson),
      lessonId: lesson?.lessonId ?? null,
      title: lesson?.title ?? null,
      subject: lesson?.subject ?? null,
      active: lesson?.active ?? null,
      testOnly: lesson?.testOnly ?? null
    },
    view: {
      key: viewKey,
      found: Boolean(view),
      viewId: view?.viewId ?? null,
      subject: view?.subject ?? null,
      label: view?.label ?? null,
      lessonIds: Array.isArray(view?.lessonIds) ? view.lessonIds : []
    },
    d1: {
      table: 'lesson_entitlements',
      readable: entitlementCountRow !== null,
      rowCount: Number(entitlementCountRow?.count ?? 0)
    }
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

    if (url.pathname === '/api/dev/phase2' && request.method === 'GET') {
      if ((env.ENVIRONMENT || 'development') !== 'development') {
        return json(
          {
            error: 'NOT_FOUND'
          },
          {
            status: 404,
            headers: cors
          }
        );
      }

      try {
        const diagnostics = await phase2Diagnostics(env);
        const dataFoundationHealthy =
          diagnostics.student.found &&
          diagnostics.lesson.found &&
          diagnostics.view.found &&
          diagnostics.d1.readable;

        return json(
          {
            ok: true,
            phase: 2,
            dataFoundationHealthy,
            diagnostics,
            timestamp: new Date().toISOString()
          },
          {
            status: 200,
            headers: cors
          }
        );
      } catch (error) {
        return json(
          {
            ok: false,
            phase: 2,
            dataFoundationHealthy: false,
            error: 'PHASE2_DIAGNOSTIC_FAILED'
          },
          {
            status: 500,
            headers: cors
          }
        );
      }
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
