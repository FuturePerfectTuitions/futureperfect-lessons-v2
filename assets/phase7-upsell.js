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
