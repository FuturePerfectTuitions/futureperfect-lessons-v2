(() => {
  'use strict';

  const lessonContent = document.getElementById('lesson-content');
  const videoSection = document.getElementById('video-section');
  if (!lessonContent || !videoSection) return;

  const STYLE_ID = 'phase21-video-single-click-style';
  let queued = false;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `#video-section .phase12-video-toggle-row { display:none !important; }`;
    document.head.appendChild(style);
  }

  function heading() {
    return Array.from(videoSection.children)
      .find(child => child.classList?.contains('phase7-section-heading')) || null;
  }

  function collapseBody() {
    return Array.from(videoSection.children)
      .find(child => child.classList?.contains('phase20-collapse-body')) || null;
  }

  function dedicatedToggle() {
    return videoSection.querySelector('.phase12-video-toggle');
  }

  function syncDedicated(expanded) {
    const button = dedicatedToggle();
    if (!button || button.disabled) return;
    const text = String(button.textContent || '').trim().toLowerCase();
    if (expanded && text === 'view') button.click();
    if (!expanded && text === 'hide') button.click();
  }

  function setExpanded(button, body, expanded) {
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.textContent = expanded ? 'Hide' : 'View';
    body.hidden = !expanded;
    syncDedicated(expanded);
  }

  function ensureBody() {
    let body = collapseBody();
    if (body) return body;
    const head = heading();
    if (!head) return null;

    body = document.createElement('div');
    body.className = 'phase20-collapse-body phase21-video-collapse-body';
    for (const child of Array.from(videoSection.children).filter(child => child !== head)) {
      body.appendChild(child);
    }
    videoSection.appendChild(body);
    return body;
  }

  function ensureSingleVisibleToggle() {
    const head = heading();
    const body = ensureBody();
    if (!head || !body) return;

    const buttons = Array.from(head.querySelectorAll('.phase20-collapse-toggle'));
    let button = buttons[0] || null;
    for (const extra of buttons.slice(1)) extra.remove();

    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'phase20-collapse-toggle phase21-video-toggle';
      head.appendChild(button);
      setExpanded(button, body, false);
    } else if (!button.hasAttribute('aria-expanded')) {
      setExpanded(button, body, false);
    }

    if (button.dataset.phase21VideoBridge !== 'true') {
      button.dataset.phase21VideoBridge = 'true';
      button.addEventListener('click', () => {
        const ownedByPhase21 = button.classList.contains('phase21-video-toggle');
        if (ownedByPhase21) {
          const expanded = button.getAttribute('aria-expanded') === 'true';
          setExpanded(button, body, !expanded);
        } else {
          // Phase 20's existing listener runs before this bridge and updates
          // aria-expanded/body.hidden. Mirror that new state to the hidden
          // dedicated Phase 12 video control so only one user click is needed.
          syncDedicated(button.getAttribute('aria-expanded') === 'true');
        }
      });
    }

    videoSection.dataset.fptCollapsible = 'true';
  }

  function apply() {
    ensureStyle();
    if (!videoSection.hidden) ensureSingleVisibleToggle();
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      apply();
    });
  }

  new MutationObserver(queue).observe(lessonContent, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'src']
  });

  queue();
})();
