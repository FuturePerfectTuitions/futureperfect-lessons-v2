import phase11EfficientWorker from './index-phase11-efficient.js';

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
  if (!rows.length) return baseResponse;
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

  const highest = highestBySubject(rows);
  for (const [subjectName, selected] of highest.entries()) {
    const subject = findSubject(body, subjectName);
    if (!subject) continue;
    for (const view of Array.isArray(subject.views) ? subject.views : []) {
      const current = String(view?.viewId || '') === selected.view.viewId;
      view.current = current;
      view.group = current ? 'current' : 'previous';
    }
  }

  return jsonLike(baseResponse, body);
}

export {
  viewForBatch,
  overlayUserForView,
  highestBySubject,
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

    const cache = new Map();
    const runtimeEnv = batchAwareEnv(env, targetViewId, cache);
    return phase11EfficientWorker.fetch(request, runtimeEnv, ctx);
  }
};