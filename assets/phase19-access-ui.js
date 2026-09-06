(() => {
  const WINDOW_KEY = 'fpt_v2_window_login_v2';
  const WINDOW_HEADER = 'X-FPT-Window-Token';
  const TRIAL_ENDED_MESSAGE = 'Trial access ended, please contact Future Perfect Tuitions to continue accessing content';
  const TRIAL_MESSAGE = 'Trial access includes full lesson descriptions and lesson videos only.';
  const SUBJECT_PREVIEW_MESSAGE = 'Full access available to enrolled students of the subject only';
  const originalFetch = window.fetch.bind(window);

  let listModes = new Map();
  let currentDetail = null;
  let lastLoginError = '';

  function requestUrl(input) {
    try {
      if (typeof input === 'string') return new URL(input, window.location.href);
      if (input?.url) return new URL(input.url, window.location.href);
    } catch (_) {}
    return null;
  }

  function randomWindowToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function getWindowToken() {
    try { return sessionStorage.getItem(WINDOW_KEY) || ''; } catch (_) { return ''; }
  }

  function ensureWindowToken() {
    let token = getWindowToken();
    if (token) return token;
    token = randomWindowToken();
    try { sessionStorage.setItem(WINDOW_KEY, token); } catch (_) {}
    return token;
  }

  function clearWindowToken() {
    try { sessionStorage.removeItem(WINDOW_KEY); } catch (_) {}
  }

  function requestWithWindowToken(input, init, token) {
    if (input instanceof Request) {
      const headers = new Headers(input.headers);
      headers.set(WINDOW_HEADER, token);
      return [new Request(input, { ...(init || {}), headers })];
    }
    const options = { ...(init || {}) };
    const headers = new Headers(options.headers || {});
    headers.set(WINDOW_HEADER, token);
    options.headers = headers;
    return [input, options];
  }

  window.fetch = async (input, init) => {
  const url = requestUrl(input);
  const studentApi = Boolean(url?.pathname?.startsWith('/api/v1/student/'));
  const login = url?.pathname === '/api/v1/student/auth/login';
  const logout = url?.pathname === '/api/v1/student/auth/logout';

  // A successful login marks only this browser window. sessionStorage
  // survives reloads in the same window/tab but disappears when it is closed.
  // A fresh window therefore cannot reuse an older HttpOnly session cookie.
  if (studentApi && !login && !getWindowToken()) {
    return new Response(JSON.stringify({ error: 'WINDOW_LOGIN_REQUIRED' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }

  const response = await originalFetch(input, init);

  if (login) {
    const body = await response.clone().json().catch(() => null);
    lastLoginError = body?.error === 'TRIAL_ACCESS_ENDED'
      ? String(body?.message || TRIAL_ENDED_MESSAGE)
      : '';
    if (response.ok && body?.ok) {
      try { sessionStorage.setItem(WINDOW_KEY, 'authenticated'); } catch (_) {}
    } else {
      clearWindowToken();
    }
  } else if (studentApi && response.status === 401) {
    clearWindowToken();
  }

  if (logout && response.ok) clearWindowToken();

  if (/\/api\/v1\/student\/views\/[^/]+\/lessons$/.test(url?.pathname || '')) {
    response.clone().json().then(body => {
      listModes = new Map();
      for (const lesson of Array.isArray(body?.lessons) ? body.lessons : []) {
        const mode = String(lesson?.accessMode || '');
        if (!['trial', 'subject-preview'].includes(mode)) continue;
        for (const code of [lesson?.lessonId, lesson?.displayLessonId].map(String).filter(Boolean)) {
          listModes.set(code, mode);
        }
      }
      queueApply();
    }).catch(() => {});
  }

  if (/\/api\/v1\/student\/lessons\/[^/]+$/.test(url?.pathname || '')) {
    response.clone().json().then(body => {
      const mode = String(body?.lesson?.accessMode || '');
      currentDetail = ['trial', 'subject-preview'].includes(mode)
        ? {
            mode,
            lessonId: String(body.lesson.lessonId || ''),
            displayLessonId: String(body.lesson.displayLessonId || ''),
            message: String(body.lesson.accessMessage || (mode === 'trial' ? TRIAL_MESSAGE : SUBJECT_PREVIEW_MESSAGE))
          }
        : null;
      queueApply();
    }).catch(() => {});
  }

  return response;
};

  function applyLoginError() {
    if (!lastLoginError) return;
    const error = document.getElementById('login-error');
    if (!error || error.hidden) return;
    error.textContent = lastLoginError;
  }

  function applyListLabels() {
    document.querySelectorAll('.phase6-lesson-row').forEach(row => {
      const code = String(row.querySelector('.phase6-lesson-code')?.textContent || '').trim();
      const mode = listModes.get(code);
      if (!mode) return;
      const state = row.querySelector('.phase6-lesson-state');
      if (!state) return;
      if (mode === 'trial') {
        state.classList.remove('locked');
        state.textContent = 'Trial video access';
      } else {
        state.classList.add('locked');
        state.textContent = '🔒 Subject not enrolled';
      }
    });
  }

  function applyDetail() {
    if (!currentDetail) return;
    const code = String(document.getElementById('lesson-code')?.textContent || '').trim();
    if (!code || ![currentDetail.lessonId, currentDetail.displayLessonId].includes(code)) return;
    const state = document.getElementById('lesson-state');
    if (state) {
      if (currentDetail.mode === 'trial') {
        state.classList.remove('locked');
        state.textContent = 'Trial video access';
      } else {
        state.classList.add('locked');
        state.textContent = '🔒 Subject not enrolled';
      }
    }
    const note = document.getElementById('lesson-locked-note');
    if (note) {
      note.textContent = currentDetail.message;
      note.hidden = false;
    }
  }

  let queued = false;
  function queueApply() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      applyLoginError();
      applyListLabels();
      applyDetail();
    });
  }

  new MutationObserver(queueApply).observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['hidden']
  });
  queueApply();
})();
