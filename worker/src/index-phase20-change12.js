import change11Worker from './index-phase20-change11.js';
import { canonicalCatalogueRowsForView } from './index-phase12.js';

const SUBJECT_PREVIEW_MESSAGE = 'Full access available to enrolled students of the subject only';

const VIEW_META = Object.freeze({
  'maths-year2': { subject: 'maths', label: 'Year 2' },
  'maths-year3': { subject: 'maths', label: 'Year 3' },
  'maths-year4': { subject: 'maths', label: 'Year 4' },
  'maths-year5': { subject: 'maths', label: 'Year 5' },
  'maths-year6': { subject: 'maths', label: 'Year 6' },
  'maths-level1': { subject: 'maths', label: 'Level 1 11+' },
  'maths-level2': { subject: 'maths', label: 'Level 2 11+' },
  'maths-level3': { subject: 'maths', label: 'Level 3 11+' },
  'english-year2': { subject: 'english', label: 'Year 2' },
  'english-year3': { subject: 'english', label: 'Year 3' },
  'english-year4': { subject: 'english', label: 'Year 4' },
  'english-year5': { subject: 'english', label: 'Year 5' },
  'english-year6': { subject: 'english', label: 'Year 6' },
  'english-year4-11plus': { subject: 'english', label: 'Year 4 11+' },
  'english-year5-11plus': { subject: 'english', label: 'Year 5 11+' }
});

const COUNTERPART_VIEW = Object.freeze({
  'maths-year2': 'english-year2',
  'maths-year3': 'english-year3',
  'maths-year4': 'english-year4',
  'maths-year5': 'english-year5',
  'maths-year6': 'english-year6',
  'maths-level1': 'english-year4-11plus',
  'maths-level2': 'english-year5-11plus',
  'maths-level3': 'english-year6',
  'english-year2': 'maths-year2',
  'english-year3': 'maths-year3',
  'english-year4': 'maths-year4',
  'english-year5': 'maths-year5',
  'english-year6': 'maths-year6',
  'english-year4-11plus': 'maths-level1',
  'english-year5-11plus': 'maths-level2'
});

const clean = value => String(value ?? '').trim();
const cleanViewId = value => clean(value).toLowerCase();

function jsonLike(response, body) {
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

function json(body, status, response = null) {
  const headers = new Headers(response?.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { status, headers });
}

function ensureSubject(body, subjectName) {
  if (!Array.isArray(body.subjects)) body.subjects = [];
  let subject = body.subjects.find(item => clean(item?.subject).toLowerCase() === subjectName);
  if (!subject) {
    subject = {
      subject: subjectName,
      label: subjectName === 'maths' ? 'Maths' : 'English',
      views: []
    };
    body.subjects.push(subject);
  }
  if (!Array.isArray(subject.views)) subject.views = [];
  return subject;
}

function actualViewIdsFromHome(body) {
  const actual = new Set();
  for (const subject of Array.isArray(body?.subjects) ? body.subjects : []) {
    for (const view of Array.isArray(subject?.views) ? subject.views : []) {
      const viewId = cleanViewId(view?.viewId);
      if (!VIEW_META[viewId]) continue;
      if (view?.lockedPreview === true || view?.source === 'crossSubjectPreview') continue;
      actual.add(viewId);
    }
  }
  return actual;
}

function previewViewIdsFromHome(body) {
  const actual = actualViewIdsFromHome(body);
  const previews = new Set();
  for (const viewId of actual) {
    const counterpart = COUNTERPART_VIEW[viewId];
    if (counterpart && !actual.has(counterpart)) previews.add(counterpart);
  }
  return previews;
}

async function canonicalRows(env, viewId) {
  const rows = canonicalCatalogueRowsForView(viewId);
  return Promise.all(rows.map(async row => {
    const record = await env.LESSONS_KV.get(`lesson:${row.lessonId}`, { type: 'json' });
    return {
      ...row,
      description: String(record?.description || record?.desc || '')
    };
  }));
}

async function baseHome(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/v1/student/home';
  url.search = '';
  const response = await change11Worker.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  }), env, ctx);
  const body = await response.clone().json().catch(() => null);
  return { response, body };
}

async function addPreviewViewsToHome(response, body, env) {
  if (!response.ok || !body?.ok) return response;
  const previews = previewViewIdsFromHome(body);
  for (const viewId of previews) {
    const meta = VIEW_META[viewId];
    if (!meta) continue;
    const rows = await canonicalRows(env, viewId);
    const subject = ensureSubject(body, meta.subject);
    const existing = subject.views.find(view => cleanViewId(view?.viewId) === viewId);
    const summary = {
      viewId,
      subject: meta.subject,
      label: meta.label,
      catalogueAvailable: true,
      visibleLessonCount: rows.length,
      openLessonCount: 0,
      lockedLessonCount: rows.length,
      lockedPreview: true,
      current: true,
      group: 'current',
      source: 'crossSubjectPreview'
    };
    if (existing) Object.assign(existing, summary);
    else subject.views.push(summary);
  }
  return jsonLike(response, body);
}

function lockedListRow(row) {
  return {
    ...row,
    state: 'locked',
    locked: true,
    blocked: false,
    preview: true,
    missedPreview: false,
    accessMode: 'subject-preview',
    accessMessage: SUBJECT_PREVIEW_MESSAGE
  };
}

async function previewListResponse(request, env, viewId, baseResponse = null) {
  const rows = (await canonicalRows(env, viewId)).map(lockedListRow);
  const meta = VIEW_META[viewId];
  return json({
    ok: true,
    view: {
      viewId,
      subject: meta.subject,
      label: meta.label,
      catalogueAvailable: true,
      visibleLessonCount: rows.length,
      openLessonCount: 0,
      lockedLessonCount: rows.length,
      lockedPreview: true,
      current: true,
      group: 'current',
      source: 'crossSubjectPreview'
    },
    lessons: rows
  }, 200, baseResponse);
}

function lockedResource(displayName = 'Resource', protectedResource = false) {
  return {
    displayName,
    available: false,
    locked: true,
    protected: protectedResource,
    passwordRequired: protectedResource
  };
}

function minimalLockedLesson(record, row) {
  return {
    lessonId: clean(record?.lessonId || row?.lessonId),
    displayLessonId: clean(row?.displayLessonId || record?.lessonId || row?.lessonId),
    title: clean(row?.title || record?.title),
    description: String(record?.description || record?.desc || ''),
    subject: clean(record?.subject || VIEW_META[cleanViewId(row?.viewId)]?.subject),
    locked: true,
    state: 'locked',
    accessMode: 'subject-preview',
    accessMessage: SUBJECT_PREVIEW_MESSAGE,
    preLessonSheets: [],
    video: record?.video || record?.core?.video ? lockedResource('Video') : null,
    homeworks: [],
    otherResources: []
  };
}

async function previewDetailResponse(request, env, viewId, lessonId, baseResponse = null) {
  const rows = canonicalCatalogueRowsForView(viewId);
  const row = rows.find(item => String(item.lessonId) === String(lessonId));
  if (!row) return baseResponse || json({ error: 'LESSON_NOT_VISIBLE' }, 404);
  const record = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
  if (!record || record.active === false) return baseResponse || json({ error: 'LESSON_NOT_VISIBLE' }, 404);
  const meta = VIEW_META[viewId];
  const lesson = minimalLockedLesson(record, { ...row, viewId });
  return json({
    ok: true,
    view: {
      viewId,
      subject: meta.subject,
      label: meta.label,
      catalogueAvailable: true,
      lockedPreview: true,
      current: true,
      group: 'current',
      source: 'crossSubjectPreview'
    },
    lesson
  }, 200, baseResponse);
}

function pathViewId(url) {
  const match = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
  if (!match) return '';
  try { return cleanViewId(decodeURIComponent(match[1])); } catch { return ''; }
}

function pathLessonId(url) {
  const match = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}

async function allowedPreviewViews(request, env, ctx) {
  const { response, body } = await baseHome(request, env, ctx);
  if (!response.ok || !body?.ok) return new Set();
  return previewViewIdsFromHome(body);
}

export {
  COUNTERPART_VIEW,
  actualViewIdsFromHome,
  previewViewIdsFromHome
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method !== 'GET' || !url.pathname.startsWith('/api/v1/student/')) {
      return change11Worker.fetch(request, env, ctx);
    }

    if (url.pathname === '/api/v1/student/home') {
      const response = await change11Worker.fetch(request, env, ctx);
      const body = await response.clone().json().catch(() => null);
      return addPreviewViewsToHome(response, body, env);
    }

    const viewId = cleanViewId(url.searchParams.get('viewId') || pathViewId(url));
    if (!viewId || !VIEW_META[viewId]) return change11Worker.fetch(request, env, ctx);

    const previews = await allowedPreviewViews(request, env, ctx);
    if (!previews.has(viewId)) return change11Worker.fetch(request, env, ctx);

    const response = await change11Worker.fetch(request, env, ctx);
    const body = await response.clone().json().catch(() => null);
    if (response.ok && body?.ok) {
      if (Array.isArray(body.lessons) && body.lessons.some(item => item?.locked === false)) return response;
      if (body?.lesson?.locked === false) return response;
    }

    if (/^\/api\/v1\/student\/views\/[^/]+\/lessons$/.test(url.pathname)) {
      return previewListResponse(request, env, viewId, response);
    }

    const lessonId = pathLessonId(url);
    if (lessonId) return previewDetailResponse(request, env, viewId, lessonId, response);

    if (url.pathname.startsWith('/api/v1/student/resources/')) {
      return json({
        error: 'SUBJECT_ENROLMENT_REQUIRED',
        message: SUBJECT_PREVIEW_MESSAGE
      }, 403, response);
    }

    return response;
  }
};
