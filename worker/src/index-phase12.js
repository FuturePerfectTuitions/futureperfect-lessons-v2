import phase11EfficientWorker from './index-phase11-efficient.js';
import { PHASE11_NAVIGATION_MANIFEST } from './phase11-navigation-manifest.generated.js';
import { VIEW_CURRICULA, validBundledManifest } from './phase11-navigation-cache.js';

const LOCKED_PREVIEW_OVERLAYS = Object.freeze({
  'maths-year2': Object.freeze({ schoolYear: 2, batches: ['Y2E'] }),
  'maths-year3': Object.freeze({ schoolYear: 3, batches: ['Y3E'] }),
  'maths-year4': Object.freeze({ schoolYear: 4, batches: ['Y4E'] }),
  'maths-year5': Object.freeze({ schoolYear: 5, batches: ['Y5E'] }),
  'maths-year6': Object.freeze({ schoolYear: 6, batches: ['Y6E'] }),
  'maths-level1': Object.freeze({ schoolYear: 4, fullLibrary: 'MATHS_L1_FULL' }),
  'maths-level2': Object.freeze({ schoolYear: 5, fullLibrary: 'MATHS_L2_FULL' }),
  'maths-level3': Object.freeze({ schoolYear: 6, fullLibrary: 'MATHS_L3_FULL' }),
  'english-year2': Object.freeze({ schoolYear: 2, batches: ['Y2M'] }),
  'english-year3': Object.freeze({ schoolYear: 3, batches: ['Y3M'] }),
  'english-year4': Object.freeze({ schoolYear: 4, batches: ['Y4M'] }),
  'english-year4-11plus': Object.freeze({ schoolYear: 4, batches: ['Y4M11'] }),
  'english-year5': Object.freeze({ schoolYear: 5, batches: ['Y5M'] }),
  'english-year5-11plus': Object.freeze({ schoolYear: 5, batches: ['Y5M11'] }),
  'english-year6': Object.freeze({ schoolYear: 6, batches: ['Y6M'] })
});

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function viewForBatch(row) {
  const subject = String(row?.subject || '').toLowerCase();
  const stream = String(row?.stream || '').toLowerCase();
  const year = Number(row?.school_year || 0);
  const level = Number(row?.maths_level || 0);

  if (subject === 'maths') {
    if (stream === '11plus' && level >= 1 && level <= 3) {
      const progressionRank = { 1: 40, 2: 50, 3: 60 }[level];
      return {
        subject: 'maths',
        viewId: `maths-level${level}`,
        schoolYear: year,
        syntheticBatch: `Y${year}M11`,
        rank: progressionRank + 1
      };
    }
    if (stream === 'normal' && year >= 2 && year <= 6) {
      return {
        subject: 'maths',
        viewId: `maths-year${year}`,
        schoolYear: year,
        syntheticBatch: `Y${year}M`,
        rank: year * 10
      };
    }
    return null;
  }

  if (subject === 'english' && year >= 2 && year <= 6) {
    if (stream === '11plus') {
      if (year !== 4 && year !== 5) return null;
      return {
        subject: 'english',
        viewId: `english-year${year}-11plus`,
        schoolYear: year,
        syntheticBatch: `Y${year}E11`,
        rank: year * 10 + 1
      };
    }
    if (stream === 'normal') {
      return {
        subject: 'english',
        viewId: `english-year${year}`,
        schoolYear: year,
        syntheticBatch: `Y${year}E`,
        rank: year * 10
      };
    }
  }

  return null;
}

async function activeBatchRows(env, portalUserIdNorm) {
  if (!env?.DB || !portalUserIdNorm) return [];
  const today = londonToday();
  const result = await env.DB.prepare(
    `SELECT
       a.batch_key,
       a.effective_from,
       a.effective_to,
       b.subject,
       b.school_year,
       b.stream,
       b.maths_level
     FROM student_batch_assignments a
     JOIN batch_definitions b ON b.batch_key = a.batch_key
     WHERE a.portal_user_id_norm = ?
       AND a.effective_from <= ?
       AND (a.effective_to IS NULL OR ? < a.effective_to)
       AND (b.active_from IS NULL OR b.active_from <= ?)
       AND (b.active_to IS NULL OR ? < b.active_to)
     ORDER BY b.subject, b.school_year, COALESCE(b.maths_level, 0), a.batch_key`
  )
    .bind(portalUserIdNorm, today, today, today, today)
    .all();
  return Array.isArray(result?.results) ? result.results : [];
}

function normaliseUserKey(key) {
  const match = String(key || '').match(/^user:(.+)$/);
  return match ? String(match[1] || '').trim().toLowerCase() : '';
}

function overlayUserForView(user, rows, targetViewId) {
  if (!user || !targetViewId) return user;
  const target = rows
    .map(row => ({ row, view: viewForBatch(row) }))
    .find(item => item.view?.viewId === targetViewId);
  if (!target?.view) return user;
  return {
    ...user,
    schoolYear: target.view.schoolYear,
    batches: [target.view.syntheticBatch]
  };
}

function batchAwareEnv(env, targetViewId, cache) {
  if (!env?.STUDENTS_KV || !env?.DB || !targetViewId) return env;
  const original = env.STUDENTS_KV;
  const kv = new Proxy(original, {
    get(target, prop) {
      if (prop !== 'get') {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (key, options) => {
        const value = await target.get(key, options);
        const portalUserIdNorm = normaliseUserKey(key);
        if (!portalUserIdNorm || value == null) return value;

        let rows = cache.get(portalUserIdNorm);
        if (!rows) {
          rows = await activeBatchRows(env, portalUserIdNorm);
          cache.set(portalUserIdNorm, rows);
        }
        if (!rows.length) return value;

        const wantsJson = options?.type === 'json';
        let user = value;
        if (!wantsJson) {
          try {
            user = JSON.parse(String(value));
          } catch {
            return value;
          }
        }
        const overlaid = overlayUserForView(user, rows, targetViewId);
        return wantsJson ? overlaid : JSON.stringify(overlaid);
      };
    }
  });

  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'STUDENTS_KV') return kv;
      if (prop === 'PHASE12_BYPASS_SESSION_PROFILE') return true;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function lockedPreviewUserForView(user, targetViewId, lessonId) {
  const rule = LOCKED_PREVIEW_OVERLAYS[String(targetViewId || '').trim().toLowerCase()];
  if (!user || !rule || !lessonId) return user;
  const blockedLessons = [...new Set([
    ...(Array.isArray(user.blockedLessons) ? user.blockedLessons.map(String) : []),
    String(lessonId)
  ])];
  const fullLibraries = [...new Set(
    Array.isArray(user.fullLibraries) ? user.fullLibraries.map(String) : []
  )];
  if (rule.fullLibrary && !fullLibraries.includes(rule.fullLibrary)) {
    fullLibraries.push(rule.fullLibrary);
  }
  return {
    ...user,
    schoolYear: rule.schoolYear,
    batches: Array.isArray(rule.batches) ? [...rule.batches] : [],
    fullLibraries,
    blockedLessons
  };
}

function lockedPreviewEnv(env, targetViewId, lessonId) {
  if (!env?.STUDENTS_KV || !targetViewId || !lessonId) return env;
  const original = env.STUDENTS_KV;
  const kv = new Proxy(original, {
    get(target, prop) {
      if (prop !== 'get') {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (key, options) => {
        const value = await target.get(key, options);
        const portalUserIdNorm = normaliseUserKey(key);
        if (!portalUserIdNorm || value == null) return value;
        const wantsJson = options?.type === 'json';
        let user = value;
        if (!wantsJson) {
          try { user = JSON.parse(String(value)); } catch { return value; }
        }
        const overlaid = lockedPreviewUserForView(user, targetViewId, lessonId);
        return wantsJson ? overlaid : JSON.stringify(overlaid);
      };
    }
  });
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'STUDENTS_KV') return kv;
      if (prop === 'PHASE12_BYPASS_SESSION_PROFILE') return true;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function lessonIdForDetailRequest(request) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}

function targetViewIdForRequest(request) {
  const url = new URL(request.url);
  const queryView = String(url.searchParams.get('viewId') || '').trim();
  if (queryView) return queryView;
  const match = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

function findSubject(body, subjectName) {
  return (Array.isArray(body?.subjects) ? body.subjects : [])
    .find(subject => String(subject?.subject || '').toLowerCase() === subjectName);
}

function mergeView(body, subjectName, view) {
  if (!view) return;
  const subject = findSubject(body, subjectName);
  if (!subject) return;
  if (!Array.isArray(subject.views)) subject.views = [];
  const existing = subject.views.find(item => item?.viewId === view.viewId);
  if (!existing) subject.views.push(view);
}

function highestBySubject(rows) {
  const result = new Map();
  for (const row of rows) {
    const view = viewForBatch(row);
    if (!view) continue;
    const current = result.get(view.subject);
    if (
      !current ||
      view.rank > current.view.rank ||
      (view.rank === current.view.rank && String(row.batch_key) > String(current.row.batch_key))
    ) {
      result.set(view.subject, { row, view });
    }
  }
  return result;
}

function activeViewIdsBySubject(rows) {
  const result = new Map();
  for (const row of rows) {
    const view = viewForBatch(row);
    if (!view) continue;
    let ids = result.get(view.subject);
    if (!ids) {
      ids = new Set();
      result.set(view.subject, ids);
    }
    ids.add(view.viewId);
  }
  return result;
}

function markCurrentViews(body, rows) {
  const active = activeViewIdsBySubject(rows);
  for (const [subjectName, activeIds] of active.entries()) {
    const subject = findSubject(body, subjectName);
    if (!subject) continue;
    for (const view of Array.isArray(subject.views) ? subject.views : []) {
      const current = activeIds.has(String(view?.viewId || ''));
      view.current = current;
      view.group = current ? 'current' : 'previous';
    }
  }
  return body;
}

function manifestDisplayLessonId(record, viewId) {
  const sources = [record?.displayIds, record?.displayLessonIds, record?.presentation?.displayIds];
  for (const source of sources) {
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

function canonicalCatalogueRowsForView(viewId, manifest = PHASE11_NAVIGATION_MANIFEST) {
  if (!validBundledManifest(manifest)) return [];
  const normalisedViewId = String(viewId || '').trim().toLowerCase();
  const curricula = VIEW_CURRICULA[normalisedViewId] || [];
  if (!curricula.length) return [];

  const lessonIds = new Set();
  for (const code of curricula) {
    const ids = manifest?.curricula?.[code]?.lessonIds;
    if (!Array.isArray(ids)) continue;
    for (const lessonId of ids) lessonIds.add(String(lessonId || '').trim());
  }

  return [...lessonIds]
    .map(lessonId => manifest.lessons[lessonId])
    .filter(record => record && record.active !== false)
    .map(record => {
      const displayLessonId = manifestDisplayLessonId(record, normalisedViewId);
      const numericOrder = Number(record.order);
      return {
        lessonId: String(record.lessonId || '').trim(),
        displayLessonId,
        title: cleanStudentTitle(record, displayLessonId),
        order: Number.isFinite(numericOrder) ? numericOrder : Number.MAX_SAFE_INTEGER
      };
    })
    .filter(row => row.lessonId)
    .sort((a, b) => a.order - b.order || a.lessonId.localeCompare(b.lessonId));
}

function mergeCanonicalLockedRows(body, viewId, manifest = PHASE11_NAVIGATION_MANIFEST) {
  if (!body?.ok || !Array.isArray(body.lessons)) return body;
  const canonical = canonicalCatalogueRowsForView(viewId, manifest);
  if (!canonical.length) return body;

  const existing = new Map(
    body.lessons
      .filter(row => row?.lessonId)
      .map(row => [String(row.lessonId), row])
  );
  const canonicalIds = new Set(canonical.map(row => row.lessonId));
  const merged = canonical.map(row => {
    const present = existing.get(row.lessonId);
    if (present) return present;
    return {
      lessonId: row.lessonId,
      displayLessonId: row.displayLessonId,
      title: row.title,
      description: '',
      state: 'locked',
      locked: true,
      blocked: false,
      preview: false,
      missedPreview: false
    };
  });

  for (const row of body.lessons) {
    if (!row?.lessonId || canonicalIds.has(String(row.lessonId))) continue;
    merged.push(row);
  }
  body.lessons = merged;
  return body;
}

function applyCanonicalHomeCounts(body, manifest = PHASE11_NAVIGATION_MANIFEST) {
  if (!body?.ok || !Array.isArray(body.subjects) || !validBundledManifest(manifest)) return body;
  for (const subject of body.subjects) {
    for (const view of Array.isArray(subject?.views) ? subject.views : []) {
      const canonicalCount = canonicalCatalogueRowsForView(view?.viewId, manifest).length;
      if (!canonicalCount) continue;
      const open = Math.max(0, Math.min(canonicalCount, Number(view?.openLessonCount || 0)));
      view.catalogueAvailable = true;
      view.visibleLessonCount = canonicalCount;
      view.openLessonCount = open;
      view.lockedLessonCount = canonicalCount - open;
    }
  }
  return body;
}

async function parseJson(response) {
  return response.clone().json().catch(() => null);
}

function jsonLike(response, body) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(JSON_HEADERS)) headers.set(key, value);
  headers.delete('content-length');
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function mergeBatchAwareHome(request, env, ctx) {
  const cache = new Map();
  const baseResponse = await phase11EfficientWorker.fetch(request, env, ctx);
  if (!baseResponse.ok) return baseResponse;
  const body = await parseJson(baseResponse);
  const portalUserIdNorm = String(body?.student?.portalUserId || '').trim().toLowerCase();
  if (!body?.ok || !portalUserIdNorm || !Array.isArray(body.subjects)) return baseResponse;

  const rows = await activeBatchRows(env, portalUserIdNorm);
  if (rows.length) {
    cache.set(portalUserIdNorm, rows);

    const uniqueViews = new Map();
    for (const row of rows) {
      const view = viewForBatch(row);
      if (view) uniqueViews.set(view.viewId, view);
    }

    for (const view of uniqueViews.values()) {
      const overlayEnv = batchAwareEnv(env, view.viewId, cache);
      const altResponse = await phase11EfficientWorker.fetch(request, overlayEnv, ctx);
      if (!altResponse.ok) continue;
      const altBody = await parseJson(altResponse);
      for (const subject of Array.isArray(altBody?.subjects) ? altBody.subjects : []) {
        for (const altView of Array.isArray(subject?.views) ? subject.views : []) {
          if (altView?.viewId === view.viewId) mergeView(body, view.subject, altView);
        }
      }
    }

    markCurrentViews(body, rows);
  }

  applyCanonicalHomeCounts(body);
  return jsonLike(baseResponse, body);
}

async function mergeBatchAwareLessonList(request, env, ctx, targetViewId) {
  const cache = new Map();
  const runtimeEnv = batchAwareEnv(env, targetViewId, cache);
  const response = await phase11EfficientWorker.fetch(request, runtimeEnv, ctx);
  if (!response.ok) return response;
  const body = await parseJson(response);
  if (!body?.ok || !Array.isArray(body.lessons)) return response;
  mergeCanonicalLockedRows(body, targetViewId);
  return jsonLike(response, body);
}

async function lockedCanonicalDetailFallback(request, env, ctx, targetViewId, originalResponse) {
  const lessonId = lessonIdForDetailRequest(request);
  if (!lessonId || originalResponse.ok || originalResponse.status !== 404) return originalResponse;
  const canonical = canonicalCatalogueRowsForView(targetViewId);
  if (!canonical.some(row => row.lessonId === lessonId)) return originalResponse;

  const previewEnv = lockedPreviewEnv(env, targetViewId, lessonId);
  const fallback = await phase11EfficientWorker.fetch(request, previewEnv, ctx);
  if (!fallback.ok) return originalResponse;
  const body = await parseJson(fallback);
  if (!body?.ok || body?.lesson?.locked !== true) return originalResponse;
  return fallback;
}

export {
  viewForBatch,
  overlayUserForView,
  highestBySubject,
  activeViewIdsBySubject,
  markCurrentViews,
  canonicalCatalogueRowsForView,
  mergeCanonicalLockedRows,
  applyCanonicalHomeCounts,
  lockedPreviewUserForView,
  lessonIdForDetailRequest,
  targetViewIdForRequest
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/v1/student/home') {
      return mergeBatchAwareHome(request, env, ctx);
    }

    const targetViewId = targetViewIdForRequest(request);
    if (!targetViewId) return phase11EfficientWorker.fetch(request, env, ctx);

    if (request.method === 'GET' && /^\/api\/v1\/student\/views\/[^/]+\/lessons$/.test(url.pathname)) {
      return mergeBatchAwareLessonList(request, env, ctx, targetViewId);
    }

    const cache = new Map();
    const runtimeEnv = batchAwareEnv(env, targetViewId, cache);
    const response = await phase11EfficientWorker.fetch(request, runtimeEnv, ctx);
    if (request.method === 'GET' && lessonIdForDetailRequest(request)) {
      return lockedCanonicalDetailFallback(request, env, ctx, targetViewId, response);
    }
    return response;
  }
};