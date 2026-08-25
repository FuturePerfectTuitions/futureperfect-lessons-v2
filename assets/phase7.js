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
    subjectsMessage: document.getElementById('phase7-message'),
    screenSubjects: document.getElementById('screen-subjects'),
    screenViews: document.getElementById('screen-views'),
    screenLessons: document.getElementById('screen-lessons'),
    screenLesson: document.getElementById('screen-lesson'),
    backToSubjects: document.getElementById('back-to-subjects'),
    backToViews: document.getElementById('back-to-views'),
    backToLessons: document.getElementById('back-to-lessons'),
    viewsHeading: document.getElementById('views-heading'),
    viewGrid: document.getElementById('view-grid'),
    lessonsEyebrow: document.getElementById('lessons-eyebrow'),
    lessonsHeading: document.getElementById('lessons-heading'),
    lessonSearch: document.getElementById('lesson-search'),
    lessonList: document.getElementById('lesson-list'),
    lessonEmpty: document.getElementById('lesson-empty'),
    lessonLoading: document.getElementById('lesson-loading'),
    lessonError: document.getElementById('lesson-error'),
    lessonContent: document.getElementById('lesson-content'),
    lessonCode: document.getElementById('lesson-code'),
    lessonTitle: document.getElementById('lesson-title'),
    lessonDescription: document.getElementById('lesson-description'),
    lessonState: document.getElementById('lesson-state'),
    lessonLockedNote: document.getElementById('lesson-locked-note'),
    prelessonSection: document.getElementById('prelesson-section'),
    prelessonList: document.getElementById('prelesson-list'),
    videoSection: document.getElementById('video-section'),
    videoLockedRow: document.getElementById('video-locked-row'),
    videoLoading: document.getElementById('video-loading'),
    videoError: document.getElementById('video-error'),
    videoFrame: document.getElementById('video-frame'),
    player: document.getElementById('lesson-player'),
    homeworkSection: document.getElementById('homework-section'),
    homeworkList: document.getElementById('homework-list'),
    otherSection: document.getElementById('other-section'),
    otherList: document.getElementById('other-list')
  };

  const state = {
    session: null,
    home: null,
    homePromise: null,
    subjectKey: null,
    subjectLabel: null,
    view: null,
    lessons: [],
    lesson: null,
    videoLoadSerial: 0
  };

  function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
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
    els.screenLesson.hidden = name !== 'lesson';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetVideo() {
    state.videoLoadSerial += 1;
    els.player.src = 'about:blank';
    els.videoFrame.hidden = true;
    els.videoLoading.hidden = true;
    els.videoError.hidden = true;
    els.videoError.textContent = '';
    els.videoLockedRow.hidden = true;
    els.videoLockedRow.innerHTML = '';
  }

  function resetLessonPanel() {
    state.lesson = null;
    resetVideo();
    els.lessonContent.hidden = true;
    els.lessonLoading.hidden = true;
    els.lessonError.hidden = true;
    els.lessonError.textContent = '';
    els.prelessonSection.hidden = true;
    els.videoSection.hidden = true;
    els.homeworkSection.hidden = true;
    els.otherSection.hidden = true;
    els.prelessonList.innerHTML = '';
    els.homeworkList.innerHTML = '';
    els.otherList.innerHTML = '';
  }

  function resetNavigation() {
    state.home = null;
    state.homePromise = null;
    state.subjectKey = null;
    state.subjectLabel = null;
    state.view = null;
    state.lessons = [];
    els.viewGrid.innerHTML = '';
    els.lessonList.innerHTML = '';
    els.lessonEmpty.hidden = true;
    els.lessonSearch.value = '';
    resetLessonPanel();
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

  async function consumeHomeResponse(response, sessionAtStart) {
    let body = null;
    try { body = await response.json(); } catch (_) {}

    if (state.session !== sessionAtStart) return null;
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
    if (!state.session?.accountLocked) setSubjectsMessage();
    return body;
  }

  async function loadHome(prefetchedResponsePromise = null) {
    if (!base || !state.session) return null;
    if (state.home) return state.home;
    if (state.homePromise) return state.homePromise;

    const sessionAtStart = state.session;
    const requestPromise = (async () => {
      try {
        const response = prefetchedResponsePromise
          ? await prefetchedResponsePromise
          : await api('/api/v1/student/home', { method: 'GET' });
        return await consumeHomeResponse(response, sessionAtStart);
      } catch (_) {
        if (state.session === sessionAtStart) {
          state.home = null;
          setSubjectsMessage('Curriculum navigation is temporarily unavailable. Please try again.');
        }
        return null;
      }
    })();

    state.homePromise = requestPromise;
    try {
      return await requestPromise;
    } finally {
      if (state.homePromise === requestPromise) state.homePromise = null;
    }
  }

  async function readSession() {
    if (!base) {
      showLogin();
      setLoginError('The student portal is temporarily unavailable. Please try again later.');
      return null;
    }

    // Returning sessions can validate identity and prepare curriculum navigation
    // in parallel. The portal therefore becomes useful after the slower of the
    // two calls rather than paying both round trips sequentially.
    const sessionResponsePromise = api('/api/v1/student/session', { method: 'GET' });
    const homeResponsePromise = api('/api/v1/student/home', { method: 'GET' });

    try {
      const response = await sessionResponsePromise;
      let body = null;
      try { body = await response.json(); } catch (_) {}
      if (!response.ok || !body?.ok) {
        showLogin();
        return null;
      }

      resetNavigation();
      showPortal(body);
      void loadHome(homeResponsePromise);
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

      // A successful login response already contains the same safe session
      // summary used by /session. Start /home immediately and do not add an
      // unnecessary second session round trip before preparing navigation.
      const homeResponsePromise = response.ok
        ? api('/api/v1/student/home', { method: 'GET' })
        : null;

      let body = null;
      try { body = await response.json(); } catch (_) {}

      els.password.value = '';
      resetPasswordVisibility();
      if (!response.ok || !body?.ok) {
        setLoginError('Invalid login');
        return;
      }

      resetNavigation();
      showPortal(body);
      void loadHome(homeResponsePromise);
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
      // Server-side expiry remains authoritative if the explicit request fails.
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
    resetLessonPanel();

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
        meta.textContent = lockedCount > 0
          ? `${openCount} available · ${lockedCount} locked`
          : `${openCount} available lesson${openCount === 1 ? '' : 's'}`;
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
      // Reuse the one in-flight home request rather than starting a duplicate.
      // The click continues automatically as soon as navigation is ready.
      const home = await loadHome();
      if (!home) return;
    }
    renderViews(subjectKey, subjectLabel);
    showPortalScreen('views');
  }

  async function fetchViewLessons(view) {
    try {
      const response = await api(
        `/api/v1/student/views/${encodeURIComponent(view.viewId)}/lessons`,
        { method: 'GET' }
      );
      let body = null;
      try { body = await response.json(); } catch (_) {}
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

  function lessonDisplayId(lesson) {
    return String(lesson?.displayLessonId || lesson?.lessonId || '').trim();
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
      return [lessonDisplayId(lesson), lesson.lessonId, lesson.title, lesson.description]
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
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'phase6-lesson-row';

      const main = document.createElement('span');
      main.className = 'phase6-lesson-main';

      const code = document.createElement('span');
      code.className = 'phase6-lesson-code';
      code.textContent = lessonDisplayId(lesson);

      const title = document.createElement('span');
      title.className = 'phase6-lesson-title';
      title.textContent = String(lesson.title || lessonDisplayId(lesson));

      main.appendChild(code);
      main.appendChild(title);

      const stateLabel = document.createElement('span');
      stateLabel.className = `phase6-lesson-state${lesson.locked ? ' locked' : ''}`;
      stateLabel.textContent = lesson.locked ? '🔒 Locked' : 'Available';

      row.appendChild(main);
      row.appendChild(stateLabel);
      row.addEventListener('click', () => openLesson(lesson));
      els.lessonList.appendChild(row);
    }
  }

  async function openView(viewSummary) {
    recordActivity();
    resetLessonPanel();
    els.lessonsEyebrow.textContent = state.subjectLabel || 'Lessons';
    els.lessonsHeading.textContent = viewSummary.label;
    els.lessonSearch.value = '';
    els.lessonList.innerHTML = '';
    els.lessonEmpty.textContent = 'Loading lessons…';
    els.lessonEmpty.hidden = false;
    showPortalScreen('lessons');

    const body = await fetchViewLessons(viewSummary);
    if (!body) {
      els.lessonEmpty.textContent = 'This lesson list is temporarily unavailable. Please go back and try again.';
      els.lessonEmpty.hidden = false;
      return;
    }

    state.view = body.view || viewSummary;
    state.lessons = Array.isArray(body.lessons) ? body.lessons : [];
    renderLessonList();
  }

  async function fetchLesson(lessonId) {
    if (!state.view?.viewId) return null;
    try {
      const response = await api(
        `/api/v1/student/lessons/${encodeURIComponent(lessonId)}?viewId=${encodeURIComponent(state.view.viewId)}`,
        { method: 'GET' }
      );
      let body = null;
      try { body = await response.json(); } catch (_) {}
      if (response.status === 401) {
        showLogin();
        return null;
      }
      if (!response.ok || !body?.ok || !body.lesson) {
        throw new Error(body?.error || 'LESSON_PAGE_UNAVAILABLE');
      }
      return body.lesson;
    } catch (error) {
      throw error;
    }
  }

  function resourceMeta(resource) {
    if (resource?.locked) {
      return resource?.protected ? 'Protected answer resource' : 'Locked';
    }
    if (resource?.available === false) return 'File currently unavailable';
    if (resource?.protected) return 'Protected answer resource';
    return 'Ready to download';
  }

  function safeDownloadName(displayName) {
    const cleaned = String(displayName || 'resource')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .trim() || 'resource';
    return /\.[a-z0-9]{1,8}$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
  }

  async function downloadResource(resource, button, statusEl) {
    if (!resource?.resourceKey || resource.locked || resource.protected || resource.available === false) return;
    if (!state.view?.viewId) return;

    recordActivity();
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparing…';
    if (statusEl) statusEl.textContent = '';

    try {
      const response = await fetch(
        `${base}/api/v1/student/resources/${encodeURIComponent(resource.resourceKey)}/download?viewId=${encodeURIComponent(state.view.viewId)}`,
        {
          method: 'GET',
          headers: { 'Accept': 'application/pdf,application/octet-stream' },
          credentials: 'include',
          cache: 'no-store'
        }
      );

      if (response.status === 401) {
        showLogin();
        return;
      }
      if (!response.ok) throw new Error('This resource could not be downloaded.');

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = safeDownloadName(resource.displayName);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      if (statusEl) statusEl.textContent = 'Download started.';
    } catch (error) {
      if (statusEl) statusEl.textContent = String(error?.message || 'This resource could not be downloaded.');
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  function makeResourceRow(resource, options = {}) {
    const row = document.createElement('div');
    row.className = 'phase7-resource-row';

    const copy = document.createElement('div');
    copy.className = 'phase7-resource-copy';

    const name = document.createElement('span');
    name.className = 'phase7-resource-name';
    name.textContent = resource?.displayName || options.fallbackName || 'Resource';

    const meta = document.createElement('span');
    meta.className = 'phase7-resource-meta';
    meta.textContent = resourceMeta(resource);

    copy.appendChild(name);
    copy.appendChild(meta);

    if (resource?.protected) {
      const protectedChip = document.createElement('span');
      protectedChip.className = 'phase7-protected-chip';
      protectedChip.textContent = '🔒 Password protected';
      copy.appendChild(protectedChip);
    }

    const status = document.createElement('div');
    status.className = 'phase7-download-status';
    copy.appendChild(status);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'phase7-resource-action';

    if (resource?.protected) {
      button.textContent = 'Protected';
      button.disabled = true;
    } else if (resource?.locked) {
      button.textContent = '🔒 Locked';
      button.disabled = true;
    } else if (resource?.available === false) {
      button.textContent = 'Unavailable';
      button.classList.add('missing');
      button.disabled = true;
    } else {
      button.textContent = options.buttonText || 'Download';
      button.addEventListener('click', () => downloadResource(resource, button, status));
    }

    row.appendChild(copy);
    row.appendChild(button);
    return row;
  }

  function renderPreLesson(lesson) {
    els.prelessonList.innerHTML = '';
    const items = Array.isArray(lesson.preLessonSheets) ? lesson.preLessonSheets : [];
    els.prelessonSection.hidden = items.length === 0;
    items.forEach(item => els.prelessonList.appendChild(makeResourceRow(item)));
  }

  function renderHomework(lesson) {
    els.homeworkList.innerHTML = '';
    const pairs = Array.isArray(lesson.homeworks) ? lesson.homeworks : [];
    els.homeworkSection.hidden = pairs.length === 0;

    pairs.forEach((pair, index) => {
      const card = document.createElement('article');
      card.className = 'phase7-homework-card';

      if (pairs.length > 1) {
        const pairLabel = document.createElement('p');
        pairLabel.className = 'phase7-homework-pair-label';
        pairLabel.textContent = `Homework ${index + 1}`;
        card.appendChild(pairLabel);
      }

      const grid = document.createElement('div');
      grid.className = 'phase7-homework-pair';
      if (pair.homework) grid.appendChild(makeResourceRow(pair.homework, { buttonText: 'Download Homework' }));
      if (pair.answerPack) grid.appendChild(makeResourceRow(pair.answerPack, { fallbackName: 'Answer Pack' }));
      card.appendChild(grid);
      els.homeworkList.appendChild(card);
    });
  }

  function renderOtherResources(lesson) {
    els.otherList.innerHTML = '';
    const items = Array.isArray(lesson.otherResources) ? lesson.otherResources : [];
    els.otherSection.hidden = items.length === 0;
    items.forEach(item => els.otherList.appendChild(makeResourceRow(item)));
  }

  async function loadVideo(video, serial) {
    if (!video?.resourceKey || video.locked || !state.view?.viewId) return;
    els.videoLoading.hidden = false;
    els.videoError.hidden = true;
    els.videoFrame.hidden = true;

    try {
      const response = await api(
        `/api/v1/student/resources/${encodeURIComponent(video.resourceKey)}/video?viewId=${encodeURIComponent(state.view.viewId)}`,
        { method: 'GET' }
      );
      let body = null;
      try { body = await response.json(); } catch (_) {}

      if (serial !== state.videoLoadSerial) return;
      if (response.status === 401) {
        showLogin();
        return;
      }
      if (!response.ok || !body?.ok || !body.embedUrl) {
        throw new Error('The lesson video is temporarily unavailable.');
      }

      els.player.src = body.embedUrl;
      els.videoFrame.hidden = false;
      els.videoLoading.hidden = true;
    } catch (error) {
      if (serial !== state.videoLoadSerial) return;
      els.videoLoading.hidden = true;
      els.videoError.textContent = String(error?.message || 'The lesson video is temporarily unavailable.');
      els.videoError.hidden = false;
    }
  }

  function renderVideo(lesson) {
    resetVideo();
    const video = lesson.video || null;
    els.videoSection.hidden = !video;
    if (!video) return;

    if (video.locked) {
      els.videoLockedRow.hidden = false;
      els.videoLockedRow.appendChild(makeResourceRow(
        { displayName: 'Video', locked: true, protected: false },
        { fallbackName: 'Video' }
      ));
      return;
    }

    const serial = state.videoLoadSerial;
    loadVideo(video, serial);
  }

  function renderLesson(lesson) {
    state.lesson = lesson;
    els.lessonLoading.hidden = true;
    els.lessonError.hidden = true;
    els.lessonContent.hidden = false;

    els.lessonCode.textContent = lesson.displayLessonId || lesson.lessonId || '';
    els.lessonTitle.textContent = lesson.title || '';
    els.lessonDescription.textContent = lesson.description || '';
    els.lessonState.className = `phase7-state${lesson.locked ? ' locked' : ''}`;
    els.lessonState.textContent = lesson.locked ? '🔒 Locked' : 'Available';
    els.lessonLockedNote.hidden = !lesson.locked;

    renderPreLesson(lesson);
    renderVideo(lesson);
    renderHomework(lesson);
    renderOtherResources(lesson);
  }

  async function openLesson(listLesson) {
    recordActivity();
    resetLessonPanel();
    showPortalScreen('lesson');
    els.lessonLoading.hidden = false;

    try {
      const lesson = await fetchLesson(listLesson.lessonId);
      if (!lesson) return;
      renderLesson(lesson);
    } catch (error) {
      els.lessonLoading.hidden = true;
      els.lessonContent.hidden = true;
      els.lessonError.textContent =
        error?.message === 'LESSON_NOT_VISIBLE'
          ? 'This lesson is no longer available in this view.'
          : 'This lesson is temporarily unavailable. Please go back and try again.';
      els.lessonError.hidden = false;
    }
  }

  function goSubjects() {
    resetLessonPanel();
    state.subjectKey = null;
    state.subjectLabel = null;
    state.view = null;
    state.lessons = [];
    showPortalScreen('subjects');
  }

  function goViews() {
    resetLessonPanel();
    if (!state.subjectKey || !state.subjectLabel) {
      goSubjects();
      return;
    }
    renderViews(state.subjectKey, state.subjectLabel);
    showPortalScreen('views');
  }

  function goLessons() {
    resetLessonPanel();
    if (!state.view) {
      goViews();
      return;
    }
    renderLessonList();
    showPortalScreen('lessons');
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
  els.backToLessons.addEventListener('click', goLessons);
  els.lessonSearch.addEventListener('input', renderLessonList);

  window.addEventListener('message', event => {
    if (!state.session || !state.lesson?.video || state.lesson?.locked) return;
    let message = '';
    if (typeof event.data === 'string') message = event.data;
    else {
      try { message = JSON.stringify(event.data); } catch (_) {}
    }
    if (message.includes('videoPlayerPlay')) recordActivity();
  });

  readSession();
})();