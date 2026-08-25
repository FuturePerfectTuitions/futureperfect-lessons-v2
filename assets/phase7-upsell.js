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

  function protectedButtonText(displayName) {
    return /answer\s*key/i.test(displayName || '') ? 'Open Answer Key' : 'Open Answer Pack';
  }

  function enhanceProtectedAnswerRow(button) {
    const row = button?.closest('.phase7-resource-row');
    if (!row || row.dataset.phase12ProtectedSignage === '1') return;

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
    meta.textContent = 'Password required every time';

    let chip = copy.querySelector('.phase7-protected-chip');
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'phase7-protected-chip';
      copy.appendChild(chip);
    }
    chip.textContent = '🔒 Password protected';

    if (!button.disabled) button.textContent = protectedButtonText(name.textContent);
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