(() => {
  const PREVIEW_FLAG = 'fpt_v2_cross_subject_preview';

  const viewGrid = document.getElementById('view-grid');
  const lessonList = document.getElementById('lesson-list');
  const mathsChoice = document.getElementById('maths-choice');
  const englishChoice = document.getElementById('english-choice');
  const backToSubjects = document.getElementById('back-to-subjects');
  const logoutButton = document.getElementById('logout-button');

  function setPreviewActive(active) {
    if (active) sessionStorage.setItem(PREVIEW_FLAG, '1');
    else sessionStorage.removeItem(PREVIEW_FLAG);
  }

  function previewActive() {
    return sessionStorage.getItem(PREVIEW_FLAG) === '1';
  }

  function softenPreviewViewCards() {
    if (!viewGrid) return;

    for (const card of viewGrid.querySelectorAll('.phase6-view-card')) {
      const badge = card.querySelector('.phase6-lock-badge');
      const meta = card.querySelector('.phase6-view-card-meta');
      const isPreview = Boolean(badge) || /locked preview|cross-subject locked preview/i.test(meta?.textContent || '');

      if (!isPreview) {
        if (!card.dataset.upsellListener) {
          card.addEventListener('click', () => setPreviewActive(false), true);
          card.dataset.upsellListener = 'normal';
        }
        continue;
      }

      card.dataset.upsellPreview = 'true';
      if (!card.dataset.upsellListener) {
        card.addEventListener('click', () => setPreviewActive(true), true);
        card.dataset.upsellListener = 'preview';
      }

      badge?.remove();

      if (meta) {
        const countMatch = meta.textContent.match(/^(\d+)\s+lesson(s)?/i);
        if (countMatch) {
          const count = Number(countMatch[1]);
          meta.textContent = `${count} lesson${count === 1 ? '' : 's'}`;
        } else if (/cross-subject locked preview/i.test(meta.textContent)) {
          meta.textContent = 'Explore lessons';
        }
      }
    }
  }

  function softenPreviewLessonRows() {
    if (!lessonList || !previewActive()) return;

    for (const state of lessonList.querySelectorAll('.phase6-lesson-state.locked')) {
      state.classList.remove('locked');
      state.classList.add('upsell-preview');
      state.textContent = 'View →';
    }
  }

  function observe(target, callback) {
    if (!target) return;
    const observer = new MutationObserver(callback);
    observer.observe(target, { childList: true, subtree: true });
    callback();
  }

  observe(viewGrid, softenPreviewViewCards);
  observe(lessonList, softenPreviewLessonRows);

  mathsChoice?.addEventListener('click', () => setPreviewActive(false), true);
  englishChoice?.addEventListener('click', () => setPreviewActive(false), true);
  backToSubjects?.addEventListener('click', () => setPreviewActive(false), true);
  logoutButton?.addEventListener('click', () => setPreviewActive(false), true);
})();

(() => {
  'use strict';

  const lessonContent = document.getElementById('lesson-content');

  function enhanceProtectedAnswerRow(button) {
    const row = button?.closest('.phase7-resource-row');
    if (!row) return;

    const name = row.querySelector('.phase7-resource-name');
    if (!name) return;

    let copy = row.querySelector('.phase7-resource-copy');
    if (!copy) {
      copy = document.createElement('div');
      copy.className = 'phase7-resource-copy';
      row.insertBefore(copy, row.firstChild);
      copy.appendChild(name);
    }

    let meta = copy.querySelector('.phase7-resource-meta');
    if (!meta) {
      meta = document.createElement('span');
      meta.className = 'phase7-resource-meta';
      copy.appendChild(meta);
    }
    if (meta.textContent !== 'Password required every time') {
      meta.textContent = 'Password required every time';
    }

    let chip = copy.querySelector('.phase7-protected-chip');
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'phase7-protected-chip';
      copy.appendChild(chip);
    }
    if (chip.textContent !== '🔒 Password protected') {
      chip.textContent = '🔒 Password protected';
    }

    if (!button.disabled && button.textContent !== 'Open') button.textContent = 'Open';
    row.dataset.phase12ProtectedSignage = '1';
  }

  function enhanceProtectedAnswerRows() {
    const root = lessonContent || document;
    root.querySelectorAll('.phase9-protected-button, .phase11-protected-button')
      .forEach(enhanceProtectedAnswerRow);
  }

  if (lessonContent) {
    new MutationObserver(enhanceProtectedAnswerRows).observe(lessonContent, {
      childList: true,
      subtree: true
    });
  }
  enhanceProtectedAnswerRows();
})();

(() => {
  'use strict';

  const lessonContent = document.getElementById('lesson-content');
  const videoSection = document.getElementById('video-section');
  const videoRowHost = document.getElementById('video-locked-row');
  const videoLoading = document.getElementById('video-loading');
  const videoError = document.getElementById('video-error');
  const videoFrame = document.getElementById('video-frame');
  const player = document.getElementById('lesson-player');
  const downstreamFetch = window.fetch.bind(window);

  let pendingMainVideo = null;
  let mainVideoExpanded = false;

  function requestInfo(input, init) {
    try {
      const raw = typeof input === 'string' || input instanceof URL
        ? String(input)
        : input?.url;
      const url = new URL(raw, location.href);
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      return { url, method };
    } catch (_) {
      return null;
    }
  }

  function cancelPendingMainVideo() {
    const pending = pendingMainVideo;
    pendingMainVideo = null;
    if (!pending) return;
    pending.resolve(new Response(JSON.stringify({
      ok: false,
      error: 'VIDEO_DEFERRED_CANCELLED'
    }), {
      status: 409,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    }));
  }

  function releasePendingMainVideo() {
    const pending = pendingMainVideo;
    pendingMainVideo = null;
    if (!pending) return;
    downstreamFetch(pending.input, pending.init).then(pending.resolve, pending.reject);
  }

  window.fetch = (input, init) => {
    const info = requestInfo(input, init);
    if (!info) return downstreamFetch(input, init);

    if (
      info.method === 'GET' &&
      /^\/api\/v1\/student\/lessons\/[^/]+$/.test(info.url.pathname)
    ) {
      cancelPendingMainVideo();
      mainVideoExpanded = false;
      return downstreamFetch(input, init);
    }

    const isVideoRequest =
      info.method === 'GET' &&
      /^\/api\/v1\/student\/resources\/[^/]+\/video$/.test(info.url.pathname);

    if (
      isVideoRequest &&
      videoSection &&
      !videoSection.hidden &&
      !mainVideoExpanded &&
      !pendingMainVideo
    ) {
      return new Promise((resolve, reject) => {
        pendingMainVideo = { input, init, resolve, reject };
        queueMicrotask(syncCompactLessonUi);
      });
    }

    return downstreamFetch(input, init);
  };

  function normalizeResourceButtons() {
    if (!lessonContent) return;
    for (const button of lessonContent.querySelectorAll('button')) {
      const text = String(button.textContent || '').trim();
      if (/^Download\s+Homework$/i.test(text) && button.textContent !== 'Download') {
        button.textContent = 'Download';
      } else if (/^Open\s+(?:Answer Pack|Answer Key)$/i.test(text) && button.textContent !== 'Open') {
        button.textContent = 'Open';
      }
    }
  }

  function videoToggleButton() {
    return videoRowHost?.querySelector('.phase12-video-toggle');
  }

  function createVideoToggleRow() {
    if (!videoRowHost || videoRowHost.querySelector('.phase12-video-toggle-row')) return;

    const row = document.createElement('div');
    row.className = 'phase7-resource-row phase12-video-toggle-row';

    const copy = document.createElement('div');
    copy.className = 'phase7-resource-copy';

    const name = document.createElement('span');
    name.className = 'phase7-resource-name';
    name.textContent = 'Lesson Video';
    copy.appendChild(name);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'phase7-resource-action phase12-video-toggle';
    button.textContent = 'View';

    button.addEventListener('click', () => {
      if (pendingMainVideo) {
        mainVideoExpanded = true;
        button.disabled = true;
        button.textContent = 'Loading…';
        if (videoLoading) videoLoading.hidden = false;
        releasePendingMainVideo();
        return;
      }

      const hasLoadedVideo = player && player.src && player.src !== 'about:blank';
      if (!hasLoadedVideo || !videoFrame) return;

      mainVideoExpanded = videoFrame.hidden;
      videoFrame.hidden = !mainVideoExpanded;
      button.textContent = mainVideoExpanded ? 'Hide' : 'View';
    });

    row.appendChild(copy);
    row.appendChild(button);
    videoRowHost.appendChild(row);
    videoRowHost.hidden = false;
  }

  function syncVideoToggle() {
    if (!videoSection || !videoRowHost) return;

    if (videoSection.hidden) {
      if (pendingMainVideo) cancelPendingMainVideo();
      mainVideoExpanded = false;
      return;
    }

    const existingLocked = videoRowHost.querySelector(
      '.phase7-resource-row:not(.phase12-video-toggle-row) .phase7-resource-action[disabled]'
    );
    if (!pendingMainVideo && !videoToggleButton() && existingLocked) return;

    if (pendingMainVideo) createVideoToggleRow();

    const button = videoToggleButton();
    if (!button) return;

    if (pendingMainVideo && !mainVideoExpanded) {
      if (videoLoading) videoLoading.hidden = true;
      if (videoFrame) videoFrame.hidden = true;
      button.disabled = false;
      button.textContent = 'View';
      return;
    }

    if (videoFrame && !videoFrame.hidden) {
      button.disabled = false;
      button.textContent = 'Hide';
      return;
    }

    if (videoError && !videoError.hidden) {
      mainVideoExpanded = false;
      button.disabled = false;
      button.textContent = 'View';
      return;
    }

    if (mainVideoExpanded) {
      button.disabled = true;
      button.textContent = 'Loading…';
    } else {
      button.disabled = false;
      button.textContent = 'View';
    }
  }

  function syncCompactLessonUi() {
    normalizeResourceButtons();
    syncVideoToggle();
  }

  if (lessonContent) {
    new MutationObserver(syncCompactLessonUi).observe(lessonContent, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden']
    });
  }

  document.addEventListener('click', event => {
    if (event.target.closest('#back-to-lessons, #back-to-views, #back-to-subjects, #logout-button')) {
      if (pendingMainVideo) cancelPendingMainVideo();
      mainVideoExpanded = false;
    }
  });

  syncCompactLessonUi();
})();
