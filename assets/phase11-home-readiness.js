(() => {
  'use strict';

  const downstreamFetch = window.fetch.bind(window);
  const HOME_TTL_MS = 5000;
  let homePromise = null;
  let homeExpiresAt = 0;

  function requestInfo(input, init) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      const url = new URL(raw, location.href);
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      return { url, method };
    } catch {
      return null;
    }
  }

  function clearHomeCache() {
    homePromise = null;
    homeExpiresAt = 0;
  }

  function rememberHomeRequest(promise) {
    homePromise = promise;
    homeExpiresAt = Date.now() + HOME_TTL_MS;
    promise.then(response => {
      if (!response?.ok && homePromise === promise) clearHomeCache();
    }).catch(() => {
      if (homePromise === promise) clearHomeCache();
    });
    return promise;
  }

  function freshHomePromise() {
    if (!homePromise) return null;
    if (Date.now() >= homeExpiresAt) {
      clearHomeCache();
      return null;
    }
    return homePromise;
  }

  function homeUrlFrom(url) {
    const homeUrl = new URL(url.toString());
    homeUrl.pathname = '/api/v1/student/home';
    homeUrl.search = '';
    homeUrl.hash = '';
    return homeUrl.toString();
  }

  function primeHome(loginUrl) {
    if (freshHomePromise()) return;
    const promise = Promise.resolve().then(() => downstreamFetch(homeUrlFrom(loginUrl), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
      cache: 'no-store'
    }));
    rememberHomeRequest(promise);
  }

  window.fetch = async (input, init) => {
    const info = requestInfo(input, init);
    if (!info) return downstreamFetch(input, init);

    const isHome = info.method === 'GET' && info.url.pathname === '/api/v1/student/home';
    const isLogin = info.method === 'POST' && info.url.pathname === '/api/v1/student/auth/login';
    const isLogout = info.method === 'POST' && info.url.pathname === '/api/v1/student/auth/logout';

    if (isLogout) clearHomeCache();

    if (isHome) {
      const cached = freshHomePromise();
      if (cached) {
        const response = await cached;
        return response.clone();
      }

      const promise = rememberHomeRequest(downstreamFetch(input, init));
      const response = await promise;
      return response.clone();
    }

    const response = await downstreamFetch(input, init);
    if (isLogin && response.ok) primeHome(info.url);
    return response;
  };

  const holder = document.getElementById('phase7-message');
  if (holder) {
    holder.setAttribute('aria-live', 'polite');
    const normaliseLoadingMessage = () => {
      if (holder.textContent.trim() === 'Curriculum navigation is still loading. Please try again in a moment.') {
        holder.textContent = 'Loading your curriculum…';
      }
    };
    new MutationObserver(normaliseLoadingMessage).observe(holder, {
      childList: true,
      characterData: true,
      subtree: true
    });
    normaliseLoadingMessage();
  }
})();
