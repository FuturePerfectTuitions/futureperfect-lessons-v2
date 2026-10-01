import currentWorker from './index-phase24-trial-vr.js';
import nativePreparedWorker from './index-phase20-change14.js';
import {
  splitYear6Lessons,
  mathsPresentationRole
} from './index-phase20-change15.js';
import { LIVE_ENTITLEMENT_BATCH_DEFINITION_MARKER } from './live-student-catalogue-overlay.js';

const FINAL_MATHS_EQUIVALENT_NAV_MARKER = 'maths-equivalent-navigation-final-v7-owner-sats-fast';
const YEAR6_CANONICAL_VIEW = 'maths-year6';
const YEAR6_LESSONS_VIEW = 'maths-year6-lessons';
const YEAR6_SATS_VIEW = 'maths-sats';
const L3_VIEW = 'maths-level3';

const OWNER_PRESENTATION_RULES = Object.freeze({
  admin0206:Object.freeze({
    mathsCurrent:Object.freeze(['maths-year3', 'maths-year4', 'maths-year5', YEAR6_CANONICAL_VIEW]),
    englishCurrent:Object.freeze(['english-year3', 'english-year4', 'english-year5', 'english-year6']),
    suppressMaths:Object.freeze(['maths-level1', 'maths-level2', L3_VIEW, YEAR6_LESSONS_VIEW]),
    mathsOrder:Object.freeze(['maths-year3', 'maths-year4', 'maths-year5', YEAR6_CANONICAL_VIEW, YEAR6_SATS_VIEW])
  }),
  admin0411:Object.freeze({
    mathsCurrent:Object.freeze(['maths-level1', 'maths-level2', L3_VIEW]),
    englishCurrent:Object.freeze(['english-year4-11plus', 'english-year5-11plus']),
    suppressMaths:Object.freeze([YEAR6_CANONICAL_VIEW, YEAR6_LESSONS_VIEW]),
    mathsOrder:Object.freeze(['maths-level1', 'maths-level2', L3_VIEW, YEAR6_SATS_VIEW])
  })
});

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function responseLike(response, body) {
  const headers = new Headers(response?.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-fpt-maths-equivalent-nav', FINAL_MATHS_EQUIVALENT_NAV_MARKER);
  headers.set('x-fpt-entitlement-classification', LIVE_ENTITLEMENT_BATCH_DEFINITION_MARKER);
  headers.delete('content-length');
  return new Response(JSON.stringify(body), {
    status:response?.status ?? 200,
    statusText:response?.statusText,
    headers
  });
}

function syntheticKind(viewId) {
  const id = norm(viewId);
  if (id === YEAR6_SATS_VIEW) return 'sats';
  if (id === YEAR6_LESSONS_VIEW) return 'lessons';
  return '';
}

function viewListMatch(url) {
  const match = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
  if (!match) return null;
  let viewId = '';
  try { viewId = decodeURIComponent(match[1]); } catch { return null; }
  return { viewId:norm(viewId), rawViewId:viewId };
}

function viewListRequest(request, viewId) {
  const url = new URL(request.url);
  url.pathname = `/api/v1/student/views/${encodeURIComponent(viewId)}/lessons`;
  url.search = '';
  return new Request(url.toString(), request);
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

function namedSubject(body, subjectName) {
  const wanted = norm(subjectName);
  return Array.isArray(body?.subjects)
    ? body.subjects.find(subject => norm(subject?.subject) === wanted) || null
    : null;
}

function mathsSubject(body) {
  return namedSubject(body, 'maths');
}

function mathsViews(body) {
  const maths = mathsSubject(body);
  return Array.isArray(maths?.views) ? maths.views : [];
}

function isCurrent(view) {
  return view?.group === 'current' || view?.current === true || (view?.group !== 'previous' && view?.current !== false);
}

function ownerPortalUserId(body) {
  return norm(body?.student?.portalUserId || body?.student?.portal_user_id || body?.student?.username);
}

function ownerPresentationRule(body) {
  return OWNER_PRESENTATION_RULES[ownerPortalUserId(body)] || null;
}

function nativeCurrentMathsAuthority(body) {
  const views = mathsViews(body).filter(isCurrent);
  const year6 = views.find(view => norm(view?.viewId) === YEAR6_CANONICAL_VIEW) || null;
  const l3 = views.find(view => norm(view?.viewId) === L3_VIEW) || null;
  const sats = views.find(view => norm(view?.viewId) === YEAR6_SATS_VIEW) || null;
  const teaching = [year6, l3].filter(Boolean);
  return {
    valid:teaching.length === 1,
    teaching:teaching[0] || null,
    sats,
    collision:teaching.length > 1
  };
}

function presentationView(rawView) {
  if (!rawView) return null;
  const id = norm(rawView.viewId);
  if (id === YEAR6_CANONICAL_VIEW) {
    return { ...rawView, viewId:YEAR6_CANONICAL_VIEW, label:'Year 6' };
  }
  if (id === L3_VIEW) {
    return { ...rawView, viewId:L3_VIEW, label:'L3' };
  }
  if (id === YEAR6_SATS_VIEW) {
    return { ...rawView, viewId:YEAR6_SATS_VIEW, label:'SATS' };
  }
  return { ...rawView };
}

function reconcileRecentShares(body, authority) {
  if (!Array.isArray(body?.recentShares) || !authority?.valid) return;
  const programmeId = norm(authority.teaching?.viewId);
  const hasSats = Boolean(authority.sats);
  const next = [];
  for (const item of body.recentShares) {
    const id = norm(item?.viewId);
    if (id === YEAR6_LESSONS_VIEW) {
      if (programmeId === YEAR6_CANONICAL_VIEW) {
        next.push({ ...item, viewId:YEAR6_CANONICAL_VIEW, viewLabel:'Year 6' });
      }
      continue;
    }
    if (id === YEAR6_SATS_VIEW) {
      if (hasSats) next.push({ ...item, viewId:YEAR6_SATS_VIEW, viewLabel:'SATS' });
      continue;
    }
    if (id === YEAR6_CANONICAL_VIEW && programmeId === YEAR6_CANONICAL_VIEW) {
      next.push({ ...item, viewLabel:'Year 6' });
      continue;
    }
    if (id === L3_VIEW && programmeId === L3_VIEW) {
      next.push({ ...item, viewLabel:'L3' });
      continue;
    }
    next.push(item);
  }
  body.recentShares = next;
}

function reconcileNativeMathsHome(body, nativeBody) {
  const maths = mathsSubject(body);
  const nativeMaths = mathsSubject(nativeBody);
  if (!maths || !nativeMaths || !Array.isArray(maths.views) || !Array.isArray(nativeMaths.views)) return false;

  const authority = nativeCurrentMathsAuthority(nativeBody);
  if (!authority.valid) return false;

  const removableRoles = new Set(['year6', 'lessons', 'l3', 'sats']);
  const firstIndex = maths.views.findIndex(view => removableRoles.has(mathsPresentationRole(view)));
  const retained = maths.views.filter(view => !removableRoles.has(mathsPresentationRole(view)));
  const desired = [presentationView(authority.teaching)];
  if (authority.sats) desired.push(presentationView(authority.sats));

  const insertion = firstIndex < 0 ? retained.length : Math.min(firstIndex, retained.length);
  retained.splice(insertion, 0, ...desired);
  maths.views = retained;
  reconcileRecentShares(body, authority);
  return true;
}

async function loadViewList(worker, request, env, ctx, viewId) {
  const response = await worker.fetch(viewListRequest(request, viewId), env, ctx);
  if (!response.ok) return { response, body:null, rows:null };
  const body = await response.clone().json().catch(() => null);
  if (!body?.ok || !Array.isArray(body.lessons)) return { response, body, rows:null };
  return { response, body, rows:body.lessons };
}

function markExistingViewsCurrent(subject, viewIds) {
  if (!subject || !Array.isArray(subject.views)) return false;
  const wanted = new Set(viewIds.map(norm));
  let changed = false;
  for (const view of subject.views) {
    if (!wanted.has(norm(view?.viewId))) continue;
    if (view?.current !== true || view?.group !== 'current') changed = true;
    view.current = true;
    view.group = 'current';
  }
  return changed;
}

function suppressExistingViews(subject, viewIds) {
  if (!subject || !Array.isArray(subject.views)) return false;
  const blocked = new Set(viewIds.map(norm));
  const next = subject.views.filter(view => !blocked.has(norm(view?.viewId)));
  if (next.length === subject.views.length) return false;
  subject.views = next;
  return true;
}

function upsertOwnerSatsView(maths, loaded) {
  if (!maths || !Array.isArray(maths.views) || !Array.isArray(loaded?.rows)) return false;
  if (norm(loaded?.body?.view?.viewId) !== YEAR6_SATS_VIEW) return false;
  const existingIndex = maths.views.findIndex(view => norm(view?.viewId) === YEAR6_SATS_VIEW);
  const existing = existingIndex >= 0 ? maths.views[existingIndex] : null;
  const next = presentationView({
    ...(existing || {}),
    ...loaded.body.view,
    viewId:YEAR6_SATS_VIEW,
    current:true,
    group:'current',
    ...countSummary(loaded.rows),
    catalogueAvailable:true
  });
  if (existingIndex >= 0) maths.views[existingIndex] = next;
  else maths.views.push(next);
  return true;
}

function upsertOwnerSatsSummary(maths) {
  if (!maths || !Array.isArray(maths.views)) return false;
  const existingIndex = maths.views.findIndex(view => norm(view?.viewId) === YEAR6_SATS_VIEW);
  const existing = existingIndex >= 0 ? maths.views[existingIndex] : null;
  const teaching = maths.views.find(view => {
    const id = norm(view?.viewId);
    return id === YEAR6_CANONICAL_VIEW || id === L3_VIEW;
  }) || null;
  const visible = Math.max(19, Number(existing?.visibleLessonCount || 0));
  const inferredOpen = Math.min(visible, Math.max(0, Number(teaching?.openLessonCount || 0)));
  const open = Number.isFinite(Number(existing?.openLessonCount))
    ? Math.min(visible, Math.max(0, Number(existing.openLessonCount)))
    : inferredOpen;
  const next = presentationView({
    ...(existing || {}),
    viewId:YEAR6_SATS_VIEW,
    subject:'maths',
    current:true,
    group:'current',
    catalogueAvailable:true,
    visibleLessonCount:visible,
    openLessonCount:open,
    lockedLessonCount:Math.max(0, visible - open),
    lockedPreview:false
  });
  if (existingIndex >= 0) maths.views[existingIndex] = next;
  else maths.views.push(next);
  return true;
}

function orderSubjectViews(subject, preferredOrder) {
  if (!subject || !Array.isArray(subject.views)) return false;
  const rank = new Map(preferredOrder.map((id, index) => [norm(id), index]));
  const before = subject.views.map(view => norm(view?.viewId)).join('|');
  subject.views = subject.views
    .map((view, index) => ({ view, index }))
    .sort((a, b) => {
      const ar = rank.has(norm(a.view?.viewId)) ? rank.get(norm(a.view?.viewId)) : preferredOrder.length + a.index;
      const br = rank.has(norm(b.view?.viewId)) ? rank.get(norm(b.view?.viewId)) : preferredOrder.length + b.index;
      return ar - br;
    })
    .map(item => item.view);
  return before !== subject.views.map(view => norm(view?.viewId)).join('|');
}

async function reconcileOwnerSpecialHome(request, env, ctx, body) {
  const rule = ownerPresentationRule(body);
  if (!rule) return false;

  const maths = mathsSubject(body);
  if (!maths || !Array.isArray(maths.views)) return false;

  let changed = false;
  changed = markExistingViewsCurrent(maths, rule.mathsCurrent) || changed;
  changed = suppressExistingViews(maths, rule.suppressMaths) || changed;

  const english = namedSubject(body, 'english');
  changed = markExistingViewsCurrent(english, rule.englishCurrent) || changed;

  // Owner home presentation must not synchronously render the entire canonical
  // Year 6 catalogue merely to show the SATS card. The exact owner rule is the
  // authority for card presence; the SATS list is resolved only when opened.
  changed = upsertOwnerSatsSummary(maths) || changed;

  changed = orderSubjectViews(maths, rule.mathsOrder) || changed;
  return changed;
}

function refreshHomeViewSummary(body, viewId, rows) {
  if (!Array.isArray(rows)) return false;
  const wanted = norm(viewId);
  const view = mathsViews(body).find(item => norm(item?.viewId) === wanted && isCurrent(item));
  if (!view) return false;
  Object.assign(view, countSummary(rows), { catalogueAvailable:true });
  return true;
}

function hasReleasedSats(year6Split) {
  return Array.isArray(year6Split?.sats) && year6Split.sats.some(row => row?.locked === false);
}

// Compatibility exports retained for older verification/importers. The owner
// presentation correction does not infer SATS or programme identity. Native
// prepared views remain the authority for ordinary Year 6/L3/SATS presentation;
// the two owner logins have an exact-ID final presentation rule.
function suppressUnreleasedL3Sats() { return false; }
function suppressUnpairedL3Sats() { return false; }

async function finalHome(request, env, ctx) {
  const [response, nativeResponse] = await Promise.all([
    currentWorker.fetch(request, env, ctx),
    nativePreparedWorker.fetch(request, env, ctx)
  ]);
  if (!response.ok) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body?.ok) return response;

  if (ownerPresentationRule(body)) {
    const reconciled = await reconcileOwnerSpecialHome(request, env, ctx, body);
    return reconciled ? responseLike(response, body) : response;
  }

  if (!nativeResponse.ok) return response;
  const nativeBody = await nativeResponse.clone().json().catch(() => null);
  if (!nativeBody?.ok) return response;

  const reconciled = reconcileNativeMathsHome(body, nativeBody);
  if (!reconciled) return response;

  const authority = nativeCurrentMathsAuthority(nativeBody);
  for (const rawView of [authority.teaching, authority.sats].filter(Boolean)) {
    const loaded = await loadViewList(nativePreparedWorker, request, env, ctx, clean(rawView.viewId));
    refreshHomeViewSummary(body, clean(rawView.viewId), loaded.rows);
  }

  return responseLike(response, body);
}

async function finalNativeSatsList(request, env, ctx) {
  const loaded = await loadViewList(currentWorker, request, env, ctx, YEAR6_CANONICAL_VIEW);
  if (!loaded.response.ok || !loaded.body?.ok || !Array.isArray(loaded.rows)) return loaded.response;
  const rows = splitYear6Lessons(loaded.rows).sats;
  loaded.body.lessons = rows;
  loaded.body.view = presentationView({
    ...(loaded.body.view || {}),
    viewId:YEAR6_SATS_VIEW,
    subject:'maths',
    current:true,
    group:'current',
    catalogueAvailable:true,
    ...countSummary(rows)
  });
  return responseLike(loaded.response, loaded.body);
}

async function finalLegacyLessonsAlias(request, env, ctx) {
  const loaded = await loadViewList(currentWorker, request, env, ctx, YEAR6_CANONICAL_VIEW);
  if (!loaded.response.ok || !loaded.body?.ok || !Array.isArray(loaded.rows)) return loaded.response;
  if (loaded.body.view) loaded.body.view = presentationView({ ...loaded.body.view, viewId:YEAR6_CANONICAL_VIEW });
  return responseLike(loaded.response, loaded.body);
}

// Retained name for compatibility with existing tests/importers. The historical
// Lessons alias still displays as Year 6; SATS is split from the current composed
// canonical Year 6 list without forcing a prepared catalogue render during home.
async function finalSyntheticList(request, env, ctx, kind) {
  return kind === 'sats'
    ? finalNativeSatsList(request, env, ctx)
    : finalLegacyLessonsAlias(request, env, ctx);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/v1/student/home') {
      return finalHome(request, env, ctx);
    }

    if (request.method === 'GET') {
      const match = viewListMatch(url);
      if (match?.viewId === YEAR6_SATS_VIEW) return finalNativeSatsList(request, env, ctx);
      if (match?.viewId === YEAR6_LESSONS_VIEW) return finalLegacyLessonsAlias(request, env, ctx);
    }

    return currentWorker.fetch(request, env, ctx);
  }
};

export {
  FINAL_MATHS_EQUIVALENT_NAV_MARKER,
  OWNER_PRESENTATION_RULES,
  syntheticKind,
  countSummary,
  ownerPortalUserId,
  ownerPresentationRule,
  nativeCurrentMathsAuthority,
  reconcileNativeMathsHome,
  reconcileOwnerSpecialHome,
  upsertOwnerSatsSummary,
  refreshHomeViewSummary,
  hasReleasedSats,
  suppressUnreleasedL3Sats,
  suppressUnpairedL3Sats,
  finalHome,
  finalNativeSatsList,
  finalLegacyLessonsAlias,
  finalSyntheticList,
  splitYear6Lessons
};
