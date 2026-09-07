import change14Worker from './index-phase20-change14.js';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function mathsLevelForView(viewId) {
  let match = norm(viewId).match(/^maths-level([1-3])$/);
  if (match) return Number(match[1]);
  match = norm(viewId).match(/^maths-year([4-6])$/);
  return match ? Number(match[1]) - 3 : 0;
}

function levelViewId(level) {
  return level >= 1 && level <= 3 ? `maths-level${level}` : '';
}

function levelLabel(level) {
  return level >= 1 && level <= 3 ? `L${level}` : '';
}

function mergeView(target, incoming, level) {
  if (!target) {
    const open = Number(incoming?.openLessonCount || 0);
    const visible = Number(incoming?.visibleLessonCount || 0);
    return {
      ...incoming,
      viewId: levelViewId(level),
      subject: 'maths',
      label: levelLabel(level),
      openLessonCount: open,
      visibleLessonCount: visible,
      lockedLessonCount: Math.max(0, visible - open)
    };
  }

  const open = Math.max(Number(target?.openLessonCount || 0), Number(incoming?.openLessonCount || 0));
  const visible = Math.max(Number(target?.visibleLessonCount || 0), Number(incoming?.visibleLessonCount || 0));
  const current = target?.current === true || incoming?.current === true;
  return {
    ...incoming,
    ...target,
    viewId: levelViewId(level),
    subject: 'maths',
    label: levelLabel(level),
    catalogueAvailable: target?.catalogueAvailable !== false || incoming?.catalogueAvailable !== false,
    visibleLessonCount: visible,
    openLessonCount: open,
    lockedLessonCount: Math.max(0, visible - open),
    lockedPreview: target?.lockedPreview === true && incoming?.lockedPreview === true,
    current,
    group: current ? 'current' : 'previous'
  };
}

export function normaliseMathsElevenPlusHome(body, mathsElevenPlus) {
  if (!body || typeof body !== 'object') return body;

  if (Array.isArray(body.subjects)) {
    for (const subject of body.subjects) {
      if (norm(subject?.subject) !== 'maths' || !Array.isArray(subject?.views)) continue;

      if (mathsElevenPlus) {
        const passthrough = [];
        const levels = new Map();

        for (const view of subject.views) {
          const id = norm(view?.viewId);
          const level = mathsLevelForView(id);
          if (!level) {
            passthrough.push(view);
            continue;
          }

          // For an 11+ Maths student, Year 4/5/6 are presentation aliases only.
          // They must be surfaced as L1/L2/L3 and never as normal year cards.
          levels.set(level, mergeView(levels.get(level), view, level));
        }

        subject.views = [
          ...passthrough,
          ...[1, 2, 3].filter(level => levels.has(level)).map(level => levels.get(level))
        ];
      }

      for (const view of subject.views) {
        const match = norm(view?.viewId).match(/^maths-level([1-3])$/);
        if (match) view.label = levelLabel(Number(match[1]));
      }
    }
  }

  if (Array.isArray(body.recentShares)) {
    for (const item of body.recentShares) {
      const level = mathsElevenPlus ? mathsLevelForView(item?.viewId) : 0;
      if (level) {
        item.viewId = levelViewId(level);
        item.viewLabel = levelLabel(level);
      } else {
        const match = norm(item?.viewId).match(/^maths-level([1-3])$/);
        if (match) item.viewLabel = levelLabel(Number(match[1]));
      }
    }
  }

  if (body.view?.viewId) {
    const match = norm(body.view.viewId).match(/^maths-level([1-3])$/);
    if (match) body.view.label = levelLabel(Number(match[1]));
  }

  return body;
}

async function mathsElevenPlusStudent(env, portalUserIdNorm) {
  if (!portalUserIdNorm) return false;

  const userPromise = env?.STUDENTS_KV
    ? env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type:'json' }).catch(() => null)
    : Promise.resolve(null);

  const accessPromise = env?.DB
    ? Promise.all([
        env.DB.prepare(
          `SELECT source_batch_code AS batch_key
           FROM lesson_entitlements
           WHERE portal_user_id_norm = ? AND core_access = 1 AND source_batch_code IS NOT NULL`
        ).bind(portalUserIdNorm).all(),
        env.DB.prepare(
          `SELECT batch_key
           FROM online_prelesson_entitlements
           WHERE portal_user_id_norm = ?`
        ).bind(portalUserIdNorm).all()
      ]).catch(() => [])
    : Promise.resolve([]);

  const [user, accessResults] = await Promise.all([userPromise, accessPromise]);

  const fullLibraries = Array.isArray(user?.fullLibraries) ? user.fullLibraries.map(value => clean(value).toUpperCase()) : [];
  if (fullLibraries.some(value => /^MATHS_L[1-3]_FULL$/.test(value))) return true;

  const batchKeys = [];
  for (const result of Array.isArray(accessResults) ? accessResults : []) {
    for (const row of Array.isArray(result?.results) ? result.results : []) {
      const key = clean(row?.batch_key).toUpperCase();
      if (key) batchKeys.push(key);
    }
  }

  return batchKeys.some(key => /^Y[456]11/.test(key) && key.includes('M'));
}

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

function isStudentNavigationGet(request, url) {
  if (request.method !== 'GET') return false;
  if (url.pathname === '/api/v1/student/home') return true;
  if (/^\/api\/v1\/student\/views\/[^/]+\/lessons$/.test(url.pathname)) return true;
  if (/^\/api\/v1\/student\/lessons\/[^/]+$/.test(url.pathname)) return true;
  return false;
}

export default {
  async fetch(request, env, ctx) {
    const response = await change14Worker.fetch(request, env, ctx);
    const url = new URL(request.url);
    if (!response.ok || !isStudentNavigationGet(request, url)) return response;

    const body = await response.clone().json().catch(() => null);
    if (!body?.ok) return response;

    const portalUserIdNorm = norm(body?.student?.portalUserId || body?.portalUserId);
    const mathsElevenPlus = url.pathname === '/api/v1/student/home'
      ? await mathsElevenPlusStudent(env, portalUserIdNorm)
      : false;

    return jsonLike(response, normaliseMathsElevenPlusHome(body, mathsElevenPlus));
  }
};
