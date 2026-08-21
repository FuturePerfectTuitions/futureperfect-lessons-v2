(() => {
  const config = window.FPT_V2_CONFIG || {};
  const base = String(config.workerBaseUrl || '').replace(/\/$/, '');

  const els = {
    loginScreen: document.getElementById('login-screen'),
    portalScreen: document.getElementById('portal-screen'),
    loginForm: document.getElementById('login-form'),
    username: document.getElementById('username'),
    password: document.getElementById('login-password'),
    togglePassword: document.getElementById('toggle-login-password'),
    eyeOpen: document.getElementById('eye-open'),
    eyeClosed: document.getElementById('eye-closed'),
    loginButton: document.getElementById('login-button'),
    loginError: document.getElementById('login-error'),
    greeting: document.getElementById('student-greeting'),
    welcomeHeading: document.getElementById('welcome-heading'),
    logoutButton: document.getElementById('logout-button'),
    mathsChoice: document.getElementById('maths-choice'),
    englishChoice: document.getElementById('english-choice'),
    message: document.getElementById('phase5-message')
  };

  let currentSession = null;

  function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');

    return fetch(`${base}${path}`, {
      ...options,
      headers,
      credentials: 'include',
      cache: 'no-store'
    });
  }

  function setLoginError(message = '') {
    els.loginError.textContent = message || 'Invalid login';
    els.loginError.hidden = !message;
  }

  function setMessage(message = '') {
    els.message.textContent = message;
    els.message.hidden = !message;
  }

  function resetPasswordVisibility() {
    els.password.type = 'password';
    els.togglePassword.setAttribute('aria-label', 'Show password');
    els.togglePassword.setAttribute('aria-pressed', 'false');
    els.eyeOpen.hidden = false;
    els.eyeClosed.hidden = true;
  }

  function showLogin() {
    currentSession = null;
    els.portalScreen.hidden = true;
    els.loginScreen.hidden = false;
    els.password.value = '';
    resetPasswordVisibility();
    setMessage();
  }

  function showPortal(session) {
    currentSession = session;
    const firstName = String(session?.firstName || 'Student').trim() || 'Student';

    els.greeting.textContent = `Hi, ${firstName}`;
    els.welcomeHeading.textContent = `Welcome, ${firstName}`;
    els.loginScreen.hidden = true;
    els.portalScreen.hidden = false;
    setLoginError();

    if (session?.accountLocked) {
      setMessage('Your account is currently locked. Your portal remains visible, but lesson and resource access is unavailable.');
    } else {
      setMessage();
    }
  }

  async function readSession() {
    if (!base) {
      setLoginError('The student portal is temporarily unavailable. Please try again later.');
      showLogin();
      return null;
    }

    try {
      const response = await api('/api/v1/student/session', { method: 'GET' });
      let body = null;
      try {
        body = await response.json();
      } catch (_) {}

      if (!response.ok || !body?.ok) {
        showLogin();
        return null;
      }

      showPortal(body);
      return body;
    } catch (_) {
      showLogin();
      setLoginError('The student portal is temporarily unavailable. Please try again later.');
      return null;
    }
  }

  async function login(event) {
    event.preventDefault();
    setLoginError();

    const username = els.username.value.trim();
    const password = els.password.value;

    if (!username || !password) {
      setLoginError('Invalid login');
      return;
    }

    els.loginButton.disabled = true;

    try {
      const response = await api('/api/v1/student/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      let body = null;
      try {
        body = await response.json();
      } catch (_) {}

      els.password.value = '';
      resetPasswordVisibility();

      if (!response.ok || !body?.ok) {
        setLoginError('Invalid login');
        return;
      }

      const session = await readSession();
      if (!session) {
        setLoginError('The login could not be completed in this browser. Please try again.');
      }
    } catch (_) {
      els.password.value = '';
      resetPasswordVisibility();
      setLoginError('The student portal is temporarily unavailable. Please try again later.');
    } finally {
      els.loginButton.disabled = false;
    }
  }

  async function logout() {
    els.logoutButton.disabled = true;

    try {
      if (base) {
        await api('/api/v1/student/auth/logout', { method: 'POST' });
      }
    } catch (_) {
      // Local UI still returns to the login screen; the server session will
      // remain protected by its normal expiry/revocation checks.
    } finally {
      els.logoutButton.disabled = false;
      showLogin();
      els.username.focus();
    }
  }

  async function recordActivity() {
    if (!currentSession || !base) return;
    try {
      await api('/api/v1/student/session/activity', { method: 'POST' });
    } catch (_) {}
  }

  function chooseSubject(label) {
    recordActivity();
    setMessage(`${label} is ready as a top-level Portal V2 subject. Year/Level curriculum navigation is added in Phase 6.`);
  }

  els.loginForm.addEventListener('submit', login);

  els.togglePassword.addEventListener('click', () => {
    const showing = els.password.type === 'text';
    els.password.type = showing ? 'password' : 'text';
    els.togglePassword.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    els.togglePassword.setAttribute('aria-pressed', showing ? 'false' : 'true');
    els.eyeOpen.hidden = !showing;
    els.eyeClosed.hidden = showing;
    els.password.focus();
  });

  els.logoutButton.addEventListener('click', logout);
  els.mathsChoice.addEventListener('click', () => chooseSubject('Maths'));
  els.englishChoice.addEventListener('click', () => chooseSubject('English'));

  readSession();
})();
