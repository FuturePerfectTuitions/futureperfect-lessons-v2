import phase11Worker from './phase11-vr-howto.js';
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
  displayLessonIdForLesson,
  normaliseLessonDisplayNamesForView,
  normaliseDisplayNameForView,
  isDisplayNameRewriteView
} from './phase11-view-display-names.js';

function decodeSegment(value) {
  try { return decodeURIComponent(String(value || '')); } catch { return ''; }
}

function resourceLessonId(resourceKey) {
  const decoded = decodeSegment(resourceKey);
  if (!decoded) return '';
  return decodeSegment(String(decoded.split('~')[0] || ''));
}

function resourceKind(resourceKey) {
  const decoded = decodeSegment(resourceKey);
  if (!decoded) return '';
  return String(decoded.split('~')[1] || '');
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

function isElevenPlusView(viewId) {
  const id = String(viewId || '').trim().toLowerCase();
  return /^maths-level[123]$/.test(id) || /^english-year[45]-11plus$/.test(id);
}

async function suppressVrVideoResponse(request, response) {
  const url = new URL(request.url);

  const lessonMatch = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
  if (lessonMatch && request.method === 'GET' && response.ok) {
    const body = await response.clone().json().catch(() => null);
    if (!body?.ok || !body.lesson?.vr) return response;
    const changed = body.lesson.vr.preLessonVideo != null || body.lesson.vr.homeworkVideo != null;
    if (!changed) return response;
    body.lesson.vr.preLessonVideo = null;
    body.lesson.vr.homeworkVideo = null;
    return responseLikeJson(response, body);
  }

  const videoMatch = url.pathname.match(/^\/api\/v1\/student\/resources\/([^/]+)\/video$/);
  if (videoMatch && request.method === 'GET' && response.ok) {
    const kind = resourceKind(videoMatch[1]);
    if (kind === 'vrprevideo' || kind === 'vrhomeworkvideo') {
      const headers = new Headers(response.headers);
      headers.set('content-type', 'application/json; charset=utf-8');
      headers.set('cache-control', 'no-store');
      headers.delete('content-length');
      return new Response(JSON.stringify({ error: 'RESOURCE_NOT_FOUND' }), {
        status: 404,
        headers
      });
    }
  }

  return response;
}

async function normalisePresentationResponse(request, response) {
  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  if (!response) return response;

  const lessonMatch = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
  if (lessonMatch && request.method === 'GET' && response.ok) {
    const lessonId = decodeSegment(lessonMatch[1]);
    const body = await response.clone().json().catch(() => null);
    if (!body?.ok || !body.lesson) return response;
    let changed = false;

    if (isDisplayNameRewriteView(viewId)) {
      const displayLessonId = String(
        body.lesson.displayLessonId || displayLessonIdForLesson(lessonId, viewId)
      ).trim();
      if (displayLessonId) {
        normaliseLessonDisplayNamesForView(body.lesson, displayLessonId, viewId);
        changed = true;
      }
    }

    // When an explicit 11+ Homework set exists, it substitutes for the ordinary
    // Homework set in the 11+ presentation. Ordinary Homework remains available
    // as fallback only when there is no explicit 11+ Homework for that lesson.
    const explicitElevenPlusHomework = body.lesson?.phase11Resources?.elevenPlus?.homeworks;
    if (
      isElevenPlusView(viewId) &&
      Array.isArray(explicitElevenPlusHomework) &&
      explicitElevenPlusHomework.length > 0 &&
      Array.isArray(body.lesson.homeworks) &&
      body.lesson.homeworks.length > 0
    ) {
      body.lesson.homeworks = [];
      changed = true;
    }

    return changed ? responseLikeJson(response, body) : response;
  }

  if (!isDisplayNameRewriteView(viewId)) return response;

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
    const displayResponse = await normalisePresentationResponse(request, response);
    const presentedResponse = await suppressVrVideoResponse(request, displayResponse);
    return appendKvAuditHeaders(presentedResponse, env, audit);
  }
};
