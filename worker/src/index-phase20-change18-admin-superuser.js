import productionWorker from './index-phase20-change17-parent-email.js';
import { bridgePhase11Answers, phase11AnswerResource } from './phase11-resources.js';

const DEFAULT_ADMIN_SUPERUSER_IDS = Object.freeze(['admin']);
const ADMIN_MOCK_ALIAS = 'ADMIN_MOCKS';

const FULL_LIBRARY_CODES = Object.freeze([
  'MATHS_Y2_FULL',
  'MATHS_Y3_FULL',
  'MATHS_Y4_FULL',
  'MATHS_Y5_FULL',
  'MATHS_Y6_FULL',
  'MATHS_L1_FULL',
  'MATHS_L2_FULL',
  'MATHS_L3_FULL',
  'ENGLISH_Y2_FULL',
  'ENGLISH_Y3_FULL',
  'ENGLISH_Y4_FULL',
  'ENGLISH_Y5_FULL',
  'ENGLISH_Y6_FULL',
  'ENGLISH_Y4_11PLUS_FULL',
  'ENGLISH_Y5_11PLUS_FULL'
]);

const SPECIAL_BUCKET_IDS = Object.freeze([
  'Y4MAssT1',
  'Y4MAssT2',
  'Y5MAssT1',
  'Y5MAssT2',
  'VR_HOWTO',
  'MOCKS'
]);

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

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
  const headers = new Headers(response?.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), {
    status: response?.status || 200,
    statusText: response?.statusText,
    headers
  });
}

function adminSuperuserIds(env) {
  const configured = String(env?.ADMIN_SUPERUSER_IDS || '')
    .split(',')
    .map(norm)
    .filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ADMIN_SUPERUSER_IDS);
}

function isConfiguredAdminSuperuser(env, portalUserId) {
  return adminSuperuserIds(env).has(norm(portalUserId));
}

async function authenticatedSession(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/v1/student/session';
  url.search = '';
  const response = await productionWorker.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  }), env, ctx);
  const body = await response.clone().json().catch(() => null);
  if (!response.ok || !body?.ok || body.accountLocked) return { response, body, portalUserIdNorm: '' };
  const portalUserIdNorm = norm(body?.portalUserId || body?.student?.portalUserId);
  return { response, body, portalUserIdNorm };
}

function mergeUnique(existing, additions, normaliser = value => String(value)) {
  const out = [];
  const seen = new Set();
  for (const value of [...(Array.isArray(existing) ? existing : []), ...additions]) {
    const raw = clean(value);
    if (!raw) continue;
    const key = normaliser(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

function makeAdminUser(user) {
  const manual = user?.manualAccess && typeof user.manualAccess === 'object'
    ? user.manualAccess
    : {};
  return {
    ...user,
    role: 'admin',
    superuser: true,
    vrEligible: true,
    blockedLessons: [],
    fullLibraries: mergeUnique(user?.fullLibraries, FULL_LIBRARY_CODES, value => value.toUpperCase()),
    manualAccess: {
      ...manual,
      specialBuckets: mergeUnique(manual.specialBuckets, SPECIAL_BUCKET_IDS, value => value)
    }
  };
}

function adminSuperuserEnv(env, portalUserIdNorm) {
  if (!env?.STUDENTS_KV || !portalUserIdNorm) return env;
  const source = env.STUDENTS_KV;
  const targetKey = `user:${portalUserIdNorm}`;
  const kv = new Proxy(source, {
    get(target, prop) {
      if (prop !== 'get') {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (key, options) => {
        const value = await target.get(key, options);
        if (value == null || norm(key) !== targetKey) return value;
        const wantsJson = options?.type === 'json';
        let user = value;
        if (!wantsJson) {
          try { user = JSON.parse(String(value)); } catch { return value; }
        }
        const elevated = makeAdminUser(user);
        return wantsJson ? elevated : JSON.stringify(elevated);
      };
    }
  });
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'STUDENTS_KV') return kv;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function forceOpenView(view) {
  if (!view || typeof view !== 'object') return view;
  const visible = Math.max(0, Number(view.visibleLessonCount || 0));
  return {
    ...view,
    lockedPreview: false,
    current: true,
    group: 'current',
    source: 'adminSuperuser',
    openLessonCount: visible,
    lockedLessonCount: 0
  };
}

function forceOpenLessonSummary(lesson) {
  if (!lesson || typeof lesson !== 'object') return lesson;
  return {
    ...lesson,
    state: 'open',
    locked: false,
    blocked: false,
    preview: false,
    missedPreview: false,
    accessMode: 'admin-superuser',
    accessMessage: ''
  };
}

function unlockProtectedTree(value) {
  if (Array.isArray(value)) return value.map(unlockProtectedTree);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = unlockProtectedTree(item);
  if (out.protected === true) {
    out.protected = false;
    out.passwordRequired = false;
    if (out.available !== false && out.resourceKey) out.locked = false;
  }
  return out;
}

function elevateJsonBody(body, pathname) {
  if (!body || typeof body !== 'object') return body;
  const elevated = unlockProtectedTree(body);
  elevated.superuser = true;
  elevated.role = 'admin';

  if (elevated.student && typeof elevated.student === 'object') {
    elevated.student = { ...elevated.student, superuser: true, role: 'admin' };
  }

  if (Array.isArray(elevated.subjects)) {
    elevated.subjects = elevated.subjects.map(subject => ({
      ...subject,
      views: Array.isArray(subject?.views) ? subject.views.map(forceOpenView) : []
    }));
  }
  if (elevated.view && typeof elevated.view === 'object') elevated.view = forceOpenView(elevated.view);
  if (Array.isArray(elevated.lessons)) elevated.lessons = elevated.lessons.map(forceOpenLessonSummary);
  if (elevated.lesson && typeof elevated.lesson === 'object') elevated.lesson = forceOpenLessonSummary(elevated.lesson);

  if (pathname === '/api/v1/student/special-areas' && Array.isArray(elevated.areas)) {
    elevated.areas = elevated.areas.map(area => clean(area?.bucketId) === 'MOCKS'
      ? { ...area, bucketId: ADMIN_MOCK_ALIAS, type: 'videos', passwordProtected: false }
      : area);
    elevated.source = 'adminSuperuser';
  }

  return elevated;
}

function safeFilename(value, fallback = 'answer-pack.pdf') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return /\.[a-z0-9]{1,8}$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

function parseAnswerResourceKey(resourceKey) {
  const parts = String(resourceKey || '').split('~');
  if (parts.length !== 3 || parts[1] !== 'answer') return null;
  let lessonId = '';
  try { lessonId = decodeURIComponent(parts[0]); } catch { return null; }
  const index = Number(parts[2]);
  if (!lessonId || !Number.isInteger(index) || index < 1) return null;
  return { lessonId, index };
}

function normaliseAnswerFile(value, fallbackName = 'Answer Pack') {
  if (!value || typeof value !== 'object') return null;
  const r2Key = clean(value.r2Key || value.r2);
  if (!r2Key) return null;
  return {
    r2Key,
    displayName: clean(value.displayName || value.name) || fallbackName
  };
}

function resolveAdminAnswerResource(record, index) {
  if (!record || !Number.isInteger(index)) return null;
  let bridged = record;
  try { bridged = bridgePhase11Answers(record); } catch { bridged = record; }

  const phase11 = phase11AnswerResource(bridged, index);
  if (phase11?.r2Key) return phase11;

  const core = bridged?.core || {};
  const homeworks = Array.isArray(bridged?.homeworks)
    ? bridged.homeworks
    : (Array.isArray(core.homeworks) ? core.homeworks : []);
  if (index >= 1 && index <= homeworks.length) {
    const ordinary = normaliseAnswerFile(
      homeworks[index - 1]?.answerPack || homeworks[index - 1]?.answerKey || homeworks[index - 1]?.answer,
      'Answer Pack'
    );
    if (ordinary) return ordinary;
  }

  const vr = bridged?.vr && typeof bridged.vr === 'object' ? bridged.vr : {};
  if (index > 1000 && index <= 1999) {
    const offset = index - 1001;
    const vrPre = Array.isArray(vr.preLesson) ? vr.preLesson[offset] : null;
    const answer = normaliseAnswerFile(vrPre?.answerKey || vrPre?.answerPack || vrPre?.answer, 'VR PreLesson Answer Key');
    if (answer) return answer;
  }
  if (index > 2000 && index <= 2999) {
    const offset = index - 2001;
    const vrHomework = Array.isArray(vr.homeworks) ? vr.homeworks[offset] : null;
    const answer = normaliseAnswerFile(vrHomework?.answerPack || vrHomework?.answerKey || vrHomework?.answer, 'VR Homework Answer Pack');
    if (answer) return answer;
  }
  return null;
}

async function adminAnswerDownload(request, env, resourceKey) {
  const parsed = parseAnswerResourceKey(resourceKey);
  if (!parsed) return null;
  const record = await env.LESSONS_KV.get(`lesson:${parsed.lessonId}`, { type: 'json' });
  if (!record || record.active === false) {
    return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404 }, request, env);
  }
  const resource = resolveAdminAnswerResource(record, parsed.index);
  if (!resource?.r2Key) {
    return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404 }, request, env);
  }
  const object = await env.MATERIALS_R2.get(resource.r2Key);
  if (!object?.body) return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404 }, request, env);
  const headers = new Headers(corsHeaders(request, env));
  object.writeHttpMetadata(headers);
  headers.set('content-type', headers.get('content-type') || 'application/pdf');
  headers.set('content-disposition', `attachment; filename="${safeFilename(resource.displayName)}"`);
  headers.set('cache-control', 'private, no-store, max-age=0');
  headers.set('pragma', 'no-cache');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.body, { status: 200, headers });
}

function screenpalEmbedUrl(screenpalId) {
  const id = clean(screenpalId);
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return `https://go.screenpal.com/player/${encodeURIComponent(id)}?ff=1&title=0&dcc=0&bg=transparent&embedded=1`;
}

async function mockCatalogue(env) {
  const catalogue = await env.LESSONS_KV.get('special:MOCKS', { type: 'json' });
  return catalogue && catalogue.active !== false ? catalogue : null;
}

async function adminMockDetail(request, env) {
  const catalogue = await mockCatalogue(env);
  if (!catalogue) return json({ error: 'SPECIAL_AREA_NOT_FOUND' }, { status: 404 }, request, env);
  const items = [];
  for (const day of Array.isArray(catalogue.days) ? catalogue.days : []) {
    const dayNumber = Number(day?.day);
    if (!Number.isInteger(dayNumber) || dayNumber < 1) continue;
    items.push({
      itemId: `day-${dayNumber}`,
      title: clean(day?.title) || `Mock ${dayNumber}`,
      description: clean(day?.description),
      separator: true,
      resourceKey: null
    });
    const videos = Array.isArray(day?.videos) ? day.videos : [];
    videos.forEach((video, index) => {
      if (!screenpalEmbedUrl(video?.screenpal)) return;
      items.push({
        itemId: `day-${dayNumber}-video-${index + 1}`,
        title: clean(video?.title) || `Answer video ${index + 1}`,
        description: clean(video?.subject).toUpperCase(),
        separator: false,
        resourceKey: `adminmock~${dayNumber}~${index + 1}`
      });
    });
  }
  return json({
    ok: true,
    area: {
      bucketId: ADMIN_MOCK_ALIAS,
      type: 'videos',
      title: clean(catalogue.title) || 'Mocks',
      description: clean(catalogue.description),
      passwordProtected: false,
      items
    },
    superuser: true
  }, { status: 200 }, request, env);
}

async function adminMockVideo(request, env, resourceKey) {
  const match = String(resourceKey || '').match(/^adminmock~(\d+)~(\d+)$/);
  if (!match) return null;
  const dayNumber = Number(match[1]);
  const index = Number(match[2]);
  const catalogue = await mockCatalogue(env);
  if (!catalogue) return json({ error: 'SPECIAL_RESOURCE_NOT_FOUND' }, { status: 404 }, request, env);
  const day = (Array.isArray(catalogue.days) ? catalogue.days : []).find(candidate => Number(candidate?.day) === dayNumber);
  const video = Array.isArray(day?.videos) ? day.videos[index - 1] : null;
  const embedUrl = screenpalEmbedUrl(video?.screenpal);
  if (!video || !embedUrl) return json({ error: 'SPECIAL_RESOURCE_NOT_FOUND' }, { status: 404 }, request, env);
  return json({
    ok: true,
    bucketId: ADMIN_MOCK_ALIAS,
    itemId: `day-${dayNumber}-video-${index}`,
    embedUrl,
    superuser: true
  }, { status: 200 }, request, env);
}

async function elevateResponse(response, pathname) {
  const type = String(response?.headers?.get('content-type') || '').toLowerCase();
  if (!type.includes('application/json')) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body || typeof body !== 'object') return response;
  return jsonLike(response, elevateJsonBody(body, pathname));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/v1/student/')) {
      return productionWorker.fetch(request, env, ctx);
    }

    if (url.pathname === '/api/v1/student/auth/login' && request.method === 'POST') {
      return productionWorker.fetch(request, env, ctx);
    }

    const session = await authenticatedSession(request, env, ctx);
    if (!session.portalUserIdNorm || !isConfiguredAdminSuperuser(env, session.portalUserIdNorm)) {
      return productionWorker.fetch(request, env, ctx);
    }

    if (url.pathname === '/api/v1/student/session' && request.method === 'GET') {
      return jsonLike(session.response, elevateJsonBody(session.body, url.pathname));
    }

    const elevatedEnv = adminSuperuserEnv(env, session.portalUserIdNorm);

    const downloadMatch = url.pathname.match(/^\/api\/v1\/student\/resources\/([^/]+)\/download$/);
    if (request.method === 'GET' && downloadMatch) {
      let resourceKey = '';
      try { resourceKey = decodeURIComponent(downloadMatch[1]); } catch { resourceKey = ''; }
      const answer = await adminAnswerDownload(request, elevatedEnv, resourceKey);
      if (answer) return answer;
    }

    const mockDetail = url.pathname.match(/^\/api\/v1\/student\/special-areas\/([^/]+)$/);
    if (request.method === 'GET' && mockDetail) {
      let bucketId = '';
      try { bucketId = decodeURIComponent(mockDetail[1]); } catch { bucketId = ''; }
      if (bucketId === ADMIN_MOCK_ALIAS || bucketId === 'MOCKS') {
        return adminMockDetail(request, elevatedEnv);
      }
    }

    const specialVideo = url.pathname.match(/^\/api\/v1\/student\/special-resources\/([^/]+)\/video$/);
    if (request.method === 'GET' && specialVideo) {
      let resourceKey = '';
      try { resourceKey = decodeURIComponent(specialVideo[1]); } catch { resourceKey = ''; }
      const mockVideo = await adminMockVideo(request, elevatedEnv, resourceKey);
      if (mockVideo) return mockVideo;
    }

    const response = await productionWorker.fetch(request, elevatedEnv, ctx);
    return elevateResponse(response, url.pathname);
  }
};

export {
  ADMIN_MOCK_ALIAS,
  FULL_LIBRARY_CODES,
  SPECIAL_BUCKET_IDS,
  adminSuperuserEnv,
  elevateJsonBody,
  isConfiguredAdminSuperuser,
  resolveAdminAnswerResource
};
