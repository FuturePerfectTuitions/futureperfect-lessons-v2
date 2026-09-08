import adminSuperuserWorker from './index-phase20-change18-admin-superuser.js';
import { liveCatalogueForView } from './live-student-catalogue-overlay.js';

const clean = value => String(value ?? '').trim();

const VIEW_META = Object.freeze({
  'maths-year2': { subject:'maths', label:'Year 2' },
  'maths-year3': { subject:'maths', label:'Year 3' },
  'maths-year4': { subject:'maths', label:'Year 4' },
  'maths-year5': { subject:'maths', label:'Year 5' },
  'maths-year6': { subject:'maths', label:'Year 6' },
  'maths-level1': { subject:'maths', label:'L1' },
  'maths-level2': { subject:'maths', label:'L2' },
  'maths-level3': { subject:'maths', label:'L3' },
  'english-year2': { subject:'english', label:'Year 2' },
  'english-year3': { subject:'english', label:'Year 3' },
  'english-year4': { subject:'english', label:'Year 4' },
  'english-year5': { subject:'english', label:'Year 5' },
  'english-year6': { subject:'english', label:'Year 6' },
  'english-year4-11plus': { subject:'english', label:'Year 4 11+' },
  'english-year5-11plus': { subject:'english', label:'Year 5 11+' }
});

function viewScopedRequest(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/v1/student/')) return false;
  if (/^\/api\/v1\/student\/views\/[^/]+\/lessons$/.test(url.pathname)) return true;
  return Boolean(clean(url.searchParams.get('viewId')));
}

function lessonListViewId(request) {
  if (request.method !== 'GET') return '';
  const match = new URL(request.url).pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]).trim().toLowerCase(); } catch { return ''; }
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

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = new Set([
    'https://futureperfecttuitions.github.io',
    ...String(env?.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
  ]);
  if (!origin || !allowed.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'Content-Type,Content-Disposition',
    Vary: 'Origin'
  };
}

function json(body, request, env, status = 200) {
  const headers = new Headers(corsHeaders(request, env));
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

async function directAdminLessonList(request, env, viewId) {
  const meta = VIEW_META[viewId];
  if (!meta) return json({ error:'VIEW_NOT_AVAILABLE' }, request, env, 404);

  const rows = await liveCatalogueForView(env, viewId);
  if (!rows.length) {
    return json({ error:'ADMIN_CATALOGUE_UNAVAILABLE' }, request, env, 503);
  }

  const lessons = rows.map(row => ({
    lessonId: row.lessonId,
    displayLessonId: row.displayLessonId,
    title: row.title,
    description: row.description || '',
    state: 'open',
    locked: false,
    blocked: false,
    preview: false,
    missedPreview: false,
    accessMode: 'admin-superuser',
    accessMessage: ''
  }));

  return json({
    ok: true,
    superuser: true,
    role: 'admin',
    view: {
      viewId,
      subject: meta.subject,
      label: meta.label,
      catalogueAvailable: true,
      visibleLessonCount: lessons.length,
      openLessonCount: lessons.length,
      lockedLessonCount: 0,
      lockedPreview: false,
      current: true,
      group: 'current',
      source: 'adminSuperuserDirect'
    },
    lessons
  }, request, env, 200);
}

export default {
  async fetch(request, env, ctx) {
    if (!viewScopedRequest(request)) {
      return adminSuperuserWorker.fetch(request, env, ctx);
    }

    // Never trust a client-supplied marker. First prove, through the normal
    // authenticated session path, that this browser session is the server-side
    // Admin superuser.
    if (!(await authenticatedAdmin(request, env, ctx))) {
      return adminSuperuserWorker.fetch(request, env, ctx);
    }

    // Admin does not need student entitlement reconstruction for a lesson list.
    // Read only the one requested live curriculum and its lesson records, then
    // mark those rows open. This avoids loading/reconciling every Admin library
    // and removes the recursive /home path that caused long waits/timeouts.
    const viewId = lessonListViewId(request);
    if (viewId) return directAdminLessonList(request, env, viewId);

    // Lesson detail/resource requests still use the established server-side
    // resource gates, but with the Admin performance hint so Change 16 does not
    // rebuild /home before serving the selected view.
    return adminSuperuserWorker.fetch(request, fastPathEnv(env), ctx);
  }
};
