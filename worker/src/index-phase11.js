import phase10HistoryWorker from './index-phase10-history.js';
import {
  explicitMainVideo,
  explicitVrVideo,
  explicitQuiz
} from './phase11-screenpal.js';

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

async function downstreamJson(request, env, pathname, search = '') {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = search;
  const internal = new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  });
  const response = await phase10HistoryWorker.fetch(internal, env);
  const body = await response.clone().json().catch(() => null);
  return { response, body };
}

async function loadLessonRecord(env, lessonId) {
  const record = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
  if (!record || record.active === false) return null;
  return record;
}

async function requireVisibleOpenLesson(request, env, lessonId, viewId) {
  if (!viewId) {
    return {
      error: json({ error: 'VIEW_REQUIRED' }, { status: 400, headers: corsHeaders(request, env) })
    };
  }

  const path = `/api/v1/student/views/${encodeURIComponent(viewId)}/lessons`;
  const { response, body } = await downstreamJson(request, env, path);
  if (!response.ok || !body?.ok) return { error: response };

  const visible = (Array.isArray(body.lessons) ? body.lessons : [])
    .find(item => String(item?.lessonId || '') === String(lessonId));

  if (!visible) {
    return {
      error: json({ error: 'LESSON_NOT_VISIBLE' }, { status: 404, headers: corsHeaders(request, env) })
    };
  }
  if (visible.locked) {
    return {
      error: json({ error: 'LESSON_LOCKED' }, { status: 403, headers: corsHeaders(request, env) })
    };
  }

  const record = await loadLessonRecord(env, lessonId);
  if (!record) {
    return {
      error: json({ error: 'LESSON_NOT_FOUND' }, { status: 404, headers: corsHeaders(request, env) })
    };
  }

  return { visible, record, view: body.view || null };
}

async function authorisedLessonDetail(request, env, lessonId, viewId) {
  if (!viewId) {
    return {
      error: json({ error: 'VIEW_REQUIRED' }, { status: 400, headers: corsHeaders(request, env) })
    };
  }

  const path = `/api/v1/student/lessons/${encodeURIComponent(lessonId)}`;
  const search = `?viewId=${encodeURIComponent(viewId)}`;
  const { response, body } = await downstreamJson(request, env, path, search);
  if (!response.ok || !body?.ok || !body.lesson) return { error: response };

  const record = await loadLessonRecord(env, lessonId);
  if (!record) {
    return {
      error: json({ error: 'LESSON_NOT_FOUND' }, { status: 404, headers: corsHeaders(request, env) })
    };
  }

  return { lesson: body.lesson, record, view: body.view || null };
}

async function handleExplicitVideo(request, env, parsed) {
  const cors = corsHeaders(request, env);
  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();

  if (parsed.kind === 'video' && parsed.index === 1) {
    const context = await requireVisibleOpenLesson(request, env, parsed.lessonId, viewId);
    if (context.error) return context.error;

    const target = explicitMainVideo(context.record, viewId);
    if (!target?.embedUrl) {
      return json(
        {
          error: 'VIDEO_URL_REQUIRED',
          message: 'This lesson has no approved explicit ScreenPal embed URL in the Phase 11 catalogue.'
        },
        { status: 409, headers: cors }
      );
    }

    return json(
      {
        ok: true,
        displayName: 'Video',
        embedUrl: target.embedUrl
      },
      { status: 200, headers: cors }
    );
  }

  if (
    (parsed.kind === 'vrprevideo' || parsed.kind === 'vrhomeworkvideo') &&
    parsed.index === 1
  ) {
    const context = await authorisedLessonDetail(request, env, parsed.lessonId, viewId);
    if (context.error) return context.error;

    const authorisedModel = parsed.kind === 'vrprevideo'
      ? context.lesson?.vr?.preLessonVideo
      : context.lesson?.vr?.homeworkVideo;

    if (!authorisedModel || authorisedModel.locked) {
      return json({ error: 'VR_NOT_AVAILABLE' }, { status: 403, headers: cors });
    }

    const target = explicitVrVideo(context.record, parsed.kind);
    if (!target?.embedUrl) {
      return json(
        {
          error: 'VIDEO_URL_REQUIRED',
          message: 'This VR resource has no approved explicit ScreenPal embed URL in the Phase 11 catalogue.'
        },
        { status: 409, headers: cors }
      );
    }

    return json(
      {
        ok: true,
        displayName: parsed.kind === 'vrprevideo'
          ? 'VR PreLesson Video'
          : 'VR Homework Solution Video',
        embedUrl: target.embedUrl
      },
      { status: 200, headers: cors }
    );
  }

  return json({ error: 'VIDEO_NOT_FOUND' }, { status: 404, headers: cors });
}

async function handleExplicitQuiz(request, env, parsed) {
  const cors = corsHeaders(request, env);
  if (parsed.kind !== 'quiz' || parsed.index !== 1) {
    return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }

  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  const context = await authorisedLessonDetail(request, env, parsed.lessonId, viewId);
  if (context.error) return context.error;

  if (!context.lesson?.quiz || context.lesson.quiz.locked) {
    return json({ error: 'QUIZ_NOT_AVAILABLE' }, { status: 403, headers: cors });
  }

  const target = explicitQuiz(context.record);
  if (!target?.url) {
    return json(
      {
        error: 'QUIZ_URL_REQUIRED',
        message: 'This lesson has no approved explicit ScreenPal quiz URL in the Phase 11 catalogue.'
      },
      { status: 409, headers: cors }
    );
  }

  return json(
    {
      ok: true,
      displayName: target.displayName,
      mode: target.mode,
      url: target.url
    },
    { status: 200, headers: cors }
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return phase10HistoryWorker.fetch(request, env, ctx);
    }

    const videoMatch = url.pathname.match(/^\/api\/v1\/student\/resources\/([^/]+)\/video$/);
    if (videoMatch && request.method === 'GET') {
      const parsed = parseResourceKey(decodeURIComponent(videoMatch[1]));
      if (!parsed) {
        return json(
          { error: 'VIDEO_NOT_FOUND' },
          { status: 404, headers: corsHeaders(request, env) }
        );
      }
      return handleExplicitVideo(request, env, parsed);
    }

    const quizMatch = url.pathname.match(/^\/api\/v1\/student\/resources\/([^/]+)\/quiz$/);
    if (quizMatch && request.method === 'GET') {
      const parsed = parseResourceKey(decodeURIComponent(quizMatch[1]));
      if (!parsed) {
        return json(
          { error: 'RESOURCE_NOT_FOUND' },
          { status: 404, headers: corsHeaders(request, env) }
        );
      }
      return handleExplicitQuiz(request, env, parsed);
    }

    return phase10HistoryWorker.fetch(request, env, ctx);
  }
};
