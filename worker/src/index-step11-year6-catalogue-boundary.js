import currentWorker from './index-step10-quiz-bridge.js';
import ownerBaseWorker from './index-phase20-change11.js';
import { isYear6SatsLesson } from './index-phase20-change15.js';

const YEAR6_CANONICAL_VIEW = 'maths-year6';
const YEAR6_LESSONS_ALIAS = 'maths-year6-lessons';
const YEAR6_SATS_VIEW = 'maths-sats';
const ADMIN0206 = 'admin0206';
const YEAR6_11PLUS_ONLY_IDS = new Set([
  'maths_l3_11p_t2m25_2026',
  'maths_l3_11p_t3m43_2026'
]);

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

export function isYear6ElevenPlusOnlyLesson(row) {
  const ids = [
    row?.lessonId,
    row?.lesson_id,
    row?.displayLessonId,
    row?.display_lesson_id
  ].map(norm).filter(Boolean);
  return ids.some(id => YEAR6_11PLUS_ONLY_IDS.has(id));
}

export function filterYear6TeachingRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter(row => !isYear6SatsLesson(row) && !isYear6ElevenPlusOnlyLesson(row));
}

function countSummary(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const open = list.filter(row => row?.locked === false).length;
  return {
    visibleLessonCount:list.length,
    openLessonCount:open,
    lockedLessonCount:Math.max(0, list.length - open)
  };
}

function jsonLike(response, body) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), {
    status:response.status,
    statusText:response.statusText,
    headers
  });
}

function listedViewId(url) {
  const match = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
  if (!match) return '';
  try { return norm(decodeURIComponent(match[1])); } catch { return ''; }
}

function mappedYear6Request(request) {
  const url = new URL(request.url);
  url.pathname = `/api/v1/student/views/${YEAR6_CANONICAL_VIEW}/lessons`;
  url.search = '';
  return new Request(url.toString(), request);
}

async function requestPortalUserId(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/v1/student/session';
  url.search = '';
  const response = await currentWorker.fetch(new Request(url.toString(), {
    method:'GET',
    headers:request.headers
  }), env, ctx);
  if (!response.ok) return '';
  const body = await response.clone().json().catch(() => null);
  if (!body?.ok || body?.accountLocked) return '';
  return norm(body?.portalUserId || body?.student?.portalUserId || body?.student?.username);
}

async function isAdmin0206Request(request, env, ctx) {
  return (await requestPortalUserId(request, env, ctx)) === ADMIN0206;
}

export function isYear6TeachingListRequest(request) {
  if (request.method !== 'GET') return false;
  const viewId = listedViewId(new URL(request.url));
  return viewId === YEAR6_CANONICAL_VIEW || viewId === YEAR6_LESSONS_ALIAS;
}

export function isYear6SatsListRequest(request) {
  if (request.method !== 'GET') return false;
  return listedViewId(new URL(request.url)) === YEAR6_SATS_VIEW;
}

async function filteredTeachingResponse(response) {
  if (!response.ok) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body?.ok || !Array.isArray(body.lessons)) return response;

  const rows = filterYear6TeachingRows(body.lessons);
  body.lessons = rows;
  if (body.view && typeof body.view === 'object') {
    Object.assign(body.view, {
      viewId:YEAR6_CANONICAL_VIEW,
      label:'Year 6',
      ...countSummary(rows)
    });
  }
  return jsonLike(response, body);
}

async function filteredYear6TeachingList(request, env, ctx) {
  // Admin0206 is an owner verification login with broad Full Library access.
  // The later cross-subject-preview presentation layers each rebuild /home before
  // a list request, which is unnecessary for this exact owner account and can
  // exceed the Worker/browser timeout. Use the same authenticated access engine
  // below those presentation-only preview wrappers, then apply the global Y6
  // catalogue boundary. No entitlement, release, resource or history is changed.
  if (await isAdmin0206Request(request, env, ctx)) {
    return filteredTeachingResponse(
      await ownerBaseWorker.fetch(mappedYear6Request(request), env, ctx)
    );
  }

  return filteredTeachingResponse(await currentWorker.fetch(request, env, ctx));
}

async function admin0206SatsList(request, env, ctx) {
  const response = await ownerBaseWorker.fetch(mappedYear6Request(request), env, ctx);
  if (!response.ok) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body?.ok || !Array.isArray(body.lessons)) return response;

  const rows = body.lessons.filter(isYear6SatsLesson);
  body.lessons = rows;
  body.view = {
    ...(body.view || {}),
    viewId:YEAR6_SATS_VIEW,
    subject:'maths',
    label:'SATS',
    catalogueAvailable:true,
    current:true,
    group:'current',
    lockedPreview:false,
    ...countSummary(rows)
  };
  return jsonLike(response, body);
}

export default {
  async fetch(request, env, ctx) {
    if (isYear6TeachingListRequest(request)) {
      return filteredYear6TeachingList(request, env, ctx);
    }

    if (isYear6SatsListRequest(request) && await isAdmin0206Request(request, env, ctx)) {
      return admin0206SatsList(request, env, ctx);
    }

    return currentWorker.fetch(request, env, ctx);
  }
};
