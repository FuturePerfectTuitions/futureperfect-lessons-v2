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

  let expanded = false;

  function normalizeResourceButtons() {
    if (!lessonContent) return;
    for (const button of lessonContent.querySelectorAll('button')) {
      const text = String(button.textContent || '').trim();
      if (/^Download\s+Homework$/i.test(text) && text !== 'Download') {
        button.textContent = 'Download';
      } else if (/^Open\s+(?:Answer Pack|Answer Key)$/i.test(text) && text !== 'Open') {
        button.textContent = 'Open';
      }
    }
  }

  function toggleButton() {
    return videoRowHost?.querySelector('.phase12-video-toggle');
  }

  function hasLockedVideoRow() {
    return Boolean(videoRowHost?.querySelector(
      '.phase7-resource-row:not(.phase12-video-toggle-row) .phase7-resource-action[disabled]'
    ));
  }

  function ensureVideoToggle() {
    if (!videoSection || !videoRowHost || videoSection.hidden || hasLockedVideoRow()) return;
    if (videoRowHost.querySelector('.phase12-video-toggle-row')) return;

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
      expanded = !expanded;
      syncVideoUi();
    });

    row.appendChild(copy);
    row.appendChild(button);
    videoRowHost.appendChild(row);
    videoRowHost.hidden = false;
  }

  function syncVideoUi() {
    if (!videoSection || !videoRowHost) return;

    normalizeResourceButtons();

    if (videoSection.hidden) {
      expanded = false;
      return;
    }

    if (hasLockedVideoRow()) {
      const compact = videoRowHost.querySelector('.phase12-video-toggle-row');
      compact?.remove();
      return;
    }

    ensureVideoToggle();
    const button = toggleButton();
    if (!button) return;

    const loaded = Boolean(player && player.src && player.src !== 'about:blank');
    const failed = Boolean(videoError && videoError.textContent.trim());

    if (!expanded) {
      if (videoFrame && !videoFrame.hidden) videoFrame.hidden = true;
      if (videoLoading && !videoLoading.hidden) videoLoading.hidden = true;
      if (videoError && !videoError.hidden) videoError.hidden = true;
      button.disabled = false;
      if (button.textContent !== 'View') button.textContent = 'View';
      return;
    }

    if (failed && !loaded) {
      if (videoLoading && !videoLoading.hidden) videoLoading.hidden = true;
      if (videoError && videoError.hidden) videoError.hidden = false;
      button.disabled = false;
      if (button.textContent !== 'Hide') button.textContent = 'Hide';
      return;
    }

    if (loaded) {
      if (videoFrame && videoFrame.hidden) videoFrame.hidden = false;
      if (videoLoading && !videoLoading.hidden) videoLoading.hidden = true;
      button.disabled = false;
      if (button.textContent !== 'Hide') button.textContent = 'Hide';
      return;
    }

    if (videoLoading && videoLoading.hidden) videoLoading.hidden = false;
    button.disabled = true;
    if (button.textContent !== 'Loading…') button.textContent = 'Loading…';
  }

  if (lessonContent) {
    new MutationObserver(syncVideoUi).observe(lessonContent, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'src']
    });
  }

  document.addEventListener('click', event => {
    if (event.target.closest('#back-to-lessons, #back-to-views, #back-to-subjects, #logout-button')) {
      expanded = false;
    }
  });

  syncVideoUi();
})();
