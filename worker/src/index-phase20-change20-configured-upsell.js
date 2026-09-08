import productionWorker from './index-phase20-change19-admin-fast.js';
import { kvCatalogueRowsForView, kvCatalogueCountsForViews } from './index-phase20-change13.js';

const SUBJECT_PREVIEW_MESSAGE = 'Full access available to enrolled students of the subject only';
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

const VIEW_META = Object.freeze({
  'maths-year2': { subject:'maths', label:'Year 2', rank:20 },
  'maths-year3': { subject:'maths', label:'Year 3', rank:30 },
  'maths-year4': { subject:'maths', label:'Year 4', rank:40 },
  'maths-year5': { subject:'maths', label:'Year 5', rank:50 },
  'maths-year6': { subject:'maths', label:'Year 6', rank:60 },
  'maths-level1': { subject:'maths', label:'L1', rank:41 },
  'maths-level2': { subject:'maths', label:'L2', rank:51 },
  'maths-level3': { subject:'maths', label:'L3', rank:61 },
  'english-year2': { subject:'english', label:'Year 2', rank:20 },
  'english-year3': { subject:'english', label:'Year 3', rank:30 },
  'english-year4': { subject:'english', label:'Year 4', rank:40 },
  'english-year5': { subject:'english', label:'Year 5', rank:50 },
  'english-year6': { subject:'english', label:'Year 6', rank:60 },
  'english-year4-11plus': { subject:'english', label:'Year 4 11+', rank:41 },
  'english-year5-11plus': { subject:'english', label:'Year 5 11+', rank:51 }
});

function jsonLike(response, body, status = 200) {
  const headers = new Headers(response?.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { status, headers });
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

function previewSummary(viewId, count) {
  const meta = VIEW_META[viewId];
  const visible = Math.max(0, Number(count) || 0);
  return {
    viewId,
    subject:meta.subject,
    label:meta.label,
    catalogueAvailable:visible > 0,
    visibleLessonCount:visible,
    openLessonCount:0,
    lockedLessonCount:visible,
    lockedPreview:true,
    current:true,
    group:'current',
    source:'configuredUpsell'
  };
}

async function configuredUpsellContext(request, env, ctx) {
  if (!env?.STUDENTS_KV) return { explicit:false, views:new Set() };
  const url = new URL(request.url);
  url.pathname = '/api/v1/student/session';
  url.search = '';
  const response = await productionWorker.fetch(new Request(url.toString(), {
    method:'GET',
    headers:request.headers
  }), env, ctx);
  const body = await response.clone().json().catch(() => null);
  if (!response.ok || !body?.ok || body?.accountLocked) return { explicit:false, views:new Set() };
  const portalUserIdNorm = norm(body?.portalUserId || body?.student?.portalUserId);
  if (!portalUserIdNorm) return { explicit:false, views:new Set() };
  const user = await env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type:'json' }).catch(() => null);
  if (!Array.isArray(user?.upsellViews)) return { explicit:false, views:new Set() };
  return {
    explicit:true,
    views:new Set(user.upsellViews.map(norm).filter(viewId => VIEW_META[viewId]))
  };
}

async function reconcileConfiguredPreviews(response, body, env, configured) {
  if (!response.ok || !body?.ok || !Array.isArray(body.subjects)) return response;
  const actual = new Set();

  for (const subject of body.subjects) {
    if (!Array.isArray(subject?.views)) subject.views = [];
    for (const view of subject.views) {
      const viewId = norm(view?.viewId);
      if (VIEW_META[viewId] && view?.lockedPreview !== true) actual.add(viewId);
    }
    subject.views = subject.views.filter(view => {
      if (view?.lockedPreview !== true) return true;
      return configured.has(norm(view?.viewId));
    });
  }

  const wanted = [...configured].filter(viewId => !actual.has(viewId));
  const counts = await kvCatalogueCountsForViews(env, wanted);
  for (const viewId of wanted) {
    const meta = VIEW_META[viewId];
    if (!meta) continue;
    const subject = ensureSubject(body, meta.subject);
    const existing = subject.views.find(view => norm(view?.viewId) === viewId);
    const summary = previewSummary(viewId, counts.get(viewId) || 0);
    if (existing) Object.assign(existing, summary);
    else subject.views.push(summary);
  }

  for (const subject of body.subjects) {
    subject.views.sort((a, b) => {
      const am = VIEW_META[norm(a?.viewId)]?.rank ?? 999;
      const bm = VIEW_META[norm(b?.viewId)]?.rank ?? 999;
      return am - bm || norm(a?.viewId).localeCompare(norm(b?.viewId));
    });
  }
  return jsonLike(response, body, response.status);
}

function listViewId(url) {
  const match = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
  if (!match) return '';
  try { return norm(decodeURIComponent(match[1])); } catch { return ''; }
}

function detailLessonId(url) {
  const match = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}

function lockedRow(row) {
  return {
    ...row,
    state:'locked',
    locked:true,
    blocked:false,
    preview:true,
    missedPreview:false,
    accessMode:'subject-preview',
    accessMessage:SUBJECT_PREVIEW_MESSAGE
  };
}

function lockedResource(name = 'Resource', protectedResource = false) {
  return {
    displayName:clean(name) || 'Resource',
    available:false,
    locked:true,
    protected:Boolean(protectedResource),
    passwordRequired:Boolean(protectedResource)
  };
}

function resourceName(value, fallback) {
  return clean(value?.displayName || value?.name || value?.title || fallback);
}

function lockedLesson(record, row) {
  const core = record?.core || {};
  const pre = Array.isArray(record?.preLessonSheets)
    ? record.preLessonSheets
    : (Array.isArray(core?.preLessonSheets) ? core.preLessonSheets : []);
  const homeworks = Array.isArray(record?.homeworks)
    ? record.homeworks
    : (Array.isArray(core?.homeworks) ? core.homeworks : []);
  const other = Array.isArray(record?.otherResources)
    ? record.otherResources
    : (Array.isArray(core?.otherResources) ? core.otherResources : []);
  const video = record?.video || core?.video || null;
  return {
    lessonId:row.lessonId,
    displayLessonId:row.displayLessonId,
    title:row.title,
    description:row.description || String(record?.description || record?.desc || ''),
    subject:clean(record?.subject),
    locked:true,
    state:'locked',
    accessMode:'subject-preview',
    accessMessage:SUBJECT_PREVIEW_MESSAGE,
    preLessonSheets:pre.map(item => lockedResource(resourceName(item, 'PreLesson Sheet'))),
    video:video ? lockedResource('Video') : null,
    homeworks:homeworks.map(pair => ({
      homework:pair?.homework || pair?.r2Key || pair?.r2
        ? lockedResource(resourceName(pair?.homework || pair, 'Homework'))
        : null,
      answerPack:pair?.answerPack
        ? lockedResource(resourceName(pair.answerPack, 'Answer Pack'), true)
        : null
    })),
    otherResources:other.map(item => lockedResource(resourceName(item, 'Resource')))
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || !url.pathname.startsWith('/api/v1/student/')) {
      return productionWorker.fetch(request, env, ctx);
    }

    const configured = await configuredUpsellContext(request, env, ctx);
    if (!configured.explicit) return productionWorker.fetch(request, env, ctx);

    if (url.pathname === '/api/v1/student/home' || url.pathname === '/api/v1/student/navigation') {
      const response = await productionWorker.fetch(request, env, ctx);
      const body = await response.clone().json().catch(() => null);
      return reconcileConfiguredPreviews(response, body, env, configured.views);
    }

    const listId = listViewId(url);
    const queryView = norm(url.searchParams.get('viewId'));
    const viewId = listId || queryView;
    if (!viewId || !configured.views.has(viewId) || !VIEW_META[viewId]) {
      return productionWorker.fetch(request, env, ctx);
    }

    const baseResponse = await productionWorker.fetch(request, env, ctx);
    const baseBody = await baseResponse.clone().json().catch(() => null);
    if (baseResponse.ok && baseBody?.ok) return baseResponse;

    const rows = await kvCatalogueRowsForView(env, viewId);
    if (listId) {
      const lockedRows = rows.map(lockedRow);
      return jsonLike(baseResponse, {
        ok:true,
        view:previewSummary(viewId, lockedRows.length),
        lessons:lockedRows
      }, 200);
    }

    const lessonId = detailLessonId(url);
    if (lessonId) {
      const row = rows.find(item => item.lessonId === lessonId);
      if (!row) return baseResponse;
      const record = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type:'json' }).catch(() => null);
      if (!record || record.active === false) return baseResponse;
      return jsonLike(baseResponse, {
        ok:true,
        view:previewSummary(viewId, rows.length),
        lesson:lockedLesson(record, row)
      }, 200);
    }

    return baseResponse;
  }
};
