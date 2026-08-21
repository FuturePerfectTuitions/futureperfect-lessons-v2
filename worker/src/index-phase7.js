import baseWorker from './index.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

function allowedOrigins(env) {
  return new Set([
    'https://futureperfecttuitions.github.io',
    ...String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  ]);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'Content-Disposition,Content-Type',
    Vary: 'Origin'
  };
}

function json(body, init = {}) {
  const headers = new Headers(init.headers || {});
  for (const [key, value] of Object.entries(JSON_HEADERS)) headers.set(key, value);
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { ...init, headers });
}

function jsonLike(response, body) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(JSON_HEADERS)) headers.set(key, value);
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { status: response.status, headers });
}

function safeFilename(value, fallback = 'resource.pdf') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return /\.[a-z0-9]{1,8}$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

function displayIdForView(record, viewId) {
  const candidates = [
    record?.displayIds,
    record?.displayLessonIds,
    record?.presentation?.displayIds
  ];

  for (const source of candidates) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const direct = String(source[viewId] || '').trim();
    if (direct) return direct;
    const match = Object.entries(source).find(
      ([key]) => String(key).toLowerCase() === String(viewId).toLowerCase()
    );
    if (match) {
      const value = String(match[1] || '').trim();
      if (value) return value;
    }
  }

  return String(record?.lessonId || '').trim();
}

function cleanStudentTitle(record, displayLessonId) {
  let title = String(record?.title || '').trim();
  const canonical = String(record?.lessonId || '').trim();

  for (const prefix of [canonical, displayLessonId]) {
    if (!prefix) continue;
    const withSpace = `${prefix} `;
    if (title.toLowerCase().startsWith(withSpace.toLowerCase())) {
      title = title.slice(withSpace.length).trim();
    }
  }

  return title || displayLessonId || canonical;
}

function lessonCollections(record) {
  const core = record?.core || {};
  return {
    preLessonSheets: Array.isArray(record?.preLessonSheets)
      ? record.preLessonSheets
      : (Array.isArray(core.preLessonSheets) ? core.preLessonSheets : []),
    video: record?.video || core.video || null,
    homeworks: Array.isArray(record?.homeworks)
      ? record.homeworks
      : (Array.isArray(core.homeworks) ? core.homeworks : []),
    otherResources: Array.isArray(record?.otherResources)
      ? record.otherResources
      : (Array.isArray(core.otherResources) ? core.otherResources : [])
  };
}

function makeResourceKey(lessonId, kind, index) {
  return `${encodeURIComponent(String(lessonId))}~${kind}~${index}`;
}

function normaliseFile(item, fallbackName, lessonId, kind, index, protectedResource = false) {
  if (!item || typeof item !== 'object') return null;
  const r2Key = String(item.r2Key || item.r2 || '').trim();
  if (!r2Key) return null;
  return {
    resourceKey: makeResourceKey(lessonId, kind, index),
    displayName: String(item.displayName || item.name || fallbackName).trim() || fallbackName,
    r2Key,
    protected: protectedResource || Boolean(item.protected),
    kind
  };
}

function normaliseLessonPackage(record) {
  const lessonId = String(record?.lessonId || '').trim();
  const source = lessonCollections(record);

  const preLessonSheets = source.preLessonSheets
    .map((item, index) => normaliseFile(
      item,
      source.preLessonSheets.length > 1 ? `PreLesson Sheet ${index + 1}` : 'PreLesson Sheet',
      lessonId,
      'pre',
      index + 1
    ))
    .filter(Boolean);

  const videoRef = String(source.video?.screenpal || source.video?.sp || '').trim();
  const video = videoRef
    ? {
        resourceKey: makeResourceKey(lessonId, 'video', 1),
        displayName: 'Video',
        screenpal: videoRef
      }
    : null;

  const homeworks = source.homeworks.map((pair, index) => {
    const number = index + 1;
    const homeworkSource = pair?.homework || (pair?.r2Key || pair?.r2 ? pair : null);
    const answerSource = pair?.answerPack || null;
    const homework = normaliseFile(
      homeworkSource,
      source.homeworks.length > 1 ? `Homework ${number}` : 'Homework',
      lessonId,
      'homework',
      number
    );
    const answerPack = normaliseFile(
      answerSource,
      source.homeworks.length > 1 ? `Answer Pack ${number}` : 'Answer Pack',
      lessonId,
      'answer',
      number,
      true
    );
    return {
      pairKey: `${encodeURIComponent(lessonId)}~pair~${number}`,
      homework,
      answerPack
    };
  }).filter(pair => pair.homework || pair.answerPack);

  const otherResources = source.otherResources
    .map((item, index) => normaliseFile(
      item,
      source.otherResources.length > 1 ? `Resource ${index + 1}` : 'Resource',
      lessonId,
      'other',
      index + 1
    ))
    .filter(Boolean);

  return { preLessonSheets, video, homeworks, otherResources };
}

async function fileExists(env, item) {
  if (!item?.r2Key || !env.MATERIALS_R2) return false;
  try {
    return Boolean(await env.MATERIALS_R2.head(item.r2Key));
  } catch {
    return false;
  }
}

async function requestBaseJson(request, env, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = '';
  const internal = new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  });
  const response = await baseWorker.fetch(internal, env);
  let body = null;
  try {
    body = await response.json();
  } catch (_) {}
  return { response, body };
}

async function visibleLessonContext(request, env, viewId, lessonId) {
  if (!viewId) return { error: 'VIEW_REQUIRED', status: 400 };

  const listPath = `/api/v1/student/views/${encodeURIComponent(viewId)}/lessons`;
  const { response, body } = await requestBaseJson(request, env, listPath);
  if (!response.ok || !body?.ok) {
    return {
      error: body?.error || 'LESSON_ACCESS_CHECK_FAILED',
      status: response.status || 500
    };
  }

  const visible = (Array.isArray(body.lessons) ? body.lessons : [])
    .find(item => String(item?.lessonId || '') === String(lessonId));
  if (!visible) return { error: 'LESSON_NOT_VISIBLE', status: 404 };

  const record = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
  if (!record || record.active === false) return { error: 'LESSON_NOT_FOUND', status: 404 };

  return { visible, record, view: body.view || null };
}

async function safeLessonModel(env, record, visible, viewId) {
  const locked = Boolean(visible?.locked);
  const displayLessonId = displayIdForView(record, viewId);
  const packageData = normaliseLessonPackage(record);

  const safeFile = async item => {
    if (!item) return null;
    if (locked) {
      return {
        displayName: item.displayName,
        locked: true,
        protected: Boolean(item.protected)
      };
    }
    const available = await fileExists(env, item);
    if (item.protected) {
      return {
        displayName: item.displayName,
        available,
        locked: true,
        protected: true,
        passwordRequired: true
      };
    }
    return {
      resourceKey: item.resourceKey,
      displayName: item.displayName,
      available,
      locked: false,
      protected: false
    };
  };

  return {
    lessonId: String(record.lessonId || ''),
    displayLessonId,
    title: cleanStudentTitle(record, displayLessonId),
    description: String(record.description || record.desc || ''),
    subject: String(record.subject || ''),
    state: locked ? 'locked' : 'open',
    locked,
    preview: Boolean(visible?.preview),
    missedPreview: Boolean(visible?.missedPreview),
    preLessonSheets: await Promise.all(packageData.preLessonSheets.map(safeFile)),
    video: packageData.video
      ? (locked
          ? { displayName: 'Video', locked: true }
          : { resourceKey: packageData.video.resourceKey, displayName: 'Video', locked: false })
      : null,
    homeworks: await Promise.all(packageData.homeworks.map(async pair => ({
      pairKey: pair.pairKey,
      homework: await safeFile(pair.homework),
      answerPack: await safeFile(pair.answerPack)
    }))),
    otherResources: await Promise.all(packageData.otherResources.map(safeFile))
  };
}

async function handleAugmentedLessonList(request, env, viewId) {
  const response = await baseWorker.fetch(request, env);
  if (!response.ok) return response;

  let body = null;
  try {
    body = await response.json();
  } catch {
    return response;
  }
  if (!body?.ok || !Array.isArray(body.lessons)) return jsonLike(response, body);

  body.lessons = await Promise.all(body.lessons.map(async lesson => {
    const record = await env.LESSONS_KV.get(`lesson:${lesson.lessonId}`, { type: 'json' });
    if (!record) return lesson;
    const displayLessonId = displayIdForView(record, viewId);
    return {
      ...lesson,
      displayLessonId,
      title: cleanStudentTitle(record, displayLessonId)
    };
  }));

  return jsonLike(response, body);
}

async function handleLessonDetail(request, env, lessonId) {
  const cors = corsHeaders(request, env);
  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();

  try {
    const context = await visibleLessonContext(request, env, viewId, lessonId);
    if (context.error) return json({ error: context.error }, { status: context.status, headers: cors });

    const lesson = await safeLessonModel(env, context.record, context.visible, viewId);
    return json(
      {
        ok: true,
        view: context.view,
        lesson,
        timestamp: new Date().toISOString()
      },
      { status: 200, headers: cors }
    );
  } catch {
    return json({ error: 'LESSON_PAGE_BUILD_FAILED' }, { status: 500, headers: cors });
  }
}

function parseResourceKey(resourceKey) {
  const parts = String(resourceKey || '').split('~');
  if (parts.length !== 3) return null;
  let lessonId = '';
  try {
    lessonId = decodeURIComponent(parts[0]);
  } catch {
    return null;
  }
  const kind = parts[1];
  const index = Number(parts[2]);
  if (!lessonId || !['pre', 'homework', 'answer', 'other', 'video'].includes(kind)) return null;
  if (!Number.isInteger(index) || index < 1) return null;
  return { lessonId, kind, index };
}

function findResource(record, resourceKey) {
  const packageData = normaliseLessonPackage(record);
  const files = [
    ...packageData.preLessonSheets,
    ...packageData.homeworks.flatMap(pair => [pair.homework, pair.answerPack].filter(Boolean)),
    ...packageData.otherResources
  ];
  if (packageData.video) files.push(packageData.video);
  return files.find(item => item.resourceKey === resourceKey) || null;
}

async function handleDownload(request, env, resourceKey) {
  const cors = corsHeaders(request, env);
  const parsed = parseResourceKey(resourceKey);
  if (!parsed || parsed.kind === 'video') {
    return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }

  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  const context = await visibleLessonContext(request, env, viewId, parsed.lessonId);
  if (context.error) return json({ error: context.error }, { status: context.status, headers: cors });
  if (context.visible.locked) return json({ error: 'LESSON_LOCKED' }, { status: 403, headers: cors });

  const resource = findResource(context.record, resourceKey);
  if (!resource || !resource.r2Key) {
    return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }
  if (resource.protected) {
    return json({ error: 'PASSWORD_REQUIRED' }, { status: 403, headers: cors });
  }

  const object = await env.MATERIALS_R2.get(resource.r2Key);
  if (!object) return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });

  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('content-type', headers.get('content-type') || 'application/pdf');
  headers.set('content-disposition', `attachment; filename="${safeFilename(resource.displayName)}"`);
  headers.set('cache-control', 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.body, { status: 200, headers });
}

async function handleVideo(request, env, resourceKey) {
  const cors = corsHeaders(request, env);
  const parsed = parseResourceKey(resourceKey);
  if (!parsed || parsed.kind !== 'video') {
    return json({ error: 'VIDEO_NOT_FOUND' }, { status: 404, headers: cors });
  }

  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  const context = await visibleLessonContext(request, env, viewId, parsed.lessonId);
  if (context.error) return json({ error: context.error }, { status: context.status, headers: cors });
  if (context.visible.locked) return json({ error: 'LESSON_LOCKED' }, { status: 403, headers: cors });

  const resource = findResource(context.record, resourceKey);
  const screenpal = String(resource?.screenpal || '').trim();
  if (!screenpal) return json({ error: 'VIDEO_NOT_FOUND' }, { status: 404, headers: cors });

  const embedUrl = `https://go.screenpal.com/player/${encodeURIComponent(screenpal)}?ff=1&ahc=1&dcc=1&bg=transparent`;
  return json({ ok: true, embedUrl }, { status: 200, headers: cors });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return baseWorker.fetch(request, env, ctx);

    const listMatch = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
    if (listMatch && request.method === 'GET') {
      return handleAugmentedLessonList(request, env, decodeURIComponent(listMatch[1]));
    }

    const lessonMatch = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
    if (lessonMatch && request.method === 'GET') {
      return handleLessonDetail(request, env, decodeURIComponent(lessonMatch[1]));
    }

    const downloadMatch = url.pathname.match(/^\/api\/v1\/student\/resources\/([^/]+)\/download$/);
    if (downloadMatch && request.method === 'GET') {
      return handleDownload(request, env, decodeURIComponent(downloadMatch[1]));
    }

    const videoMatch = url.pathname.match(/^\/api\/v1\/student\/resources\/([^/]+)\/video$/);
    if (videoMatch && request.method === 'GET') {
      return handleVideo(request, env, decodeURIComponent(videoMatch[1]));
    }

    return baseWorker.fetch(request, env, ctx);
  }
};
