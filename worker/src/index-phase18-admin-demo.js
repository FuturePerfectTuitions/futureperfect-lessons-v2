import phase17Worker from './index-phase17.js';
import { PHASE11_NAVIGATION_MANIFEST } from './phase11-navigation-manifest.generated.js';
import { VIEW_CURRICULA, validBundledManifest } from './phase11-navigation-cache.js';

const ADMIN_ID = 'admin';

const ADMIN_VIEWS = Object.freeze([
  Object.freeze({ viewId: 'maths-year2', subject: 'maths', label: 'Year 2' }),
  Object.freeze({ viewId: 'maths-year3', subject: 'maths', label: 'Year 3' }),
  Object.freeze({ viewId: 'maths-year4', subject: 'maths', label: 'Year 4' }),
  Object.freeze({ viewId: 'maths-year5', subject: 'maths', label: 'Year 5' }),
  Object.freeze({ viewId: 'maths-year6', subject: 'maths', label: 'Year 6' }),
  Object.freeze({ viewId: 'maths-level1', subject: 'maths', label: 'Level 1' }),
  Object.freeze({ viewId: 'maths-level2', subject: 'maths', label: 'Level 2' }),
  Object.freeze({ viewId: 'maths-level3', subject: 'maths', label: 'Level 3' }),
  Object.freeze({ viewId: 'english-year2', subject: 'english', label: 'Year 2' }),
  Object.freeze({ viewId: 'english-year3', subject: 'english', label: 'Year 3' }),
  Object.freeze({ viewId: 'english-year4', subject: 'english', label: 'Year 4' }),
  Object.freeze({ viewId: 'english-year4-11plus', subject: 'english', label: 'Year 4 11+' }),
  Object.freeze({ viewId: 'english-year5', subject: 'english', label: 'Year 5' }),
  Object.freeze({ viewId: 'english-year5-11plus', subject: 'english', label: 'Year 5 11+' }),
  Object.freeze({ viewId: 'english-year6', subject: 'english', label: 'Year 6' })
]);

function clean(value) {
  return String(value || '').trim();
}

function normalise(value) {
  return clean(value).toLowerCase();
}

function targetViewId(request) {
  const url = new URL(request.url);
  const direct = clean(url.searchParams.get('viewId')).toLowerCase();
  if (direct) return direct;
  const match = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]).trim().toLowerCase(); } catch { return ''; }
}

function viewLessonIds(viewId, manifest = PHASE11_NAVIGATION_MANIFEST) {
  if (!validBundledManifest(manifest)) return [];
  const curricula = VIEW_CURRICULA[normalise(viewId)] || [];
  const ids = new Set();
  for (const curriculumCode of curricula) {
    for (const lessonId of manifest.curricula?.[curriculumCode]?.lessonIds || []) {
      const record = manifest.lessons?.[lessonId];
      if (record && record.active !== false) ids.add(String(lessonId));
    }
  }
  return [...ids];
}

async function adminSession(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/v1/student/session';
  url.search = '';
  const sessionRequest = new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  });
  const response = await phase17Worker.fetch(sessionRequest, env, ctx);
  const body = await response.clone().json().catch(() => null);
  return {
    admin: Boolean(response.ok && body?.ok && normalise(body.portalUserId) === ADMIN_ID),
    response,
    body
  };
}

function scopedAdminUser(user, viewId) {
  const lessonIds = viewLessonIds(viewId);
  const vr = /^english-year[45]-11plus$/.test(normalise(viewId));
  return {
    ...user,
    batches: [],
    fullLibraries: [],
    historicalViews: [normalise(viewId)],
    manualAccess: {
      ...(user?.manualAccess || {}),
      coreLessons: lessonIds,
      vrLessons: vr ? lessonIds : [],
      specialBuckets: Array.isArray(user?.manualAccess?.specialBuckets)
        ? [...user.manualAccess.specialBuckets]
        : []
    },
    blockedLessons: []
  };
}

function scopedAdminEnv(env, viewId) {
  const target = normalise(viewId);
  if (!target || !VIEW_CURRICULA[target] || !env?.STUDENTS_KV) return env;
  const originalKv = env.STUDENTS_KV;
  const kv = new Proxy(originalKv, {
    get(targetKv, prop) {
      if (prop !== 'get') {
        const value = Reflect.get(targetKv, prop, targetKv);
        return typeof value === 'function' ? value.bind(targetKv) : value;
      }
      return async (key, options) => {
        const value = await targetKv.get(key, options);
        if (String(key) !== 'user:admin' || value == null) return value;
        const wantsJson = options?.type === 'json';
        let user = value;
        if (!wantsJson) {
          try { user = JSON.parse(String(value)); } catch { return value; }
        }
        const scoped = scopedAdminUser(user, target);
        return wantsJson ? scoped : JSON.stringify(scoped);
      };
    }
  });
  return new Proxy(env, {
    get(targetEnv, prop) {
      if (prop === 'STUDENTS_KV') return kv;
      if (prop === 'PHASE12_BYPASS_SESSION_PROFILE') return true;
      const value = Reflect.get(targetEnv, prop, targetEnv);
      return typeof value === 'function' ? value.bind(targetEnv) : value;
    }
  });
}

function adminHomeBody(sessionBody) {
  if (!validBundledManifest()) return null;
  const views = ADMIN_VIEWS.map(definition => {
    const count = viewLessonIds(definition.viewId).length;
    return {
      viewId: definition.viewId,
      subject: definition.subject,
      label: definition.label,
      lockedPreview: false,
      catalogueAvailable: true,
      visibleLessonCount: count,
      openLessonCount: count,
      lockedLessonCount: 0,
      current: true,
      group: 'current'
    };
  });
  return {
    ok: true,
    student: {
      firstName: 'Admin',
      portalUserId: ADMIN_ID,
      schoolYear: 6,
      status: String(sessionBody?.status || 'active'),
      expired: Boolean(sessionBody?.expired),
      accountLocked: Boolean(sessionBody?.accountLocked)
    },
    subjects: [
      { subject: 'maths', label: 'Maths', views: views.filter(view => view.subject === 'maths') },
      { subject: 'english', label: 'English', views: views.filter(view => view.subject === 'english') }
    ],
    diagnostics: { demoAdminAllAccess: true },
    timestamp: new Date().toISOString()
  };
}

function jsonLike(response, body) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { status: 200, headers });
}

export {
  ADMIN_VIEWS,
  viewLessonIds,
  scopedAdminUser,
  adminHomeBody
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const authenticatedRoute =
      url.pathname.startsWith('/api/v1/student/') &&
      !['/api/v1/student/auth/login', '/api/v1/student/auth/logout', '/api/v1/student/session']
        .includes(url.pathname);

    if (!authenticatedRoute) return phase17Worker.fetch(request, env, ctx);

    const session = await adminSession(request, env, ctx);
    if (!session.admin) return phase17Worker.fetch(request, env, ctx);

    if (request.method === 'GET' && url.pathname === '/api/v1/student/home') {
      const body = adminHomeBody(session.body);
      if (!body) return new Response(JSON.stringify({ error: 'ADMIN_DEMO_MANIFEST_UNAVAILABLE' }), {
        status: 503,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      });
      return jsonLike(session.response, body);
    }

    const viewId = targetViewId(request);
    return phase17Worker.fetch(request, scopedAdminEnv(env, viewId), ctx);
  }
};
