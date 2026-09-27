import currentWorker from './index-phase24-trial-vr.js';
import {
  normaliseMathsEquivalentHome,
  splitYear6Lessons,
  mathsPresentationRole
} from './index-phase20-change15.js';
import { LIVE_ENTITLEMENT_BATCH_DEFINITION_MARKER } from './live-student-catalogue-overlay.js';

const FINAL_MATHS_EQUIVALENT_NAV_MARKER = 'maths-equivalent-navigation-final-v4';
const YEAR6_CANONICAL_VIEW = 'maths-year6';
const YEAR6_LESSONS_VIEW = 'maths-year6-lessons';
const YEAR6_SATS_VIEW = 'maths-sats';
const L3_VIEW = 'maths-level3';

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

function syntheticListMatch(url) {
  const match = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
  if (!match) return null;
  let viewId = '';
  try { viewId = decodeURIComponent(match[1]); } catch { return null; }
  const kind = syntheticKind(viewId);
  return kind ? { kind, viewId:norm(viewId) } : null;
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

function syntheticViewSummary(base, kind, rows) {
  const counts = countSummary(rows);
  return {
    ...(base || {}),
    viewId:kind === 'sats' ? YEAR6_SATS_VIEW : YEAR6_LESSONS_VIEW,
    subject:'maths',
    label:kind === 'sats' ? 'SATS' : 'Lessons',
    catalogueAvailable:true,
    ...counts,
    lockedPreview:false,
    current:base?.current !== false,
    group:base?.current === false ? 'previous' : 'current'
  };
}

async function loadViewList(request, env, ctx, viewId) {
  const response = await currentWorker.fetch(viewListRequest(request, viewId), env, ctx);
  if (!response.ok) return { response, body:null, rows:null };
  const body = await response.clone().json().catch(() => null);
  if (!body?.ok || !Array.isArray(body.lessons)) return { response, body, rows:null };
  return { response, body, rows:body.lessons };
}

async function canonicalYear6List(request, env, ctx) {
  const loaded = await loadViewList(request, env, ctx, YEAR6_CANONICAL_VIEW);
  return {
    ...loaded,
    split:loaded.rows ? splitYear6Lessons(loaded.rows) : null
  };
}

function mathsViews(body) {
  const maths = Array.isArray(body?.subjects)
    ? body.subjects.find(subject => norm(subject?.subject) === 'maths')
    : null;
  return Array.isArray(maths?.views) ? maths.views : [];
}

function currentRoleView(body, role) {
  return mathsViews(body).find(view => mathsPresentationRole(view) === role) || null;
}

function homeHasYear6Equivalent(body) {
  return mathsViews(body).some(view => {
    const role = mathsPresentationRole(view);
    return role === 'year6' || role === 'l3';
  });
}

function homeHasView(body, viewId) {
  const wanted = norm(viewId);
  if (wanted === L3_VIEW) return Boolean(currentRoleView(body, 'l3'));
  if (wanted === YEAR6_CANONICAL_VIEW) return Boolean(currentRoleView(body, 'year6'));
  return mathsViews(body).some(view => norm(view?.viewId) === wanted);
}

function refreshHomeViewSummary(body, viewId, rows) {
  if (!Array.isArray(rows)) return false;
  const wanted = norm(viewId);
  const view = mathsViews(body).find(item => norm(item?.viewId) === wanted);
  if (!view) return false;
  Object.assign(view, countSummary(rows), { catalogueAvailable:true });
  return true;
}

function hasReleasedSats(year6Split) {
  return Array.isArray(year6Split?.sats) && year6Split.sats.some(row => row?.locked === false);
}

// Retained for compatibility with existing verification code. The production
// final-home rule now uses the presence of the extra Year 6 alias alongside L3
// as the presentation signal, because that is exactly the live defect surface.
function suppressUnreleasedL3Sats(body, hadL3BeforeNormalisation, year6Split) {
  if (!hadL3BeforeNormalisation || hasReleasedSats(year6Split)) return false;
  const maths = Array.isArray(body?.subjects)
    ? body.subjects.find(subject => norm(subject?.subject) === 'maths')
    : null;
  if (!maths || !Array.isArray(maths.views)) return false;
  const before = maths.views.length;
  maths.views = maths.views.filter(view => mathsPresentationRole(view) !== 'sats');
  return maths.views.length !== before;
}

function suppressUnpairedL3Sats(body, hadL3BeforeNormalisation, hadYear6BeforeNormalisation) {
  if (!hadL3BeforeNormalisation || hadYear6BeforeNormalisation) return false;
  const maths = Array.isArray(body?.subjects)
    ? body.subjects.find(subject => norm(subject?.subject) === 'maths')
    : null;
  if (!maths || !Array.isArray(maths.views)) return false;
  const before = maths.views.length;
  maths.views = maths.views.filter(view => mathsPresentationRole(view) !== 'sats');
  return maths.views.length !== before;
}

async function finalHome(request, env, ctx) {
  const response = await currentWorker.fetch(request, env, ctx);
  if (!response.ok) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body?.ok) return response;

  // Capture the live presentation before final normalisation. Matching uses
  // either view IDs or labels so prepared/live alias IDs cannot bypass the rule.
  const l3Before = currentRoleView(body, 'l3');
  const year6Before = currentRoleView(body, 'year6');
  const hadL3BeforeNormalisation = Boolean(l3Before);
  const hadYear6BeforeNormalisation = Boolean(year6Before);

  let year6Split = null;
  if (homeHasYear6Equivalent(body)) {
    const loaded = await canonicalYear6List(request, env, ctx);
    year6Split = loaded.split;
  }

  // The prepared home snapshot can be older than the current entitlement/source
  // classification. Refresh the actual L3 navigation target when one exists;
  // do not assume its internal ID is the canonical presentation ID.
  if (l3Before?.viewId) {
    const l3 = await loadViewList(request, env, ctx, clean(l3Before.viewId));
    refreshHomeViewSummary(body, clean(l3Before.viewId), l3.rows);
  }

  normaliseMathsEquivalentHome(body, year6Split);

  // If L3 existed without an extra Year 6 alias (Kiaan's shape), there is no
  // separate SATS presentation card. If Year 6 existed beside L3 (Devansh's
  // shape), normalisation converts that duplicate alias into SATS.
  suppressUnpairedL3Sats(body, hadL3BeforeNormalisation, hadYear6BeforeNormalisation);

  return responseLike(response, body);
}

async function finalSyntheticList(request, env, ctx, kind) {
  const loaded = await canonicalYear6List(request, env, ctx);
  if (!loaded.response.ok || !loaded.body?.ok || !loaded.split) return loaded.response;

  const rows = kind === 'sats' ? loaded.split.sats : loaded.split.lessons;
  loaded.body.lessons = rows;
  loaded.body.view = syntheticViewSummary(loaded.body.view, kind, rows);
  return responseLike(loaded.response, loaded.body);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/v1/student/home') {
      return finalHome(request, env, ctx);
    }

    if (request.method === 'GET') {
      const synthetic = syntheticListMatch(url);
      if (synthetic) return finalSyntheticList(request, env, ctx, synthetic.kind);
    }

    return currentWorker.fetch(request, env, ctx);
  }
};

export {
  FINAL_MATHS_EQUIVALENT_NAV_MARKER,
  syntheticKind,
  countSummary,
  homeHasYear6Equivalent,
  refreshHomeViewSummary,
  hasReleasedSats,
  suppressUnreleasedL3Sats,
  suppressUnpairedL3Sats,
  finalHome,
  finalSyntheticList
};
