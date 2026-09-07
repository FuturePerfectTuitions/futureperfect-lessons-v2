(() => {
  'use strict';
  const lessonContent = document.getElementById('lesson-content');
  if (!lessonContent) return;
  let lastLessonCode = '';
  let queued = false;

  function setExpanded(button, body, expanded, labels = {}) {
    const closedLabel = labels.closed || 'View';
    const openLabel = labels.open || 'Hide';
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.textContent = expanded ? openLabel : closedLabel;
    body.hidden = !expanded;
  }

  function setDescriptionExpanded(button, description, expanded) {
    setExpanded(button, description, expanded, { closed:'Detail', open:'Hide detail' });
  }

  function enhanceDescription() {
    const description = document.getElementById('lesson-description');
    if (!description || description.dataset.fptCollapsible === 'true') return;
    const host = description.parentElement;
    if (!host) return;
    description.dataset.fptCollapsible = 'true';
    description.id = 'lesson-description';

    const bar = document.createElement('div');
    bar.className = 'phase20-description-bar';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'phase20-collapse-toggle phase20-detail-toggle';
    button.setAttribute('aria-controls', 'lesson-description');
    button.addEventListener('click', () => {
      setDescriptionExpanded(button, description, button.getAttribute('aria-expanded') !== 'true');
    });

    bar.appendChild(button);
    host.insertBefore(bar, description);
    setDescriptionExpanded(button, description, false);
  }

  function enhanceSection(section) {
    if (section.dataset.fptCollapsible === 'true') return;
    const heading = Array.from(section.children).find(child => child.classList?.contains('phase7-section-heading'));
    if (!heading) return;
    section.dataset.fptCollapsible = 'true';

    const body = document.createElement('div');
    body.className = 'phase20-collapse-body';
    const children = Array.from(section.children).filter(child => child !== heading);
    for (const child of children) body.appendChild(child);
    section.appendChild(body);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'phase20-collapse-toggle';
    button.addEventListener('click', () => setExpanded(button, body, button.getAttribute('aria-expanded') !== 'true'));
    heading.appendChild(button);
    setExpanded(button, body, false);
  }

  function collapseForNewLesson() {
    const code = String(document.getElementById('lesson-code')?.textContent || '').trim();
    if (!code || code === lastLessonCode) return;
    lastLessonCode = code;

    const desc = document.getElementById('lesson-description');
    const descButton = lessonContent.querySelector('.phase20-description-bar .phase20-detail-toggle');
    if (desc && descButton) setDescriptionExpanded(descButton, desc, false);

    for (const section of lessonContent.querySelectorAll('.phase7-resource-section[data-fpt-collapsible="true"]')) {
      const button = Array.from(section.querySelectorAll('.phase20-collapse-toggle')).find(candidate => candidate.closest('.phase7-section-heading'));
      const body = Array.from(section.children).find(child => child.classList?.contains('phase20-collapse-body'));
      if (button && body) setExpanded(button, body, false);
    }
  }

  function apply() {
    enhanceDescription();
    lessonContent.querySelectorAll('.phase7-resource-section').forEach(enhanceSection);
    collapseForNewLesson();
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; apply(); });
  }

  new MutationObserver(queue).observe(lessonContent, {
    subtree:true,
    childList:true,
    characterData:true,
    attributes:true,
    attributeFilter:['hidden']
  });
  queue();
})();
