(() => {
  'use strict';

  const portal = document.getElementById('portal-screen');
  const viewGrid = document.getElementById('view-grid');
  if (!portal) return;

  function simplifyAvailabilityCopy() {
    for (const state of portal.querySelectorAll('.phase7-state:not(.locked), .phase6-lesson-state:not(.locked)')) {
      state.setAttribute('aria-hidden', 'true');
    }

    if (!viewGrid) return;
    for (const meta of viewGrid.querySelectorAll('.phase6-view-card-meta')) {
      const text = String(meta.textContent || '').trim();
      const mixed = text.match(/^(\d+)\s+available\s+·\s+(\d+)\s+locked$/i);
      if (mixed) {
        const openCount = Number(mixed[1]);
        const lockedCount = Number(mixed[2]);
        meta.textContent = `${openCount} open · ${lockedCount} locked`;
        continue;
      }

      const openOnly = text.match(/^(\d+)\s+available\s+lesson(s)?$/i);
      if (openOnly) {
        const count = Number(openOnly[1]);
        meta.textContent = `${count} lesson${count === 1 ? '' : 's'}`;
      }
    }
  }

  const observer = new MutationObserver(simplifyAvailabilityCopy);
  observer.observe(portal, { childList: true, subtree: true });
  simplifyAvailabilityCopy();
})();
