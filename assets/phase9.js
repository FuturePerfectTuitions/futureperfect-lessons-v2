(() => {
  'use strict';

  const config = window.FPT_V2_CONFIG || {};
  const API_BASE = String(
    config.workerBaseUrl || 'https://fpt-portal-v2-worker.futureperfectlessons.workers.dev'
  ).replace(/\/$/, '');
  const phase8Fetch = window.fetch.bind(window);
  const captured = { viewId: '', lessonId: '', lesson: null, renderTimer: null, renderAttempt: 0 };

  const state = {
    quizFrame: null,
    vrPreVideoFrame: null,
    vrHomeworkVideoFrame: null,
    protectedViewer: {
      resource: null,
      viewId: '',
      viewerPath: '',
      heartbeatTimer: null,
      rendering: false
    }
  };

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  function isLessonDetailRequest(input, init) {
    try {
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (method !== 'GET') return null;
      const raw = typeof input === 'string' ? input : input?.url;
      const url = new URL(raw, location.href);
      if (url.origin !== new URL(API_BASE).origin) return null;
      const match = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
      if (!match) return null;
      return {
        lessonId: decodeURIComponent(match[1]),
        viewId: String(url.searchParams.get('viewId') || '').trim()
      };
    } catch {
      return null;
    }
  }

  async function captureLessonResponse(response, info) {
    if (!response?.ok || !info) return;
    try {
      const body = await response.clone().json();
      if (!body?.ok || !body.lesson) return;
      captured.viewId = info.viewId;
      captured.lessonId = info.lessonId;
      captured.lesson = body.lesson;
      captured.renderAttempt = 0;
      schedulePhase9Render();
    } catch (_) {}
  }

  window.fetch = async (input, init) => {
    const info = isLessonDetailRequest(input, init);
    const response = await phase8Fetch(input, init);
    if (info) captureLessonResponse(response, info);
    return response;
  };

  function schedulePhase9Render() {
    clearTimeout(captured.renderTimer);
    captured.renderTimer = setTimeout(() => {
      const lessonContent = document.getElementById('lesson-content');
      if (lessonContent?.hidden && captured.renderAttempt < 12) {
        captured.renderAttempt += 1;
        schedulePhase9Render();
        return;
      }
      renderPhase9Additions();
    }, 25);
  }

  function ensurePhase9Sections() {
    const videoSection = document.getElementById('video-section');
    const homeworkSection = document.getElementById('homework-section');
    const otherSection = document.getElementById('other-section');
    if (!videoSection || !homeworkSection || !otherSection) return null;

    let quizSection = document.getElementById('phase9-quiz-section');
    if (!quizSection) {
      quizSection = document.createElement('section');
      quizSection.id = 'phase9-quiz-section';
      quizSection.className = 'phase7-resource-section phase9-quiz-section';
      quizSection.hidden = true;
      quizSection.innerHTML = `
        <div class="phase7-section-heading">
          <span class="phase7-kicker">11+ knowledge check</span>
          <h2>ScreenPal Quiz</h2>
        </div>
        <div id="phase9-quiz-body"></div>
      `;
      videoSection.insertAdjacentElement('afterend', quizSection);
    }

    let vrSection = document.getElementById('phase9-vr-section');
    if (!vrSection) {
      vrSection = document.createElement('section');
      vrSection.id = 'phase9-vr-section';
      vrSection.className = 'phase7-resource-section phase9-vr-section';
      vrSection.hidden = true;
      vrSection.innerHTML = `
        <div class="phase7-section-heading">
          <span class="phase7-kicker">11+ English extension</span>
          <h2>Verbal Reasoning</h2>
        </div>
        <div id="phase9-vr-body" class="phase9-vr-body"></div>
      `;
      otherSection.insertAdjacentElement('afterend', vrSection);
    }

    return { quizSection, vrSection };
  }

  function resourceRow(resource, onOpen, actionText = 'Open') {
    const row = document.createElement('div');
    row.className = 'phase7-resource-row';

    const name = document.createElement('span');
    name.className = 'phase7-resource-name';
    name.textContent = resource?.displayName || 'Resource';
    row.appendChild(name);

    const action = document.createElement('span');
    action.className = 'phase7-resource-action';

    if (resource?.locked) {
      const chip = document.createElement('span');
      chip.className = 'phase7-locked-chip';
      chip.textContent = '🔒 Locked';
      action.appendChild(chip);
    } else if (resource?.protected) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'phase7-download-button phase9-protected-button';
      button.textContent = resource.available === false ? 'Unavailable' : actionText;
      button.disabled = resource.available === false || !resource.resourceKey;
      if (!button.disabled) button.addEventListener('click', () => openProtectedPrompt(resource));
      action.appendChild(button);
    } else if (resource?.available === false || !resource?.resourceKey) {
      const chip = document.createElement('span');
      chip.className = 'phase7-unavailable-chip';
      chip.textContent = 'Unavailable';
      action.appendChild(chip);
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'phase7-download-button';
      button.textContent = actionText;
      button.addEventListener('click', () => onOpen?.(resource));
      action.appendChild(button);
    }

    row.appendChild(action);
    return row;
  }

  function pairCard(primary, protectedAnswer, primaryLabel, answerLabel) {
    const card = document.createElement('article');
    card.className = 'phase7-homework-card phase9-pair-card';

    if (primary) {
      const label = document.createElement('div');
      label.className = 'phase9-pair-label';
      label.textContent = primaryLabel;
      card.appendChild(label);
      card.appendChild(resourceRow(primary, downloadVrResource, 'Download'));
    }

    if (protectedAnswer) {
      const label = document.createElement('div');
      label.className = 'phase9-pair-label phase9-answer-label';
      label.textContent = answerLabel;
      card.appendChild(label);
      card.appendChild(resourceRow(protectedAnswer, null, 'Open'));
    }

    return card;
  }

  async function downloadVrResource(resource) {
    if (!resource?.resourceKey || !captured.viewId) return;
    const buttonText = resource.displayName || 'Resource';
    try {
      const response = await fetch(
        apiUrl(`/api/v1/student/resources/${encodeURIComponent(resource.resourceKey)}/download?viewId=${encodeURIComponent(captured.viewId)}`),
        { credentials: 'include' }
      );
      if (!response.ok) throw new Error('Download failed.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = buttonText;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      showInlineMessage(error?.message || 'Unable to download this resource.');
    }
  }

  function showInlineMessage(message) {
    const holder = document.getElementById('phase7-message');
    if (!holder) return;
    holder.textContent = message;
    holder.hidden = false;
    setTimeout(() => { holder.hidden = true; }, 5000);
  }

  function playerBlock(title, model, type) {
    const block = document.createElement('div');
    block.className = 'phase9-video-block';

    const heading = document.createElement('h3');
    heading.className = 'phase9-subheading';
    heading.textContent = title;
    block.appendChild(heading);

    if (model.locked) {
      block.appendChild(resourceRow(model, null));
      return block;
    }

    const status = document.createElement('div');
    status.className = 'phase7-inline-note';
    status.hidden = true;
    block.appendChild(status);

    const frameWrap = document.createElement('div');
    frameWrap.className = 'phase7-player-frame phase9-player-frame';
    frameWrap.hidden = true;
    const frame = document.createElement('iframe');
    frame.title = title;
    frame.allow = 'fullscreen';
    frame.allowFullscreen = true;
    frame.scrolling = 'no';
    frameWrap.appendChild(frame);
    block.appendChild(frameWrap);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'phase7-download-button phase9-video-button';
    button.textContent = 'Open Video';
    button.addEventListener('click', async () => {
      status.hidden = false;
      status.textContent = 'Preparing video…';
      try {
        const response = await fetch(
          apiUrl(`/api/v1/student/resources/${encodeURIComponent(model.resourceKey)}/video?viewId=${encodeURIComponent(captured.viewId)}`),
          { credentials: 'include' }
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body?.embedUrl) throw new Error('Unable to open this video.');
        frame.src = body.embedUrl;
        frameWrap.hidden = false;
        status.hidden = true;
        if (type === 'pre') state.vrPreVideoFrame = frame;
        if (type === 'homework') state.vrHomeworkVideoFrame = frame;
      } catch (error) {
        status.textContent = error?.message || 'Unable to open this video.';
      }
    });
    block.insertBefore(button, status);
    return block;
  }

  function renderVr(vr) {
    const section = document.getElementById('phase9-vr-section');
    const body = document.getElementById('phase9-vr-body');
    if (!section || !body) return;

    body.replaceChildren();
    section.hidden = true;
    if (!vr) return;

    let rendered = false;

    if (Array.isArray(vr.preLesson) && vr.preLesson.length) {
      const group = document.createElement('div');
      group.className = 'phase9-vr-group';
      const title = document.createElement('h3');
      title.className = 'phase9-subheading';
      title.textContent = 'VR PreLesson';
      group.appendChild(title);
      const list = document.createElement('div');
      list.className = 'phase7-homework-list';
      vr.preLesson.forEach(pair => {
        if (!pair?.sheet && !pair?.answerKey) return;
        list.appendChild(pairCard(pair.sheet, pair.answerKey, 'Sheet', 'Answer Key'));
      });
      if (list.children.length) {
        group.appendChild(list);
        body.appendChild(group);
        rendered = true;
      }
    }

    if (vr.preLessonVideo) {
      body.appendChild(playerBlock('VR PreLesson Video', vr.preLessonVideo, 'pre'));
      rendered = true;
    }

    if (Array.isArray(vr.homeworks) && vr.homeworks.length) {
      const group = document.createElement('div');
      group.className = 'phase9-vr-group';
      const title = document.createElement('h3');
      title.className = 'phase9-subheading';
      title.textContent = 'VR Homework';
      group.appendChild(title);
      const list = document.createElement('div');
      list.className = 'phase7-homework-list';
      vr.homeworks.forEach(pair => {
        if (!pair?.homework && !pair?.answerPack) return;
        list.appendChild(pairCard(pair.homework, pair.answerPack, 'Homework', 'Answer Pack'));
      });
      if (list.children.length) {
        group.appendChild(list);
        body.appendChild(group);
        rendered = true;
      }
    }

    if (vr.homeworkVideo) {
      body.appendChild(playerBlock('VR Homework Solution Video', vr.homeworkVideo, 'homework'));
      rendered = true;
    }

    section.hidden = !rendered;
  }

  function renderQuiz(quiz) {
    const section = document.getElementById('phase9-quiz-section');
    const body = document.getElementById('phase9-quiz-body');
    if (!section || !body) return;

    body.replaceChildren();
    section.hidden = true;
    if (!quiz) return;

    if (quiz.locked) {
      body.appendChild(resourceRow(quiz, null));
      section.hidden = false;
      return;
    }

    const row = document.createElement('div');
    row.className = 'phase7-resource-row';
    const name = document.createElement('span');
    name.className = 'phase7-resource-name';
    name.textContent = quiz.displayName || 'ScreenPal Quiz';
    row.appendChild(name);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'phase7-download-button';
    button.textContent = 'Open Quiz';
    button.addEventListener('click', () => openQuiz(quiz));
    const action = document.createElement('span');
    action.className = 'phase7-resource-action';
    action.appendChild(button);
    row.appendChild(action);
    body.appendChild(row);

    const message = document.createElement('div');
    message.id = 'phase9-quiz-message';
    message.className = 'phase7-inline-note phase9-quiz-message';
    message.hidden = true;
    body.appendChild(message);

    const frameWrap = document.createElement('div');
    frameWrap.id = 'phase9-quiz-frame';
    frameWrap.className = 'phase7-player-frame phase9-player-frame';
    frameWrap.hidden = true;
    const frame = document.createElement('iframe');
    frame.title = 'ScreenPal Quiz';
    frame.allow = 'fullscreen';
    frame.allowFullscreen = true;
    frameWrap.appendChild(frame);
    body.appendChild(frameWrap);
    state.quizFrame = frame;

    section.hidden = false;
  }

  async function openQuiz(quiz) {
    const message = document.getElementById('phase9-quiz-message');
    const frameWrap = document.getElementById('phase9-quiz-frame');
    if (!quiz?.resourceKey || !captured.viewId) return;

    if (message) {
      message.hidden = false;
      message.textContent = 'Preparing quiz…';
    }
    if (frameWrap) frameWrap.hidden = true;

    try {
      const response = await fetch(
        apiUrl(`/api/v1/student/resources/${encodeURIComponent(quiz.resourceKey)}/quiz?viewId=${encodeURIComponent(captured.viewId)}`),
        { credentials: 'include' }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.url) {
        const text = body?.error === 'QUIZ_SHARE_URL_REQUIRED'
          ? 'This quiz is gated correctly for 11+, but its ScreenPal share/embed URL still needs to be stored before it can open.'
          : 'Unable to open this quiz.';
        throw new Error(text);
      }

      if (body.mode === 'embed') {
        state.quizFrame.src = body.url;
        if (frameWrap) frameWrap.hidden = false;
        if (message) message.hidden = true;
      } else {
        const opened = window.open(body.url, '_blank', 'noopener,noreferrer');
        if (!opened) throw new Error('Your browser blocked the quiz window. Please allow pop-ups for this portal.');
        if (message) message.hidden = true;
      }
    } catch (error) {
      if (message) {
        message.hidden = false;
        message.textContent = error?.message || 'Unable to open this quiz.';
      }
    }
  }

  function renderPhase9Additions() {
    const sections = ensurePhase9Sections();
    if (!sections) return;

    const lessonContent = document.getElementById('lesson-content');
    if (!captured.lesson || lessonContent?.hidden) {
      sections.quizSection.hidden = true;
      sections.vrSection.hidden = true;
      return;
    }

    renderQuiz(captured.lesson.quiz || null);
    renderVr(captured.lesson.vr || null);
  }

  function eyeIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"></circle>
      </svg>`;
  }

  function ensureProtectedModal() {
    let overlay = document.getElementById('phase9-answer-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'phase9-answer-overlay';
    overlay.className = 'phase8-answer-backdrop';
    overlay.hidden = true;
    overlay.innerHTML = `
      <section class="phase8-answer-card" role="dialog" aria-modal="true" aria-labelledby="phase9-answer-title">
        <header class="phase8-answer-header">
          <div>
            <p class="phase8-answer-eyebrow">Protected answer resource</p>
            <h2 id="phase9-answer-title">Answer Pack</h2>
          </div>
          <button id="phase9-answer-close" class="phase8-answer-close" type="button">Close</button>
        </header>

        <div id="phase9-answer-prompt-panel" class="phase8-answer-prompt">
          <p id="phase9-answer-name" class="phase8-answer-note"></p>
          <p class="phase8-answer-note">Enter your current Answer Pack password. You will be asked again every time you open a protected answer resource.</p>
          <form id="phase9-answer-form" class="phase8-answer-form">
            <label for="phase9-answer-password">Answer Pack password</label>
            <div class="phase8-password-row">
              <input id="phase9-answer-password" type="password" maxlength="4" autocomplete="off" autocapitalize="off" spellcheck="false" required>
              <button id="phase9-answer-toggle" class="phase8-answer-eye" type="button" aria-label="Show password" aria-pressed="false">${eyeIcon()}</button>
            </div>
            <button id="phase9-answer-submit" class="phase8-answer-open" type="submit">Open protected answer</button>
            <p id="phase9-answer-error" class="phase8-answer-error" role="alert" hidden></p>
          </form>
        </div>

        <div id="phase9-answer-viewer-panel" class="phase8-answer-viewer" hidden>
          <div id="phase9-viewer-watermark" class="phase8-answer-watermark"></div>
          <div class="phase9-viewer-heading-row">
            <strong id="phase9-viewer-title">Answer Pack</strong>
            <button id="phase9-viewer-close" class="phase8-answer-close" type="button">Close</button>
          </div>
          <div id="phase9-viewer-loading" class="phase8-answer-loading">Preparing protected answers…</div>
          <div id="phase9-viewer-error" class="phase8-answer-invalid" role="alert" hidden></div>
          <div id="phase9-viewer-pages" class="phase8-answer-pages" aria-label="Protected answer pages"></div>
          <p class="phase8-answer-protection-note">Protected viewer · download and print controls are not provided.</p>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);

    document.getElementById('phase9-answer-close').addEventListener('click', closeProtectedViewer);
    document.getElementById('phase9-viewer-close').addEventListener('click', closeProtectedViewer);
    document.getElementById('phase9-answer-toggle').addEventListener('click', toggleProtectedPassword);
    document.getElementById('phase9-answer-form').addEventListener('submit', submitProtectedPassword);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeProtectedViewer();
    });
    return overlay;
  }

  function openProtectedPrompt(resource) {
    ensureProtectedModal();
    stopHeartbeat();
    resetViewerDocument();
    state.protectedViewer.resource = resource;
    state.protectedViewer.viewId = captured.viewId;
    state.protectedViewer.viewerPath = '';

    document.getElementById('phase9-answer-title').textContent = /answer key/i.test(resource.displayName || '') ? 'Answer Key' : 'Answer Pack';
    document.getElementById('phase9-answer-name').textContent = resource.displayName || 'Protected answer';
    const input = document.getElementById('phase9-answer-password');
    input.value = '';
    input.type = 'password';
    document.getElementById('phase9-answer-toggle').setAttribute('aria-pressed', 'false');
    document.getElementById('phase9-answer-error').hidden = true;
    document.getElementById('phase9-answer-prompt-panel').hidden = false;
    document.getElementById('phase9-answer-viewer-panel').hidden = true;
    document.getElementById('phase9-answer-overlay').hidden = false;
    document.body.classList.add('phase8-viewer-open');
    setTimeout(() => input.focus(), 0);
  }

  function closeProtectedViewer() {
    const overlay = document.getElementById('phase9-answer-overlay');
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('phase8-viewer-open');
    stopHeartbeat();
    resetViewerDocument();
    state.protectedViewer.resource = null;
    state.protectedViewer.viewerPath = '';
    const input = document.getElementById('phase9-answer-password');
    if (input) input.value = '';
  }

  function toggleProtectedPassword() {
    const input = document.getElementById('phase9-answer-password');
    const button = document.getElementById('phase9-answer-toggle');
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    button.setAttribute('aria-pressed', String(!showing));
    button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  }

  function protectedErrorMessage(error) {
    switch (error) {
      case 'ANSWER_PASSWORD_INCORRECT': return 'Incorrect Answer Pack password.';
      case 'ANSWER_PASSWORD_REQUIRED': return 'Enter your 4-character Answer Pack password.';
      case 'TOO_MANY_ATTEMPTS': return 'Too many password attempts. Please wait a minute and try again.';
      case 'VR_NOT_ENTITLED': return 'This Verbal Reasoning answer is not available for this account.';
      case 'VR_NOT_AVAILABLE': return 'Verbal Reasoning answers are available only in the 11+ English view.';
      case 'SESSION_INVALID':
      case 'SESSION_EXPIRED': return 'Your portal session has ended. Please log in again.';
      default: return 'Unable to open this protected answer.';
    }
  }

  async function submitProtectedPassword(event) {
    event.preventDefault();
    const viewer = state.protectedViewer;
    const resource = viewer.resource;
    const password = document.getElementById('phase9-answer-password').value;
    const errorEl = document.getElementById('phase9-answer-error');
    const submit = document.getElementById('phase9-answer-submit');
    if (!resource?.resourceKey || !viewer.viewId) return;

    errorEl.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Checking…';

    try {
      const response = await fetch(
        apiUrl(`/api/v1/student/resources/${encodeURIComponent(resource.resourceKey)}/answer/authorize?viewId=${encodeURIComponent(viewer.viewId)}`),
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password })
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.viewerPath) throw new Error(body?.error || 'ANSWER_OPEN_FAILED');

      document.getElementById('phase9-answer-password').value = '';
      viewer.viewerPath = body.viewerPath;
      document.getElementById('phase9-answer-prompt-panel').hidden = true;
      document.getElementById('phase9-answer-viewer-panel').hidden = false;
      document.getElementById('phase9-viewer-title').textContent = resource.displayName || 'Protected answer';
      document.getElementById('phase9-viewer-watermark').textContent = body.watermark || 'Future Perfect Tuitions';
      await loadProtectedPdf(body.viewerPath);
      startHeartbeat(body.viewerPath);
    } catch (error) {
      errorEl.textContent = protectedErrorMessage(error?.message);
      errorEl.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Open protected answer';
    }
  }

  async function loadProtectedPdf(viewerPath) {
    const pagesEl = document.getElementById('phase9-viewer-pages');
    const loadingEl = document.getElementById('phase9-viewer-loading');
    const errorEl = document.getElementById('phase9-viewer-error');
    pagesEl.replaceChildren();
    loadingEl.hidden = false;
    errorEl.hidden = true;

    try {
      const response = await fetch(apiUrl(viewerPath), { credentials: 'include' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'ANSWER_VIEW_FAILED');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!window.pdfjsLib) throw new Error('PDF_VIEWER_UNAVAILABLE');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
      state.protectedViewer.rendering = true;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(280, pagesEl.clientWidth - 24);
        const cssScale = Math.min(1.65, availableWidth / baseViewport.width);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const renderViewport = page.getViewport({ scale: cssScale * pixelRatio });

        const wrapper = document.createElement('div');
        wrapper.className = 'phase8-answer-page';
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        canvas.style.width = `${Math.floor(baseViewport.width * cssScale)}px`;
        canvas.style.height = `${Math.floor(baseViewport.height * cssScale)}px`;
        canvas.setAttribute('aria-label', `Protected answer page ${pageNumber}`);
        wrapper.appendChild(canvas);
        pagesEl.appendChild(wrapper);

        const context = canvas.getContext('2d', { alpha: false });
        await page.render({ canvasContext: context, viewport: renderViewport }).promise;
      }
      loadingEl.hidden = true;
    } catch (error) {
      loadingEl.hidden = true;
      errorEl.textContent = protectedErrorMessage(error?.message);
      errorEl.hidden = false;
    } finally {
      state.protectedViewer.rendering = false;
    }
  }

  function resetViewerDocument() {
    const pagesEl = document.getElementById('phase9-viewer-pages');
    if (pagesEl) pagesEl.replaceChildren();
    const errorEl = document.getElementById('phase9-viewer-error');
    if (errorEl) errorEl.hidden = true;
  }

  function startHeartbeat(viewerPath) {
    stopHeartbeat();
    const check = async () => {
      try {
        const separator = viewerPath.includes('?') ? '&' : '?';
        const response = await fetch(apiUrl(`${viewerPath}${separator}status=1`), {
          credentials: 'include',
          cache: 'no-store'
        });
        if (!response.ok) throw new Error('LEASE_INVALID');
      } catch {
        stopHeartbeat();
        const errorEl = document.getElementById('phase9-viewer-error');
        if (errorEl) {
          errorEl.textContent = 'Protected access has ended. Close this viewer and enter your current Answer Pack password again.';
          errorEl.hidden = false;
        }
      }
    };
    state.protectedViewer.heartbeatTimer = setInterval(check, 30000);
  }

  function stopHeartbeat() {
    if (state.protectedViewer.heartbeatTimer) {
      clearInterval(state.protectedViewer.heartbeatTimer);
      state.protectedViewer.heartbeatTimer = null;
    }
  }

  function clearMediaOnNavigation() {
    if (state.quizFrame) state.quizFrame.src = 'about:blank';
    if (state.vrPreVideoFrame) state.vrPreVideoFrame.src = 'about:blank';
    if (state.vrHomeworkVideoFrame) state.vrHomeworkVideoFrame.src = 'about:blank';
    state.quizFrame = null;
    state.vrPreVideoFrame = null;
    state.vrHomeworkVideoFrame = null;
  }

  document.addEventListener('click', event => {
    if (event.target.closest('#back-to-lessons, #back-to-views, #back-to-subjects, #logout-button')) {
      clearMediaOnNavigation();
      closeProtectedViewer();
      captured.lesson = null;
      const sections = ensurePhase9Sections();
      if (sections) {
        sections.quizSection.hidden = true;
        sections.vrSection.hidden = true;
      }
    }
  });

  document.addEventListener('keydown', event => {
    const overlay = document.getElementById('phase9-answer-overlay');
    if (event.key === 'Escape' && overlay && !overlay.hidden) closeProtectedViewer();
    if (!overlay || overlay.hidden) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && ['p', 's'].includes(key)) {
      event.preventDefault();
    }
  });

  document.addEventListener('contextmenu', event => {
    const overlay = document.getElementById('phase9-answer-overlay');
    if (overlay && !overlay.hidden && overlay.contains(event.target)) event.preventDefault();
  });

  ensurePhase9Sections();
})();
