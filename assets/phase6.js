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
    subjectsMessage: document.getElementById('phase6-message'),
    screenSubjects: document.getElementById('screen-subjects'),
    screenViews: document.getElementById('screen-views'),
    screenLessons: document.getElementById('screen-lessons'),
    backToSubjects: document.getElementById('back-to-subjects'),
    backToViews: document.getElementById('back-to-views'),
    viewsHeading: document.getElementById('views-heading'),
    viewGrid: document.getElementById('view-grid'),
    lessonsEyebrow: document.getElementById('lessons-eyebrow'),
    lessonsHeading: document.getElementById('lessons-heading'),
    lessonSearch: document.getElementById('lesson-search'),
    lessonList: document.getElementById('lesson-list'),
    lessonEmpty: document.getElementById('lesson-empty')
  };

  const state = {
    session: null,
    home: null,
    subjectKey: null,
    subjectLabel: null,
    view: null,
    lessons: []
  };

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

  function setSubjectsMessage(message = '') {
    els.subjectsMessage.textContent = message;
    els.subjectsMessage.hidden = !message;
  }

  function resetPasswordVisibility() {
    els.password.type = 'password';
    els.togglePassword.setAttribute('aria-label', 'Show password');
    els.togglePassword.setAttribute('aria-pressed', 'false');
    els.eyeOpen.hidden = false;
    els.eyeClosed.hidden = true;
  }

  function showPortalScreen(name) {
    els.screenSubjects.hidden = name !== 'subjects';
    els.screenViews.hidden = name !== 'views';
    els.screenLessons.hidden = name !== 'lessons';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetNavigation() {
    state.home = null;
    state.subjectKey = null;
    state.subjectLabel = null;
    state.view = null;
    state.lessons = [];
    els.viewGrid.innerHTML = '';
    els.lessonList.innerHTML = '';
    els.lessonEmpty.hidden = true;
    els.lessonSearch.value = '';
  }

  function showLogin() {
    state.session = null;
    resetNavigation();
    els.portalScreen.hidden = true;
    els.loginScreen.hidden = false;
    els.password.value = '';
    resetPasswordVisibility();
    setSubjectsMessage();
  }

  function showPortal(session) {
    state.session = session;
    const firstName = String(session?.firstName || 'Student').trim() || 'Student';

    els.greeting.textContent = `Hi, ${firstName}`;
    els.welcomeHeading.textContent = `Welcome, ${firstName}`;
    els.loginScreen.hidden = true;
    els.portalScreen.hidden = false;
    setLoginError();
    showPortalScreen('subjects');

    if (session?.accountLocked) {
      setSubjectsMessage(
        'Your account is currently locked. Your portal remains visible, but lesson and resource access is unavailable.'
      );
    } else {
      setSubjectsMessage();
    }
  }

  async function loadHome() {
    if (!base || !state.session) return null;

    try {
      const response = await api('/api/v1/student/home', { method: 'GET' });
      let body = null;
      try {
        body = await response.json();
      } catch (_) {}

      if (response.status === 401) {
        showLogin();
        return null;
      }

      if (!response.ok || !body?.ok) {
        state.home = null;
        setSubjectsMessage('Curriculum navigation is temporarily unavailable. Please try again.');
        return null;
      }

      state.home = body;
      return body;
    } catch (_) {
      state.home = null;
      setSubjectsMessage('Curriculum navigation is temporarily unavailable. Please try again.');
      return null;
    }
  }

  async function readSession() {
    if (!base) {
      showLogin();
      setLoginError('The student portal is temporarily unavailable. Please try again later.');
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

      resetNavigation();
      showPortal(body);
      await loadHome();
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
      if (base) await api('/api/v1/student/auth/logout', { method: 'POST' });
    } catch (_) {
      // The server-side session still expires/revokes normally if the explicit
      // logout request cannot complete.
    } finally {
      els.logoutButton.disabled = false;
      showLogin();
      els.username.focus();
    }
  }

  async function recordActivity() {
    if (!state.session || !base) return;
    try {
      await api('/api/v1/student/session/activity', { method: 'POST' });
    } catch (_) {}
  }

  function subjectFromHome(subjectKey) {
    return (state.home?.subjects || []).find(subject => subject.subject === subjectKey) || {
      subject: subjectKey,
      views: []
    };
  }

  function renderViews(subjectKey, subjectLabel) {
    state.subjectKey = subjectKey;
    state.subjectLabel = subjectLabel;
    state.view = null;
    state.lessons = [];

    els.viewsHeading.textContent = subjectLabel;
    els.viewGrid.innerHTML = '';

    const subject = subjectFromHome(subjectKey);
    const views = Array.isArray(subject.views) ? subject.views : [];

    if (!views.length) {
      const empty = document.createElement('div');
      empty.className = 'phase6-empty-state';
      empty.textContent = 'No Year or Level view is available for this subject yet.';
      els.viewGrid.appendChild(empty);
      return;
    }

    for (const view of views) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'phase6-view-card';

      const text = document.createElement('span');
      const title = document.createElement('span');
      title.className = 'phase6-view-card-title';
      title.textContent = view.label;

      const meta = document.createElement('span');
      meta.className = 'phase6-view-card-meta';

      if (view.lockedPreview) {
        if (view.catalogueAvailable === false) {
          meta.textContent = 'Cross-subject locked preview';
        } else {
          const count = Number(view.visibleLessonCount || 0);
          meta.textContent = `${count} lesson${count === 1 ? '' : 's'} · locked preview`;
        }
      } else {
        const openCount = Number(view.openLessonCount || 0);
        const lockedCount = Number(view.lockedLessonCount || 0);
        if (lockedCount > 0) {
          meta.textContent = `${openCount} available · ${lockedCount} locked`;
        } else {
          meta.textContent = `${openCount} available lesson${openCount === 1 ? '' : 's'}`;
        }
      }

      text.appendChild(title);
      text.appendChild(meta);

      if (view.lockedPreview) {
        const lock = document.createElement('span');
        lock.className = 'phase6-lock-badge';
        lock.textContent = '🔒 Preview';
        text.appendChild(lock);
      }

      const arrow = document.createElement('span');
      arrow.className = 'phase6-view-card-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';

      card.appendChild(text);
      card.appendChild(arrow);
      card.addEventListener('click', () => openView(view));
      els.viewGrid.appendChild(card);
    }
  }

  async function chooseSubject(subjectKey, subjectLabel) {
    recordActivity();

    if (!state.home) {
      setSubjectsMessage('Curriculum navigation is still loading. Please try again in a moment.');
      const home = await loadHome();
      if (!home) return;
    }

    renderViews(subjectKey, subjectLabel);
    showPortalScreen('views');
  }

  async function fetchViewLessons(view) {
    const encodedViewId = encodeURIComponent(view.viewId);

    try {
      const response = await api(
        `/api/v1/student/views/${encodedViewId}/lessons`,
        { method: 'GET' }
      );

      let body = null;
      try {
        body = await response.json();
      } catch (_) {}

      if (response.status === 401) {
        showLogin();
        return null;
      }

      if (!response.ok || !body?.ok) return null;
      return body;
    } catch (_) {
      return null;
    }
  }

  function renderLessonList() {
    const query = els.lessonSearch.value.trim().toLowerCase();

    els.lessonList.innerHTML = '';
    els.lessonEmpty.hidden = true;

    if (state.view?.catalogueAvailable === false) {
      els.lessonEmpty.textContent =
        'This Year or Level is part of the agreed portal navigation, but its catalogue has not been loaded into V2 yet.';
      els.lessonEmpty.hidden = false;
      return;
    }

    const filtered = state.lessons.filter(lesson => {
      if (!query) return true;
      return [lesson.lessonId, lesson.title, lesson.description]
        .some(value => String(value || '').toLowerCase().includes(query));
    });

    if (!filtered.length) {
      els.lessonEmpty.textContent = query
        ? 'No lessons match your search.'
        : 'No lessons are currently visible in this Year or Level.';
      els.lessonEmpty.hidden = false;
      return;
    }

    for (const lesson of filtered) {
      const row = document.createElement('div');
      row.className = 'phase6-lesson-row';

      const main = document.createElement('div');
      main.className = 'phase6-lesson-main';

      const code = document.createElement('span');
      code.className = 'phase6-lesson-code';
      code.textContent = lesson.lessonId;

      const title = document.createElement('span');
      title.className = 'phase6-lesson-title';
      title.textContent = lesson.title;

      main.appendChild(code);
      main.appendChild(title);

      const stateLabel = document.createElement('span');
      stateLabel.className = `phase6-lesson-state${lesson.locked ? ' locked' : ''}`;
      stateLabel.textContent = lesson.locked ? '🔒 Locked' : 'Available';

      row.appendChild(main);
      row.appendChild(stateLabel);
      els.lessonList.appendChild(row);
    }
  }

  async function openView(viewSummary) {
    recordActivity();

    els.lessonsEyebrow.textContent = state.subjectLabel || 'Lessons';
    els.lessonsHeading.textContent = viewSummary.label;
    els.lessonSearch.value = '';
    els.lessonList.innerHTML = '';
    els.lessonEmpty.textContent = 'Loading lessons…';
    els.lessonEmpty.hidden = false;
    showPortalScreen('lessons');

    const body = await fetchViewLessons(viewSummary);
    if (!body) {
      els.lessonEmpty.textContent =
        'This lesson list is temporarily unavailable. Please go back and try again.';
      els.lessonEmpty.hidden = false;
      return;
    }

    state.view = body.view || viewSummary;
    state.lessons = Array.isArray(body.lessons) ? body.lessons : [];
    renderLessonList();
  }

  function goSubjects() {
    state.subjectKey = null;
    state.subjectLabel = null;
    state.view = null;
    state.lessons = [];
    showPortalScreen('subjects');
  }

  function goViews() {
    if (!state.subjectKey || !state.subjectLabel) {
      goSubjects();
      return;
    }
    renderViews(state.subjectKey, state.subjectLabel);
    showPortalScreen('views');
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
  els.mathsChoice.addEventListener('click', () => chooseSubject('maths', 'Maths'));
  els.englishChoice.addEventListener('click', () => chooseSubject('english', 'English'));
  els.backToSubjects.addEventListener('click', goSubjects);
  els.backToViews.addEventListener('click', goViews);
  els.lessonSearch.addEventListener('input', renderLessonList);

  readSession();
})();
