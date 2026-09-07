import change9Worker from './index-phase20-change9.js';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function jsonResponseLike(response, body) {
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

function usablePreLessonResource(resource) {
  return Boolean(
    resource &&
    resource.locked !== true &&
    resource.available !== false &&
    clean(resource.resourceKey)
  );
}

function hasUsablePreLesson(lesson) {
  if (!lesson || typeof lesson !== 'object') return false;

  if ((Array.isArray(lesson.preLessonSheets) ? lesson.preLessonSheets : [])
    .some(usablePreLessonResource)) return true;

  const phase11 = lesson.phase11Resources;
  if ((Array.isArray(phase11?.corePreLessonPairs) ? phase11.corePreLessonPairs : [])
    .some(pair => usablePreLessonResource(pair?.primary))) return true;

  if ((Array.isArray(phase11?.elevenPlus?.preLessonPairs) ? phase11.elevenPlus.preLessonPairs : [])
    .some(pair => usablePreLessonResource(pair?.primary))) return true;

  if ((Array.isArray(lesson.vr?.preLesson) ? lesson.vr.preLesson : [])
    .some(pair => usablePreLessonResource(pair?.sheet))) return true;

  return false;
}

async function preLessonAvailability(request, env, ctx, lessonId, viewId) {
  if (!lessonId || !viewId) return false;
  const url = new URL(request.url);
  url.pathname = `/api/v1/student/lessons/${encodeURIComponent(lessonId)}`;
  url.search = `?viewId=${encodeURIComponent(viewId)}`;
  const internal = new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  });
  const response = await change9Worker.fetch(internal, env, ctx);
  const body = await response.clone().json().catch(() => null);
  return Boolean(response.ok && body?.ok && hasUsablePreLesson(body.lesson));
}

async function annotateLessonList(request, env, ctx, body, viewId) {
  if (!Array.isArray(body?.lessons)) return body;

  const candidates = body.lessons.filter(item =>
    item?.accessMode === 'prelesson' && item?.locked === false && item?.lessonId
  );

  const checks = await Promise.all(candidates.map(async item => ({
    lessonId: String(item.lessonId),
    available: await preLessonAvailability(request, env, ctx, String(item.lessonId), viewId)
  })));
  const availability = new Map(checks.map(item => [item.lessonId, item.available]));

  for (const lesson of body.lessons) {
    if (!availability.has(String(lesson?.lessonId || ''))) continue;
    const available = availability.get(String(lesson.lessonId));
    lesson.preLessonAvailable = available;
    lesson.clickable = available;
    lesson.availabilityLabel = available ? 'PreLesson Sheets only' : 'No PreLesson Sheets';
    if (!available) {
      lesson.state = 'prelesson-empty';
      lesson.locked = true;
    }
  }

  if (body.view && typeof body.view === 'object') {
    body.view.openLessonCount = body.lessons.filter(item => item?.locked === false).length;
    body.view.lockedLessonCount = body.lessons.filter(item => item?.locked !== false).length;
  }
  return body;
}

async function annotateHome(request, env, ctx, body) {
  if (!Array.isArray(body?.recentShares)) return body;

  const candidates = body.recentShares.filter(item =>
    item?.accessMode === 'prelesson' && item?.lessonId && item?.viewId
  );

  const checks = await Promise.all(candidates.map(async item => ({
    lessonId: String(item.lessonId),
    viewId: norm(item.viewId),
    available: await preLessonAvailability(
      request,
      env,
      ctx,
      String(item.lessonId),
      String(item.viewId)
    )
  })));
  const availability = new Map(checks.map(item => [`${item.viewId}\u0000${item.lessonId}`, item.available]));

  for (const item of body.recentShares) {
    const key = `${norm(item?.viewId)}\u0000${String(item?.lessonId || '')}`;
    if (!availability.has(key)) continue;
    const available = availability.get(key);
    item.preLessonAvailable = available;
    item.clickable = available;
    item.accessLabel = available ? 'PreLesson Sheets only' : 'No PreLesson Sheets';
  }
  return body;
}

export { usablePreLessonResource, hasUsablePreLesson, annotateLessonList, annotateHome };

export default {
  async fetch(request, env, ctx) {
    const response = await change9Worker.fetch(request, env, ctx);
    if (!response.ok || request.method !== 'GET') return response;

    const url = new URL(request.url);
    const isHome = url.pathname === '/api/v1/student/home';
    const viewMatch = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
    if (!isHome && !viewMatch) return response;

    const body = await response.clone().json().catch(() => null);
    if (!body?.ok) return response;

    if (isHome) {
      return jsonResponseLike(response, await annotateHome(request, env, ctx, body));
    }

    let viewId = '';
    try { viewId = decodeURIComponent(viewMatch[1]); } catch { viewId = ''; }
    if (!viewId) return response;
    return jsonResponseLike(response, await annotateLessonList(request, env, ctx, body, viewId));
  }
};
