(() => {
  const base = String(window.FPT_V2_CONFIG?.workerBaseUrl || '').replace(/\/$/, '');
  if (!base) return;

  const MOCK_STORE = 'fpt_v2_mock_unlocks_phase10';
  let currentViewId = '';

  function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    return fetch(`${base}${path}`, { ...options, headers, credentials: 'include', cache: 'no-store' });
  }

  function specialSection() {
    const lessons = document.getElementById('screen-lessons');
    if (!lessons) return null;
    let section = document.getElementById('phase10-special-section');
    if (section) return section;
    section = document.createElement('section');
    section.id = 'phase10-special-section';
    section.className = 'phase10-special-section';
    section.hidden = true;
    const eyebrow = document.createElement('p');
    eyebrow.className = 'phase10-eyebrow';
    eyebrow.textContent = 'Special resources';
    const heading = document.createElement('h3');
    heading.textContent = '11+ resources';
    const intro = document.createElement('p');
    intro.className = 'phase10-special-intro';
    intro.textContent = 'Your manually assigned assessment, mock and VR How-To resources appear here.';
    const list = document.createElement('div');
    list.id = 'phase10-special-list';
    list.className = 'phase10-special-list';
    section.append(eyebrow, heading, intro, list);
    const lessonList = document.getElementById('lesson-list');
    lessonList?.parentNode?.insertBefore(section, lessonList);
    return section;
  }

  function specialScreen() {
    let screen = document.getElementById('screen-special');
    if (screen) return screen;
    const anchor = document.getElementById('screen-lesson');
    if (!anchor?.parentNode) return null;
    screen = document.createElement('section');
    screen.id = 'screen-special';
    screen.className = 'phase5-subject-card phase6-screen phase10-special-screen';
    screen.hidden = true;

    const back = document.createElement('button');
    back.id = 'phase10-back-to-lessons';
    back.className = 'phase6-back-button';
    back.type = 'button';
    back.textContent = '← Back to lessons';

    const header = document.createElement('div');
    header.className = 'phase10-area-header';
    const eyebrow = document.createElement('p');
    eyebrow.className = 'phase10-eyebrow';
    eyebrow.textContent = 'Special resources';
    const title = document.createElement('h2');
    title.id = 'phase10-area-title';
    const description = document.createElement('p');
    description.id = 'phase10-area-description';
    description.className = 'phase10-area-description';
    header.append(eyebrow, title, description);

    const loading = document.createElement('div');
    loading.id = 'phase10-area-loading';
    loading.className = 'phase6-empty-state';
    loading.textContent = 'Loading…';
    loading.hidden = true;
    const error = document.createElement('div');
    error.id = 'phase10-area-error';
    error.className = 'phase6-empty-state phase7-error';
    error.hidden = true;
    const content = document.createElement('div');
    content.id = 'phase10-area-content';

    const videoWrap = document.createElement('div');
    videoWrap.id = 'phase10-video-wrap';
    videoWrap.className = 'phase10-video-wrap';
    videoWrap.hidden = true;
    const videoHead = document.createElement('div');
    videoHead.className = 'phase10-video-head';
    const videoTitle = document.createElement('strong');
    videoTitle.id = 'phase10-video-title';
    videoTitle.textContent = 'Video';
    const close = document.createElement('button');
    close.id = 'phase10-close-video';
    close.className = 'phase7-resource-action';
    close.type = 'button';
    close.textContent = 'Close';
    videoHead.append(videoTitle, close);
    const frame = document.createElement('div');
    frame.className = 'phase10-video-frame';
    const player = document.createElement('iframe');
    player.id = 'phase10-video-player';
    player.src = 'about:blank';
    player.title = 'Special resource video';
    player.allow = 'autoplay; fullscreen; picture-in-picture';
    player.allowFullscreen = true;
    player.referrerPolicy = 'no-referrer';
    frame.appendChild(player);
    videoWrap.append(videoHead, frame);

    screen.append(back, header, loading, error, content, videoWrap);
    anchor.parentNode.insertBefore(screen, anchor.nextSibling);
    back.addEventListener('click', showLessons);
    close.addEventListener('click', closeVideo);
    return screen;
  }

  function coreScreens() {
    return ['screen-subjects','screen-views','screen-lessons','screen-lesson'].map(id => document.getElementById(id)).filter(Boolean);
  }

  function showSpecial() {
    specialScreen();
    coreScreens().forEach(el => { el.hidden = true; });
    const screen = document.getElementById('screen-special');
    if (screen) screen.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showLessons() {
    closeVideo();
    const screen = document.getElementById('screen-special');
    if (screen) screen.hidden = true;
    coreScreens().forEach(el => { el.hidden = el.id !== 'screen-lessons'; });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeVideo() {
    const wrap = document.getElementById('phase10-video-wrap');
    const player = document.getElementById('phase10-video-player');
    if (player) player.src = 'about:blank';
    if (wrap) wrap.hidden = true;
  }

  function openEmbed(title, embedUrl) {
    const url = String(embedUrl || '');
    if (!/^https:\/\/go\.screenpal\.com\//i.test(url)) return;
    const wrap = document.getElementById('phase10-video-wrap');
    const player = document.getElementById('phase10-video-player');
    const heading = document.getElementById('phase10-video-title');
    if (!wrap || !player || !heading) return;
    heading.textContent = String(title || 'Video');
    player.src = url;
    wrap.hidden = false;
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function readUnlocks() {
    try {
      const value = JSON.parse(sessionStorage.getItem(MOCK_STORE) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (_) {
      sessionStorage.removeItem(MOCK_STORE);
      return {};
    }
  }

  function storeUnlock(day, videos) {
    try {
      const value = readUnlocks();
      value[String(day)] = Array.isArray(videos) ? videos : [];
      sessionStorage.setItem(MOCK_STORE, JSON.stringify(value));
    } catch (_) {}
  }

  function clearUnlocks() {
    try { sessionStorage.removeItem(MOCK_STORE); } catch (_) {}
  }

  function renderAreaCards(areas) {
    const section = specialSection();
    const list = document.getElementById('phase10-special-list');
    if (!section || !list) return;
    list.textContent = '';
    const safe = Array.isArray(areas) ? areas : [];
    section.hidden = safe.length === 0;
    for (const area of safe) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'phase10-special-card';
      const copy = document.createElement('span');
      copy.className = 'phase10-special-card-copy';
      const title = document.createElement('strong');
      title.textContent = String(area.title || area.bucketId || 'Special resource');
      const meta = document.createElement('span');
      meta.textContent = area.passwordProtected ? 'Daily password protected' : String(area.description || 'Open special resources');
      copy.append(title, meta);
      const arrow = document.createElement('span');
      arrow.className = 'phase10-special-arrow';
      arrow.textContent = '→';
      button.append(copy, arrow);
      button.addEventListener('click', () => openArea(area.bucketId));
      list.appendChild(button);
    }
  }

  async function loadAreas(viewId) {
    currentViewId = String(viewId || '');
    const section = specialSection();
    if (section) section.hidden = true;
    if (!currentViewId) return;
    try {
      const response = await api(`/api/v1/student/special-areas?viewId=${encodeURIComponent(currentViewId)}`);
      const body = await response.json().catch(() => null);
      renderAreaCards(response.ok && body?.ok ? body.areas : []);
    } catch (_) { renderAreaCards([]); }
  }

  function setAreaState(loading, message = '') {
    const loadingEl = document.getElementById('phase10-area-loading');
    const errorEl = document.getElementById('phase10-area-error');
    const content = document.getElementById('phase10-area-content');
    if (loadingEl) loadingEl.hidden = !loading;
    if (errorEl) { errorEl.textContent = message; errorEl.hidden = !message; }
    if (content && loading) content.textContent = '';
  }

  async function openArea(bucketId) {
    closeVideo();
    showSpecial();
    setAreaState(true);
    try {
      const response = await api(`/api/v1/student/special-areas/${encodeURIComponent(bucketId)}?viewId=${encodeURIComponent(currentViewId)}`);
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok || !body.area) throw new Error('This special resource is temporarily unavailable.');
      const area = body.area;
      document.getElementById('phase10-area-title').textContent = String(area.title || bucketId);
      const desc = document.getElementById('phase10-area-description');
      desc.textContent = String(area.description || '');
      desc.hidden = !area.description;
      setAreaState(false);
      if (area.type === 'mocks' || bucketId === 'MOCKS') renderMocks(area);
      else renderVideos(area);
    } catch (error) { setAreaState(false, error?.message || 'This special resource is temporarily unavailable.'); }
  }

  function emptyMessage(text) {
    const p = document.createElement('p');
    p.className = 'phase10-empty';
    p.textContent = text;
    return p;
  }

  function renderVideos(area) {
    const content = document.getElementById('phase10-area-content');
    if (!content) return;
    content.textContent = '';
    const items = Array.isArray(area.items) ? area.items : [];
    if (!items.length) { content.appendChild(emptyMessage('No resources are available here yet.')); return; }
    for (const item of items) {
      if (item.separator) {
        const h = document.createElement('h3');
        h.className = 'phase10-separator';
        h.textContent = String(item.title || '');
        content.appendChild(h);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'phase10-resource-row';
      const copy = document.createElement('div');
      copy.className = 'phase10-resource-copy';
      const title = document.createElement('strong');
      title.textContent = String(item.title || 'Video');
      copy.appendChild(title);
      if (item.description) {
        const description = document.createElement('span');
        description.textContent = String(item.description);
        copy.appendChild(description);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'phase7-resource-action';
      button.textContent = 'Watch';
      button.addEventListener('click', async () => {
        if (!item.resourceKey) return;
        const old = button.textContent;
        button.disabled = true;
        button.textContent = 'Loading…';
        try {
          const response = await api(`/api/v1/student/special-resources/${encodeURIComponent(item.resourceKey)}/video?viewId=${encodeURIComponent(currentViewId)}`);
          const body = await response.json().catch(() => null);
          if (!response.ok || !body?.ok || !body.embedUrl) throw new Error();
          openEmbed(item.title, body.embedUrl);
        } catch (_) { button.textContent = 'Unavailable'; setTimeout(() => { button.textContent = old; }, 1800); }
        finally { button.disabled = false; }
      });
      row.append(copy, button);
      content.appendChild(row);
    }
  }

  function renderUnlocked(container, day, videos) {
    container.textContent = '';
    for (const video of Array.isArray(videos) ? videos : []) {
      const row = document.createElement('div');
      row.className = 'phase10-mock-video-row';
      const label = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = String(video.title || 'Answer video');
      const subject = document.createElement('small');
      subject.textContent = String(video.subject || '').toUpperCase();
      label.append(title, subject);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'phase7-resource-action';
      button.textContent = 'Watch';
      button.addEventListener('click', () => openEmbed(video.title, video.embedUrl));
      row.append(label, button);
      container.appendChild(row);
    }
    if (!container.children.length) container.appendChild(emptyMessage(`No answer videos are available for Mock ${day}.`));
  }

  function renderMocks(area) {
    const content = document.getElementById('phase10-area-content');
    if (!content) return;
    content.textContent = '';
    const days = Array.isArray(area.days) ? area.days : [];
    if (!days.length) { content.appendChild(emptyMessage('No mock days are available here yet.')); return; }

    for (const day of days) {
      const card = document.createElement('article');
      card.className = 'phase10-mock-card';
      const header = document.createElement('div');
      header.className = 'phase10-mock-header';
      const titleWrap = document.createElement('div');
      const title = document.createElement('h3');
      title.textContent = String(day.title || `Mock ${day.day}`);
      const description = document.createElement('p');
      description.textContent = String(day.description || 'Maths and VR answer videos use the same daily password.');
      titleWrap.append(title, description);
      const badge = document.createElement('span');
      badge.className = 'phase10-password-badge';
      badge.textContent = '🔒 Daily password';
      header.append(titleWrap, badge);
      card.appendChild(header);

      const unlocked = readUnlocks()[String(day.day)];
      const videoList = document.createElement('div');
      videoList.className = 'phase10-mock-video-list';
      if (Array.isArray(unlocked) && unlocked.length) {
        badge.textContent = 'Unlocked this session';
        renderUnlocked(videoList, day.day, unlocked);
        card.appendChild(videoList);
        content.appendChild(card);
        continue;
      }

      const locked = document.createElement('div');
      locked.className = 'phase10-locked-video-names';
      for (const video of Array.isArray(day.videos) ? day.videos : []) {
        const row = document.createElement('div');
        row.textContent = `🔒 ${String(video.title || 'Answer video')}`;
        locked.appendChild(row);
      }
      card.appendChild(locked);

      const form = document.createElement('form');
      form.className = 'phase10-mock-form';
      const label = document.createElement('label');
      const labelText = document.createElement('span');
      labelText.textContent = 'Daily password';
      const field = document.createElement('span');
      field.className = 'phase10-password-field';
      const input = document.createElement('input');
      input.type = 'password';
      input.autocomplete = 'off';
      input.required = true;
      input.setAttribute('aria-label', 'Daily mock password');
      const eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'phase10-eye';
      eye.textContent = 'Show';
      eye.setAttribute('aria-label', 'Show password');
      field.append(input, eye);
      label.append(labelText, field);
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.className = 'phase7-resource-action';
      submit.textContent = `Unlock Mock ${day.day}`;
      const status = document.createElement('p');
      status.className = 'phase10-mock-status';
      status.setAttribute('aria-live', 'polite');
      form.append(label, submit, status);

      eye.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        eye.textContent = show ? 'Hide' : 'Show';
        eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        input.focus();
      });

      form.addEventListener('submit', async event => {
        event.preventDefault();
        const password = input.value;
        if (!password) return;
        status.textContent = '';
        submit.disabled = true;
        submit.textContent = 'Checking…';
        try {
          const response = await api(`/api/v1/student/special-areas/MOCKS/mock-days/${encodeURIComponent(day.day)}/unlock?viewId=${encodeURIComponent(currentViewId)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password })
          });
          const body = await response.json().catch(() => null);
          input.value = '';
          input.type = 'password';
          eye.textContent = 'Show';
          if (!response.ok || !body?.ok || !Array.isArray(body.videos)) {
            const message = body?.error === 'MOCK_PASSWORD_RATE_LIMITED'
              ? 'Too many attempts. Please wait a minute and try again.'
              : body?.error === 'MOCK_PASSWORD_INCORRECT'
                ? 'That daily password is not correct.'
                : 'The mock could not be unlocked.';
            throw new Error(message);
          }
          storeUnlock(day.day, body.videos);
          badge.textContent = 'Unlocked this session';
          form.remove();
          locked.remove();
          renderUnlocked(videoList, day.day, body.videos);
          card.appendChild(videoList);
        } catch (error) { status.textContent = error?.message || 'The mock could not be unlocked.'; }
        finally { submit.disabled = false; submit.textContent = `Unlock Mock ${day.day}`; }
      });

      card.appendChild(form);
      content.appendChild(card);
    }
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const input = args[0];
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      const viewMatch = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
      if (viewMatch && response.ok) setTimeout(() => loadAreas(decodeURIComponent(viewMatch[1])), 0);
      if (url.pathname === '/api/v1/student/auth/logout') {
        clearUnlocks();
        currentViewId = '';
      }
    } catch (_) {}
    return response;
  };

  for (const id of ['back-to-subjects','back-to-views','maths-choice','english-choice']) {
    document.getElementById(id)?.addEventListener('click', () => {
      const screen = document.getElementById('screen-special');
      if (screen) screen.hidden = true;
      const section = specialSection();
      if (section) section.hidden = true;
      currentViewId = '';
      closeVideo();
    });
  }
  document.getElementById('logout-button')?.addEventListener('click', clearUnlocks);
  specialSection();
  specialScreen();
})();
