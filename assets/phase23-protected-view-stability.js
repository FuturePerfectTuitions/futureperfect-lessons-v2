(() => {
  'use strict';

  const STABILITY_VERSION = '2026-09-09-protected-view-stability-v1';
  const nativeSetInterval = window.setInterval.bind(window);

  // Once a protected PDF has been rendered into the viewer, keep it visible until
  // the user closes it. The legacy 30-second lease heartbeat could otherwise hide
  // an already-open Answer Pack even though the password gate had succeeded.
  window.setInterval = function protectedViewStableInterval(handler, delay, ...args) {
    let source = '';
    try {
      source = typeof handler === 'function'
        ? Function.prototype.toString.call(handler)
        : String(handler || '');
    } catch (_) {}

    const protectedAnswerHeartbeat =
      Number(delay) === 30000 &&
      /status=1/.test(source) &&
      /(answer-view|viewerPath|LEASE_INVALID|checkViewerLease)/.test(source);

    if (protectedAnswerHeartbeat) return 0;
    return nativeSetInterval(handler, delay, ...args);
  };

  const replaceMisleadingExpiry = root => {
    const nodes = [];
    if (root?.matches?.('.phase8-answer-invalid')) nodes.push(root);
    if (root?.querySelectorAll) nodes.push(...root.querySelectorAll('.phase8-answer-invalid'));

    for (const node of nodes) {
      if (/This protected open expired\. Close it and enter your password again\./i.test(node.textContent || '')) {
        node.textContent = 'This protected answer could not be loaded. Close it and try opening it again.';
      }
    }
  };

  const observer = new MutationObserver(records => {
    for (const record of records) {
      replaceMisleadingExpiry(record.target);
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) replaceMisleadingExpiry(node);
      }
    }
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true
  });

  replaceMisleadingExpiry(document);
  window.FPT_PROTECTED_VIEW_STABILITY = Object.freeze({ version: STABILITY_VERSION });
})();
