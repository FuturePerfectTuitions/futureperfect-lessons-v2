(() => {
  'use strict';

  const config = window.FPT_V2_CONFIG || {};
  const API_BASE = String(
    config.workerBaseUrl || 'https://fpt-portal-v2-worker.futureperfectlessons.workers.dev'
  ).replace(/\/$/, '');

  const state = {
    resource: null,
    viewId: '',
    viewerPath: '',
    heartbeat: null,
    rendering: false
  };

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  function eyeIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"></circle>
      </svg>`;
  }

  function ensureModal() {
    let overlay = document.getElementById('phase11-answer-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'phase11-answer-overlay';
    overlay.className = 'phase8-answer-backdrop';
    overlay.hidden = true;
    overlay.innerHTML = `
      <section class="phase8-answer-card" role="dialog" aria-modal="true" aria-labelledby="phase11-answer-title">
        <header class="phase8-answer-header">
          <div>
            <p class="phase8-answer-eyebrow">Protected answer resource</p>
            <h2 id="phase11-answer-title">Answer Pack</h2>
          </div>
          <button id="phase11-answer-close" class="phase8-answer-close" type="button">Close</button>
        </header>

        <div id="phase11-answer-prompt" class="phase8-answer-prompt">
          <p id="phase11-answer-name" class="phase8-answer-note"></p>
          <p class="phase8-answer-note">Enter your current Answer Pack password. You will be asked again every time you open a protected answer resource.</p>
          <form id="phase11-answer-form" class="phase8-answer-form">
            <label for="phase11-answer-password">Answer Pack password</label>
            <div class="phase8-password-row">
              <input id="phase11-answer-password" type="password" maxlength="4" autocomplete="off" autocapitalize="off" spellcheck="false" required>
              <button id="phase11-answer-eye" class="phase8-answer-eye" type="button" aria-label="Show password" aria-pressed="false">${eyeIcon()}</button>
            </div>
            <button id="phase11-answer-open" class="phase8-answer-open" type="submit">Open protected answer</button>
            <p id="phase11-answer-error" class="phase8-answer-error" role="alert" hidden></p>
          </form>
        </div>

        <div id="phase11-answer-viewer" class="phase8-answer-viewer" hidden>
          <div id="phase11-answer-watermark" class="phase8-answer-watermark"></div>
          <div class="phase9-viewer-heading-row">
            <strong id="phase11-viewer-title">Answer Pack</strong>
            <button id="phase11-viewer-close" class="phase8-answer-close" type="button">Close</button>
          </div>
          <div id="phase11-answer-loading" class="phase8-answer-loading">Preparing protected answers…</div>
          <div id="phase11-answer-invalid" class="phase8-answer-invalid" role="alert" hidden></div>
          <div id="phase11-answer-pages" class="phase8-answer-pages" aria-label="Protected answer pages"></div>
          <p class="phase8-answer-protection-note">Protected viewer · download and print controls are not provided.</p>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);

    document.getElementById('phase11-answer-close').addEventListener('click', close);
    document.getElementById('phase11-viewer-close').addEventListener('click', close);
    document.getElementById('phase11-answer-eye').addEventListener('click', togglePassword);
    document.getElementById('phase11-answer-form').addEventListener('submit', submitPassword);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
    return overlay;
  }

  function elements() {
    ensureModal();
    return {
      overlay: document.getElementById('phase11-answer-overlay'),
      title: document.getElementById('phase11-answer-title'),
      name: document.getElementById('phase11-answer-name'),
      prompt: document.getElementById('phase11-answer-prompt'),
      password: document.getElementById('phase11-answer-password'),
      eye: document.getElementById('phase11-answer-eye'),
      open: document.getElementById('phase11-answer-open'),
      error: document.getElementById('phase11-answer-error'),
      viewer: document.getElementById('phase11-answer-viewer'),
      viewerTitle: document.getElementById('phase11-viewer-title'),
      watermark: document.getElementById('phase11-answer-watermark'),
      loading: document.getElementById('phase11-answer-loading'),
      invalid: document.getElementById('phase11-answer-invalid'),
      pages: document.getElementById('phase11-answer-pages')
    };
  }

  function setPasswordVisible(visible) {
    const els = elements();
    els.password.type = visible ? 'text' : 'password';
    els.eye.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    els.eye.setAttribute('aria-pressed', visible ? 'true' : 'false');
  }

  function togglePassword() {
    const els = elements();
    setPasswordVisible(els.password.type === 'password');
    els.password.focus();
  }

  function stopHeartbeat() {
    if (state.heartbeat) window.clearInterval(state.heartbeat);
    state.heartbeat = null;
  }

  function resetDocument() {
    const els = elements();
    els.pages.replaceChildren();
    els.invalid.hidden = true;
    els.invalid.textContent = '';
    els.loading.hidden = false;
    state.rendering = false;
  }

  function errorMessage(code) {
    switch (String(code || '')) {
      case 'ANSWER_PASSWORD_INCORRECT': return 'Incorrect Answer Pack password.';
      case 'ANSWER_PASSWORD_REQUIRED': return 'Enter your 4-character Answer Pack password.';
      case 'TOO_MANY_ATTEMPTS': return 'Too many password attempts. Please wait a minute and try again.';
      case 'RESOURCE_NOT_AVAILABLE': return 'This answer resource is not available in this view.';
      case 'VR_NOT_AVAILABLE': return 'This Verbal Reasoning answer is not available for this account.';
      case 'SESSION_INVALID':
      case 'SESSION_EXPIRED': return 'Your portal session has ended. Please log in again.';
      default: return 'Unable to open this protected answer.';
    }
  }

  function open(resource, viewId) {
    if (!resource?.resourceKey || !viewId) return;
    const els = elements();
    stopHeartbeat();
    resetDocument();
    state.resource = resource;
    state.viewId = String(viewId).trim();
    state.viewerPath = '';
    els.title.textContent = /answer key/i.test(resource.displayName || '') ? 'Answer Key' : 'Answer Pack';
    els.name.textContent = resource.displayName || 'Protected answer';
    els.password.value = '';
    setPasswordVisible(false);
    els.error.hidden = true;
    els.prompt.hidden = false;
    els.viewer.hidden = true;
    els.overlay.hidden = false;
    document.body.classList.add('phase8-viewer-open');
    window.setTimeout(() => els.password.focus(), 0);
  }

  function close() {
    const els = elements();
    stopHeartbeat();
    resetDocument();
    state.resource = null;
    state.viewId = '';
    state.viewerPath = '';
    els.password.value = '';
    els.prompt.hidden = false;
    els.viewer.hidden = true;
    els.overlay.hidden = true;
    document.body.classList.remove('phase8-viewer-open');
  }

  async function submitPassword(event) {
    event.preventDefault();
    const els = elements();
    if (!state.resource?.resourceKey || !state.viewId) return;

    els.error.hidden = true;
    els.open.disabled = true;
    els.open.textContent = 'Checking…';

    try {
      const response = await fetch(
        apiUrl(`/api/v1/student/resources/${encodeURIComponent(state.resource.resourceKey)}/answer/authorize?viewId=${encodeURIComponent(state.viewId)}`),
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ password: els.password.value })
        }
      );
      const body = await response.json().catch(() => ({}));
      els.password.value = '';
      setPasswordVisible(false);

      if (response.status === 401) {
        window.location.reload();
        return;
      }
      if (!response.ok || !body?.viewerPath) {
        throw new Error(body?.error || 'ANSWER_OPEN_FAILED');
      }

      state.viewerPath = body.viewerPath;
      els.prompt.hidden = true;
      els.viewer.hidden = false;
      els.viewerTitle.textContent = state.resource.displayName || 'Protected answer';
      els.watermark.textContent = body.watermark || 'Future Perfect Tuitions';
      await renderPdf(body.viewerPath);
      startHeartbeat(body.viewerPath);
    } catch (error) {
      els.error.textContent = errorMessage(error?.message);
      els.error.hidden = false;
    } finally {
      els.open.disabled = false;
      els.open.textContent = 'Open protected answer';
    }
  }

  async function renderPdf(viewerPath) {
    const els = elements();
    resetDocument();
    try {
      const response = await fetch(apiUrl(viewerPath), {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/pdf,application/octet-stream' }
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'ANSWER_VIEW_FAILED');
      }
      if (!window.pdfjsLib) throw new Error('PDF_VIEWER_UNAVAILABLE');
      const bytes = new Uint8Array(await response.arrayBuffer());
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
      state.rendering = true;

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(280, els.pages.clientWidth - 24);
        const cssScale = Math.min(1.65, availableWidth / baseViewport.width);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale * pixelRatio });
        const wrapper = document.createElement('div');
        wrapper.className = 'phase8-answer-page';
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${Math.floor(baseViewport.width * cssScale)}px`;
        canvas.style.height = `${Math.floor(baseViewport.height * cssScale)}px`;
        canvas.setAttribute('aria-label', `Protected answer page ${pageNumber}`);
        wrapper.appendChild(canvas);
        els.pages.appendChild(wrapper);
        const context = canvas.getContext('2d', { alpha: false });
        await page.render({ canvasContext: context, viewport }).promise;
      }
      els.loading.hidden = true;
    } catch (error) {
      els.loading.hidden = true;
      els.invalid.textContent = errorMessage(error?.message);
      els.invalid.hidden = false;
    } finally {
      state.rendering = false;
    }
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
        const els = elements();
        els.invalid.textContent = 'Protected access has ended. Close this viewer and enter your current Answer Pack password again.';
        els.invalid.hidden = false;
      }
    };
    state.heartbeat = window.setInterval(check, 30000);
  }

  document.addEventListener('keydown', event => {
    const overlay = document.getElementById('phase11-answer-overlay');
    if (!overlay || overlay.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && ['p', 's'].includes(String(event.key).toLowerCase())) {
      event.preventDefault();
    }
  });

  document.addEventListener('contextmenu', event => {
    const overlay = document.getElementById('phase11-answer-overlay');
    if (overlay && !overlay.hidden && overlay.contains(event.target)) event.preventDefault();
  });

  document.addEventListener('click', event => {
    if (event.target.closest('#back-to-lessons, #back-to-views, #back-to-subjects, #logout-button')) {
      close();
    }
  });

  window.FPT_PHASE11_PROTECTED = Object.assign(window.FPT_PHASE11_PROTECTED || {}, { open, close });

  // Compatibility hook used by the Phase 11 resource renderer. Phase 9 keeps
  // ownership of its own protected viewer; this only fills the hook when Phase 9
  // has not exported one.
  window.FPT_PHASE9 = window.FPT_PHASE9 || {};
  if (typeof window.FPT_PHASE9.openProtectedAnswer !== 'function') {
    window.FPT_PHASE9.openProtectedAnswer = open;
  }
})();
