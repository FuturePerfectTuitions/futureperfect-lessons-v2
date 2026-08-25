(() => {
  'use strict';

  const config = window.FPT_V2_CONFIG || {};
  const base = String(config.workerBaseUrl || '').replace(/\/$/, '');
  if (!base) return;

  const upstreamFetch = window.fetch.bind(window);
  const ELIGIBLE_VIEW_IDS = new Set(['english-year4-11plus', 'english-year5-11plus']);
  let eligibleViewId = '';
  let eligibleViewLabel = '';
  let cardTimer = null;

  function requestUrl(input) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      return new URL(raw, window.location.href);
    } catch (_) {
      return null;
    }
  }

  function requestMethod(input, init) {
    return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  }

  function isHomeRequest(input, init) {
    if (requestMethod(input, init) !== 'GET') return false;
    const url = requestUrl(input);
    if (!url) return false;
    try {
      return url.origin === new URL(base).origin && url.pathname === '/api/v1/student/home';
    } catch (_) {
      return false;
    }
  }

  function rememberEligibility(body) {
    eligibleViewId = '';
    eligibleViewLabel = '';

    const english = (Array.isArray(body?.subjects) ? body.subjects : [])
      .find(subject => String(subject?.subject || '').toLowerCase() === 'english');
    const views = Array.isArray(english?.views) ? english.views : [];
    const eligible = views
      .filter(view => {
        const viewId = String(view?.viewId || '').trim().toLowerCase();
        return ELIGIBLE_VIEW_IDS.has(viewId) && view?.lockedPreview !== true;
      })
      .sort((left, right) => {
        const leftCurrent = left?.group === 'current' || left?.current === true ? 1 : 0;
        const rightCurrent = right?.group === 'current' || right?.current === true ? 1 : 0;
        if (leftCurrent !== rightCurrent) return rightCurrent - leftCurrent;
        return String(right?.viewId || '').localeCompare(String(left?.viewId || ''));
      });

    if (eligible.length) {
      eligibleViewId = String(eligible[0].viewId || '').trim();
      eligibleViewLabel = String(eligible[0].label || '').trim();
    }
    scheduleCard();
  }

  window.fetch = async (input, init) => {
    const response = await upstreamFetch(input, init);
    if (!isHomeRequest(input, init) || !response?.ok) return response;
    try {
      const body = await response.clone().json();
      if (body?.ok) rememberEligibility(body);
    } catch (_) {}
    return response;
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

  function removeCard() {
    document.getElementById('phase11-vr-howto-card')?.remove();
  }

  function makeCard() {
    const card = document.createElement('button');
    card.id = 'phase11-vr-howto-card';
    card.type = 'button';
    card.className = 'phase6-view-card';
    card.setAttribute('aria-label', 'VR How To');

    const text = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'phase6-view-card-title';
    title.textContent = 'VR How To';
    const meta = document.createElement('span');
    meta.className = 'phase6-view-card-meta';
    meta.textContent = 'Verbal Reasoning guides';
    text.append(title, meta);

    const arrow = document.createElement('span');
    arrow.className = 'phase6-view-card-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';

    card.append(text, arrow);
    card.addEventListener('click', openVrHowTo);
    return card;
  }

  function applyCard() {
    const grid = document.getElementById('view-grid');
    const heading = document.getElementById('views-heading');
    if (!grid || !heading) return;

    if (String(heading.textContent || '').trim() !== 'English' || !eligibleViewId) {
      removeCard();
      return;
    }

    const cards = [...grid.querySelectorAll('.phase6-view-card')]
      .filter(card => card.id !== 'phase11-vr-howto-card');
    const target = cards.find(card => {
      const title = String(card.querySelector('.phase6-view-card-title')?.textContent || '').trim();
      return eligibleViewLabel ? title === eligibleViewLabel : /Year [45] 11\+/.test(title);
    });
    if (!target) return;

    let card = document.getElementById('phase11-vr-howto-card');
    if (!card) card = makeCard();
    if (card.parentElement !== target.parentElement || card.previousElementSibling !== target) {
      target.after(card);
    }
  }

  function scheduleCard() {
    clearTimeout(cardTimer);
    cardTimer = setTimeout(applyCard, 20);
  }

  function hidePortalScreens() {
    for (const id of ['screen-subjects', 'screen-views', 'screen-lessons', 'screen-lesson', 'screen-special']) {
      const screen = document.getElementById(id);
      if (screen) screen.hidden = true;
    }
  }

  function closeVideo() {
    const wrap = document.getElementById('phase11-vr-howto-video-wrap');
    const player = document.getElementById('phase11-vr-howto-player');
    if (player) player.src = 'about:blank';
    if (wrap) wrap.hidden = true;
  }

  function showViews() {
    closeVideo();
    const screen = document.getElementById('screen-vr-howto');
    if (screen) screen.hidden = true;
    const views = document.getElementById('screen-views');
    if (views) views.hidden = false;
    scheduleCard();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function ensureScreen() {
    let screen = document.getElementById('screen-vr-howto');
    if (screen) return screen;

    const anchor = document.getElementById('screen-lesson');
    if (!anchor?.parentNode) return null;

    screen = document.createElement('section');
    screen.id = 'screen-vr-howto';
    screen.className = 'phase5-subject-card phase6-screen phase10-special-screen';
    screen.hidden = true;

    const back = document.createElement('button');
    back.className = 'phase6-back-button';
    back.type = 'button';
    back.textContent = '← English';
    back.addEventListener('click', showViews);

    const eyebrow = document.createElement('p');
    eyebrow.className = 'phase5-eyebrow';
    eyebrow.textContent = 'Verbal Reasoning';

    const title = document.createElement('h1');
    title.textContent = 'VR How To';

    const description = document.createElement('p');
    description.id = 'phase11-vr-howto-description';
    description.className = 'phase5-subject-intro';
    description.textContent = 'Short guides for Verbal Reasoning techniques.';

    const loading = document.createElement('div');
    loading.id = 'phase11-vr-howto-loading';
    loading.className = 'phase6-empty-state';
    loading.textContent = 'Loading VR How To…';
    loading.hidden = true;

    const error = document.createElement('div');
    error.id = 'phase11-vr-howto-error';
    error.className = 'phase6-empty-state phase7-error';
    error.hidden = true;

    const content = document.createElement('div');
    content.id = 'phase11-vr-howto-content';

    const videoWrap = document.createElement('div');
    videoWrap.id = 'phase11-vr-howto-video-wrap';
    videoWrap.className = 'phase10-video-wrap';
    videoWrap.hidden = true;

    const videoHead = document.createElement('div');
    videoHead.className = 'phase10-video-head';
    const videoTitle = document.createElement('strong');
    videoTitle.id = 'phase11-vr-howto-video-title';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'phase7-resource-action';
    close.textContent = 'Close';
    close.addEventListener('click', closeVideo);
    videoHead.append(videoTitle, close);

    const frame = document.createElement('div');
    frame.className = 'phase10-video-frame';
    const player = document.createElement('iframe');
    player.id = 'phase11-vr-howto-player';
    player.src = 'about:blank';
    player.title = 'VR How To video';
    player.allow = 'autoplay; fullscreen; picture-in-picture';
    player.allowFullscreen = true;
    player.referrerPolicy = 'no-referrer';
    frame.appendChild(player);
    videoWrap.append(videoHead, frame);

    screen.append(back, eyebrow, title, description, loading, error, content, videoWrap);
    anchor.parentNode.insertBefore(screen, anchor.nextSibling);
    return screen;
  }

  function setState({ loading = false, error = '' } = {}) {
    const loadingEl = document.getElementById('phase11-vr-howto-loading');
    const errorEl = document.getElementById('phase11-vr-howto-error');
    if (loadingEl) loadingEl.hidden = !loading;
    if (errorEl) {
      errorEl.textContent = error;
      errorEl.hidden = !error;
    }
  }

  function openEmbed(title, embedUrl) {
    const url = String(embedUrl || '');
    if (!/^https:\/\/go\.screenpal\.com\//i.test(url)) return;
    const wrap = document.getElementById('phase11-vr-howto-video-wrap');
    const player = document.getElementById('phase11-vr-howto-player');
    const heading = document.getElementById('phase11-vr-howto-video-title');
    if (!wrap || !player || !heading) return;
    heading.textContent = String(title || 'VR How To');
    player.src = url;
    wrap.hidden = false;
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderItems(area) {
    const content = document.getElementById('phase11-vr-howto-content');
    const description = document.getElementById('phase11-vr-howto-description');
    if (!content) return;
    content.textContent = '';

    if (description) {
      const text = String(area?.description || '').trim();
      if (text) description.textContent = text;
    }

    const items = Array.isArray(area?.items) ? area.items : [];
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'phase10-empty';
      empty.textContent = 'No VR How To guides are available yet.';
      content.appendChild(empty);
      return;
    }

    for (const item of items) {
      if (item?.separator) {
        const separator = document.createElement('h3');
        separator.className = 'phase10-separator';
        separator.textContent = String(item.title || '');
        content.appendChild(separator);
        continue;
      }

      const row = document.createElement('div');
      row.className = 'phase10-resource-row';
      const copy = document.createElement('div');
      copy.className = 'phase10-resource-copy';
      const title = document.createElement('strong');
      title.textContent = String(item?.title || 'VR How To');
      copy.appendChild(title);
      if (item?.description) {
        const detail = document.createElement('span');
        detail.textContent = String(item.description);
        copy.appendChild(detail);
      }

      const watch = document.createElement('button');
      watch.type = 'button';
      watch.className = 'phase7-resource-action';
      watch.textContent = 'Watch';
      watch.addEventListener('click', async () => {
        if (!item?.resourceKey || !eligibleViewId) return;
        const old = watch.textContent;
        watch.disabled = true;
        watch.textContent = 'Loading…';
        try {
          const response = await api(
            `/api/v1/student/special-resources/${encodeURIComponent(item.resourceKey)}/video?viewId=${encodeURIComponent(eligibleViewId)}`
          );
          const body = await response.json().catch(() => null);
          if (!response.ok || !body?.ok || !body.embedUrl) throw new Error();
          openEmbed(item.title, body.embedUrl);
          watch.textContent = old;
        } catch (_) {
          watch.textContent = 'Unavailable';
          setTimeout(() => { watch.textContent = old; }, 1800);
        } finally {
          watch.disabled = false;
        }
      });

      row.append(copy, watch);
      content.appendChild(row);
    }
  }

  async function openVrHowTo() {
    if (!eligibleViewId) return;
    const screen = ensureScreen();
    if (!screen) return;

    closeVideo();
    hidePortalScreens();
    screen.hidden = false;
    const content = document.getElementById('phase11-vr-howto-content');
    if (content) content.textContent = '';
    setState({ loading: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const response = await api(
        `/api/v1/student/special-areas/VR_HOWTO?viewId=${encodeURIComponent(eligibleViewId)}`
      );
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok || !body.area) {
        throw new Error('VR How To is temporarily unavailable.');
      }
      setState();
      renderItems(body.area);
    } catch (error) {
      setState({ error: error?.message || 'VR How To is temporarily unavailable.' });
    }
  }

  function start() {
    ensureScreen();
    const grid = document.getElementById('view-grid');
    if (grid) {
      const observer = new MutationObserver(scheduleCard);
      observer.observe(grid, { childList: true, subtree: true });
    }
    const heading = document.getElementById('views-heading');
    if (heading) {
      const observer = new MutationObserver(scheduleCard);
      observer.observe(heading, { childList: true, characterData: true, subtree: true });
    }
    scheduleCard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
