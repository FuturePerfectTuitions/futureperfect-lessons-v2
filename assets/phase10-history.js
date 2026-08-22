(() => {
  'use strict';

  const config = window.FPT_V2_CONFIG || {};
  const base = String(config.workerBaseUrl || '').replace(/\/$/, '');
  if (!base) return;

  const upstreamFetch = window.fetch.bind(window);
  const groups = new Map();
  let groupTimer = null;

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

  function rememberGroups(body) {
    groups.clear();
    for (const subject of Array.isArray(body?.subjects) ? body.subjects : []) {
      const subjectLabel = String(subject?.label || '').trim();
      if (!subjectLabel) continue;
      const byLabel = new Map();
      for (const view of Array.isArray(subject?.views) ? subject.views : []) {
        const label = String(view?.label || '').trim();
        if (!label) continue;
        byLabel.set(label, view?.group === 'current' || view?.current === true ? 'current' : 'previous');
      }
      groups.set(subjectLabel, byLabel);
    }
  }

  window.fetch = async (input, init) => {
    const response = await upstreamFetch(input, init);
    if (!isHomeRequest(input, init) || !response?.ok) return response;
    try {
      const body = await response.clone().json();
      if (body?.ok) rememberGroups(body);
    } catch (_) {}
    return response;
  };

  function groupSection(label, cards) {
    const section = document.createElement('section');
    section.className = 'phase10-view-group';
    section.style.gridColumn = '1 / -1';

    const heading = document.createElement('p');
    heading.className = 'phase5-eyebrow';
    heading.textContent = label;

    const grid = document.createElement('div');
    grid.className = 'phase6-view-grid';
    cards.forEach(card => grid.appendChild(card));

    section.append(heading, grid);
    return section;
  }

  function applyGrouping() {
    const grid = document.getElementById('view-grid');
    const heading = document.getElementById('views-heading');
    if (!grid || !heading) return;

    const directCards = [...grid.children].filter(child => child.classList?.contains('phase6-view-card'));
    if (!directCards.length) return;

    const subjectGroups = groups.get(String(heading.textContent || '').trim());
    if (!subjectGroups) return;

    const current = [];
    const previous = [];
    for (const card of directCards) {
      const label = String(card.querySelector('.phase6-view-card-title')?.textContent || '').trim();
      (subjectGroups.get(label) === 'current' ? current : previous).push(card);
    }

    grid.replaceChildren();
    if (current.length) grid.appendChild(groupSection('Current', current));
    if (previous.length) grid.appendChild(groupSection('Previous', previous));
  }

  function scheduleGrouping() {
    clearTimeout(groupTimer);
    groupTimer = setTimeout(applyGrouping, 0);
  }

  const observer = new MutationObserver(scheduleGrouping);
  const start = () => {
    const grid = document.getElementById('view-grid');
    if (!grid) return;
    observer.observe(grid, { childList: true });
    scheduleGrouping();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
