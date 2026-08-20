(() => {
  const config = window.FPT_V2_CONFIG || {};
  const base = String(config.workerBaseUrl || '').replace(/\/$/, '');

  const els = {
    studentChip: document.getElementById('student-chip'),
    status: document.getElementById('phase3-status'),
    error: document.getElementById('phase3-error'),
    breadcrumbs: document.getElementById('breadcrumbs'),
    subjectGrid: document.getElementById('subject-grid'),
    viewGrid: document.getElementById('view-grid'),
    lessonList: document.getElementById('lesson-list'),
    viewsHeading: document.getElementById('views-heading'),
    lessonsHeading: document.getElementById('lessons-heading'),
    lessonCode: document.getElementById('lesson-code'),
    lessonTitle: document.getElementById('lesson-title'),
    lessonDescription: document.getElementById('lesson-description'),
    prelessonSection: document.getElementById('prelesson-section'),
    prelessonList: document.getElementById('prelesson-list'),
    videoSection: document.getElementById('video-section'),
    player: document.getElementById('lesson-player'),
    homeworkSection: document.getElementById('homework-section'),
    homeworkList: document.getElementById('homework-list'),
    modal: document.getElementById('answer-modal'),
    modalTitle: document.getElementById('answer-modal-title'),
    closeModal: document.getElementById('close-answer-modal'),
    promptPanel: document.getElementById('answer-prompt-panel'),
    answerForm: document.getElementById('answer-form'),
    answerPassword: document.getElementById('answer-password'),
    toggleAnswerPassword: document.getElementById('toggle-answer-password'),
    answerButton: document.getElementById('open-answer-button'),
    answerError: document.getElementById('answer-error'),
    viewerPanel: document.getElementById('answer-viewer-panel'),
    answerViewer: document.getElementById('answer-viewer')
  };

  const screens = {
    subjects: document.getElementById('screen-subjects'),
    views: document.getElementById('screen-views'),
    lessons: document.getElementById('screen-lessons'),
    lesson: document.getElementById('screen-lesson')
  };

  const state = {
    data: null,
    subject: null,
    view: null,
    lesson: null,
    answerResource: null,
    answerBlobUrl: null
  };

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.hidden = key !== name;
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function clearError() {
    els.error.textContent = '';
    els.error.hidden = true;
  }

  function setStatus(ok, message) {
    els.status.className = `phase-status ${ok ? 'status-ok-box' : 'status-error-box'}`;
    els.status.textContent = message;
  }

  function screenpalUrl(spId) {
    const id = encodeURIComponent(spId);
    return `https://go.screenpal.com/player/${id}?ff=1&ahc=1&dcc=1&bg=transparent`;
  }

  function setBreadcrumbs(items) {
    els.breadcrumbs.innerHTML = '';
    els.breadcrumbs.hidden = false;

    items.forEach((item, index) => {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'breadcrumb-sep';
        sep.textContent = '›';
        els.breadcrumbs.appendChild(sep);
      }

      if (item.action) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'breadcrumb-button';
        btn.textContent = item.label;
        btn.addEventListener('click', item.action);
        els.breadcrumbs.appendChild(btn);
      } else {
        const span = document.createElement('span');
        span.className = 'breadcrumb-current';
        span.textContent = item.label;
        els.breadcrumbs.appendChild(span);
      }
    });
  }

  function goSubjects() {
    state.subject = null;
    state.view = null;
    state.lesson = null;
    els.player.src = 'about:blank';
    setBreadcrumbs([{ label: 'Subjects' }]);
    showScreen('subjects');
  }

  function goViews(subject) {
    state.subject = subject;
    state.view = null;
    state.lesson = null;
    els.viewsHeading.textContent = subject.label;
    renderViews(subject);
    setBreadcrumbs([
      { label: 'Subjects', action: goSubjects },
      { label: subject.label }
    ]);
    showScreen('views');
  }

  function goLessons(view) {
    state.view = view;
    state.lesson = null;
    els.lessonsHeading.textContent = `${state.subject.label} — ${view.label}`;
    renderLessons(view);
    setBreadcrumbs([
      { label: 'Subjects', action: goSubjects },
      { label: state.subject.label, action: () => goViews(state.subject) },
      { label: view.label }
    ]);
    showScreen('lessons');
  }

  function goLesson(lesson) {
    state.lesson = lesson;
    renderLesson(lesson);
    setBreadcrumbs([
      { label: 'Subjects', action: goSubjects },
      { label: state.subject.label, action: () => goViews(state.subject) },
      { label: state.view.label, action: () => goLessons(state.view) },
      { label: lesson.lessonId }
    ]);
    showScreen('lesson');
  }

  function makeChoiceCard(title, subtitle, buttonText, handler, disabled = false) {
    const card = document.createElement('article');
    card.className = `choice-card${disabled ? ' choice-card-disabled' : ''}`;

    const text = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = title;
    const sub = document.createElement('p');
    sub.textContent = subtitle;
    text.appendChild(heading);
    text.appendChild(sub);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = buttonText;
    btn.disabled = disabled;
    if (!disabled) btn.addEventListener('click', handler);

    card.appendChild(text);
    card.appendChild(btn);
    return card;
  }

  function renderSubjects() {
    els.subjectGrid.innerHTML = '';
    for (const subject of state.data.subjects || []) {
      const unavailable = Boolean(subject.developmentUnavailable);
      els.subjectGrid.appendChild(
        makeChoiceCard(
          subject.label,
          unavailable
            ? 'Not included in the Phase 3 proof yet.'
            : `${subject.views.length} current curriculum view${subject.views.length === 1 ? '' : 's'}`,
          unavailable ? 'Coming later' : `Open ${subject.label}`,
          () => goViews(subject),
          unavailable
        )
      );
    }
  }

  function renderViews(subject) {
    els.viewGrid.innerHTML = '';
    for (const view of subject.views || []) {
      els.viewGrid.appendChild(
        makeChoiceCard(
          view.label,
          `${view.lessons.length} released lesson${view.lessons.length === 1 ? '' : 's'}`,
          'Open',
          () => goLessons(view)
        )
      );
    }
  }

  function renderLessons(view) {
    els.lessonList.innerHTML = '';

    if (!view.lessons.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No lessons have been released to this development student yet.';
      els.lessonList.appendChild(empty);
      return;
    }

    for (const lesson of view.lessons) {
      const card = document.createElement('article');
      card.className = 'lesson-card';

      const text = document.createElement('div');
      const code = document.createElement('span');
      code.className = 'lesson-code-chip';
      code.textContent = lesson.lessonId;
      const title = document.createElement('h3');
      title.textContent = lesson.title;
      const desc = document.createElement('p');
      desc.textContent = lesson.description || '';
      text.appendChild(code);
      text.appendChild(title);
      text.appendChild(desc);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Open lesson';
      btn.addEventListener('click', () => goLesson(lesson));

      card.appendChild(text);
      card.appendChild(btn);
      els.lessonList.appendChild(card);
    }
  }

  function makeResourceRow(label, note, buttonText, disabled, handler, protectedResource = false) {
    const row = document.createElement('div');
    row.className = 'resource-row';

    const text = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = label;
    const meta = document.createElement('span');
    meta.textContent = note;
    text.appendChild(title);
    text.appendChild(meta);

    const actionWrap = document.createElement('div');
    actionWrap.className = 'resource-actions';
    if (protectedResource) {
      const lock = document.createElement('span');
      lock.className = 'lock-chip';
      lock.textContent = '🔒 Password';
      actionWrap.appendChild(lock);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = buttonText;
    btn.disabled = disabled;
    if (!disabled) btn.addEventListener('click', handler);
    actionWrap.appendChild(btn);

    row.appendChild(text);
    row.appendChild(actionWrap);
    return row;
  }

  function resourceUrl(resourceId) {
    return `${base}/api/dev/phase3/resource?resourceId=${encodeURIComponent(resourceId)}`;
  }

  function openUnprotectedResource(resource) {
    window.open(resourceUrl(resource.resourceId), '_blank', 'noopener');
  }

  function renderLesson(lesson) {
    els.lessonCode.textContent = lesson.lessonId;
    els.lessonTitle.textContent = lesson.title;
    els.lessonDescription.textContent = lesson.description || '';

    els.prelessonList.innerHTML = '';
    els.homeworkList.innerHTML = '';

    const preSheets = lesson.preLessonSheets || [];
    els.prelessonSection.hidden = preSheets.length === 0;
    preSheets.forEach(resource => {
      els.prelessonList.appendChild(
        makeResourceRow(
          resource.displayName,
          resource.available ? 'Ready' : 'File missing from R2',
          'Open',
          !resource.available,
          () => openUnprotectedResource(resource)
        )
      );
    });

    els.videoSection.hidden = !lesson.video;
    els.player.src = lesson.video?.screenpal ? screenpalUrl(lesson.video.screenpal) : 'about:blank';

    const homeworkPairs = lesson.homeworks || [];
    els.homeworkSection.hidden = homeworkPairs.length === 0;

    homeworkPairs.forEach(pair => {
      if (pair.homework) {
        els.homeworkList.appendChild(
          makeResourceRow(
            pair.homework.displayName,
            pair.homework.available ? 'Ready' : 'File missing from R2',
            'Open Homework',
            !pair.homework.available,
            () => openUnprotectedResource(pair.homework)
          )
        );
      }

      if (pair.answerPack) {
        els.homeworkList.appendChild(
          makeResourceRow(
            pair.answerPack.displayName,
            pair.answerPack.available ? 'Protected answer resource' : 'File missing from R2',
            'Open Answer Pack',
            !pair.answerPack.available,
            () => openAnswerPrompt(pair.answerPack),
            true
          )
        );
      }
    });
  }

  function revokeAnswerBlob() {
    if (state.answerBlobUrl) {
      URL.revokeObjectURL(state.answerBlobUrl);
      state.answerBlobUrl = null;
    }
    els.answerViewer.src = 'about:blank';
  }

  function openAnswerPrompt(resource) {
    revokeAnswerBlob();
    state.answerResource = resource;
    els.modalTitle.textContent = resource.displayName || 'Answer Pack';
    els.answerPassword.value = '';
    els.answerPassword.type = 'password';
    els.answerError.hidden = true;
    els.answerError.textContent = '';
    els.promptPanel.hidden = false;
    els.viewerPanel.hidden = true;
    els.modal.hidden = false;
    setTimeout(() => els.answerPassword.focus(), 0);
  }

  function closeAnswerModal() {
    revokeAnswerBlob();
    state.answerResource = null;
    els.modal.hidden = true;
    els.answerPassword.value = '';
    els.answerError.hidden = true;
    els.promptPanel.hidden = false;
    els.viewerPanel.hidden = true;
  }

  async function submitAnswerPassword(event) {
    event.preventDefault();
    if (!state.answerResource) return;

    els.answerButton.disabled = true;
    els.answerError.hidden = true;

    try {
      const response = await fetch(`${base}/api/dev/phase3/answer`, {
        method: 'POST',
        headers: {
          'Accept': 'application/pdf,application/json',
          'Content-Type': 'application/json'
        },
        cache: 'no-store',
        body: JSON.stringify({
          resourceId: state.answerResource.resourceId,
          password: els.answerPassword.value
        })
      });

      if (!response.ok) {
        let message = `Could not open Answer Pack (${response.status}).`;
        try {
          const body = await response.json();
          if (body.error === 'ANSWER_PASSWORD_INCORRECT') {
            message = 'Incorrect Answer Pack password.';
          }
        } catch (_) {}
        els.answerError.textContent = message;
        els.answerError.hidden = false;
        els.answerPassword.select();
        return;
      }

      const blob = await response.blob();
      revokeAnswerBlob();
      state.answerBlobUrl = URL.createObjectURL(blob);
      els.answerViewer.src = `${state.answerBlobUrl}#toolbar=0&navpanes=0`;
      els.promptPanel.hidden = true;
      els.viewerPanel.hidden = false;
    } catch (error) {
      els.answerError.textContent = 'Could not reach the protected resource service.';
      els.answerError.hidden = false;
    } finally {
      els.answerButton.disabled = false;
    }
  }

  async function load() {
    clearError();

    if (!base) {
      showError('The V2 Worker URL is not configured.');
      setStatus(false, 'Phase 3 cannot start until config.js contains the Worker URL.');
      return;
    }

    try {
      const response = await fetch(`${base}/api/dev/phase3`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      state.data = data;
      els.studentChip.textContent = `${data.student.firstName} · ${data.student.portalUserId}`;

      if (data.phase3Healthy) {
        setStatus(true, 'Phase 3 data, entitlement and all three private R2 files are available.');
      } else {
        setStatus(false, 'Phase 3 loaded, but one or more required records/resources are missing.');
      }

      renderSubjects();
      goSubjects();
    } catch (error) {
      els.studentChip.textContent = 'Development student unavailable';
      setStatus(false, 'Phase 3 Worker route could not be loaded.');
      showError(String(error?.message || error));
    }
  }

  els.closeModal.addEventListener('click', closeAnswerModal);
  els.answerForm.addEventListener('submit', submitAnswerPassword);
  els.toggleAnswerPassword.addEventListener('click', () => {
    els.answerPassword.type = els.answerPassword.type === 'password' ? 'text' : 'password';
  });
  els.modal.addEventListener('click', event => {
    if (event.target === els.modal) closeAnswerModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !els.modal.hidden) closeAnswerModal();
  });

  load();
})();
