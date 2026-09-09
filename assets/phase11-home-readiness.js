(() => {
  'use strict';

  const downstreamFetch = window.fetch.bind(window);
  const HOME_TTL_MS = 5000;
  const PREFETCH_REUSE_WAIT_MS = 1200;
  const HOME_REQUEST_TIMEOUT_MS = 7000;
  const HOME_RETRY_DELAY_MS = 250;
  const holder = document.getElementById('phase7-message');
  const LOADING_MESSAGE = 'Loading your curriculum… Please wait.';
  let homePromise = null;
  let homeExpiresAt = 0;
  let homeAbortController = null;
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

  function clearHomeCache({ resetReady = false, abort = false } = {}) {
    if (abort && homeAbortController) {
      try { homeAbortController.abort(); } catch (_) {}
    }
    homePromise = null;
    homeExpiresAt = 0;
    homeAbortController = null;
    if (resetReady) homeReady = false;
  }

  function clearBootstrapSession() {
    bootstrapSessionPromise = null;
  }

  function rememberHomeRequest(promise, controller = null) {
    homePromise = promise;
    homeAbortController = controller;
    homeExpiresAt = Date.now() + HOME_TTL_MS;
    promise.catch(() => {
      if (homePromise === promise) clearHomeCache();
    });
    return promise;
  }

  function freshHomePromise() {
    if (!homePromise) return null;
    if (Date.now() >= homeExpiresAt) {
      clearHomeCache({ abort: true });
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

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function settleWithin(promise, ms) {
    let timer = 0;
    const timeout = new Promise(resolve => {
      timer = window.setTimeout(() => resolve({ timedOut: true }), ms);
    });
    const settled = promise.then(
      value => ({ timedOut: false, value }),
      error => ({ timedOut: false, error })
    );
    const result = await Promise.race([settled, timeout]);
    if (timer) window.clearTimeout(timer);
    return result;
  }

  async function fetchWithTimeout(input, init, timeoutMs) {
    const controller = new AbortController();
    const sourceSignal = init?.signal || (input instanceof Request ? input.signal : null);
    let sourceAbort = null;

    if (sourceSignal) {
      if (sourceSignal.aborted) controller.abort();
      else {
        sourceAbort = () => controller.abort();
        sourceSignal.addEventListener('abort', sourceAbort, { once: true });
      }
    }

    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await downstreamFetch(input, { ...(init || {}), signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
      if (sourceSignal && sourceAbort) sourceSignal.removeEventListener('abort', sourceAbort);
    }
  }

  function shouldRetryHomeResponse(response) {
    return response?.status === 408 || response?.status === 429 || response?.status >= 500;
  }

  async function fetchHomeWithRetry(input, init) {
    let lastError = null;
    let lastResponse = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchWithTimeout(input, init, HOME_REQUEST_TIMEOUT_MS);
        lastResponse = response;
        if (response?.ok) {
          homeReady = true;
          clearLoadingNotice();
          return response;
        }
        if (!shouldRetryHomeResponse(response) || attempt === 1) return response;
      } catch (error) {
        lastError = error;
        if (attempt === 1) throw error;
      }
      await delay(HOME_RETRY_DELAY_MS);
    }

    if (lastResponse) return lastResponse;
    throw lastError || new Error('Curriculum request failed');
  }

  function primeHome(loginUrl) {
    if (freshHomePromise()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), HOME_TTL_MS);
    const promise = downstreamFetch(homeUrlFrom(loginUrl), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal
    }).finally(() => window.clearTimeout(timer));
    rememberHomeRequest(promise, controller);
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
      clearHomeCache({ resetReady: true, abort: true });
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
        const settled = await settleWithin(cached, PREFETCH_REUSE_WAIT_MS);
        if (!settled.timedOut && !settled.error && settled.value?.ok) {
          const response = settled.value;
          clearHomeCache();
          homeReady = true;
          clearLoadingNotice();
          return response.clone();
        }

        // The speculative request is only an optimisation. Never let a slow,
        // failed or rejected prefetch block the real foreground home request.
        clearHomeCache({ abort: true });
      }

      const response = await fetchHomeWithRetry(input, init);
      return response.clone();
    }

    const response = await downstreamFetch(input, init);
    if (isLogin) {
      clearBootstrapSession();
      clearHomeCache({ resetReady: true, abort: true });
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
