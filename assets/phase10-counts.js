(() => {
  'use strict';

  const config = window.FPT_V2_CONFIG || {};
  const base = String(config.workerBaseUrl || '').replace(/\/$/, '');
  if (!base) return;

  const upstreamFetch = window.fetch.bind(window);

  function requestUrl(input) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      return new URL(raw, window.location.href);
    } catch (_) {
      return null;
    }
  }

  function requestMethod(input, init) {
    return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  }

  function isHomeRequest(input, init) {
    if (requestMethod(input, init) !== 'GET') return false;
    const url = requestUrl(input);
    if (!url) return false;
    try {
      return url.origin === new URL(base).origin && url.pathname === '/api/v1/student/home';
    } catch (_) {
      return false;
    }
  }

  async function specialLessonCount(viewId) {
    const response = await upstreamFetch(
      `${base}/api/v1/student/special-areas?viewId=${encodeURIComponent(String(viewId || ''))}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      }
    );
    if (!response.ok) return 0;
    const body = await response.json().catch(() => null);
    return body?.ok && Array.isArray(body.areas) ? body.areas.length : 0;
  }

  async function augmentHomeResponse(response) {
    if (!response?.ok) return response;

    const body = await response.clone().json().catch(() => null);
    if (!body?.ok || !Array.isArray(body.subjects)) return response;

    const openViews = [];
    for (const subject of body.subjects) {
      for (const view of Array.isArray(subject?.views) ? subject.views : []) {
        if (!view || view.lockedPreview || !view.viewId) continue;
        openViews.push(view);
      }
    }

    await Promise.all(openViews.map(async view => {
      const ordinaryOpenCount = Number(view.openLessonCount || 0);
      const specialCount = await specialLessonCount(view.viewId).catch(() => 0);
      view.ordinaryOpenLessonCount = Number.isFinite(ordinaryOpenCount) ? ordinaryOpenCount : 0;
      view.specialLessonCount = specialCount;
      view.openLessonCount = view.ordinaryOpenLessonCount + specialCount;
    }));

    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('cache-control', 'no-store');

    return new Response(JSON.stringify(body), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  window.fetch = async (input, init) => {
    const response = await upstreamFetch(input, init);
    return isHomeRequest(input, init) ? augmentHomeResponse(response) : response;
  };
})();
