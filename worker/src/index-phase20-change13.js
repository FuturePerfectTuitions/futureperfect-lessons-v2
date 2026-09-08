import change12Worker, { previewViewIdsFromHome } from './index-phase20-change12.js';
import { VIEW_CURRICULA } from './phase11-navigation-cache.js';

const SUBJECT_PREVIEW_MESSAGE = 'Full access available to enrolled students of the subject only';
const PREFETCH_CONCURRENCY = 64;

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

const clean = value => String(value ?? '').trim();
const cleanViewId = value => clean(value).toLowerCase();

function rawCatalogueItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw.lessonIds)) return raw.lessonIds;
  if (Array.isArray(raw.lessons)) return raw.lessons;
  if (Array.isArray(raw.items)) return raw.items;
  return [];
}

function lessonIdsFromCurriculum(raw) {
  return rawCatalogueItems(raw)
    .map(item => typeof item === 'string' ? clean(item) : clean(item?.lessonId))
    .filter(Boolean);
}

async function readJsonInBatches(namespace, keys, batchSize = PREFETCH_CONCURRENCY) {
  const result = new Map();
  const unique = [...new Set(keys.map(clean).filter(Boolean))];
  for (let offset = 0; offset < unique.length; offset += batchSize) {
    const batch = unique.slice(offset, offset + batchSize);
    const values = await Promise.all(batch.map(async key => [
      key,
      await namespace.get(key, { type: 'json' })
    ]));
    for (const [key, value] of values) {
      if (value != null) result.set(key, value);
    }
  }
  return result;
}

function displayLessonId(record, viewId) {
  const sources = [record?.displayIds, record?.displayLessonIds, record?.presentation?.displayIds];
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const direct = clean(source[viewId]);
    if (direct) return direct;
    const match = Object.entries(source).find(([key]) => cleanViewId(key) === viewId);
    if (match) {
      const value = clean(match[1]);
      if (value) return value;
    }
  }
  return clean(record?.lessonId);
}

function cleanStudentTitle(record, shownId) {
  let title = clean(record?.title);
  const canonical = clean(record?.lessonId);
  for (const prefix of [canonical, shownId]) {
    if (!prefix) continue;
    const marker = `${prefix} `;
    if (title.toLowerCase().startsWith(marker.toLowerCase())) {
      title = title.slice(marker.length).trim();
    }
  }
  return title || shownId || canonical;
}

async function kvCatalogueRowsForView(env, viewId) {
  const normalized = cleanViewId(viewId);
  const curricula = VIEW_CURRICULA[normalized] || [];
  if (!env?.LESSONS_KV || !curricula.length) return [];

  const curriculumValues = await readJsonInBatches(
    env.LESSONS_KV,
    curricula.map(code => `curriculum:${code}`),
    curricula.length
  );

  const lessonIds = [];
  const seen = new Set();
  for (const code of curricula) {
    const raw = curriculumValues.get(`curriculum:${code}`);
    for (const lessonId of lessonIdsFromCurriculum(raw)) {
      if (seen.has(lessonId)) continue;
      seen.add(lessonId);
      lessonIds.push(lessonId);
    }
  }
  if (!lessonIds.length) return [];

  const lessons = await readJsonInBatches(
    env.LESSONS_KV,
    lessonIds.map(id => `lesson:${id}`)
  );

  return lessonIds
    .map(lessonId => lessons.get(`lesson:${lessonId}`))
    .filter(record => record && record.active !== false)
    .map(record => {
      const shownId = displayLessonId(record, normalized);
      const numericOrder = Number(record?.order);
      return {
        lessonId: clean(record?.lessonId),
        displayLessonId: shownId,
        title: cleanStudentTitle(record, shownId),
        description: String(record?.description || record?.desc || ''),
        order: Number.isFinite(numericOrder) ? numericOrder : Number.MAX_SAFE_INTEGER
      };
    })
    .filter(row => row.lessonId)
    .sort((a, b) => a.order - b.order || a.lessonId.localeCompare(b.lessonId));
}

// Home only needs whether a preview catalogue exists and how many lessons it
// contains. Do not fetch every lesson record (titles/descriptions/resources) for
// the other subject before the student has chosen that subject. Current live
// curriculum membership remains authoritative, so the lightweight home summary
// reads only the required curriculum records and derives counts from lesson IDs.
async function kvCatalogueCountsForViews(env, viewIds) {
  const normalizedViews = [...new Set(
    (Array.isArray(viewIds) ? viewIds : [])
      .map(cleanViewId)
      .filter(viewId => VIEW_META[viewId] && Array.isArray(VIEW_CURRICULA[viewId]))
  )];
  const counts = new Map();
  if (!env?.LESSONS_KV || !normalizedViews.length) return counts;

  const curriculumCodes = [...new Set(
    normalizedViews.flatMap(viewId => VIEW_CURRICULA[viewId] || [])
  )];
  const curriculumValues = await readJsonInBatches(
    env.LESSONS_KV,
    curriculumCodes.map(code => `curriculum:${code}`),
    Math.max(1, curriculumCodes.length)
  );

  for (const viewId of normalizedViews) {
    const lessonIds = new Set();
    for (const code of VIEW_CURRICULA[viewId] || []) {
      const raw = curriculumValues.get(`curriculum:${code}`);
      for (const lessonId of lessonIdsFromCurriculum(raw)) lessonIds.add(lessonId);
    }
    counts.set(viewId, lessonIds.size);
  }
  return counts;
}

function jsonLike(response, body, status = null) {
  const headers = new Headers(response?.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), {
    status: status ?? response?.status ?? 200,
    headers
  });
}

function lockedRow(row) {
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

function viewSummary(viewId, rowsOrCount) {
  const meta = VIEW_META[viewId] || { subject: '', label: viewId };
  const count = Array.isArray(rowsOrCount)
    ? rowsOrCount.length
    : Math.max(0, Number(rowsOrCount) || 0);
  return {
    viewId,
    subject: meta.subject,
    label: meta.label,
    catalogueAvailable: count > 0,
    visibleLessonCount: count,
    openLessonCount: 0,
    lockedLessonCount: count,
    lockedPreview: true,
    current: true,
    group: 'current',
    source: 'crossSubjectPreview'
  };
}

function lockedResource(name = 'Resource', protectedResource = false) {
  return {
    displayName: clean(name) || 'Resource',
    available: false,
    locked: true,
    protected: Boolean(protectedResource),
    passwordRequired: Boolean(protectedResource)
  };
}

function resourceName(value, fallback) {
  return clean(value?.displayName || value?.name || value?.title || fallback);
}

function buildLockedLesson(record, row) {
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
    lessonId: row.lessonId,
    displayLessonId: row.displayLessonId,
    title: row.title,
    description: row.description,
    subject: clean(record?.subject),
    locked: true,
    state: 'locked',
    accessMode: 'subject-preview',
    accessMessage: SUBJECT_PREVIEW_MESSAGE,
    preLessonSheets: pre.map(item => lockedResource(resourceName(item, 'PreLesson Sheet'))),
    video: video ? lockedResource('Video') : null,
    homeworks: homeworks.map(pair => ({
      homework: pair?.homework || pair?.r2Key || pair?.r2
        ? lockedResource(resourceName(pair?.homework || pair, 'Homework'))
        : null,
      answerPack: pair?.answerPack
        ? lockedResource(resourceName(pair.answerPack, 'Answer Pack'), true)
        : null
    })),
    otherResources: other.map(item => lockedResource(resourceName(item, 'Resource'))
  };
}

async function homeWithKvPreviewCounts(request, env, ctx) {
  const response = await change12Worker.fetch(request, env, ctx);
  if (!response.ok) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body?.ok || !Array.isArray(body.subjects)) return response;

  const previews = [];
  for (const subject of body.subjects) {
    for (const view of Array.isArray(subject?.views) ? subject.views : []) {
      if (view?.lockedPreview !== true && view?.source !== 'crossSubjectPreview') continue;
      const viewId = cleanViewId(view?.viewId);
      if (!VIEW_META[viewId]) continue;
      previews.push({ view, viewId });
    }
  }

  const counts = await kvCatalogueCountsForViews(env, previews.map(item => item.viewId));
  for (const { view, viewId } of previews) {
    Object.assign(view, viewSummary(viewId, counts.get(viewId) || 0));
  }
  return jsonLike(response, body);
}

async function previewSet(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/v1/student/home';
  url.search = '';
  const response = await change12Worker.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  }), env, ctx);
  const body = await response.clone().json().catch(() => null);
  if (!response.ok || !body?.ok) return new Set();
  return previewViewIdsFromHome(body);
}

function listViewId(url) {
  const match = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
  if (!match) return '';
  try { return cleanViewId(decodeURIComponent(match[1])); } catch { return ''; }
}

function detailLessonId(url) {
  const match = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}

export {
  rawCatalogueItems,
  lessonIdsFromCurriculum,
  kvCatalogueRowsForView,
  kvCatalogueCountsForViews
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || !url.pathname.startsWith('/api/v1/student/')) {
      return change12Worker.fetch(request, env, ctx);
    }

    if (url.pathname === '/api/v1/student/home') {
      return homeWithKvPreviewCounts(request, env, ctx);
    }

    const listId = listViewId(url);
    const queryView = cleanViewId(url.searchParams.get('viewId'));
    const viewId = listId || queryView;
    if (!viewId || !VIEW_META[viewId]) return change12Worker.fetch(request, env, ctx);

    const previews = await previewSet(request, env, ctx);
    if (!previews.has(viewId)) return change12Worker.fetch(request, env, ctx);

    if (listId) {
      const baseResponse = await change12Worker.fetch(request, env, ctx);
      const rows = (await kvCatalogueRowsForView(env, viewId)).map(lockedRow);
      return jsonLike(baseResponse, {
        ok: true,
        view: viewSummary(viewId, rows),
        lessons: rows
      }, 200);
    }

    const lessonId = detailLessonId(url);
    if (lessonId) {
      const rows = await kvCatalogueRowsForView(env, viewId);
      const row = rows.find(item => item.lessonId === lessonId);
      if (!row) return change12Worker.fetch(request, env, ctx);
      const record = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
      if (!record || record.active === false) return change12Worker.fetch(request, env, ctx);
      const baseResponse = await change12Worker.fetch(request, env, ctx);
      return jsonLike(baseResponse, {
        ok: true,
        view: viewSummary(viewId, rows),
        lesson: buildLockedLesson(record, row)
      }, 200);
    }

    return change12Worker.fetch(request, env, ctx);
  }
};
