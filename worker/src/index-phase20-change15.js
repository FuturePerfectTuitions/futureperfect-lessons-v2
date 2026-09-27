import change14Worker from './index-phase20-change14.js';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

const YEAR6_CANONICAL_VIEW = 'maths-year6';
const YEAR6_LESSONS_VIEW = 'maths-year6-lessons';
const YEAR6_SATS_VIEW = 'maths-sats';

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

function isTrialHome(body) {
  const portalUserId = norm(body?.student?.portalUserId || body?.portalUserId);
  return portalUserId.startsWith('trial');
}

export function isYear6SatsLesson(row) {
  const canonical = clean(row?.lessonId ?? row?.lesson_id);
  const canonicalMatch = canonical.match(/^Y6M(\d+)$/i);
  if (canonicalMatch) {
    const number = Number(canonicalMatch[1]);
    if (number >= 51 && number <= 69) return true;
  }

  const display = clean(row?.displayLessonId ?? row?.display_lesson_id);
  return /^Y6(?:SM|MS)(?:[1-9]|1[0-9])$/i.test(display);
}

export function splitYear6Lessons(rows = []) {
  const lessons = Array.isArray(rows) ? rows : [];
  return {
    lessons: lessons.filter(row => !isYear6SatsLesson(row)),
    sats: lessons.filter(isYear6SatsLesson)
  };
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

function summaryFrom(base, viewId, label, rows) {
  const counts = countSummary(rows);
  return {
    ...(base || {}),
    viewId,
    subject:'maths',
    label,
    catalogueAvailable:true,
    ...counts,
    lockedPreview:false,
    current:base?.current !== false,
    group:base?.current === false ? 'previous' : 'current'
  };
}

function fallbackSatsSummary(base) {
  const open = Math.min(19, Math.max(0, Number(base?.openLessonCount || 0)));
  return {
    ...(base || {}),
    viewId:YEAR6_SATS_VIEW,
    subject:'maths',
    label:'SATS',
    catalogueAvailable:true,
    visibleLessonCount:19,
    openLessonCount:open,
    lockedLessonCount:Math.max(0, 19 - open),
    lockedPreview:false,
    current:base?.current !== false,
    group:base?.current === false ? 'previous' : 'current'
  };
}

function fallbackLessonsSummary(base) {
  const visible = Math.max(0, Number(base?.visibleLessonCount || 0) - 19);
  const open = Math.min(visible, Math.max(0, Number(base?.openLessonCount || 0)));
  return {
    ...(base || {}),
    viewId:YEAR6_LESSONS_VIEW,
    subject:'maths',
    label:'Lessons',
    catalogueAvailable:true,
    visibleLessonCount:visible,
    openLessonCount:open,
    lockedLessonCount:Math.max(0, visible - open),
    lockedPreview:false,
    current:base?.current !== false,
    group:base?.current === false ? 'previous' : 'current'
  };
}

function mergeEquivalentView(target, incoming, level) {
  if (!target) {
    const open = Number(incoming?.openLessonCount || 0);
    const visible = Number(incoming?.visibleLessonCount || 0);
    return {
      ...incoming,
      viewId:levelViewId(level),
      subject:'maths',
      label:levelLabel(level),
      openLessonCount:open,
      visibleLessonCount:visible,
      lockedLessonCount:Math.max(0, visible - open)
    };
  }

  const open = Math.max(Number(target?.openLessonCount || 0), Number(incoming?.openLessonCount || 0));
  const visible = Math.max(Number(target?.visibleLessonCount || 0), Number(incoming?.visibleLessonCount || 0));
  const current = target?.current === true || incoming?.current === true;
  return {
    ...incoming,
    ...target,
    viewId:levelViewId(level),
    subject:'maths',
    label:levelLabel(level),
    catalogueAvailable:target?.catalogueAvailable !== false || incoming?.catalogueAvailable !== false,
    visibleLessonCount:visible,
    openLessonCount:open,
    lockedLessonCount:Math.max(0, visible - open),
    lockedPreview:target?.lockedPreview === true && incoming?.lockedPreview === true,
    current,
    group:current ? 'current' : 'previous'
  };
}

function replaceRecentShareAliases(body, finalViews) {
  if (!Array.isArray(body?.recentShares)) return;
  const ids = new Set((finalViews || []).map(view => norm(view?.viewId)));

  for (const item of body.recentShares) {
    const id = norm(item?.viewId);
    if (id === 'maths-year4' && ids.has('maths-level1')) {
      item.viewId = 'maths-level1';
      item.viewLabel = 'L1';
      continue;
    }
    if (id === 'maths-year5' && ids.has('maths-level2')) {
      item.viewId = 'maths-level2';
      item.viewLabel = 'L2';
      continue;
    }
    if (id === YEAR6_CANONICAL_VIEW) {
      if (isYear6SatsLesson(item) && ids.has(YEAR6_SATS_VIEW)) {
        item.viewId = YEAR6_SATS_VIEW;
        item.viewLabel = 'SATS';
      } else if (ids.has('maths-level3')) {
        item.viewId = 'maths-level3';
        item.viewLabel = 'L3';
      } else if (ids.has(YEAR6_LESSONS_VIEW)) {
        item.viewId = YEAR6_LESSONS_VIEW;
        item.viewLabel = 'Lessons';
      }
      continue;
    }

    const level = mathsLevelForView(id);
    if (level && id.startsWith('maths-level')) item.viewLabel = levelLabel(level);
  }
}

export function normaliseMathsEquivalentHome(body, year6Split = null) {
  if (!body || typeof body !== 'object' || isTrialHome(body) || !Array.isArray(body.subjects)) return body;

  const maths = body.subjects.find(subject => norm(subject?.subject) === 'maths');
  if (!maths || !Array.isArray(maths.views)) return body;

  let views = [...maths.views];

  // Year 4/L1 and Year 5/L2 are presentation aliases for the same Maths
  // curriculum. When both are present, the L-level is the authoritative label.
  for (const level of [1, 2]) {
    const yearId = `maths-year${level + 3}`;
    const levelId = `maths-level${level}`;
    const year = views.find(view => norm(view?.viewId) === yearId);
    const levelView = views.find(view => norm(view?.viewId) === levelId);
    if (!year || !levelView) continue;

    const merged = mergeEquivalentView(levelView, year, level);
    const insertion = Math.min(views.indexOf(year), views.indexOf(levelView));
    views = views.filter(view => view !== year && view !== levelView);
    views.splice(Math.max(0, insertion), 0, merged);
  }

  const year6 = views.find(view => norm(view?.viewId) === YEAR6_CANONICAL_VIEW) || null;
  const l3 = views.find(view => norm(view?.viewId) === 'maths-level3') || null;

  if (l3) {
    l3.label = 'L3';
    // A Year 6 card alongside L3 is never a second curriculum choice. It is
    // the presentation surface created by Year 6 SAT direct entitlements.
    if (year6) views = views.filter(view => view !== year6);

    const base = year6 || l3;
    const sats = year6Split?.sats
      ? summaryFrom(base, YEAR6_SATS_VIEW, 'SATS', year6Split.sats)
      : fallbackSatsSummary(base);
    const l3Index = views.indexOf(l3);
    const existingSats = views.find(view => norm(view?.viewId) === YEAR6_SATS_VIEW);
    if (existingSats) Object.assign(existingSats, sats);
    else views.splice(l3Index + 1, 0, sats);
  } else if (year6) {
    // An ordinary Year 6 student gets two explicit surfaces backed by the one
    // canonical Year 6 catalogue: teaching Lessons and SATS.
    const lessons = year6Split?.lessons
      ? summaryFrom(year6, YEAR6_LESSONS_VIEW, 'Lessons', year6Split.lessons)
      : fallbackLessonsSummary(year6);
    const sats = year6Split?.sats
      ? summaryFrom(year6, YEAR6_SATS_VIEW, 'SATS', year6Split.sats)
      : fallbackSatsSummary(year6);
    const index = views.indexOf(year6);
    views.splice(index, 1, lessons, sats);
  }

  maths.views = views;
  replaceRecentShareAliases(body, views);
  return body;
}

// Preserve the earlier exported contract used by existing verification code.
// The new rule is presentation-driven and no longer depends on fragile
// entitlement-source heuristics; mathsElevenPlus is retained for compatibility.
export function normaliseMathsElevenPlusHome(body, mathsElevenPlus, year6Split = null) {
  if (!mathsElevenPlus) {
    if (body?.view?.viewId) {
      const match = norm(body.view.viewId).match(/^maths-level([1-3])$/);
      if (match) body.view.label = levelLabel(Number(match[1]));
    }
    return body;
  }
  return normaliseMathsEquivalentHome(body, year6Split);
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

function syntheticKind(viewId) {
  const id = norm(viewId);
  if (id === YEAR6_SATS_VIEW) return 'sats';
  if (id === YEAR6_LESSONS_VIEW) return 'lessons';
  return '';
}

function mappedRequest(request, options = {}) {
  const url = new URL(request.url);
  if (options.pathViewId) {
    url.pathname = `/api/v1/student/views/${encodeURIComponent(YEAR6_CANONICAL_VIEW)}/lessons`;
  }
  const queryView = syntheticKind(url.searchParams.get('viewId'));
  if (queryView) url.searchParams.set('viewId', YEAR6_CANONICAL_VIEW);
  return new Request(url.toString(), request);
}

async function filteredSyntheticList(request, env, ctx, kind) {
  const upstream = await change14Worker.fetch(mappedRequest(request, { pathViewId:true }), env, ctx);
  if (!upstream.ok) return upstream;
  const body = await upstream.clone().json().catch(() => null);
  if (!body?.ok || !Array.isArray(body.lessons)) return upstream;

  const split = splitYear6Lessons(body.lessons);
  const rows = kind === 'sats' ? split.sats : split.lessons;
  const baseView = body.view || {};
  body.lessons = rows;
  body.view = summaryFrom(
    baseView,
    kind === 'sats' ? YEAR6_SATS_VIEW : YEAR6_LESSONS_VIEW,
    kind === 'sats' ? 'SATS' : 'Lessons',
    rows
  );
  return jsonLike(upstream, body);
}

async function loadYear6Split(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = `/api/v1/student/views/${encodeURIComponent(YEAR6_CANONICAL_VIEW)}/lessons`;
  url.search = '';
  const upstream = await change14Worker.fetch(new Request(url.toString(), request), env, ctx);
  if (!upstream.ok) return null;
  const body = await upstream.clone().json().catch(() => null);
  if (!body?.ok || !Array.isArray(body.lessons)) return null;
  return splitYear6Lessons(body.lessons);
}

function homeHasYear6Equivalent(body) {
  const maths = Array.isArray(body?.subjects)
    ? body.subjects.find(subject => norm(subject?.subject) === 'maths')
    : null;
  return Array.isArray(maths?.views) && maths.views.some(view => {
    const id = norm(view?.viewId);
    return id === YEAR6_CANONICAL_VIEW || id === 'maths-level3';
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
    const url = new URL(request.url);
    const syntheticListMatch = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
    if (request.method === 'GET' && syntheticListMatch) {
      let requestedView = '';
      try { requestedView = decodeURIComponent(syntheticListMatch[1]); } catch { requestedView = ''; }
      const kind = syntheticKind(requestedView);
      if (kind) return filteredSyntheticList(request, env, ctx, kind);
    }

    const queryKind = syntheticKind(url.searchParams.get('viewId'));
    if (queryKind) {
      return change14Worker.fetch(mappedRequest(request), env, ctx);
    }

    const response = await change14Worker.fetch(request, env, ctx);
    if (!response.ok || !isStudentNavigationGet(request, url)) return response;

    const body = await response.clone().json().catch(() => null);
    if (!body?.ok) return response;

    if (url.pathname === '/api/v1/student/home') {
      if (isTrialHome(body)) return response;
      const year6Split = homeHasYear6Equivalent(body)
        ? await loadYear6Split(request, env, ctx)
        : null;
      return jsonLike(response, normaliseMathsEquivalentHome(body, year6Split));
    }

    if (body.view?.viewId) {
      const match = norm(body.view.viewId).match(/^maths-level([1-3])$/);
      if (match) body.view.label = levelLabel(Number(match[1]));
    }
    return jsonLike(response, body);
  }
};
