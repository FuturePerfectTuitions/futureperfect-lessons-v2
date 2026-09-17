import './styles.css';
import logoUrl from '../assets/fpt-logo.png';

const root = document.querySelector('#app');
const config = window.FPT_V2_CONFIG || {};
const API_BASE = String(config.workerBaseUrl || '').replace(/\/$/, '');
const NETWORK_TIMEOUT_MS = Number(config.networkTimeoutMs || 8_000);
const inflight = new Map();
const navControllers = new Map();
let navigationEpoch = 0;

const state = {
  account: null,
  home: null,
  subject: '',
  view: null,
  lessons: [],
  lesson: null,
  lessonResources: [],
  search: '',
  videoLoaded: false,
  viewer: null
};

const apiUrl = path => `${API_BASE}${path}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const enc = value => encodeURIComponent(String(value ?? ''));

function portalOwnerName() {
  return String(state.account?.firstName || state.account?.name || '').trim().split(/\s+/)[0] || '';
}

function portalLabel() {
  const first = portalOwnerName();
  return first ? `${first}'s Portal` : 'Student Portal';
}

function backButton(id, label) {
  return `<div class="back-row"><button id="${escapeHtml(id)}" class="floating-back" type="button" data-back-label="${escapeHtml(label)}" aria-label="Back to ${escapeHtml(label)}"><span class="back-arrow" aria-hidden="true">←</span><span class="back-label">${escapeHtml(label)}</span></button></div>`;
}

const EYE_OPEN = `<svg class="eye-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.8"/></svg>`;
const EYE_CLOSED = `<svg class="eye-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.2A10.4 10.4 0 0 1 12 6c6 0 9.5 6 9.5 6a16.8 16.8 0 0 1-3 3.5M8.2 8.2C5 10 2.5 12 2.5 12s3.5 6 9.5 6a10.6 10.6 0 0 0 3.1-.5M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;

function bindPasswordEye(button, input) {
  if (!button || !input) return;
  button.addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    button.innerHTML = showing ? EYE_OPEN : EYE_CLOSED;
    button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    button.setAttribute('aria-pressed', showing ? 'false' : 'true');
  });
}


function controllerFor(scope) {
  navControllers.get(scope)?.abort();
  const controller = new AbortController();
  navControllers.set(scope, controller);
  return controller;
}

function abortScope(scope) {
  navControllers.get(scope)?.abort();
  navControllers.delete(scope);
}

function requestKey(url, options) {
  return `${String(options?.method || 'GET').toUpperCase()} ${url}`;
}

async function requestJson(path, options = {}) {
  const url = apiUrl(path);
  const method = String(options.method || 'GET').toUpperCase();
  const key = requestKey(url, { method });
  if (method === 'GET' && inflight.has(key)) return inflight.get(key);

  const operation = (async () => {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new DOMException('Request timed out', 'AbortError')), options.timeoutMs || NETWORK_TIMEOUT_MS);
    const signals = [timeout.signal, options.signal].filter(Boolean);
    const controller = new AbortController();
    const abort = signal => { if (!controller.signal.aborted) controller.abort(signal.reason); };
    signals.forEach(signal => signal.addEventListener('abort', () => abort(signal), { once: true }));
    try {
      const headers = new Headers(options.headers || {});
      let body = options.body;
      if (body && typeof body !== 'string') {
        headers.set('content-type', 'application/json');
        body = JSON.stringify(body);
      }
      const response = await fetch(url, {
        method,
        credentials: 'include',
        cache: method === 'GET' ? 'default' : 'no-store',
        headers,
        body,
        signal: controller.signal
      });
      let payload = null;
      try { payload = await response.json(); } catch { payload = {}; }
      if (!response.ok) {
        const error = new Error(payload?.error || `REQUEST_FAILED_${response.status}`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  })();

  if (method === 'GET') inflight.set(key, operation);
  try { return await operation; }
  finally { if (method === 'GET' && inflight.get(key) === operation) inflight.delete(key); }
}

function shell(content, { portal = false } = {}) {
  const label = portalLabel();
  document.title = portal ? `${label} | Future Perfect Tuitions` : 'Student Portal | Future Perfect Tuitions';
  if (!portal) return `<main class="login-layout">${content}</main><footer class="footer">Future Perfect Tuitions · Student Portal</footer>`;
  return `<div class="shell">
    <header class="topbar">
      <a class="brand" href="https://futureperfect.education/" aria-label="Future Perfect Tuitions"><img src="${logoUrl}" alt="Future Perfect Tuitions"></a>
      <div class="topbar-actions"><span class="greeting">${escapeHtml(label)}</span><button id="logout" class="button site-logout" type="button">Log out</button></div>
    </header>
    <main class="main">${content}</main>
    <footer class="footer">Future Perfect Tuitions · ${escapeHtml(label)}</footer>
  </div>`;
}

function bindShell() {
  document.querySelector('#logout')?.addEventListener('click', logout);
}

function renderLogin(message = '') {
  clearLessonMedia();
  root.innerHTML = shell(`<section class="card login-card">
    <img src="${logoUrl}" class="login-logo" alt="Future Perfect Tuitions">
    <p class="eyebrow">Student Portal</p><h1>Student Login</h1>
    <p class="intro">Please enter your username and password to access your Future Perfect Tuitions lesson resources.</p>
    <form id="login-form" class="form">
      <label for="username">Username</label><input id="username" class="field" autocomplete="username" required>
      <label for="password">Password</label><div class="password-wrap"><input id="password" class="field" type="password" maxlength="4" autocomplete="current-password" required><button id="toggle-password" class="password-toggle" type="button" aria-label="Show password" aria-pressed="false">${EYE_OPEN}</button></div>
      <button id="login-submit" class="button button-primary" type="submit">Log in</button>
      <div id="login-error" class="error-box" role="alert" ${message ? '' : 'hidden'}>${escapeHtml(message)}</div>
    </form>
    <p class="security-note">🔒 Future Perfect Tuitions lesson materials are provided for the intended student and must not be shared, copied or distributed.</p>
  </section>`);
  const form = document.querySelector('#login-form');
  const password = document.querySelector('#password');
  bindPasswordEye(document.querySelector('#toggle-password'), password);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = document.querySelector('#login-submit');
    const error = document.querySelector('#login-error');
    button.disabled = true; button.textContent = 'Logging in…'; error.hidden = true;
    try {
      const payload = await requestJson('/api/v2/auth/login', { method: 'POST', body: { username: document.querySelector('#username').value, password: password.value } });
      if (payload.accountLocked) return renderLogin('Your access to Future Perfect Material has now been withdrawn.');
      state.account = payload.account || {};
      await bootstrapHome();
    } catch (err) {
      error.textContent = err.status === 401 ? 'Invalid username or password.' : friendlyError(err);
      error.hidden = false;
    } finally {
      button.disabled = false; button.textContent = 'Log in';
    }
  });
}

function friendlyError(error) {
  if (error?.name === 'AbortError') return 'This is taking longer than expected. Please try again.';
  if (error?.message === 'ACCOUNT_LOCKED') return 'Your access to Future Perfect Material has now been withdrawn.';
  return 'This part of the portal could not be loaded. Please try again.';
}

async function bootstrapHome() {
  const controller = controllerFor('home');
  try {
    const payload = await requestJson('/api/v2/student/home', { signal: controller.signal });
    state.home = payload;
    state.account = payload.account || state.account || {};
    if (payload.accountLocked) return renderLogin('Your access to Future Perfect Material has now been withdrawn.');
    renderSubjects();
  } catch (error) {
    if (error.status === 401) return renderLogin();
    renderPortalError('We could not load your portal.', error, bootstrapHome);
  }
}

function renderPortalError(title, error, retry) {
  root.innerHTML = shell(`<section class="card"><p class="eyebrow">Student Portal</p><h1>${escapeHtml(title)}</h1><div class="error-box" role="alert">${escapeHtml(friendlyError(error))}</div><p><button id="retry" class="button button-primary" type="button">Try again</button></p></section>`, { portal: true });
  bindShell(); document.querySelector('#retry')?.addEventListener('click', retry);
}

function subjectViews(subject) {
  return (state.home?.views || []).filter(view => String(view.subject).toLowerCase() === subject);
}

function renderSubjects() {
  navigationEpoch += 1; abortScope('view'); abortScope('lesson'); clearLessonMedia(); state.subject=''; state.view=null;
  const maths = subjectViews('maths');
  const english = subjectViews('english');
  root.innerHTML = shell(`<section class="card"><p class="eyebrow">${escapeHtml(portalLabel())}</p><h1>Welcome${state.account?.firstName ? `, ${escapeHtml(state.account.firstName)}` : ''}</h1><p class="intro">Choose a subject to continue.</p>
    <div class="subject-grid">
      <button class="choice-card subject-maths" data-subject="maths" type="button"><span><span class="choice-title">Maths</span><span class="choice-meta">${maths.length} year${maths.length===1?'':'s'} / level${maths.length===1?'':'s'}</span></span><span class="choice-arrow">→</span></button>
      <button class="choice-card subject-english" data-subject="english" type="button"><span><span class="choice-title">English</span><span class="choice-meta">${english.length} year${english.length===1?'':'s'} / level${english.length===1?'':'s'}</span></span><span class="choice-arrow">→</span></button>
    </div></section>`, { portal: true });
  bindShell();
  document.querySelectorAll('[data-subject]').forEach(button => button.addEventListener('click', () => renderViews(button.dataset.subject)));
}

function renderViews(subject) {
  navigationEpoch += 1; abortScope('view'); abortScope('lesson'); clearLessonMedia(); state.subject = subject;
  const label = subject === 'maths' ? 'Maths' : 'English';
  const views = subjectViews(subject);
  const groups = [
    ['current', 'Current', views.filter(view => view.group === 'current' || view.current === true)],
    ['previous', 'Previous', views.filter(view => view.group === 'previous' && view.current !== true)]
  ].filter(([, , rows]) => rows.length);
  const sections = groups.map(([, title, rows]) => `<section class="view-section"><h2 class="view-section-title">${title}</h2><div class="view-grid">${rows.map(view => `<button class="view-card ${view.lockedPreview?'locked':''}" type="button" data-view="${escapeHtml(view.viewId)}"><span class="view-label">${view.lockedPreview?'🔒 ':''}${escapeHtml(view.label)}</span><span class="view-count">${Number(view.openLessonCount||0)} open · ${Number(view.lockedLessonCount||0)} locked</span></button>`).join('')}</div></section>`).join('');
  root.innerHTML = shell(`<section class="card">${backButton('back-subjects','Subjects')}<p class="eyebrow">Student Portal</p><h1>${label}</h1><p class="intro">Choose a year or level.</p>${sections || '<div class="empty-state">No years or levels are currently available.</div>'}</section>`, { portal:true });
  bindShell(); document.querySelector('#back-subjects').addEventListener('click', renderSubjects);
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => loadView(button.dataset.view)));
}

async function loadView(viewId) {
  const epoch = ++navigationEpoch;
  abortScope('lesson'); clearLessonMedia();
  const controller = controllerFor('view');
  const view = subjectViews(state.subject).find(item => item.viewId === viewId) || { viewId, label: viewId };
  state.view = view;
  root.innerHTML = shell(`<section class="card">${backButton('back-views', state.subject==='maths'?'Maths':'English')}<p class="eyebrow">${escapeHtml(state.subject)}</p><h1>${escapeHtml(view.label)}</h1><div class="loading-row"><span class="spinner"></span><span>Loading your knowledge bank of lessons…</span></div></section>`, {portal:true});
  bindShell(); document.querySelector('#back-views').addEventListener('click', () => renderViews(state.subject));
  try {
    const payload = await requestJson(`/api/v2/student/views/${enc(viewId)}/lessons`, { signal: controller.signal });
    if (epoch !== navigationEpoch) return;
    state.lessons = payload.lessons || [];
    renderLessonList();
  } catch (error) {
    if (controller.signal.aborted || epoch !== navigationEpoch) return;
    renderViewError(error);
  }
}

function renderViewError(error) {
  root.innerHTML = shell(`<section class="card">${backButton('back-views', state.subject==='maths'?'Maths':'English')}<p class="eyebrow">${escapeHtml(state.subject)}</p><h1>${escapeHtml(state.view?.label||'Lessons')}</h1><div class="error-box" role="alert">${escapeHtml(friendlyError(error))}</div><p><button id="retry-view" class="button button-primary" type="button">Try again</button></p></section>`, {portal:true});
  bindShell(); document.querySelector('#back-views').addEventListener('click', () => renderViews(state.subject)); document.querySelector('#retry-view').addEventListener('click', () => loadView(state.view.viewId));
}

function filteredLessons() {
  const needle = state.search.trim().toLowerCase();
  if (!needle) return state.lessons;
  return state.lessons.filter(row => `${row.displayLessonId||row.lessonId} ${row.title||''} ${row.description||''}`.toLowerCase().includes(needle));
}

function lessonRowHtml(row) {
  return `<article class="lesson-row"><div class="lesson-main"><span class="lesson-code">${escapeHtml(row.displayLessonId||row.lessonId)}</span><div class="lesson-title">${escapeHtml(row.title)}</div></div><button class="button ${row.locked?'lesson-action locked':'button-primary lesson-action'}" type="button" data-lesson="${escapeHtml(row.lessonId)}">${row.locked?'Preview':'Open'}</button></article>`;
}

function isSatsLesson(row) {
  return /^Y6MS\d+$/i.test(String(row.displayLessonId || row.lessonId || '').trim());
}

function lessonRowsHtml(rows) {
  if (!rows.length) return '<div class="empty-state">No lessons match your search.</div>';
  const sats = rows.filter(isSatsLesson);
  if (!sats.length) return rows.map(lessonRowHtml).join('');
  const weekly = rows.filter(row => !isSatsLesson(row));
  const section = (title, intro, items, extra = '') => items.length ? `<section class="lesson-list-section ${extra}"><div class="lesson-list-section-heading"><span></span><div><p class="eyebrow">${escapeHtml(title === 'SATs Practice Papers' ? 'Year 6 revision' : 'Weekly lessons')}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(intro)}</p></div><span></span></div><div class="lesson-list">${items.map(lessonRowHtml).join('')}</div></section>` : '';
  return `${section('Weekly Lessons','Your weekly lessons in chronological order.',weekly)}${section('SATs Practice Papers','SATs papers are grouped together so weekly lessons stay easy to scan.',sats,'sats-list-section')}`;
}

function renderLessonList() {
  const rows = filteredLessons();
  root.innerHTML = shell(`<section class="card portal-card">${backButton('back-views', state.subject==='maths'?'Maths':'English')}<p class="eyebrow">${escapeHtml(portalLabel())}</p><h1>${escapeHtml(state.view?.label||'Lessons')}</h1><p class="intro">Your lessons are shown in chronological order.</p>
    <div class="search-wrap"><label for="lesson-search">Search lessons</label><input id="lesson-search" class="field" type="search" placeholder="Search by lesson ID, title or topic" value="${escapeHtml(state.search)}"></div>
    <div class="lesson-list-wrap">${lessonRowsHtml(rows)}</div></section>`, {portal:true});
  bindShell();
  document.querySelector('#back-views').addEventListener('click', () => renderViews(state.subject));
  const search = document.querySelector('#lesson-search');
  search.addEventListener('input', () => { state.search = search.value; renderLessonList(); document.querySelector('#lesson-search')?.focus(); });
  document.querySelectorAll('[data-lesson]').forEach(button => button.addEventListener('click', () => loadLesson(button.dataset.lesson)));
}

async function loadLesson(lessonId) {
  const epoch = ++navigationEpoch; abortScope('view'); clearLessonMedia();
  const controller = controllerFor('lesson');
  root.innerHTML = shell(`<section class="card">${backButton('back-lessons','Lessons')}<div class="loading-row"><span class="spinner"></span><span>Loading lesson…</span></div></section>`, {portal:true});
  bindShell(); document.querySelector('#back-lessons').addEventListener('click', renderLessonList);
  try {
    const payload = await requestJson(`/api/v2/student/lessons/${enc(lessonId)}?viewId=${enc(state.view.viewId)}`, { signal: controller.signal });
    if (epoch !== navigationEpoch) return;
    state.lesson = payload.lesson; state.lessonResources = payload.resources || []; state.videoLoaded = false;
    renderLesson(payload);
  } catch (error) {
    if (controller.signal.aborted || epoch !== navigationEpoch) return;
    root.innerHTML = shell(`<section class="card">${backButton('back-lessons','Lessons')}<div class="error-box" role="alert">${escapeHtml(friendlyError(error))}</div><p><button id="retry-lesson" class="button button-primary" type="button">Try again</button></p></section>`, {portal:true});
    bindShell(); document.querySelector('#back-lessons').addEventListener('click', renderLessonList); document.querySelector('#retry-lesson').addEventListener('click', () => loadLesson(lessonId));
  }
}

function resourceOpenPath(resource) {
  return `/api/v2/student/lessons/${enc(state.lesson.lessonId)}/resources/${enc(resource.resourceId)}/open?viewId=${enc(state.view.viewId)}`;
}

function resourceScopes(resource) {
  const raw = Array.isArray(resource?.presentationScopes) ? resource.presentationScopes : [];
  const scopes = [...new Set(raw.map(value => String(value || '').trim()).filter(Boolean))];
  return scopes.length ? scopes : ['core'];
}

function resourceScope(resource) {
  const scopes = resourceScopes(resource);
  if (scopes.includes('vr')) return 'vr';
  if (scopes.includes('elevenPlus')) return 'elevenPlus';
  return 'core';
}

function fallbackResourceGroup(resource, previous = null) {
  const scope = resourceScope(resource);
  const prefix = scope === 'elevenPlus' ? 'elevenplus' : scope;
  const type = String(resource?.type || '').trim();
  if (type === 'answer-pack' && previous && resourceScope(previous) === scope) {
    const previousType = String(previous.type || '').trim();
    if (['prelesson','homework','cumulative-homework'].includes(previousType)) {
      return fallbackResourceGroup(previous);
    }
  }
  if (type === 'prelesson') return `${prefix}-prelesson`;
  if (type === 'homework') return `${prefix}-homework`;
  if (type === 'cumulative-homework') return `${prefix}-cumulative`;
  if (type === 'answer-pack') return `${prefix}-answers`;
  return scope === 'core' ? 'core-other' : `${prefix}-other`;
}

function groupLessonResources(resources) {
  const groups = new Map();
  let previous = null;
  for (const resource of resources.filter(row => row.type !== 'video')) {
    const explicit = String(resource.presentationGroup || '').trim();
    const group = explicit || fallbackResourceGroup(resource, previous);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(resource);
    previous = resource;
  }
  return groups;
}

function resourceRow(resource) {
  const kind = resource.type === 'prelesson' ? 'PreLesson Sheet'
    : resource.type === 'homework' ? 'Homework'
    : resource.type === 'cumulative-homework' ? 'Cumulative Homework'
    : resource.type === 'answer-pack' ? 'Answer Pack'
    : 'Resource';
  if (resource.type === 'answer-pack' || resource.protected) {
    return `<div class="resource-row"><div><span class="resource-name">${escapeHtml(resource.displayName||kind)}</span><span class="resource-kind">Protected Answer Pack</span></div><button class="button button-secondary" type="button" data-answer="${escapeHtml(resource.resourceId)}">Open</button></div>`;
  }
  return `<div class="resource-row"><div><span class="resource-name">${escapeHtml(resource.displayName||kind)}</span><span class="resource-kind">${kind}</span></div><a class="button button-secondary resource-link" href="${escapeHtml(apiUrl(resourceOpenPath(resource)))}" target="_blank" rel="noopener" data-direct-resource="${escapeHtml(resource.resourceId)}">Open</a></div>`;
}

function resourceList(items) {
  return items?.length ? `<div class="resource-list">${items.map(resourceRow).join('')}</div>` : '';
}

function collapsibleResourceSection(id, kicker, title, body) {
  if (!body) return '';
  const bodyId = `${id}-body`;
  return `<section class="resource-section resource-section-collapsible" data-resource-section="${escapeHtml(id)}">
    <div class="resource-section-heading">
      <div><p class="eyebrow">${escapeHtml(kicker)}</p><h2>${escapeHtml(title)}</h2></div>
      <button class="resource-collapse-toggle" type="button" data-resource-toggle="${escapeHtml(bodyId)}" aria-controls="${escapeHtml(bodyId)}" aria-expanded="false">View</button>
    </div>
    <div id="${escapeHtml(bodyId)}" class="resource-collapse-body" hidden>${body}</div>
  </section>`;
}

function resourceSubgroup(title, items) {
  if (!items?.length) return '';
  return `<section class="resource-subgroup"><h3 class="resource-subheading">${escapeHtml(title)}</h3>${resourceList(items)}</section>`;
}

function bindResourceCollapses() {
  document.querySelectorAll('[data-resource-toggle]').forEach(button => {
    button.addEventListener('click', () => {
      const body = document.getElementById(button.dataset.resourceToggle);
      if (!body) return;
      const opening = body.hidden;
      body.hidden = !opening;
      button.textContent = opening ? 'Hide' : 'View';
      button.setAttribute('aria-expanded', opening ? 'true' : 'false');
    });
  });
}

function renderLesson(payload) {
  const lesson = payload.lesson || {};
  const resources = payload.resources || [];
  const video = resources.find(row => row.type === 'video');
  const groups = groupLessonResources(resources);
  const take = key => groups.get(key) || [];
  const locked = !payload.resourcesIncluded || lesson.locked;
  const statusPill = locked ? '<span class="state-pill locked-pill">🔒 Preview</span>' : lesson.accessMode === 'prelesson-only' ? '<span class="state-pill">PreLesson only</span>' : '';
  const description = String(lesson.description || '').trim();
  const descriptionBlock = description ? `<section class="lesson-description-block"><div class="lesson-description-heading"><p class="eyebrow">Lesson overview</p><button id="lesson-description-toggle" class="details-toggle" type="button" aria-controls="lesson-description-body" aria-expanded="false">Details</button></div><div id="lesson-description-body" class="lesson-description-body" hidden><p>${escapeHtml(description)}</p></div></section>` : '';

  const vrBody = [
    resourceSubgroup('VR PreLesson', take('vr-prelesson')),
    resourceSubgroup('VR Homework', take('vr-homework')),
    resourceSubgroup('Additional VR Answer Packs', take('vr-answers')),
    resourceSubgroup('Other VR Resources', take('vr-other'))
  ].filter(Boolean).join('');

  root.innerHTML = shell(`<section class="card portal-card">${backButton('back-lessons','Lessons')}
    <div class="lesson-heading"><div><span class="lesson-code">${escapeHtml(lesson.displayLessonId||lesson.lessonId)}</span><h1>${escapeHtml(lesson.title)}</h1></div>${statusPill}</div>
    ${descriptionBlock}
    ${locked?'<div class="notice">This lesson is visible as a preview. Resources remain locked until they are released to you.</div>':''}
    <div class="resource-sections">
      ${collapsibleResourceSection('core-prelesson','Before the lesson','PreLesson Sheets',resourceList(take('core-prelesson')))}
      ${video ? `<section class="resource-section video-section"><div class="resource-section-heading"><div><p class="eyebrow">Main lesson</p><h2>Lesson Video</h2></div><button id="video-toggle" class="resource-collapse-toggle" type="button" aria-controls="player-frame" aria-expanded="false">View</button></div><div id="player-frame" class="player-frame" hidden><iframe id="lesson-player" title="Lesson video" allow="fullscreen" allowfullscreen></iframe></div></section>` : ''}
      ${collapsibleResourceSection('core-homework','After the lesson','Homework',resourceList(take('core-homework')))}
      ${collapsibleResourceSection('core-cumulative','Revision','Cumulative Homework',resourceList(take('core-cumulative')))}
      ${collapsibleResourceSection('elevenplus-prelesson','11+ extension','11+ PreLesson',resourceList(take('elevenplus-prelesson')))}
      ${collapsibleResourceSection('elevenplus-homework','11+ extension','11+ Homework',resourceList(take('elevenplus-homework')))}
      ${collapsibleResourceSection('elevenplus-cumulative','11+ revision','11+ Cumulative Homework',resourceList(take('elevenplus-cumulative')))}
      ${collapsibleResourceSection('verbal-reasoning','11+ English extension','Verbal Reasoning',vrBody)}
      ${collapsibleResourceSection('core-answers','Protected resources','Additional Answer Packs',resourceList(take('core-answers')))}
      ${collapsibleResourceSection('elevenplus-answers','Protected resources','Additional 11+ Answer Packs',resourceList(take('elevenplus-answers')))}
      ${collapsibleResourceSection('core-other','Extra material','Other Resources',resourceList(take('core-other')))}
      ${collapsibleResourceSection('elevenplus-other','11+ extra material','Other 11+ Resources',resourceList(take('elevenplus-other')))}
      ${(!locked && !resources.length)?'<div class="empty-state">No lesson resources are currently available.</div>':''}
    </div></section>`, {portal:true});
  bindShell();
  bindResourceCollapses();
  document.querySelector('#back-lessons').addEventListener('click', () => { clearLessonMedia(); renderLessonList(); });
  const detailsButton = document.querySelector('#lesson-description-toggle');
  detailsButton?.addEventListener('click', () => {
    const body = document.querySelector('#lesson-description-body');
    const opening = body?.hidden === true;
    if (!body) return;
    body.hidden = !opening;
    detailsButton.textContent = opening ? 'Hide' : 'Details';
    detailsButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
  });
  document.querySelector('#video-toggle')?.addEventListener('click', () => toggleVideo(video));
  document.querySelectorAll('[data-answer]').forEach(button => button.addEventListener('click', () => openAnswerPack(resources.find(r => r.resourceId === button.dataset.answer))));
}

function toggleVideo(video) {
  const frame = document.querySelector('#player-frame');
  const player = document.querySelector('#lesson-player');
  const button = document.querySelector('#video-toggle');
  if (!frame || !player || !button) return;
  if (!state.videoLoaded) {
    player.src = apiUrl(resourceOpenPath(video));
    state.videoLoaded = true;
    frame.hidden = false; button.textContent = 'Hide'; button.setAttribute('aria-expanded', 'true');
    return;
  }
  frame.hidden = !frame.hidden; button.textContent = frame.hidden ? 'View' : 'Hide'; button.setAttribute('aria-expanded', frame.hidden ? 'false' : 'true');
}

function clearLessonMedia() {
  const player = document.querySelector('#lesson-player');
  if (player) player.removeAttribute('src');
  state.videoLoaded = false;
  state.viewer?.close?.(); state.viewer = null;
}

async function openAnswerPack(resource) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="answer-password-title"><div class="modal-head"><div><p class="eyebrow">Protected resource</p><h2 id="answer-password-title">Open Answer Pack</h2></div><button class="icon-button" type="button" data-close aria-label="Close">×</button></div><p class="intro">Enter the Answer Pack password. The password is checked every time you open an Answer Pack.</p><form id="answer-form" class="form"><label for="answer-password">Answer Pack password</label><div class="password-wrap"><input id="answer-password" class="field" type="password" maxlength="4" autocomplete="off" required><button id="answer-toggle-password" class="password-toggle" type="button" aria-label="Show password" aria-pressed="false">${EYE_OPEN}</button></div><button id="answer-submit" class="button button-primary" type="submit">Open Answer Pack</button><div id="answer-error" class="error-box" hidden role="alert"></div></form></section>`;
  const close = () => backdrop.remove(); backdrop.querySelector('[data-close]').addEventListener('click', close); backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); }); document.body.append(backdrop);
  bindPasswordEye(backdrop.querySelector('#answer-toggle-password'), backdrop.querySelector('#answer-password'));
  backdrop.querySelector('#answer-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = backdrop.querySelector('#answer-submit'); const error = backdrop.querySelector('#answer-error'); button.disabled = true; button.textContent='Checking…'; error.hidden=true;
    try {
      const payload = await requestJson(resourceOpenPath(resource), { method:'POST', body:{ password:backdrop.querySelector('#answer-password').value } });
      close();
      const viewerModule = await import('./protected-viewer.js');
      state.viewer = await viewerModule.openProtectedViewer({ url:apiUrl(payload.viewerUrl), title:resource.displayName || 'Answer Pack', watermark:`Future Perfect Tuitions · ${state.account?.firstName||'Student'}`, onClose:()=>{state.viewer=null;} });
    } catch (err) {
      if (err.status === 429) error.textContent = 'Too many incorrect attempts. Please try again shortly.';
      else if (err.status === 401) error.textContent = 'Incorrect Answer Pack password.';
      else error.textContent = friendlyError(err);
      error.hidden=false;
    } finally { button.disabled=false; button.textContent='Open Answer Pack'; }
  });
}

async function logout() {
  clearLessonMedia(); for (const controller of navControllers.values()) controller.abort();
  navControllers.clear();
  try { await requestJson('/api/v2/auth/logout', { method:'POST', body:{} }); } catch {}
  state.account=null; state.home=null; state.subject=''; state.view=null; state.lessons=[]; state.lesson=null; renderLogin();
}

async function start() {
  root.innerHTML = `<main class="login-layout"><div class="loading-row"><span class="spinner"></span><span>Loading your portal…</span></div></main>`;
  try { await bootstrapHome(); } catch { renderLogin(); }
}

start();
