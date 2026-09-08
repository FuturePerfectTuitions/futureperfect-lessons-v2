import change15Worker from './index-phase20-change15.js';

// Performance note: Portal home now avoids loading every entitled lesson record
// individually. Change 8 resolves established access from the bundled catalogue
// plus live curriculum membership, with live-KV fallback only for genuinely new
// or unresolved lessons. Change 10 also checks ordinary PreLesson availability
// directly from the canonical lesson record instead of recursively rendering each
// recent-share lesson. This file is intentionally touched so production bundles
// and deploys those imported performance changes.
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function isCrossSubjectPreview(view) {
  // lockedPreview is the authoritative presentation/access marker.
  // Do not classify from source alone: Change 15 may merge a genuine 11+ Maths
  // level entitlement with a year-alias preview, leaving the historical source
  // string behind even though lockedPreview is false and real access exists.
  return view?.lockedPreview === true;
}

export function suppressCrossSubjectPreviewsForEnrolledSubjects(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.subjects)) return body;

  for (const subject of body.subjects) {
    if (!Array.isArray(subject?.views)) continue;
    const hasActualView = subject.views.some(view => !isCrossSubjectPreview(view));
    if (!hasActualView) continue;

    // Upsell previews are only for a completely unenrolled subject.
    // Once the student has any real access in that subject, its year/level
    // navigation must come only from explicit entitlements/imports.
    subject.views = subject.views.filter(view => !isCrossSubjectPreview(view));
  }

  return body;
}

export function suppressedCrossSubjectViewIds(body) {
  const suppressed = new Set();
  if (!body || typeof body !== 'object' || !Array.isArray(body.subjects)) return suppressed;

  for (const subject of body.subjects) {
    const views = Array.isArray(subject?.views) ? subject.views : [];
    if (!views.some(view => !isCrossSubjectPreview(view))) continue;
    for (const view of views) {
      if (isCrossSubjectPreview(view) && view?.viewId) suppressed.add(norm(view.viewId));
    }
  }
  return suppressed;
}

function jsonLike(response, body, status = null) {
  const headers = new Headers(response?.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), {
    status: status ?? response?.status ?? 200,
    statusText: response?.statusText,
    headers
  });
}

function requestedViewId(url) {
  const queryView = norm(url.searchParams.get('viewId'));
  if (queryView) return queryView;
  const match = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
  if (!match) return '';
  try { return norm(decodeURIComponent(match[1])); } catch { return ''; }
}

async function homeResponse(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/v1/student/home';
  url.search = '';
  return change15Worker.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  }), env, ctx);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method !== 'GET' || !url.pathname.startsWith('/api/v1/student/')) {
      return change15Worker.fetch(request, env, ctx);
    }

    if (url.pathname === '/api/v1/student/home') {
      const response = await change15Worker.fetch(request, env, ctx);
      if (!response.ok) return response;
      const body = await response.clone().json().catch(() => null);
      if (!body?.ok) return response;
      return jsonLike(response, suppressCrossSubjectPreviewsForEnrolledSubjects(body));
    }

    const viewId = requestedViewId(url);
    if (viewId) {
      const home = await homeResponse(request, env, ctx);
      if (home.ok) {
        const body = await home.clone().json().catch(() => null);
        if (body?.ok && suppressedCrossSubjectViewIds(body).has(viewId)) {
          return jsonLike(home, { error:'VIEW_NOT_VISIBLE' }, 404);
        }
      }
    }

    return change15Worker.fetch(request, env, ctx);
  }
};
