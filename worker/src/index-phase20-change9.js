import change8Worker from './index-phase20-change8.js';

const clean = value => String(value ?? '').trim();

function consistentViewLabel(viewId) {
  let match = clean(viewId).match(/^english-year([2-6])(-11plus)?$/i);
  if (match) return `Year ${match[1]}${match[2] ? ' 11+' : ''}`;

  match = clean(viewId).match(/^maths-year([2-6])$/i);
  if (match) return `Year ${match[1]}`;

  match = clean(viewId).match(/^maths-level([1-3])$/i);
  if (match) return `Level ${match[1]} 11+`;

  return clean(viewId);
}

function normaliseNavigationLabels(body) {
  if (!body || typeof body !== 'object') return body;

  if (Array.isArray(body.subjects)) {
    for (const subject of body.subjects) {
      if (!Array.isArray(subject?.views)) continue;
      for (const view of subject.views) {
        if (!view?.viewId) continue;
        view.label = consistentViewLabel(view.viewId);
      }
    }
  }

  if (body.view?.viewId) {
    body.view.label = consistentViewLabel(body.view.viewId);
  }

  if (Array.isArray(body.recentShares)) {
    for (const item of body.recentShares) {
      if (!item?.viewId) continue;
      item.viewLabel = consistentViewLabel(item.viewId);
    }
  }

  return body;
}

function isNavigationResponse(url, request) {
  if (request.method !== 'GET') return false;
  if (url.pathname === '/api/v1/student/home') return true;
  return /^\/api\/v1\/student\/views\/[^/]+\/lessons$/.test(url.pathname);
}

function jsonResponseLike(response, body) {
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

export { consistentViewLabel, normaliseNavigationLabels };

export default {
  async fetch(request, env, ctx) {
    const response = await change8Worker.fetch(request, env, ctx);
    const url = new URL(request.url);
    if (!response.ok || !isNavigationResponse(url, request)) return response;

    const body = await response.clone().json().catch(() => null);
    if (!body?.ok) return response;

    return jsonResponseLike(response, normaliseNavigationLabels(body));
  }
};
