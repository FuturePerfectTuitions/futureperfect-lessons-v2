(() => {
  'use strict';

  const config = window.FPT_V2_CONFIG || {};
  const API_BASE = String(
    config.workerBaseUrl || 'https://fpt-portal-v2-worker.futureperfectlessons.workers.dev'
  ).replace(/\/$/, '');

  const downstreamFetch = window.fetch.bind(window);
  const captured = {
    viewId: '',
    lessonId: '',
    lesson: null,
    renderTimer: null,
    renderAttempt: 0
  };

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  function isLessonDetailRequest(input, init) {
    try {
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (method !== 'GET') return null;
      const raw = typeof input === 'string' ? input : input?.url;
      const url = new URL(raw, location.href);
      if (url.origin !== new URL(API_BASE).origin) return null;
      const match = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
      if (!match) return null;
      return {
        lessonId: decodeURIComponent(match[1]),
        viewId: String(url.searchParams.get('viewId') || '').trim()
      };
    } catch {
      return null;
    }
  }

  async function captureLessonResponse(response, info) {
    if (!response?.ok || !info) return;
    try {
      const body = await response.clone().json();
      if (!body?.ok || !body.lesson) return;
      captured.viewId = info.viewId;
      captured.lessonId = info.lessonId;
      captured.lesson = body.lesson;
      captured.renderAttempt = 0;
      scheduleRender();
    } catch (_) {}
  }

  window.fetch = async (input, init) => {
    const info = isLessonDetailRequest(input, init);
    const response = await downstreamFetch(input, init);
    if (info) captureLessonResponse(response, info);
    return response;
  };

  function scheduleRender() {
    clearTimeout(captured.renderTimer);
    captured.renderTimer = setTimeout(() => {
      const lessonContent = document.getElementById('lesson-content');
      if (lessonContent?.hidden && captured.renderAttempt < 16) {
        captured.renderAttempt += 1;
        scheduleRender();
        return;
      }
      renderPhase11Resources();
    }, 80);
  }

  function section(id, kicker, title) {
    let node = document.getElementById(id);
    if (node) return node;
    node = document.createElement('section');
    node.id = id;
    node.className = 'phase7-resource-section phase11-resource-section';
    node.hidden = true;
    node.innerHTML = `
      <div class="phase7-section-heading">
        <span class="phase7-kicker">${kicker}</span>
        <h2>${title}</h2>
      </div>
      <div class="phase11-resource-body"></div>
    `;
    return node;
  }

  function ensureSections() {
    const sectionsHost = document.querySelector('#lesson-content .phase7-resource-sections');
    if (!sectionsHost) return null;

    const corePre = section('phase11-core-prelesson-section', 'Before the lesson', 'PreLesson Answer Packs');
    const cumulative = section('phase11-cumulative-section', 'Revision', 'Cumulative Homework');
    const elevenPre = section('phase11-eleven-prelesson-section', '11+ extension', '11+ PreLesson');
    const elevenHomework = section('phase11-eleven-homework-section', '11+ extension', '11+ Homework');
    const elevenCumulative = section('phase11-eleven-cumulative-section', '11+ revision', '11+ Cumulative Homework');
    const additionalAnswers = section('phase11-additional-answers-section', 'Protected resources', 'Additional Answer Packs');

    const preLessonSection = document.getElementById('prelesson-section');
    const homeworkSection = document.getElementById('homework-section');
    const otherSection = document.getElementById('other-section');

    if (!corePre.isConnected) {
      (preLessonSection || sectionsHost.firstElementChild)?.insertAdjacentElement('afterend', corePre);
    }
    if (!cumulative.isConnected) {
      (homeworkSection || sectionsHost.lastElementChild)?.insertAdjacentElement('afterend', cumulative);
    }
    if (!elevenPre.isConnected) sectionsHost.appendChild(elevenPre);
    if (!elevenHomework.isConnected) sectionsHost.appendChild(elevenHomework);
    if (!elevenCumulative.isConnected) sectionsHost.appendChild(elevenCumulative);
    if (!additionalAnswers.isConnected) (otherSection || sectionsHost.lastElementChild)?.insertAdjacentElement('afterend', additionalAnswers);

    return { corePre, cumulative, elevenPre, elevenHomework, elevenCumulative, additionalAnswers };
  }

  function bodyOf(sectionNode) {
    return sectionNode?.querySelector('.phase11-resource-body') || null;
  }

  function resourceAction(resource, label) {
    const action = document.createElement('span');
    action.className = 'phase7-resource-action';

    if (resource?.locked) {
      const chip = document.createElement('span');
      chip.className = 'phase7-locked-chip';
      chip.textContent = '🔒 Locked';
      action.appendChild(chip);
      return action;
    }

    if (resource?.protected) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'phase7-download-button phase11-protected-button';
      button.textContent = resource.available === false ? 'Unavailable' : (label || 'Open');
      button.disabled = resource.available === false || !resource.resourceKey;
      if (!button.disabled) {
        button.addEventListener('click', () => openProtected(resource));
      }
      action.appendChild(button);
      return action;
    }

    if (resource?.available === false || !resource?.resourceKey) {
      const chip = document.createElement('span');
      chip.className = 'phase7-unavailable-chip';
      chip.textContent = 'Unavailable';
      action.appendChild(chip);
      return action;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'phase7-download-button';
    button.textContent = label || 'Download';
    button.addEventListener('click', () => downloadResource(resource));
    action.appendChild(button);
    return action;
  }

  function resourceRow(resource, label) {
    if (!resource) return null;
    const row = document.createElement('div');
    row.className = 'phase7-resource-row';
    const name = document.createElement('span');
    name.className = 'phase7-resource-name';
    name.textContent = resource.displayName || 'Resource';
    row.appendChild(name);
    row.appendChild(resourceAction(resource, label));
    return row;
  }

  function pairCard(pair, primaryLabel, answerLabel) {
    if (!pair?.primary && !pair?.answerPack) return null;
    const card = document.createElement('article');
    card.className = 'phase7-homework-card phase11-pair-card';

    if (pair.primary) {
      const label = document.createElement('div');
      label.className = 'phase9-pair-label';
      label.textContent = primaryLabel;
      card.appendChild(label);
      card.appendChild(resourceRow(pair.primary, 'Download'));
    }

    if (pair.answerPack) {
      const label = document.createElement('div');
      label.className = 'phase9-pair-label phase9-answer-label';
      label.textContent = answerLabel;
      card.appendChild(label);
      card.appendChild(resourceRow(pair.answerPack, 'Open'));
    }

    return card;
  }

  function renderPairs(sectionNode, pairs, primaryLabel, answerLabel, options = {}) {
    const body = bodyOf(sectionNode);
    if (!body) return false;
    body.replaceChildren();
    const list = document.createElement('div');
    list.className = 'phase7-homework-list';

    const existingPreNames = new Set(
      Array.isArray(captured.lesson?.preLessonSheets)
        ? captured.lesson.preLessonSheets.map(item => String(item?.displayName || '').trim().toLowerCase()).filter(Boolean)
        : []
    );

    for (const pair of Array.isArray(pairs) ? pairs : []) {
      if (!pair) continue;
      let renderPair = pair;
      if (options.suppressCorePreLessonDuplicate && pair.primary) {
        const name = String(pair.primary.displayName || '').trim().toLowerCase();
        if (name && existingPreNames.has(name)) {
          renderPair = { ...pair, primary: null };
        }
      }
      const card = pairCard(renderPair, primaryLabel, answerLabel);
      if (card) list.appendChild(card);
    }

    if (!list.children.length) {
      sectionNode.hidden = true;
      return false;
    }

    body.appendChild(list);
    sectionNode.hidden = false;
    return true;
  }

  function renderAnswers(sectionNode, groups) {
    const body = bodyOf(sectionNode);
    if (!body) return false;
    body.replaceChildren();
    const list = document.createElement('div');
    list.className = 'phase7-resource-list';

    for (const group of groups) {
      for (const answer of Array.isArray(group?.answers) ? group.answers : []) {
        const row = resourceRow(answer, 'Open');
        if (!row) continue;
        if (group.label) row.dataset.phase11Group = group.label;
        list.appendChild(row);
      }
    }

    if (!list.children.length) {
      sectionNode.hidden = true;
      return false;
    }
    body.appendChild(list);
    sectionNode.hidden = false;
    return true;
  }

  function ensureVrSupplementaryGroup() {
    const vrBody = document.getElementById('phase9-vr-body');
    if (!vrBody) return null;
    let group = document.getElementById('phase11-vr-supplementary-group');
    if (!group) {
      group = document.createElement('div');
      group.id = 'phase11-vr-supplementary-group';
      group.className = 'phase9-vr-group phase11-vr-supplementary-group';
      group.innerHTML = '<h3 class="phase9-subheading">Additional VR Answer Packs</h3><div class="phase7-resource-list"></div>';
      vrBody.appendChild(group);
    }
    return group;
  }

  function renderVrSupplementary(answers) {
    const group = ensureVrSupplementaryGroup();
    if (!group) return false;
    const list = group.querySelector('.phase7-resource-list');
    list.replaceChildren();
    for (const answer of Array.isArray(answers) ? answers : []) {
      const row = resourceRow(answer, 'Open');
      if (row) list.appendChild(row);
    }
    group.hidden = !list.children.length;
    return Boolean(list.children.length);
  }

  function renderPhase11Resources() {
    const sections = ensureSections();
    if (!sections) return;

    const model = captured.lesson?.phase11Resources || null;
    const hideAll = () => Object.values(sections).forEach(node => { node.hidden = true; });
    if (!model) {
      hideAll();
      const vrGroup = document.getElementById('phase11-vr-supplementary-group');
      if (vrGroup) vrGroup.hidden = true;
      return;
    }

    renderPairs(
      sections.corePre,
      model.corePreLessonPairs,
      'PreLesson Sheet',
      'Answer Pack',
      { suppressCorePreLessonDuplicate: true }
    );
    renderPairs(
      sections.cumulative,
      model.coreCumulativeHomeworks,
      'Cumulative Homework',
      'Answer Pack'
    );

    const eleven = model.elevenPlus || null;
    renderPairs(sections.elevenPre, eleven?.preLessonPairs, '11+ PreLesson Sheet', 'Answer Pack');
    renderPairs(sections.elevenHomework, eleven?.homeworks, '11+ Homework', 'Answer Pack');
    renderPairs(sections.elevenCumulative, eleven?.cumulativeHomeworks, 'Cumulative Homework', 'Answer Pack');

    renderAnswers(sections.additionalAnswers, [
      { label: 'core', answers: model.coreSupplementaryAnswers },
      { label: '11plus', answers: eleven?.supplementaryAnswers }
    ]);
    renderVrSupplementary(model.vrSupplementaryAnswers);
  }

  function openProtected(resource) {
    const api = window.FPT_PHASE9;
    if (!api || typeof api.openProtectedAnswer !== 'function') {
      showMessage('Protected Answer Pack viewer is not available.');
      return;
    }
    api.openProtectedAnswer(resource, captured.viewId);
  }

  async function downloadResource(resource) {
    if (!resource?.resourceKey || !captured.viewId) return;
    try {
      const response = await fetch(
        apiUrl(`/api/v1/student/resources/${encodeURIComponent(resource.resourceKey)}/download?viewId=${encodeURIComponent(captured.viewId)}`),
        { credentials: 'include' }
      );
      if (!response.ok) throw new Error('Download failed.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = resource.displayName || 'resource.pdf';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      showMessage(error?.message || 'Unable to download this resource.');
    }
  }

  function showMessage(message) {
    const holder = document.getElementById('phase7-message');
    if (!holder) return;
    holder.textContent = message;
    holder.hidden = false;
    setTimeout(() => { holder.hidden = true; }, 5000);
  }

  function clearPhase11Resources() {
    captured.lesson = null;
    captured.lessonId = '';
    captured.viewId = '';
    for (const id of [
      'phase11-core-prelesson-section',
      'phase11-cumulative-section',
      'phase11-eleven-prelesson-section',
      'phase11-eleven-homework-section',
      'phase11-eleven-cumulative-section',
      'phase11-additional-answers-section'
    ]) {
      const node = document.getElementById(id);
      if (node) node.hidden = true;
    }
    const vrGroup = document.getElementById('phase11-vr-supplementary-group');
    if (vrGroup) vrGroup.hidden = true;
  }

  document.addEventListener('click', event => {
    if (event.target.closest('#back-to-lessons, #back-to-views, #back-to-subjects, #logout-button')) {
      clearPhase11Resources();
    }
  });

  window.FPT_PHASE11_RESOURCES = Object.assign(window.FPT_PHASE11_RESOURCES || {}, {
    render: renderPhase11Resources,
    clear: clearPhase11Resources
  });
})();
