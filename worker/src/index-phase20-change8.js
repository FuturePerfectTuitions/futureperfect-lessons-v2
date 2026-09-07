import phase20Worker from './index-phase20-change7.js';
import { canonicalCatalogueRowsForView } from './index-phase12.js';
import {
  PRELESSON_MESSAGE,
  PRELESSON_DOWNLOAD_KINDS,
  parseResourceRequest,
  restrictLessonToPrelesson
} from './index-phase18-online-prelesson.js';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function withoutLegacyPrelessonOverlay(env) {
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'PHASE20_DISABLE_LEGACY_PRELESSON_OVERLAY') return true;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function allowedOrigins(env) {
  return new Set([
    'https://futureperfecttuitions.github.io',
    ...String(env?.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
  ]);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'Content-Type,Content-Disposition',
    Vary: 'Origin'
  };
}

function json(body, init = {}, request = null, env = null) {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  if (request && env) {
    for (const [key, value] of Object.entries(corsHeaders(request, env))) headers.set(key, value);
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

function jsonLike(response, body) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), {
    status: response.ok ? response.status : 200,
    statusText: response.ok ? response.statusText : 'OK',
    headers
  });
}

function viewLabel(viewId) {
  let match = clean(viewId).match(/^english-year([2-6])(-11plus)?$/i);
  if (match) return `Year ${match[1]}${match[2] ? ' (11+)' : ''}`;
  match = clean(viewId).match(/^maths-year([2-6])$/i);
  if (match) return `Year ${match[1]}`;
  match = clean(viewId).match(/^maths-level([1-3])$/i);
  if (match) return `Level ${match[1]} (11+)`;
  return clean(viewId);
}

function viewSubject(viewId) {
  return clean(viewId).toLowerCase().startsWith('english-') ? 'english' :
    (clean(viewId).toLowerCase().startsWith('maths-') ? 'maths' : '');
}

function viewRank(viewId) {
  const id = clean(viewId).toLowerCase();
  let match = id.match(/^(?:english|maths)-year([2-6])(-11plus)?$/);
  if (match) return Number(match[1]) * 10 + (match[2] ? 1 : 0);
  match = id.match(/^maths-level([1-3])$/);
  if (match) return (Number(match[1]) + 3) * 10 + 1;
  return 999;
}

function batchIsElevenPlus(batchKey) {
  return /11/.test(clean(batchKey));
}

function displayViewIds(lesson) {
  const ids = new Set();
  for (const source of [lesson?.displayIds, lesson?.displayLessonIds, lesson?.presentation?.displayIds]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const key of Object.keys(source)) ids.add(clean(key).toLowerCase());
  }
  return [...ids].filter(Boolean);
}

function fallbackViewId(lesson, elevenPlus) {
  const subject = norm(lesson?.subject);
  const canonical = clean(lesson?.lessonId).toUpperCase();
  const yearMatch = canonical.match(/^Y([2-6])/);
  const year = Number(yearMatch?.[1] || 0);
  if (!year) return '';
  if (subject === 'english') {
    if (elevenPlus && (year === 4 || year === 5)) return `english-year${year}-11plus`;
    return `english-year${year}`;
  }
  if (subject === 'maths') {
    if (elevenPlus && year >= 4 && year <= 6) return `maths-level${year - 3}`;
    return `maths-year${year}`;
  }
  return '';
}

function viewIdForAccess(lesson, batchKey = '') {
  const subject = norm(lesson?.subject);
  const elevenPlus = batchIsElevenPlus(batchKey);
  const candidates = displayViewIds(lesson);

  if (subject === 'english') {
    const filtered = candidates.filter(id => /^english-year[2-6](?:-11plus)?$/.test(id));
    const target = elevenPlus
      ? filtered.find(id => id.endsWith('-11plus'))
      : filtered.find(id => !id.endsWith('-11plus'));
    return target || fallbackViewId(lesson, elevenPlus);
  }

  if (subject === 'maths') {
    const filtered = candidates.filter(id => /^maths-(?:year[2-6]|level[1-3])$/.test(id));
    const target = elevenPlus
      ? filtered.find(id => /^maths-level[1-3]$/.test(id))
      : filtered.find(id => /^maths-year[2-6]$/.test(id));
    return target || fallbackViewId(lesson, elevenPlus);
  }

  return '';
}

function fullLibraryForView(viewId) {
  const id = clean(viewId).toLowerCase();
  let match = id.match(/^english-year([2-6])(-11plus)?$/);
  if (match) return `ENGLISH_Y${match[1]}${match[2] ? '_11PLUS' : ''}_FULL`;
  match = id.match(/^maths-year([2-6])$/);
  if (match) return `MATHS_Y${match[1]}_FULL`;
  match = id.match(/^maths-level([1-3])$/);
  if (match) return `MATHS_L${match[1]}_FULL`;
  return '';
}

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function academicYearStart(today = londonToday()) {
  const match = String(today).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  return `${month >= 9 ? year : year - 1}-09-01`;
}

function currentFromDates(rows) {
  const start = academicYearStart();
  const dates = rows.map(row => clean(row.lessonDate)).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date));
  if (!dates.length || !start) return true;
  return dates.sort().at(-1) >= start;
}

async function sessionUser(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/v1/student/session';
  url.search = '';
  const response = await phase20Worker.fetch(new Request(url.toString(), {
    method: 'GET', headers: request.headers
  }), env, ctx);
  const body = await response.clone().json().catch(() => null);
  if (!response.ok || !body?.ok || body.accountLocked) return '';
  return norm(body.portalUserId);
}

async function rawAccessRows(env, portalUserIdNorm) {
  if (!portalUserIdNorm) return [];
  const [full, pre] = await Promise.all([
    env.DB.prepare(
      `SELECT lesson_id, vr_access, source_batch_code, source_lesson_date
       FROM lesson_entitlements
       WHERE portal_user_id_norm = ? AND core_access = 1`
    ).bind(portalUserIdNorm).all(),
    env.DB.prepare(
      `SELECT lesson_id, vr_access, batch_key, lesson_date
       FROM online_prelesson_entitlements
       WHERE portal_user_id_norm = ?`
    ).bind(portalUserIdNorm).all()
  ]);

  const byLesson = new Map();
  for (const row of Array.isArray(full?.results) ? full.results : []) {
    const lessonId = clean(row.lesson_id);
    if (!lessonId) continue;
    byLesson.set(lessonId, {
      lessonId,
      mode: 'full',
      vrAccess: Number(row.vr_access) === 1,
      batchKey: clean(row.source_batch_code),
      lessonDate: clean(row.source_lesson_date)
    });
  }
  for (const row of Array.isArray(pre?.results) ? pre.results : []) {
    const lessonId = clean(row.lesson_id);
    if (!lessonId || byLesson.has(lessonId)) continue;
    byLesson.set(lessonId, {
      lessonId,
      mode: 'prelesson',
      vrAccess: Number(row.vr_access) === 1,
      batchKey: clean(row.batch_key),
      lessonDate: clean(row.lesson_date)
    });
  }
  return [...byLesson.values()];
}

async function resolvedAccessRows(env, portalUserIdNorm) {
  const rows = await rawAccessRows(env, portalUserIdNorm);
  const lessons = await Promise.all(rows.map(row => env.LESSONS_KV.get(`lesson:${row.lessonId}`, { type:'json' })));
  return rows.map((row, index) => {
    const lesson = lessons[index];
    if (!lesson || lesson.active === false) return null;
    const viewId = viewIdForAccess(lesson, row.batchKey);
    return viewId ? { ...row, viewId, lesson } : null;
  }).filter(Boolean);
}

function ensureSubject(body, subjectName) {
  if (!Array.isArray(body.subjects)) body.subjects = [];
  let subject = body.subjects.find(item => norm(item?.subject) === subjectName);
  if (!subject) {
    subject = { subject:subjectName, label:subjectName === 'maths' ? 'Maths' : 'English', views:[] };
    body.subjects.push(subject);
  }
  if (!Array.isArray(subject.views)) subject.views = [];
  return subject;
}

function sortViews(subject) {
  if (!Array.isArray(subject?.views)) return;
  subject.views.sort((a, b) => viewRank(a?.viewId) - viewRank(b?.viewId) || clean(a?.viewId).localeCompare(clean(b?.viewId)));
}

function temporaryFullLibraryEnv(env, portalUserIdNorm, viewId) {
  const library = fullLibraryForView(viewId);
  if (!library || !env?.STUDENTS_KV) return env;
  const source = env.STUDENTS_KV;
  const kv = new Proxy(source, {
    get(target, prop) {
      if (prop !== 'get') {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (key, options) => {
        const value = await target.get(key, options);
        if (value == null || String(key || '').toLowerCase() !== `user:${portalUserIdNorm}`) return value;
        const wantsJson = options?.type === 'json';
        let user = value;
        if (!wantsJson) {
          try { user = JSON.parse(String(value)); } catch { return value; }
        }
        const fullLibraries = [...new Set([
          ...(Array.isArray(user?.fullLibraries) ? user.fullLibraries.map(String) : []),
          library
        ])];
        const overlaid = { ...user, fullLibraries };
        return wantsJson ? overlaid : JSON.stringify(overlaid);
      };
    }
  });
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'STUDENTS_KV') return kv;
      if (prop === 'PHASE12_BYPASS_SESSION_PROFILE') return true;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function restrictVrForAccess(lesson, access) {
  if (!lesson || access?.vrAccess) return lesson;
  if (lesson.vr) lesson.vr = null;
  return lesson;
}

async function handleHome(request, env, ctx) {
  const response = await phase20Worker.fetch(request, env, ctx);
  if (!response.ok) return response;
  const body = await response.clone().json().catch(() => null);
  const portalUserIdNorm = norm(body?.student?.portalUserId);
  if (!body?.ok || !portalUserIdNorm) return response;

  const accessRows = await resolvedAccessRows(env, portalUserIdNorm);
  if (!accessRows.length) return response;
  const grouped = new Map();
  for (const row of accessRows) {
    if (!grouped.has(row.viewId)) grouped.set(row.viewId, []);
    grouped.get(row.viewId).push(row);
  }

  for (const [viewId, rows] of grouped.entries()) {
    const subjectName = viewSubject(viewId);
    if (!subjectName) continue;
    const subject = ensureSubject(body, subjectName);
    const canonical = canonicalCatalogueRowsForView(viewId);
    if (!canonical.length) continue;
    const canonicalIds = new Set(canonical.map(row => row.lessonId));
    const openIds = new Set(rows.map(row => row.lessonId).filter(id => canonicalIds.has(id)));
    const current = currentFromDates(rows);
    const existing = subject.views.find(view => norm(view?.viewId) === viewId);
    const summary = {
      viewId,
      subject:subjectName,
      label:viewLabel(viewId),
      catalogueAvailable:true,
      visibleLessonCount:canonical.length,
      openLessonCount:openIds.size,
      lockedLessonCount:Math.max(0, canonical.length - openIds.size),
      lockedPreview:false,
      current,
      group:current ? 'current' : 'previous',
      source:'lessonReleaseEntitlement'
    };
    if (existing) {
      existing.openLessonCount = Math.max(Number(existing.openLessonCount || 0), openIds.size);
      existing.lockedLessonCount = Math.max(0, canonical.length - Number(existing.openLessonCount || 0));
      existing.visibleLessonCount = canonical.length;
      existing.catalogueAvailable = true;
    } else {
      subject.views.push(summary);
    }
    sortViews(subject);
  }

  return jsonLike(response, body);
}

async function lessonDescriptions(env, canonical) {
  const records = await Promise.all(canonical.map(row => env.LESSONS_KV.get(`lesson:${row.lessonId}`, { type:'json' })));
  return new Map(canonical.map((row, index) => [row.lessonId, String(records[index]?.description || records[index]?.desc || '')]));
}

async function handleLessonList(request, env, ctx, viewId) {
  const [baseResponse, portalUserIdNorm] = await Promise.all([
    phase20Worker.fetch(request, env, ctx),
    sessionUser(request, env, ctx)
  ]);
  if (!portalUserIdNorm) return baseResponse;
  const [accessRows, user] = await Promise.all([
    resolvedAccessRows(env, portalUserIdNorm),
    env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type:'json' })
  ]);
  const inView = accessRows.filter(row => row.viewId === viewId);
  if (!inView.length) return baseResponse;

  const canonical = canonicalCatalogueRowsForView(viewId);
  if (!canonical.length) return baseResponse;
  const descriptions = await lessonDescriptions(env, canonical);
  const accessByLesson = new Map(inView.map(row => [row.lessonId, row]));
  const blocked = new Set(Array.isArray(user?.blockedLessons) ? user.blockedLessons.map(String) : []);
  const baseBody = baseResponse.ok ? await baseResponse.clone().json().catch(() => null) : null;
  const existing = new Map(Array.isArray(baseBody?.lessons)
    ? baseBody.lessons.filter(row => row?.lessonId).map(row => [String(row.lessonId), row]) : []);

  const lessons = canonical.map(row => {
    const current = existing.get(row.lessonId);
    const access = accessByLesson.get(row.lessonId);
    if (!access || blocked.has(row.lessonId)) {
      return {
        ...(current || row),
        description:current?.description ?? descriptions.get(row.lessonId) ?? '',
        state:'locked', locked:true, blocked:blocked.has(row.lessonId), preview:false, missedPreview:false
      };
    }
    if (access.mode === 'prelesson') {
      return {
        ...(current || row),
        description:current?.description ?? descriptions.get(row.lessonId) ?? '',
        state:'prelesson', locked:false, blocked:false, preview:false, missedPreview:false,
        accessMode:'prelesson', accessMessage:PRELESSON_MESSAGE
      };
    }
    return {
      ...(current || row),
      description:current?.description ?? descriptions.get(row.lessonId) ?? '',
      state:'open', locked:false, blocked:false, preview:false, missedPreview:false, accessMode:'full'
    };
  });

  const current = currentFromDates(inView);
  const body = {
    ok:true,
    view:{
      viewId, subject:viewSubject(viewId), label:viewLabel(viewId), catalogueAvailable:true,
      visibleLessonCount:lessons.length,
      openLessonCount:lessons.filter(row => row.locked === false).length,
      lockedLessonCount:lessons.filter(row => row.locked !== false).length,
      lockedPreview:false, current, group:current ? 'current' : 'previous', source:'lessonReleaseEntitlement'
    },
    lessons
  };
  return baseResponse.ok ? jsonLike(baseResponse, body) : json(body, { status:200 }, request, env);
}

async function handleLessonDetail(request, env, ctx, lessonId, viewId) {
  const baseResponse = await phase20Worker.fetch(request, env, ctx);
  const baseBody = await baseResponse.clone().json().catch(() => null);
  if (baseResponse.ok && baseBody?.ok && baseBody?.lesson?.locked === false) return baseResponse;

  const portalUserIdNorm = await sessionUser(request, env, ctx);
  if (!portalUserIdNorm) return baseResponse;
  const [accessRows, user] = await Promise.all([
    resolvedAccessRows(env, portalUserIdNorm),
    env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type:'json' })
  ]);
  const access = accessRows.find(row => row.lessonId === lessonId && row.viewId === viewId);
  if (!access) return baseResponse;
  if (new Set(Array.isArray(user?.blockedLessons) ? user.blockedLessons.map(String) : []).has(lessonId)) return baseResponse;

  const runtimeEnv = temporaryFullLibraryEnv(env, portalUserIdNorm, viewId);
  const response = await phase20Worker.fetch(request, runtimeEnv, ctx);
  const body = await response.clone().json().catch(() => null);
  if (!response.ok || !body?.ok || !body.lesson) return baseResponse;

  if (access.mode === 'prelesson') body.lesson = restrictLessonToPrelesson(body.lesson);
  body.lesson = restrictVrForAccess(body.lesson, access);
  return jsonLike(response, body);
}

function vrResource(kind) {
  return clean(kind).toLowerCase().startsWith('vr');
}

async function handleResource(request, env, ctx, parsed, viewId) {
  const portalUserIdNorm = await sessionUser(request, env, ctx);
  if (!portalUserIdNorm) return phase20Worker.fetch(request, env, ctx);
  const [accessRows, user] = await Promise.all([
    resolvedAccessRows(env, portalUserIdNorm),
    env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type:'json' })
  ]);
  const access = accessRows.find(row => row.lessonId === parsed.lessonId && row.viewId === viewId);
  if (!access) return phase20Worker.fetch(request, env, ctx);
  if (new Set(Array.isArray(user?.blockedLessons) ? user.blockedLessons.map(String) : []).has(parsed.lessonId)) {
    return phase20Worker.fetch(request, env, ctx);
  }

  if (vrResource(parsed.kind) && !access.vrAccess) {
    return json({ error:'RESOURCE_NOT_AVAILABLE' }, { status:403 }, request, env);
  }

  const runtimeEnv = temporaryFullLibraryEnv(env, portalUserIdNorm, viewId);
  if (access.mode === 'full') return phase20Worker.fetch(request, runtimeEnv, ctx);

  if (request.method === 'GET' && parsed.action === 'download' && PRELESSON_DOWNLOAD_KINDS.has(parsed.kind)) {
    return phase20Worker.fetch(request, runtimeEnv, ctx);
  }
  return json({ error:'PRELESSON_ONLY', message:PRELESSON_MESSAGE }, { status:403 }, request, env);
}

export {
  viewIdForAccess,
  fullLibraryForView,
  academicYearStart,
  currentFromDates
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const releaseEnv = withoutLegacyPrelessonOverlay(env);
    if (request.method === 'GET' && url.pathname === '/api/v1/student/home') {
      return handleHome(request, releaseEnv, ctx);
    }

    const viewMatch = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
    if (request.method === 'GET' && viewMatch) {
      let viewId = '';
      try { viewId = decodeURIComponent(viewMatch[1]).toLowerCase(); } catch { viewId = ''; }
      if (viewId) return handleLessonList(request, releaseEnv, ctx, viewId);
    }

    const lessonMatch = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
    if (request.method === 'GET' && lessonMatch) {
      let lessonId = '';
      try { lessonId = decodeURIComponent(lessonMatch[1]); } catch { lessonId = ''; }
      const viewId = norm(url.searchParams.get('viewId'));
      if (lessonId && viewId) return handleLessonDetail(request, releaseEnv, ctx, lessonId, viewId);
    }

    const parsed = parseResourceRequest(url);
    if (parsed) {
      const viewId = norm(url.searchParams.get('viewId'));
      if (viewId) return handleResource(request, releaseEnv, ctx, parsed, viewId);
    }

    return phase20Worker.fetch(request, env, ctx);
  }
};
