(() => {
  const config = window.FPT_V2_CONFIG || {};
  const base = String(config.workerBaseUrl || '').replace(/\/$/, '');
  const upstreamFetch = window.fetch.bind(window);
  const captured = { viewId: '', resources: [] };
  let renderTimer = null;

  function requestUrl(input) {
    try {
      if (typeof input === 'string' || input instanceof URL) return new URL(String(input), window.location.href);
      if (input instanceof Request) return new URL(input.url, window.location.href);
    } catch (_) {}
    return null;
  }

  function methodOf(input, init) {
    if (init?.method) return String(init.method).toUpperCase();
    if (input instanceof Request) return String(input.method || 'GET').toUpperCase();
    return 'GET';
  }

  function scheduleRender() {
    if (renderTimer) window.clearTimeout(renderTimer);
    // Use a macrotask so the base Phase 7 lesson renderer can finish consuming
    // the successful lesson-detail response before this extension touches the DOM.
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      render();
    }, 0);
  }

  async function capture(response, url) {
    try {
      const body = await response.clone().json();
      if (!response.ok || !body?.ok || !body?.lesson) return;
      captured.viewId = String(url.searchParams.get('viewId') || '').trim();
      captured.resources = Array.isArray(body.lesson?.phase11OtherResources?.elevenPlus)
        ? body.lesson.phase11OtherResources.elevenPlus
        : [];
      scheduleRender();
    } catch (_) {
      captured.resources = [];
      scheduleRender();
    }
  }

  window.fetch = async (input, init) => {
    const url = requestUrl(input);
    const method = methodOf(input, init);
    const response = await upstreamFetch(input, init);
    if (url && method === 'GET' && /\/api\/v1\/student\/lessons\/[^/]+$/.test(url.pathname)) {
      // Do not block the base lesson fetch on extension rendering. response.clone()
      // is created inside capture before any body read can affect this response.
      capture(response, url);
    }
    return response;
  };

  function buttonFor(resource) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'phase7-resource-action';
    button.textContent = resource.locked ? 'Locked' : (resource.available ? 'Download' : 'Unavailable');
    button.disabled = Boolean(resource.locked || !resource.available || !resource.resourceKey);
    if (!button.disabled) {
      button.addEventListener('click', async () => {
        button.disabled = true;
        const old = button.textContent;
        button.textContent = 'Preparing…';
        try {
          const response = await upstreamFetch(
            `${base}/api/v1/student/resources/${encodeURIComponent(resource.resourceKey)}?viewId=${encodeURIComponent(captured.viewId)}`,
            { credentials: 'include', cache: 'no-store' }
          );
          if (response.status === 401) {
            window.location.reload();
            return;
          }
          if (!response.ok) throw new Error('DOWNLOAD_FAILED');
          const blob = await response.blob();
          const href = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = href;
          link.download = resource.displayName || 'resource.pdf';
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(href), 1000);
        } catch (_) {
          button.textContent = 'Try again';
          return;
        } finally {
          button.disabled = false;
          if (button.textContent === 'Preparing…') button.textContent = old;
        }
      });
    }
    return button;
  }

  function rowFor(resource) {
    const row = document.createElement('div');
    row.className = 'phase7-resource-row phase11-eleven-other-row';
    const details = document.createElement('div');
    details.className = 'phase7-resource-details';
    const name = document.createElement('div');
    name.className = 'phase7-resource-name';
    name.textContent = resource.displayName || '11+ Additional Resource';
    const meta = document.createElement('div');
    meta.className = 'phase7-resource-meta';
    meta.textContent = resource.locked ? '11+ resource · locked preview' : '11+ additional resource';
    details.append(name, meta);
    row.append(details, buttonFor(resource));
    return row;
  }

  function render() {
    const section = document.getElementById('other-section');
    const list = document.getElementById('other-list');
    if (!section || !list) return;

    list.querySelectorAll('.phase11-eleven-other-row').forEach(node => node.remove());
    if (!captured.resources.length) return;

    captured.resources.forEach(resource => list.appendChild(rowFor(resource)));
    section.hidden = false;
  }

  const otherList = document.getElementById('other-list');
  if (otherList) {
    new MutationObserver(records => {
      // The previous Phase 11 observer watched all of #lesson-content, including
      // its own rows and the `hidden` attribute it changed. A non-empty 11+ Other
      // resource list could therefore trigger render -> mutation -> render forever,
      // starving the base lesson-detail promise. Observe only the base list and
      // ignore records made exclusively from our own extension rows.
      const baseChanged = records.some(record => {
        const changedNodes = [...record.addedNodes, ...record.removedNodes];
        return changedNodes.some(node => !(
          node.nodeType === Node.ELEMENT_NODE &&
          node.classList?.contains('phase11-eleven-other-row')
        ));
      });
      if (baseChanged) scheduleRender();
    }).observe(otherList, { childList: true });
  }
})();
