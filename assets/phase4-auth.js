(() => {
  const config = window.FPT_V2_CONFIG || {};
  const base = String(config.workerBaseUrl || '').replace(/\/$/, '');

  const els = {
    status: document.getElementById('auth-status'),
    sessionChip: document.getElementById('session-chip'),
    loginForm: document.getElementById('login-form'),
    username: document.getElementById('username'),
    password: document.getElementById('login-password'),
    togglePassword: document.getElementById('toggle-login-password'),
    loginButton: document.getElementById('login-button'),
    loginError: document.getElementById('login-error'),
    signedOutPanel: document.getElementById('signed-out-panel'),
    signedInPanel: document.getElementById('signed-in-panel'),
    sessionStudent: document.getElementById('session-student'),
    sessionStatus: document.getElementById('session-status'),
    sessionLastActivity: document.getElementById('session-last-activity'),
    sessionIdleExpiry: document.getElementById('session-idle-expiry'),
    refreshSession: document.getElementById('refresh-session'),
    logoutButton: document.getElementById('logout-button'),
    phase4Output: document.getElementById('phase4-output')
  };

  function setStatus(kind, message) {
    els.status.className = `phase-status ${kind === 'ok' ? 'status-ok-box' : kind === 'error' ? 'status-error-box' : 'status-wait'}`;
    els.status.textContent = message;
  }

  function setLoginError(message = '') {
    els.loginError.textContent = message;
    els.loginError.hidden = !message;
  }

  function showSignedOut(message = 'No authenticated browser session is currently available.') {
    els.sessionChip.textContent = 'Not signed in';
    els.signedOutPanel.textContent = message;
    els.signedOutPanel.hidden = false;
    els.signedInPanel.hidden = true;
    els.phase4Output.textContent = 'Waiting for an authenticated browser session.';
  }

  function formatDate(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');

    return fetch(`${base}${path}`, {
      ...options,
      headers,
      credentials: 'include',
      cache: 'no-store'
    });
  }

  async function loadAuthenticatedPhase4() {
    const response = await api('/api/dev/phase4', { method: 'GET' });
    let body = null;
    try {
      body = await response.json();
    } catch (_) {}

    if (!response.ok || !body?.ok) {
      els.phase4Output.textContent = JSON.stringify(
        body || { error: `HTTP_${response.status}` },
        null,
        2
      );
      return false;
    }

    const maths = (body.subjects || []).find(subject => subject.subject === 'maths');
    const lesson = maths?.views?.[0]?.lessons?.[0] || null;

    els.phase4Output.textContent = JSON.stringify(
      {
        ok: body.ok,
        phase: body.phase,
        phase4Healthy: body.phase4Healthy,
        student: body.student,
        session: body.session,
        firstMathsLesson: lesson
          ? {
              lessonId: lesson.lessonId,
              title: lesson.title,
              locked: Boolean(lesson.locked)
            }
          : null
      },
      null,
      2
    );

    return body.phase4Healthy === true;
  }

  async function verifySession({ afterLogin = false } = {}) {
    if (!base) {
      setStatus('error', 'The V2 Worker URL is not configured.');
      showSignedOut();
      return false;
    }

    const response = await api('/api/v1/student/session', { method: 'GET' });
    let body = null;
    try {
      body = await response.json();
    } catch (_) {}

    if (!response.ok || !body?.ok) {
      if (afterLogin) {
        setStatus(
          'error',
          'Login was accepted, but the browser did not return the HttpOnly session cookie on the next request. This usually indicates a cross-site cookie restriction in the browser.'
        );
        showSignedOut('Login succeeded, but the browser session cookie was not available to the authenticated request.');
      } else {
        setStatus('wait', 'No active development browser session.');
        showSignedOut();
      }
      return false;
    }

    els.sessionChip.textContent = `${body.firstName || 'Student'} · ${body.portalUserId}`;
    els.signedOutPanel.hidden = true;
    els.signedInPanel.hidden = false;
    els.sessionStudent.textContent = `${body.firstName || 'Student'} (${body.portalUserId})`;
    els.sessionStatus.textContent = body.accountLocked ? 'Locked' : body.status || 'active';
    els.sessionLastActivity.textContent = formatDate(body.lastActivityAt);
    els.sessionIdleExpiry.textContent = formatDate(body.idleExpiresAt);

    const phase4Healthy = await loadAuthenticatedPhase4();
    setStatus(
      phase4Healthy ? 'ok' : 'error',
      phase4Healthy
        ? 'Phase 4 browser authentication, server session and authenticated lesson access are working.'
        : 'The browser session is authenticated, but the Phase 4 lesson proof is not fully healthy.'
    );

    return true;
  }

  async function login(event) {
    event.preventDefault();
    setLoginError();
    els.loginButton.disabled = true;
    setStatus('wait', 'Submitting development login…');

    try {
      const response = await api('/api/v1/student/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: els.username.value,
          password: els.password.value
        })
      });

      let body = null;
      try {
        body = await response.json();
      } catch (_) {}

      els.password.value = '';

      if (!response.ok || !body?.ok) {
        setStatus('error', 'Development login was rejected.');
        setLoginError(body?.error === 'INVALID_LOGIN' ? 'Incorrect username or password, or this user is not permitted in development.' : body?.error || `HTTP ${response.status}`);
        return;
      }

      setStatus('wait', 'Login accepted. Verifying the HttpOnly browser session…');
      await verifySession({ afterLogin: true });
    } catch (error) {
      setStatus('error', 'Could not reach the V2 authentication service.');
      setLoginError(String(error?.message || error));
    } finally {
      els.loginButton.disabled = false;
    }
  }

  async function logout() {
    els.logoutButton.disabled = true;
    try {
      await api('/api/v1/student/auth/logout', { method: 'POST' });
    } finally {
      els.logoutButton.disabled = false;
      setStatus('wait', 'Development session logged out.');
      showSignedOut('The browser session has been revoked and cleared.');
    }
  }

  els.loginForm.addEventListener('submit', login);
  els.togglePassword.addEventListener('click', () => {
    els.password.type = els.password.type === 'password' ? 'text' : 'password';
  });
  els.refreshSession.addEventListener('click', () => verifySession());
  els.logoutButton.addEventListener('click', logout);

  verifySession();
})();
