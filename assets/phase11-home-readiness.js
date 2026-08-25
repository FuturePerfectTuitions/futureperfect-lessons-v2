(() => {
  'use strict';

  const downstreamFetch = window.fetch.bind(window);
  const HOME_TTL_MS = 5000;
  const holder = document.getElementById('phase7-message');
  const LOADING_MESSAGE = 'Loading your curriculum… Please wait.';
  let homePromise = null;
  let homeExpiresAt = 0;
  let homeReady = false;
  let bootstrapSessionPromise = null;

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

  function isLoadingNotice() {
    if (!holder) return false;
    const text = holder.textContent.trim();
    return text === LOADING_MESSAGE || text === 'Curriculum navigation is still loading. Please try again in a moment.';
  }

  function clearLoadingNotice() {
    if (!holder || !isLoadingNotice()) return;
    holder.textContent = '';
    holder.hidden = true;
  }

  function clearHomeCache({ resetReady = false } = {}) {
    homePromise = null;
    homeExpiresAt = 0;
    if (resetReady) homeReady = false;
  }

  function clearBootstrapSession() {
    bootstrapSessionPromise = null;
  }

  function rememberHomeRequest(promise) {
    homePromise = promise;
    homeExpiresAt = Date.now() + HOME_TTL_MS;
    promise.then(response => {
      if (response?.ok) {
        homeReady = true;
        clearLoadingNotice();
      } else if (homePromise === promise) {
        clearHomeCache();
      }
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

  function rememberBootstrapSession(loginResponse) {
    bootstrapSessionPromise = loginResponse.clone().json()
      .then(body => {
        if (!body?.ok) return null;
        return {
          ok: true,
          firstName: body.firstName,
          portalUserId: body.portalUserId,
          status: body.status,
          expires: body.expires,
          expired: body.expired,
          accountLocked: body.accountLocked,
          idleExpiresAt: body.idleExpiresAt
        };
      })
      .catch(() => null);
  }

  async function takeBootstrapSessionResponse() {
    if (!bootstrapSessionPromise) return null;
    const promise = bootstrapSessionPromise;
    clearBootstrapSession();
    const body = await promise;
    if (!body?.ok) return null;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      }
    });
  }

  window.fetch = async (input, init) => {
    const info = requestInfo(input, init);
    if (!info) return downstreamFetch(input, init);

    const isHome = info.method === 'GET' && info.url.pathname === '/api/v1/student/home';
    const isLogin = info.method === 'POST' && info.url.pathname === '/api/v1/student/auth/login';
    const isSession = info.method === 'GET' && info.url.pathname === '/api/v1/student/session';
    const isLogout = info.method === 'POST' && info.url.pathname === '/api/v1/student/auth/logout';

    if (isLogout) {
      clearBootstrapSession();
      clearHomeCache({ resetReady: true });
      clearLoadingNotice();
    }

    // Immediately after a successful login, phase7 asks /session for the same
    // identity/account fields the login response has just supplied. Reuse that
    // successful response exactly once. The real HttpOnly server session has
    // already been created and remains authoritative for all later requests.
    if (isSession && bootstrapSessionPromise) {
      const bootstrap = await takeBootstrapSessionResponse();
      if (bootstrap) return bootstrap;
    }

    if (isHome) {
      const cached = freshHomePromise();
      if (cached) {
        const response = await cached;
        if (response.ok) {
          homeReady = true;
          clearLoadingNotice();
        }
        return response.clone();
      }

      const promise = rememberHomeRequest(downstreamFetch(input, init));
      const response = await promise;
      if (response.ok) {
        homeReady = true;
        clearLoadingNotice();
      }
      return response.clone();
    }

    const response = await downstreamFetch(input, init);
    if (isLogin) {
      clearBootstrapSession();
      clearHomeCache({ resetReady: true });
      if (response.ok) {
        rememberBootstrapSession(response);
        primeHome(info.url);
      }
    }
    return response;
  };

  if (holder) {
    holder.setAttribute('aria-live', 'polite');
    const normaliseLoadingMessage = () => {
      const text = holder.textContent.trim();
      if (text === 'Curriculum navigation is still loading. Please try again in a moment.') {
        if (homeReady) {
          clearLoadingNotice();
        } else {
          holder.textContent = LOADING_MESSAGE;
        }
        return;
      }
      if (homeReady && text === LOADING_MESSAGE) clearLoadingNotice();
    };
    new MutationObserver(normaliseLoadingMessage).observe(holder, {
      childList: true,
      characterData: true,
      subtree: true
    });
    normaliseLoadingMessage();
  }
})();