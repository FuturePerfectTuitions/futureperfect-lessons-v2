import phase11ResourcesWorker from './index-phase11-resources.js';
import { presentationForView } from './phase11-screenpal.js';
import {
  normaliseElevenPlusOther,
  elevenPlusOtherAt
} from './phase11-other-resources.js';

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
    'Access-Control-Expose-Headers': 'Content-Type',
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

function parseResourceKey(resourceKey) {
  const parts = String(resourceKey || '').split('~');
  if (parts.length !== 3) return null;
  let lessonId = '';
  try {
    lessonId = decodeURIComponent(parts[0]);
  } catch {
    return null;
  }
  const kind = String(parts[1] || '');
  const index = Number(parts[2]);
  if (!lessonId || !Number.isInteger(index) || index < 1) return null;
  return { lessonId, kind, index };
}

function makeResourceKey(lessonId, index) {
  return `${encodeURIComponent(String(lessonId))}~p11elevenother~${index}`;
}

function makeLessonVideoKey(lessonId) {
  return `${encodeURIComponent(String(lessonId))}~video~1`;
}

function safeFilename(value, fallback = 'resource.pdf') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return /\.[a-z0-9]{1,8}$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

async function loadLessonRecord(env, lessonId) {
  const record = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
  if (!record || record.active === false) return null;
  return record;
}

async function downstreamJson(request, env, pathname, search = '') {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = search;
  const internal = new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  });
  const response = await phase11ResourcesWorker.fetch(internal, env);
  const body = await response.clone().json().catch(() => null);
  return { response, body };
}

async function r2Available(env, r2Key) {
  if (!r2Key) return false;
  try {
    return Boolean(await env.MATERIALS_R2.head(r2Key));
  } catch {
    return false;
  }
}

function applyLessonVideoPresentation(body, lessonId, presentation) {
  const lesson = body?.lesson;
  if (!lesson) return;

  if (presentation !== '11plus') {
    // Normal streams receive only the ordinary lesson video. Phase 9's quiz
    // model is an internal implementation detail and must never be presented
    // as a separate student-facing resource.
    lesson.quiz = null;
    return;
  }

  // Owner rule: the ScreenPal quiz is the interactive 11+ variant of the
  // lesson video. It occupies the same Lesson Video slot; it is not an extra
  // section. If no quiz variant exists, an 11+ view must not fall back to the
  // normal-stream video.
  const hasInteractiveVideo = Boolean(lesson.quiz);
  lesson.quiz = null;
  if (!hasInteractiveVideo) {
    lesson.video = null;
    return;
  }

  lesson.video = lesson.locked
    ? { displayName: 'Video', locked: true }
    : {
        displayName: 'Video',
        resourceKey: makeLessonVideoKey(lessonId),
        locked: false
      };
}

async function augmentLessonDetail(request, env, lessonId) {
  const response = await phase11ResourcesWorker.fetch(request, env);
  const body = await response.clone().json().catch(() => null);
  if (!response.ok || !body?.ok || !body.lesson) return response;

  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  const presentation = presentationForView(viewId);
  applyLessonVideoPresentation(body, lessonId, presentation);

  if (presentation !== '11plus') {
    body.lesson.phase11OtherResources = null;
    return jsonLike(response, body);
  }

  const record = await loadLessonRecord(env, lessonId);
  if (!record) return response;
  const source = normaliseElevenPlusOther(record);
  if (!source.length) {
    body.lesson.phase11OtherResources = null;
    return jsonLike(response, body);
  }

  const locked = Boolean(body.lesson.locked);
  const safe = await Promise.all(source.map(async (item, offset) => {
    if (locked) {
      return {
        displayName: item.displayName,
        locked: true,
        protected: false
      };
    }
    const available = await r2Available(env, item.r2Key);
    return {
      displayName: item.displayName,
      resourceKey: available ? makeResourceKey(lessonId, offset + 1) : undefined,
      available,
      locked: false,
      protected: false
    };
  }));

  body.lesson.phase11OtherResources = { elevenPlus: safe };
  return jsonLike(response, body);
}

async function requireVisibleOpenElevenPlusLesson(request, env, lessonId, viewId) {
  if (!viewId || presentationForView(viewId) !== '11plus') {
    return { error: json({ error: 'RESOURCE_NOT_AVAILABLE' }, { status: 403, headers: corsHeaders(request, env) }) };
  }
  const path = `/api/v1/student/views/${encodeURIComponent(viewId)}/lessons`;
  const { response, body } = await downstreamJson(request, env, path);
  if (!response.ok || !body?.ok) return { error: response };
  const visible = (Array.isArray(body.lessons) ? body.lessons : [])
    .find(item => String(item?.lessonId || '') === String(lessonId));
  if (!visible) {
    return { error: json({ error: 'LESSON_NOT_VISIBLE' }, { status: 404, headers: corsHeaders(request, env) }) };
  }
  if (visible.locked) {
    return { error: json({ error: 'LESSON_LOCKED' }, { status: 403, headers: corsHeaders(request, env) }) };
  }
  const record = await loadLessonRecord(env, lessonId);
  if (!record) {
    return { error: json({ error: 'LESSON_NOT_FOUND' }, { status: 404, headers: corsHeaders(request, env) }) };
  }
  return { record };
}

async function handleElevenPlusOtherDownload(request, env, parsed) {
  const cors = corsHeaders(request, env);
  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  const context = await requireVisibleOpenElevenPlusLesson(request, env, parsed.lessonId, viewId);
  if (context.error) return context.error;

  const resource = elevenPlusOtherAt(context.record, parsed.index);
  if (!resource?.r2Key) {
    return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }
  const object = await env.MATERIALS_R2.get(resource.r2Key);
  if (!object?.body) {
    return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }

  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('content-type', headers.get('content-type') || 'application/pdf');
  headers.set('content-disposition', `attachment; filename="${safeFilename(resource.displayName)}"`);
  headers.set('cache-control', 'private, no-store, max-age=0');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.body, { status: 200, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const lessonMatch = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
    if (lessonMatch && request.method === 'GET') {
      return augmentLessonDetail(request, env, decodeURIComponent(lessonMatch[1]));
    }

    const resourceMatch = url.pathname.match(/^\/api\/v1\/student\/resources\/([^/]+)$/);
    if (resourceMatch && request.method === 'GET') {
      const parsed = parseResourceKey(decodeURIComponent(resourceMatch[1]));
      if (parsed?.kind === 'p11elevenother') {
        return handleElevenPlusOtherDownload(request, env, parsed);
      }
    }

    return phase11ResourcesWorker.fetch(request, env, ctx);
  }
};