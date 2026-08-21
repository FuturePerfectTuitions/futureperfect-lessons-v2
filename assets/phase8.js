(() => {
  const config = window.FPT_V2_CONFIG || {};
  const base = String(config.workerBaseUrl || '').replace(/\/$/, '');
  const nativeFetch = window.fetch.bind(window);

  const captured = {
    viewId: '',
    answerResources: []
  };

  const viewer = {
    resource: null,
    token: '',
    viewerPath: '',
    heartbeat: null,
    pdfDocument: null
  };

  function requestUrl(input) {
    try {
      if (typeof input === 'string' || input instanceof URL) return new URL(String(input), window.location.href);
      if (input instanceof Request) return new URL(input.url, window.location.href);
    } catch (_) {}
    return null;
  }

  function requestMethod(input, init) {
    if (init?.method) return String(init.method).toUpperCase();
    if (input instanceof Request) return String(input.method || 'GET').toUpperCase();
    return 'GET';
  }

  async function captureLessonResponse(response, url) {
    try {
      const body = await response.clone().json();
      const lesson = body?.lesson;
      if (!response.ok || !body?.ok || !lesson) return;

      captured.viewId = String(url.searchParams.get('viewId') || '').trim();
      captured.answerResources = (Array.isArray(lesson.homeworks) ? lesson.homeworks : [])
        .map(pair => pair?.answerPack || null)
        .filter(resource => resource?.protected && resource?.resourceKey && resource?.available !== false)
        .map(resource => ({
          resourceKey: String(resource.resourceKey),
          displayName: String(resource.displayName || 'Answer Pack')
        }));
    } catch (_) {
      captured.viewId = '';
      captured.answerResources = [];
    }
  }

  window.fetch = async (input, init) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    const response = await nativeFetch(input, init);

    if (
      url &&
      method === 'GET' &&
      /\/api\/v1\/student\/lessons\/[^/]+$/.test(url.pathname)
    ) {
      await captureLessonResponse(response, url);
    }

    return response;
  };

  function makeEyeIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"></circle>
      </svg>`;
  }

  function createModal() {
    const backdrop = document.createElement('div');
    backdrop.id = 'phase8-answer-modal';
    backdrop.className = 'phase8-answer-backdrop';
    backdrop.hidden = true;
    backdrop.innerHTML = `
      <section class="phase8-answer-card" role="dialog" aria-modal="true" aria-labelledby="phase8-answer-title">
        <header class="phase8-answer-header">
          <div>
            <p class="phase8-answer-eyebrow">Protected answer resource</p>
            <h2 id="phase8-answer-title">Answer Pack</h2>
          </div>
          <button id="phase8-answer-close" class="phase8-answer-close" type="button">Close</button>
        </header>

        <div id="phase8-answer-prompt" class="phase8-answer-prompt">
          <p class="phase8-answer-note">
            Enter your current Answer Pack password. You will be asked again every time you open a protected answer resource.
          </p>
          <form id="phase8-answer-form" class="phase8-answer-form">
            <label for="phase8-answer-password">Answer Pack password</label>
            <div class="phase8-password-row">
              <input id="phase8-answer-password" type="password" maxlength="4" autocomplete="off" autocapitalize="off" spellcheck="false" required>
              <button id="phase8-answer-eye" class="phase8-answer-eye" type="button" aria-label="Show password" aria-pressed="false">${makeEyeIcon()}</button>
            </div>
            <button id="phase8-answer-open" class="phase8-answer-open" type="submit">Open protected answers</button>
            <p id="phase8-answer-error" class="phase8-answer-error" role="alert" hidden></p>
          </form>
        </div>

        <div id="phase8-answer-viewer" class="phase8-answer-viewer" hidden>
          <div id="phase8-answer-watermark" class="phase8-answer-watermark"></div>
          <div id="phase8-answer-loading" class="phase8-answer-loading">Preparing protected answers…</div>
          <div id="phase8-answer-invalid" class="phase8-answer-invalid" role="alert" hidden></div>
          <div id="phase8-answer-pages" class="phase8-answer-pages" aria-label="Protected answer pages"></div>
          <p class="phase8-answer-protection-note">Protected viewer · download and print controls are not provided.</p>
        </div>
      </section>`;
    document.body.appendChild(backdrop);
    return backdrop;
  }

  const modal = createModal();
  const els = {
    modal,
    card: modal.querySelector('.phase8-answer-card'),
    title: document.getElementById('phase8-answer-title'),
    close: document.getElementById('phase8-answer-close'),
    prompt: document.getElementById('phase8-answer-prompt'),
    form: document.getElementById('phase8-answer-form'),
    password: document.getElementById('phase8-answer-password'),
    eye: document.getElementById('phase8-answer-eye'),
    open: document.getElementById('phase8-answer-open'),
    error: document.getElementById('phase8-answer-error'),
    viewer: document.getElementById('phase8-answer-viewer'),
    watermark: document.getElementById('phase8-answer-watermark'),
    loading: document.getElementById('phase8-answer-loading'),
    invalid: document.getElementById('phase8-answer-invalid'),
    pages: document.getElementById('phase8-answer-pages')
  };

  function setPasswordVisible(visible) {
    els.password.type = visible ? 'text' : 'password';
    els.eye.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    els.eye.setAttribute('aria-pressed', visible ? 'true' : 'false');
  }

  function clearHeartbeat() {
    if (viewer.heartbeat) window.clearInterval(viewer.heartbeat);
    viewer.heartbeat = null;
  }

  function clearViewerPages() {
    viewer.pdfDocument = null;
    els.pages.innerHTML = '';
  }

  function resetViewer() {
    clearHeartbeat();
    clearViewerPages();
    viewer.token = '';
    viewer.viewerPath = '';
    els.watermark.textContent = '';
    els.loading.hidden = false;
    els.invalid.hidden = true;
    els.invalid.textContent = '';
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function clearError() {
    els.error.textContent = '';
    els.error.hidden = true;
  }

  function openPrompt(resource) {
    resetViewer();
    viewer.resource = resource;
    els.title.textContent = resource.displayName || 'Answer Pack';
    els.password.value = '';
    setPasswordVisible(false);
    clearError();
    els.prompt.hidden = false;
    els.viewer.hidden = true;
    els.modal.hidden = false;
    document.body.classList.add('phase8-viewer-open');
    window.setTimeout(() => els.password.focus(), 0);
  }

  function closeModal() {
    resetViewer();
    viewer.resource = null;
    els.password.value = '';
    setPasswordVisible(false);
    clearError();
    els.prompt.hidden = false;
    els.viewer.hidden = true;
    els.modal.hidden = true;
    document.body.classList.remove('phase8-viewer-open');
  }

  function invalidateViewer(message) {
    clearHeartbeat();
    clearViewerPages();
    els.loading.hidden = true;
    els.invalid.textContent = message;
    els.invalid.hidden = false;
  }

  async function renderProtectedPdf(blob) {
    if (!window.pdfjsLib) throw new Error('The protected PDF viewer could not be loaded.');

    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    viewer.pdfDocument = pdf;
    els.pages.innerHTML = '';

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(280, els.pages.clientWidth - 24);
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
      els.pages.appendChild(wrapper);

      const context = canvas.getContext('2d', { alpha: false });
      await page.render({ canvasContext: context, viewport: renderViewport }).promise;
    }

    els.loading.hidden = true;
  }

  async function checkViewerLease() {
    if (!viewer.viewerPath || els.modal.hidden || els.viewer.hidden) return;
    try {
      const response = await nativeFetch(`${base}${viewer.viewerPath}?status=1`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (!response.ok) {
        invalidateViewer(
          'This protected view is no longer authorised. Close it and enter your current Answer Pack password to open it again.'
        );
      }
    } catch (_) {
      invalidateViewer(
        'The protected view could not be revalidated. Close it and enter your Answer Pack password to open it again.'
      );
    }
  }

  function startHeartbeat() {
    clearHeartbeat();
    viewer.heartbeat = window.setInterval(checkViewerLease, 30000);
  }

  async function submitPassword(event) {
    event.preventDefault();
    if (!viewer.resource?.resourceKey || !captured.viewId || !base) return;

    clearError();
    els.open.disabled = true;
    const suppliedPassword = els.password.value;

    try {
      const authorizeResponse = await nativeFetch(
        `${base}/api/v1/student/resources/${encodeURIComponent(viewer.resource.resourceKey)}/answer/authorize?viewId=${encodeURIComponent(captured.viewId)}`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          cache: 'no-store',
          body: JSON.stringify({ password: suppliedPassword })
        }
      );

      let authorizeBody = null;
      try { authorizeBody = await authorizeResponse.json(); } catch (_) {}
      els.password.value = '';
      setPasswordVisible(false);

      if (authorizeResponse.status === 401) {
        window.location.reload();
        return;
      }
      if (authorizeResponse.status === 429) {
        showError('Too many password attempts. Please wait a minute and try again.');
        return;
      }
      if (!authorizeResponse.ok || !authorizeBody?.ok || !authorizeBody.viewerPath) {
        showError(
          authorizeBody?.error === 'ANSWER_PASSWORD_INCORRECT'
            ? 'Incorrect Answer Pack password.'
            : 'This protected answer resource could not be opened.'
        );
        els.password.focus();
        return;
      }

      viewer.token = String(authorizeBody.token || '');
      viewer.viewerPath = String(authorizeBody.viewerPath || '');
      els.watermark.textContent = String(
        authorizeBody.watermark || 'Future Perfect Tuitions'
      );
      els.prompt.hidden = true;
      els.viewer.hidden = false;
      els.loading.hidden = false;
      els.invalid.hidden = true;
      clearViewerPages();
      await new Promise(resolve => window.requestAnimationFrame(resolve));

      const pdfResponse = await nativeFetch(`${base}${viewer.viewerPath}`, {
        method: 'GET',
        headers: { Accept: 'application/pdf,application/octet-stream' },
        credentials: 'include',
        cache: 'no-store'
      });

      if (pdfResponse.status === 401) {
        window.location.reload();
        return;
      }
      if (!pdfResponse.ok) {
        throw new Error('This protected open expired. Close it and enter your password again.');
      }

      const blob = await pdfResponse.blob();
      await renderProtectedPdf(blob);
      startHeartbeat();
    } catch (error) {
      if (els.viewer.hidden) {
        showError(String(error?.message || 'This protected answer resource could not be opened.'));
      } else {
        invalidateViewer(String(error?.message || 'This protected answer resource could not be opened.'));
      }
    } finally {
      els.open.disabled = false;
    }
  }

  function answerButtonText(resource) {
    return /answer\s*key/i.test(resource?.displayName || '') ? 'Open Answer Key' : 'Open Answer Pack';
  }

  function enhanceProtectedRows() {
    const homeworkList = document.getElementById('homework-list');
    if (!homeworkList) return;

    const protectedRows = [...homeworkList.querySelectorAll('.phase7-resource-row')]
      .filter(row => row.querySelector('.phase7-protected-chip'));

    protectedRows.forEach((row, index) => {
      const resource = captured.answerResources[index];
      const button = row.querySelector('.phase7-resource-action');
      if (!button || !resource?.resourceKey) return;
      if (button.dataset.phase8Bound === resource.resourceKey) return;

      button.dataset.phase8Bound = resource.resourceKey;
      button.disabled = false;
      button.textContent = answerButtonText(resource);
      button.addEventListener('click', () => openPrompt(resource));

      const meta = row.querySelector('.phase7-resource-meta');
      if (meta) meta.textContent = 'Password required every time';
    });
  }

  const homeworkList = document.getElementById('homework-list');
  if (homeworkList) {
    const observer = new MutationObserver(enhanceProtectedRows);
    observer.observe(homeworkList, { childList: true, subtree: true });
  }

  els.form.addEventListener('submit', submitPassword);
  els.close.addEventListener('click', closeModal);
  els.eye.addEventListener('click', () => {
    setPasswordVisible(els.password.type === 'password');
    els.password.focus();
  });
  els.modal.addEventListener('click', event => {
    if (event.target === els.modal) closeModal();
  });
  els.pages.addEventListener('contextmenu', event => event.preventDefault());
  document.addEventListener('keydown', event => {
    if (els.modal.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && ['p', 's'].includes(String(event.key).toLowerCase())) {
      event.preventDefault();
    }
  });
})();
