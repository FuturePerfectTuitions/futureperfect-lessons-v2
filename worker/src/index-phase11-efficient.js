import phase11Worker from './index-phase11-final.js';
import {
  prepareSessionProfileEnv,
  persistSessionProfile
} from './phase11-session-profile.js';
import {
  appendKvAuditHeaders,
  createKvAudit,
  kvAuditEnv
} from './phase11-kv-audit.js';
import {
  YEAR5_MATHS_VIEW,
  displayLessonIdForLesson,
  normaliseLessonDisplayNamesForView,
  normaliseDisplayNameForView
} from './phase11-view-display-names.js';

function decodeSegment(value) {
  try { return decodeURIComponent(String(value || '')); } catch { return ''; }
}

function resourceLessonId(resourceKey) {
  const decoded = decodeSegment(resourceKey);
  if (!decoded) return '';
  return decodeSegment(String(decoded.split('~')[0] || ''));
}

function responseLikeJson(response, body) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function responseWithHeaders(response, headers) {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function normaliseYear5MathsResponse(request, response) {
  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  if (viewId !== YEAR5_MATHS_VIEW || !response) return response;

  const lessonMatch = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
  if (lessonMatch && request.method === 'GET' && response.ok) {
    const lessonId = decodeSegment(lessonMatch[1]);
    const body = await response.clone().json().catch(() => null);
    if (!body?.ok || !body.lesson) return response;
    const displayLessonId = String(
      body.lesson.displayLessonId || displayLessonIdForLesson(lessonId, viewId)
    ).trim();
    normaliseLessonDisplayNamesForView(body.lesson, displayLessonId, viewId);
    return responseLikeJson(response, body);
  }

  const authorizeMatch = url.pathname.match(
    /^\/api\/v1\/student\/resources\/([^/]+)\/answer\/authorize$/
  );
  if (authorizeMatch && request.method === 'POST' && response.ok) {
    const lessonId = resourceLessonId(authorizeMatch[1]);
    const displayLessonId = displayLessonIdForLesson(lessonId, viewId);
    const body = await response.clone().json().catch(() => null);
    if (!body?.ok || !displayLessonId) return response;
    if (typeof body.displayName === 'string') {
      body.displayName = normaliseDisplayNameForView(body.displayName, displayLessonId, viewId);
    }
    return responseLikeJson(response, body);
  }

  const downloadMatch = url.pathname.match(
    /^\/api\/v1\/student\/resources\/([^/]+)\/download$/
  );
  if (downloadMatch && request.method === 'GET' && response.ok) {
    const lessonId = resourceLessonId(downloadMatch[1]);
    const displayLessonId = displayLessonIdForLesson(lessonId, viewId);
    const disposition = response.headers.get('content-disposition') || '';
    if (!displayLessonId || !disposition) return response;
    const rewritten = normaliseDisplayNameForView(disposition, displayLessonId, viewId);
    if (rewritten === disposition) return response;
    const headers = new Headers(response.headers);
    headers.set('content-disposition', rewritten);
    headers.delete('content-length');
    return responseWithHeaders(response, headers);
  }

  return response;
}

export default {
  async fetch(request, env, ctx) {
    const audit = createKvAudit();
    const measuredEnv = kvAuditEnv(env, audit);
    const prepared = await prepareSessionProfileEnv(request, measuredEnv);
    const response = await phase11Worker.fetch(request, prepared.env, ctx);
    await persistSessionProfile(request, response, measuredEnv, prepared.state);
    const presentedResponse = await normaliseYear5MathsResponse(request, response);
    return appendKvAuditHeaders(presentedResponse, env, audit);
  }
};
