import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import {
  WORKER_BASE,
  PORTAL_URL,
  assertWorkerSafety,
  assertExactBaseline,
  insertNavigationFixtures,
  cleanupNavigationFixtures,
  cleanupControlledSessions,
  revokeExistingControlledSessions,
  activeControlledSessions,
  ageSessionByHash,
  revokeSessionByHash,
  deleteAnswerRateLimit,
  sessionStateByHash,
  tokenHash,
  randomFourCharacterPassword,
  kvGetJson,
  kvPutJson,
  curriculumLessonIds,
  waitForKvProfile,
  isoNow,
  safeEvidence
} from './phase16-runtime.mjs';

const OUT = path.resolve('artifacts/phase16');
const TEST_START = isoNow();
const SHARED_LOGIN = 'Te12'; // committed development-only TestY fixture credential
const evidence = {
  phase: 16,
  testStart: TEST_START,
  portalUrl: PORTAL_URL,
  worker: WORKER_BASE,
  browsers: {},
  navigation: {},
  resources: {},
  sessions: {},
  performanceMs: {},
  physicalPlatforms: {
    androidChrome: 'NOT_CONFIRMED',
    macOSSafari: 'NOT_CONFIRMED',
    iPadSafari: 'NOT_CONFIRMED'
  },
  screenPal: {
    ordinaryPlayback: 'NOT_CONFIRMED',
    ordinaryFullscreen: 'NOT_CONFIRMED',
    elevenPlusPlayback: 'NOT_CONFIRMED',
    elevenPlusFullscreen: 'NOT_CONFIRMED'
  }
};

await fs.mkdir(OUT, { recursive: true });

let chrome = null;
let ff = null;
let wk = null;
let settings = null;
let testY5EOriginal = null;
let testY5EMOriginal = null;
let testY5EMAnswerMutated = false;
let testY5EHistoryMutated = false;

function ms(start) {
  return Math.round((performance.now() - start) * 10) / 10;
}

function assertNoRawR2(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const forbidden of ['fpt-materials-dev', 'r2.cloudflarestorage', 'r2.dev', 'amazonaws.com', '"r2Key"', '"r2"']) {
    assert.equal(text.includes(forbidden), false, `${label} leaked raw R2/gated reference text: ${forbidden}`);
  }
}

function recursiveKeys(value, out = new Set()) {
  if (Array.isArray(value)) {
    value.forEach(item => recursiveKeys(item, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      out.add(key);
      recursiveKeys(item, out);
    }
  }
  return out;
}

function assertLockedPayloadSafe(body) {
  const keys = recursiveKeys(body);
  for (const key of ['resourceKey', 'r2Key', 'r2', 'url', 'embedUrl', 'screenpal', 'sp', 'quizId', 'quiz_id']) {
    assert.equal(keys.has(key), false, `Locked preview payload exposed gated key ${key}.`);
  }
  assertNoRawR2(body, 'locked preview');
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});
}

function browserContextOptions(viewport, { mobile = false } = {}) {
  return {
    viewport,
    screen: viewport,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'en-GB',
    timezoneId: 'Europe/London'
  };
}

async function pageApi(page, route, options = {}) {
  return page.evaluate(async ({ base, route, options }) => {
    const response = await fetch(`${base}${route}`, {
      method: options.method || 'GET',
      headers: {
        Accept: options.accept || 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      credentials: 'include',
      cache: 'no-store',
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const type = response.headers.get('content-type') || '';
    let body = null;
    if (type.includes('application/json')) {
      try { body = await response.json(); } catch (_) {}
    } else {
      const buffer = await response.arrayBuffer();
      body = { byteLength: buffer.byteLength, contentType: type };
    }
    return { status: response.status, ok: response.ok, body, url: response.url };
  }, { base: WORKER_BASE, route, options });
}

async function sessionCookie(context) {
  const cookies = await context.cookies(WORKER_BASE);
  const cookie = cookies.find(item => item.name === 'fpt_v2_session');
  assert.ok(cookie?.value, 'Expected secure opaque session cookie.');
  assert.equal(cookie.httpOnly, true, 'Session cookie must be HttpOnly.');
  assert.equal(cookie.secure, true, 'Session cookie must be Secure.');
  return cookie;
}

async function assertNoHorizontalOverflow(page, label) {
  const state = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body?.scrollWidth || 0
  }));
  assert.ok(state.scrollWidth <= state.innerWidth + 2, `${label}: document horizontally overflows (${state.scrollWidth} > ${state.innerWidth}).`);
  assert.ok(state.bodyWidth <= state.innerWidth + 2, `${label}: body horizontally overflows (${state.bodyWidth} > ${state.innerWidth}).`);
}

async function login(page, username = 'TestY5EM', password = SHARED_LOGIN) {
  const start = performance.now();
  await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#login-screen').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.locator('#login-button').click();
  await page.locator('#portal-screen').waitFor({ state: 'visible', timeout: 60000 });
  await page.locator('#screen-subjects').waitFor({ state: 'visible', timeout: 30000 });
  const session = await pageApi(page, '/api/v1/student/session');
  assert.equal(session.status, 200, `Login session was not accepted for controlled persona ${username}.`);
  evidence.performanceMs[`login-${username}-${Object.keys(evidence.performanceMs).length}`] = ms(start);
  return session.body;
}

async function loginWithEyeCheck(page, username = 'TestY5EM') {
  await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#login-screen').waitFor({ state: 'visible', timeout: 30000 });
  const input = page.locator('#login-password');
  const eye = page.locator('#toggle-login-password');
  assert.equal(await input.getAttribute('type'), 'password');
  assert.equal(await eye.getAttribute('aria-label'), 'Show password');
  await input.fill(SHARED_LOGIN);
  await eye.click();
  assert.equal(await input.getAttribute('type'), 'text');
  assert.equal(await eye.getAttribute('aria-label'), 'Hide password');
  assert.equal(await eye.getAttribute('aria-pressed'), 'true');
  await eye.click();
  assert.equal(await input.getAttribute('type'), 'password');
  assert.equal(await eye.getAttribute('aria-label'), 'Show password');
  assert.equal(await eye.getAttribute('aria-pressed'), 'false');
  await page.locator('#username').fill(username);
  await page.locator('#login-button').click();
  await page.locator('#portal-screen').waitFor({ state: 'visible', timeout: 60000 });
  const session = await pageApi(page, '/api/v1/student/session');
  assert.equal(session.status, 200);
  evidence.navigation.loginPasswordEye = 'PASS';
}

async function openSubject(page, subject) {
  const start = performance.now();
  await page.locator(subject === 'maths' ? '#maths-choice' : '#english-choice').click();
  await page.locator('#screen-views').waitFor({ state: 'visible', timeout: 30000 });
  evidence.performanceMs[`subject-${subject}-${Object.keys(evidence.performanceMs).length}`] = ms(start);
}

async function openView(page, label) {
  const start = performance.now();
  const button = page.locator('#view-grid').getByRole('button', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
  await button.waitFor({ state: 'visible', timeout: 30000 });
  const responsePromise = page.waitForResponse(response => response.request().method() === 'GET' && response.url().includes('/api/v1/student/views/') && response.url().endsWith('/lessons'), { timeout: 60000 });
  await button.click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, `View lesson list failed for ${label}.`);
  await page.locator('#screen-lessons').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#lesson-list .phase6-lesson-row').first().waitFor({ state: 'visible', timeout: 60000 });
  evidence.performanceMs[`view-${label}-${Object.keys(evidence.performanceMs).length}`] = ms(start);
}

async function getViewLessons(page, viewId) {
  const response = await pageApi(page, `/api/v1/student/views/${encodeURIComponent(viewId)}/lessons`);
  assert.equal(response.status, 200, `Could not load view ${viewId}.`);
  assert.equal(response.body?.ok, true);
  return response.body;
}

async function getLessonDetail(page, viewId, lessonId) {
  const response = await pageApi(page, `/api/v1/student/lessons/${encodeURIComponent(lessonId)}?viewId=${encodeURIComponent(viewId)}`);
  assert.equal(response.status, 200, `Could not load lesson ${lessonId} in ${viewId}.`);
  assert.equal(response.body?.ok, true);
  return response.body;
}

async function findLesson(page, viewId, predicate) {
  const list = await getViewLessons(page, viewId);
  for (const item of list.lessons || []) {
    if (item.locked) continue;
    const detail = await getLessonDetail(page, viewId, item.lessonId);
    if (predicate(detail.lesson, detail)) return { list, item, detail };
  }
  return null;
}

async function openLessonByActualId(page, viewId, lessonId) {
  const list = await getViewLessons(page, viewId);
  const index = (list.lessons || []).findIndex(item => item.lessonId === lessonId);
  assert.ok(index >= 0, `Lesson ${lessonId} not present in ${viewId}.`);
  const row = page.locator('#lesson-list .phase6-lesson-row').nth(index);
  await row.scrollIntoViewIfNeeded();
  const start = performance.now();
  const responsePromise = page.waitForResponse(response => response.request().method() === 'GET' && response.url().includes(`/api/v1/student/lessons/${encodeURIComponent(lessonId)}`), { timeout: 60000 });
  await row.click();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  await page.locator('#screen-lesson').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#lesson-content').waitFor({ state: 'visible', timeout: 30000 });
  evidence.performanceMs[`lesson-${viewId}-${Object.keys(evidence.performanceMs).length}`] = ms(start);
  return response;
}

async function assertLongListAndBack(page, viewLabel, expectedCount) {
  const rows = page.locator('#lesson-list .phase6-lesson-row');
  assert.equal(await rows.count(), expectedCount, `${viewLabel}: unexpected canonical lesson count.`);
  const last = rows.last();
  await last.scrollIntoViewIfNeeded();
  assert.equal(await last.isVisible(), true, `${viewLabel}: final lesson was not reachable by scrolling.`);
  const finalCode = await last.locator('.phase6-lesson-code').textContent();
  assert.ok(String(finalCode || '').trim(), `${viewLabel}: final lesson has no display code.`);
  await page.locator('#lesson-search').fill(String(finalCode).trim());
  assert.equal(await rows.count(), 1, `${viewLabel}: search did not narrow to the requested lesson.`);
  await page.locator('#lesson-search').fill('');
  assert.equal(await rows.count(), expectedCount, `${viewLabel}: clearing search did not restore full list.`);
  await last.click();
  await page.locator('#screen-lesson').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#back-to-lessons').click();
  await page.locator('#screen-lessons').waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(await page.locator('#lesson-list .phase6-lesson-row').count(), expectedCount);
  await page.locator('#back-to-views').click();
  await page.locator('#screen-views').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#back-to-subjects').click();
  await page.locator('#screen-subjects').waitFor({ state: 'visible', timeout: 30000 });
}

async function clickResourceAndAssert(page, row, resourceKey, label) {
  const button = row.locator('button').last();
  await button.waitFor({ state: 'visible', timeout: 30000 });
  const responsePromise = page.waitForResponse(response => {
    try {
      return response.request().method() === 'GET' && response.url().includes(`/api/v1/student/resources/${encodeURIComponent(resourceKey)}`);
    } catch (_) { return false; }
  }, { timeout: 60000 });
  const start = performance.now();
  await button.click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, `${label} resource request did not succeed.`);
  assert.ok(response.url().startsWith(WORKER_BASE), `${label} bypassed the authenticated Worker resource route.`);
  assertNoRawR2(response.url(), `${label} request URL`);
  const bytes = await response.body();
  assert.ok(bytes.length > 0, `${label} returned an empty resource.`);
  evidence.performanceMs[`resource-${label}-${Object.keys(evidence.performanceMs).length}`] = ms(start);
  return { bytes: bytes.length, contentType: response.headers()['content-type'] || '', urlPath: new URL(response.url()).pathname };
}

async function testDownloadsAndProtected(page, context) {
  await openSubject(page, 'maths');
  await openView(page, 'Year 5');
  const viewId = 'maths-year5';
  const resourceLesson = await findLesson(page, viewId, lesson => {
    const pre = (lesson.preLessonSheets || []).some(r => !r.locked && r.available !== false && r.resourceKey);
    const hw = (lesson.homeworks || []).some(pair => pair?.homework && !pair.homework.locked && pair.homework.available !== false && pair.homework.resourceKey);
    const ans = (lesson.homeworks || []).some(pair => pair?.answerPack?.protected && pair.answerPack.resourceKey);
    return pre && hw && ans;
  });
  assert.ok(resourceLesson, 'Could not dynamically discover an unlocked Maths lesson with PreLesson, Homework and protected answer resources.');
  const lesson = resourceLesson.detail.lesson;
  assertNoRawR2(resourceLesson.detail, 'unlocked lesson detail');
  await openLessonByActualId(page, viewId, resourceLesson.item.lessonId);

  const pre = (lesson.preLessonSheets || []).find(r => !r.locked && r.available !== false && r.resourceKey);
  const hw = (lesson.homeworks || []).map(pair => pair?.homework).find(r => r && !r.locked && r.available !== false && r.resourceKey);
  const answer = (lesson.homeworks || []).map(pair => pair?.answerPack).find(r => r?.protected && r.resourceKey);
  assert.ok(pre && hw && answer);

  const preRows = page.locator('#prelesson-list .phase7-resource-row');
  const preIndex = (lesson.preLessonSheets || []).findIndex(r => r.resourceKey === pre.resourceKey);
  evidence.resources.preLesson = await clickResourceAndAssert(page, preRows.nth(preIndex), pre.resourceKey, 'PreLesson');

  const homeworkCards = page.locator('#homework-list .phase7-homework-card');
  let homeworkRow = null;
  let answerRow = null;
  for (let i = 0; i < await homeworkCards.count(); i += 1) {
    const card = homeworkCards.nth(i);
    const names = await card.locator('.phase7-resource-name').allTextContents();
    const pair = (lesson.homeworks || [])[i] || {};
    if (pair.homework?.resourceKey === hw.resourceKey) homeworkRow = card.locator('.phase7-resource-row').first();
    if (pair.answerPack?.resourceKey === answer.resourceKey) answerRow = card.locator('.phase7-resource-row').filter({ has: card.locator('.phase7-protected-chip') }).first();
    void names;
  }
  assert.ok(homeworkRow, 'Homework UI row was not found for the dynamically discovered resource.');
  evidence.resources.homework = await clickResourceAndAssert(page, homeworkRow, hw.resourceKey, 'Homework');

  // Protected-answer browser UI: hidden password, eye, valid open, PDF.js render, close/re-open.
  answerRow = page.locator('#homework-list .phase7-resource-row').filter({ has: page.locator('.phase7-protected-chip') }).first();
  const answerButton = answerRow.locator('button').last();
  await answerButton.waitFor({ state: 'visible', timeout: 30000 });
  await answerButton.click();
  const modal = page.locator('#phase8-answer-modal');
  await modal.waitFor({ state: 'visible', timeout: 10000 });
  const password = page.locator('#phase8-answer-password');
  const eye = page.locator('#phase8-answer-eye');
  assert.equal(await password.getAttribute('type'), 'password');
  assert.equal(await eye.getAttribute('aria-label'), 'Show password');
  await eye.click();
  assert.equal(await password.getAttribute('type'), 'text');
  assert.equal(await eye.getAttribute('aria-label'), 'Hide password');
  await eye.click();
  assert.equal(await password.getAttribute('type'), 'password');

  const currentProfile = await kvGetJson(settings.studentsKv, 'user:testy5em');
  const answerPassword = String(currentProfile.answerPassword || '');
  assert.equal(answerPassword.length, 4, 'Controlled TestY answer password is not four characters.');
  const authorizeResponsePromise = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/answer/authorize?viewId='), { timeout: 30000 });
  await password.fill(answerPassword);
  const protectedStart = performance.now();
  await page.locator('#phase8-answer-open').click();
  const authorizeResponse = await authorizeResponsePromise;
  assert.equal(authorizeResponse.status(), 200);
  const authBody = await authorizeResponse.json();
  assert.equal(authBody.ok, true);
  assert.equal(typeof authBody.viewerPath, 'string');
  assert.equal(Object.prototype.hasOwnProperty.call(authBody, 'r2Key'), false, 'Protected answer authorization leaked r2Key.');
  assertNoRawR2(authBody, 'protected answer authorization');
  await page.locator('#phase8-answer-viewer').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#phase8-answer-pages canvas').first().waitFor({ state: 'visible', timeout: 60000 });
  assert.ok(await page.locator('#phase8-answer-pages canvas').count() >= 1, 'Protected Answer Pack viewer rendered no pages.');
  assert.equal(await page.locator('#phase8-answer-viewer a[download], #phase8-answer-viewer button').count(), 0, 'Protected viewer unexpectedly provides download/print controls.');
  assertNoRawR2(await page.locator('body').innerHTML(), 'protected answer DOM');
  evidence.performanceMs.protectedAnswerOpenRender = ms(protectedStart);
  evidence.resources.protectedAnswerUi = 'PASS';

  await page.locator('#phase8-answer-close').click();
  await modal.waitFor({ state: 'hidden', timeout: 10000 });
  await answerButton.click();
  await modal.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await password.inputValue(), '', 'Protected-answer password was remembered across opens.');
  assert.equal(await password.getAttribute('type'), 'password');
  assert.equal(await page.locator('#phase8-answer-prompt').isVisible(), true, 'Per-open Answer Pack password prompt was not restored.');
  evidence.resources.protectedAnswerPerOpen = 'PASS';
  await page.locator('#phase8-answer-close').click();

  // Issue a fresh viewer capability to prove Answer Pack password change invalidates it.
  await answerButton.click();
  await password.fill(answerPassword);
  const auth2Promise = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/answer/authorize?viewId='), { timeout: 30000 });
  await page.locator('#phase8-answer-open').click();
  const auth2 = await auth2Promise;
  assert.equal(auth2.status(), 200);
  const auth2Body = await auth2.json();
  const oldViewerPath = String(auth2Body.viewerPath || '');
  assert.ok(oldViewerPath.startsWith('/api/v1/student/answer-view/'));
  await page.locator('#phase8-answer-pages canvas').first().waitFor({ state: 'visible', timeout: 60000 });

  const cookie = await sessionCookie(context);
  const hash = tokenHash(cookie.value);
  const altAnswer = randomFourCharacterPassword();
  testY5EMOriginal = currentProfile;
  const changed = structuredClone(currentProfile);
  changed.answerPassword = altAnswer;
  testY5EMAnswerMutated = true;
  await kvPutJson(settings.studentsKv, 'user:testy5em', changed);
  await waitForKvProfile(settings.studentsKv, 'user:testy5em', profile => profile.answerPassword === altAnswer);

  const authPath = `/api/v1/student/resources/${encodeURIComponent(answer.resourceKey)}/answer/authorize?viewId=${encodeURIComponent(viewId)}`;
  let edgeReady = false;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const probe = await pageApi(page, authPath, { method: 'POST', body: { password: altAnswer } });
    if (probe.status === 200 && probe.body?.ok === true) {
      edgeReady = true;
      break;
    }
    if (probe.status === 403 && probe.body?.error === 'ANSWER_PASSWORD_INCORRECT') {
      deleteAnswerRateLimit(hash);
      await new Promise(resolve => setTimeout(resolve, 4000));
      continue;
    }
    throw new Error(`Unexpected answer-password propagation probe status ${probe.status}.`);
  }
  assert.equal(edgeReady, true, 'Changed controlled Answer Pack password did not reach the Worker edge in time.');
  const oldViewer = await pageApi(page, `${oldViewerPath}?status=1`);
  assert.ok([401, 410].includes(oldViewer.status), `Old protected viewer remained valid after Answer Pack password change (${oldViewer.status}).`);
  evidence.resources.protectedAnswerPasswordInvalidation = 'PASS';

  // Exact KV restore and propagation proof.
  await kvPutJson(settings.studentsKv, 'user:testy5em', testY5EMOriginal);
  testY5EMAnswerMutated = false;
  await waitForKvProfile(settings.studentsKv, 'user:testy5em', profile => profile.answerPassword === answerPassword);
  let restored = false;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const probe = await pageApi(page, authPath, { method: 'POST', body: { password: answerPassword } });
    if (probe.status === 200 && probe.body?.ok === true) {
      restored = true;
      break;
    }
    if (probe.status === 403 && probe.body?.error === 'ANSWER_PASSWORD_INCORRECT') {
      deleteAnswerRateLimit(hash);
      await new Promise(resolve => setTimeout(resolve, 4000));
      continue;
    }
    throw new Error(`Unexpected restored answer-password probe status ${probe.status}.`);
  }
  assert.equal(restored, true, 'Original controlled Answer Pack password did not restore at the Worker edge.');

  // Fresh protected capability must be invalidated by session revocation.
  const auth3 = await pageApi(page, authPath, { method: 'POST', body: { password: answerPassword } });
  assert.equal(auth3.status, 200);
  const viewer3 = String(auth3.body?.viewerPath || '');
  assert.ok(viewer3.startsWith('/api/v1/student/answer-view/'));
  revokeSessionByHash(hash);
  const invalidAfterSession = await pageApi(page, `${viewer3}?status=1`);
  assert.ok([401, 410].includes(invalidAfterSession.status), `Protected viewer survived session revocation (${invalidAfterSession.status}).`);
  evidence.resources.protectedAnswerSessionInvalidation = 'PASS';
}

async function probeScreenPal(page, kind) {
  const iframe = page.locator('#lesson-player');
  await iframe.waitFor({ state: 'visible', timeout: 30000 });
  const src = String(await iframe.getAttribute('src') || '');
  assert.ok(src.startsWith('https://go.screenpal.com/'), `${kind}: ScreenPal iframe does not use an approved explicit HTTPS player URL.`);
  assert.equal(page.locator('#phase9-quiz-section').count() ? await page.locator('#phase9-quiz-section').evaluate(el => el.hidden) : true, true, `${kind}: separate Quiz section became visible.`);
  const handle = await iframe.elementHandle();
  const frame = await handle?.contentFrame();
  const result = { srcShape: src.includes('quiz_id=') ? 'interactive-quiz' : 'ordinary', frameLoaded: Boolean(frame), playback: 'NOT_CONFIRMED', fullscreen: 'NOT_CONFIRMED' };
  if (!frame) return result;

  await frame.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 1500));
  let video = frame.locator('video').first();
  let playButton = frame.locator('button[aria-label*="play" i], button[title*="play" i], [role="button"][aria-label*="play" i]').first();
  try {
    if (await playButton.count() && await playButton.isVisible()) {
      await playButton.click({ timeout: 5000 });
      await new Promise(resolve => setTimeout(resolve, 1800));
    } else if (await video.count() && await video.isVisible()) {
      await video.click({ timeout: 5000 });
      await new Promise(resolve => setTimeout(resolve, 1800));
    }
    if (await video.count()) {
      const state = await video.evaluate(el => ({ paused: el.paused, currentTime: Number(el.currentTime || 0), readyState: el.readyState }));
      if (!state.paused || state.currentTime > 0) result.playback = 'PASS';
    }
  } catch (_) {}

  try {
    const full = frame.locator('button[aria-label*="full" i], button[title*="full" i], [role="button"][aria-label*="full" i]').first();
    if (await full.count() && await full.isVisible()) {
      await full.click({ timeout: 5000 });
      await new Promise(resolve => setTimeout(resolve, 600));
      const active = await frame.evaluate(() => Boolean(document.fullscreenElement || document.webkitFullscreenElement));
      if (active) {
        result.fullscreen = 'PASS';
        await frame.evaluate(() => document.exitFullscreen?.() || document.webkitExitFullscreen?.()).catch(() => {});
      }
    }
  } catch (_) {}
  return result;
}

async function testOrdinaryAndElevenPlusVideo() {
  const context = await chrome.newContext(browserContextOptions({ width: 1440, height: 1100 }));
  const page = await context.newPage();
  try {
    await login(page, 'TestY5EM');
    await openSubject(page, 'maths');
    await openView(page, 'Year 5');
    const ordinary = await findLesson(page, 'maths-year5', lesson => lesson.video && !lesson.video.locked && lesson.video.resourceKey);
    assert.ok(ordinary, 'No authorised ordinary Maths ScreenPal lesson was dynamically discoverable.');
    await openLessonByActualId(page, 'maths-year5', ordinary.item.lessonId);
    await page.locator('#video-frame').waitFor({ state: 'visible', timeout: 30000 });
    const ordinarySrc = String(await page.locator('#lesson-player').getAttribute('src') || '');
    assert.equal(ordinarySrc.includes('quiz_id='), false, 'Ordinary Maths received the 11+ interactive quiz variant.');
    const ordinaryProbe = await probeScreenPal(page, 'ordinary');
    evidence.resources.ordinaryScreenPal = { lessonId: ordinary.item.lessonId, ...ordinaryProbe };
    evidence.screenPal.ordinaryPlayback = ordinaryProbe.playback;
    evidence.screenPal.ordinaryFullscreen = ordinaryProbe.fullscreen;
    await shot(page, 'desktop-ordinary-video');
  } finally {
    await context.close();
  }

  const context11 = await chrome.newContext(browserContextOptions({ width: 1440, height: 1100 }));
  const page11 = await context11.newPage();
  try {
    await login(page11, 'TestY411M');
    await openSubject(page11, 'maths');
    await openView(page11, 'Level 2');
    const interactive = await findLesson(page11, 'maths-level2', lesson => lesson.video && !lesson.video.locked && lesson.video.resourceKey);
    assert.ok(interactive, 'No authorised 11+ Maths interactive lesson was dynamically discoverable.');
    await openLessonByActualId(page11, 'maths-level2', interactive.item.lessonId);
    await page11.locator('#video-frame').waitFor({ state: 'visible', timeout: 30000 });
    const src = String(await page11.locator('#lesson-player').getAttribute('src') || '');
    assert.equal(src.includes('quiz_id='), true, 'Authorised 11+ Maths did not receive interactive quiz variant in Lesson Video.');
    assert.equal(await page11.locator('#phase9-quiz-section').evaluate(el => el.hidden), true, 'Separate 11+ Quiz section is visible.');
    const elevenProbe = await probeScreenPal(page11, '11plus');
    evidence.resources.elevenPlusScreenPal = { lessonId: interactive.item.lessonId, ...elevenProbe };
    evidence.screenPal.elevenPlusPlayback = elevenProbe.playback;
    evidence.screenPal.elevenPlusFullscreen = elevenProbe.fullscreen;
    await shot(page11, 'desktop-11plus-interactive-video');
  } finally {
    await context11.close();
  }
}

async function testOtherResource() {
  const context = await chrome.newContext(browserContextOptions({ width: 1440, height: 1100 }));
  const page = await context.newPage();
  try {
    await login(page, 'TestY511E');
    await openSubject(page, 'english');
    await openView(page, 'Year 5 11+');
    const found = await findLesson(page, 'english-year5-11plus', lesson => {
      const list = lesson?.phase11OtherResources?.elevenPlus || [];
      return list.some(r => !r.locked && r.available !== false && r.resourceKey);
    });
    if (!found) {
      evidence.resources.otherResource = 'NOT_APPLICABLE_NO_AUTHORISED_RESOURCE_DISCOVERED';
      return;
    }
    const resource = (found.detail.lesson.phase11OtherResources.elevenPlus || []).find(r => !r.locked && r.available !== false && r.resourceKey);
    await openLessonByActualId(page, 'english-year5-11plus', found.item.lessonId);
    const row = page.locator('#other-list .phase11-eleven-other-row').filter({ hasText: resource.displayName || '' }).first();
    await row.waitFor({ state: 'visible', timeout: 30000 });
    evidence.resources.otherResource = await clickResourceAndAssert(page, row, resource.resourceKey, 'OtherResource');
    await shot(page, 'desktop-11plus-other-resource');
  } finally {
    await context.close();
  }
}

async function testDesktopNavigationAndResources() {
  const context = await chrome.newContext(browserContextOptions({ width: 1440, height: 1100 }));
  const page = await context.newPage();
  try {
    await loginWithEyeCheck(page, 'TestY5EM');
    await assertNoHorizontalOverflow(page, 'desktop subjects');
    await openSubject(page, 'maths');
    await openView(page, 'Year 5');
    await assertLongListAndBack(page, 'Year 5 Maths', 38);
    await openSubject(page, 'english');
    await openView(page, 'Year 5');
    assert.equal(await page.locator('#lesson-list .phase6-lesson-row').count(), 32, 'Year 5 English canonical list was truncated.');
    await page.locator('#back-to-views').click();
    await page.locator('#back-to-subjects').click();
    evidence.navigation.desktopChrome = 'PASS';
    await shot(page, 'desktop-subjects');
  } finally {
    await context.close();
  }

  const resourceContext = await chrome.newContext(browserContextOptions({ width: 1440, height: 1100 }));
  const resourcePage = await resourceContext.newPage();
  try {
    await login(resourcePage, 'TestY5EM');
    await testDownloadsAndProtected(resourcePage, resourceContext);
    await shot(resourcePage, 'desktop-protected-answer');
  } finally {
    await resourceContext.close();
  }
  await testOrdinaryAndElevenPlusVideo();
  await testOtherResource();
}

async function testResponsiveContext(name, viewport, { mobile = true, protectedDialog = false } = {}) {
  const context = await chrome.newContext(browserContextOptions(viewport, { mobile }));
  const page = await context.newPage();
  try {
    await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('#login-screen').waitFor({ state: 'visible', timeout: 30000 });
    await assertNoHorizontalOverflow(page, `${name} login`);
    const eye = page.locator('#toggle-login-password');
    const password = page.locator('#login-password');
    await password.fill(SHARED_LOGIN);
    await eye.click();
    assert.equal(await password.getAttribute('type'), 'text');
    await eye.click();
    await page.locator('#username').fill('TestY5EM');
    await page.locator('#login-button').click();
    await page.locator('#portal-screen').waitFor({ state: 'visible', timeout: 60000 });
    await assertNoHorizontalOverflow(page, `${name} subjects`);
    await openSubject(page, 'maths');
    await assertNoHorizontalOverflow(page, `${name} views`);
    await openView(page, 'Year 5');
    await assertNoHorizontalOverflow(page, `${name} lesson list`);
    const rows = page.locator('#lesson-list .phase6-lesson-row');
    assert.equal(await rows.count(), 38);
    await rows.last().scrollIntoViewIfNeeded();
    assert.equal(await rows.last().isVisible(), true);
    await rows.last().click();
    await page.locator('#screen-lesson').waitFor({ state: 'visible', timeout: 30000 });
    await assertNoHorizontalOverflow(page, `${name} lesson`);
    await page.locator('#back-to-lessons').click();
    await page.locator('#back-to-views').click();
    await page.locator('#back-to-subjects').click();

    if (protectedDialog) {
      await openSubject(page, 'maths');
      await openView(page, 'Year 5');
      const protectedLesson = await findLesson(page, 'maths-year5', lesson => (lesson.homeworks || []).some(pair => pair?.answerPack?.protected && pair.answerPack.resourceKey));
      assert.ok(protectedLesson);
      await openLessonByActualId(page, 'maths-year5', protectedLesson.item.lessonId);
      const button = page.locator('#homework-list .phase7-resource-row').filter({ has: page.locator('.phase7-protected-chip') }).first().locator('button').last();
      await button.click();
      const modal = page.locator('#phase8-answer-modal');
      await modal.waitFor({ state: 'visible', timeout: 10000 });
      await assertNoHorizontalOverflow(page, `${name} protected modal`);
      const box = await page.locator('.phase8-answer-card').boundingBox();
      assert.ok(box && box.width <= viewport.width + 1, `${name}: protected-answer dialog exceeds viewport width.`);
      assert.equal(await page.locator('#phase8-answer-eye').isVisible(), true);
      await page.locator('#phase8-answer-close').click();
    }

    await shot(page, `${name}-responsive`);
    evidence.browsers[name] = 'PASS';
  } finally {
    await context.close();
  }
}

async function loginUntilHome(page, username, predicate, attempts = 15) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await page.goto('about:blank');
    await login(page, username);
    const home = await pageApi(page, '/api/v1/student/home');
    if (home.status === 200 && home.body?.ok && predicate(home.body)) return home.body;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`Controlled ${username} home projection did not reach Phase 16 fixture state in time.`);
}

async function testCurrentPreviousLockedNavigation() {
  testY5EOriginal = await kvGetJson(settings.studentsKv, 'user:testy5e');
  const y2Ids = await curriculumLessonIds(settings.lessonsKv, 'ENGLISH_Y2');
  assert.equal(y2Ids.length, 29, 'Expected exact Year 2 English canonical curriculum length 29.');
  const historicalLesson = y2Ids[0];
  const changed = structuredClone(testY5EOriginal);
  changed.manualAccess ||= { coreLessons: [], vrLessons: [], specialBuckets: [] };
  changed.manualAccess.coreLessons = [...new Set([...(changed.manualAccess.coreLessons || []), historicalLesson])];
  testY5EHistoryMutated = true;
  await kvPutJson(settings.studentsKv, 'user:testy5e', changed);
  await waitForKvProfile(settings.studentsKv, 'user:testy5e', profile => (profile.manualAccess?.coreLessons || []).includes(historicalLesson));

  const context = await chrome.newContext(browserContextOptions({ width: 412, height: 915 }, { mobile: true }));
  const page = await context.newPage();
  try {
    const home = await loginUntilHome(page, 'TestY5E', body => {
      const maths = (body.subjects || []).find(s => s.subject === 'maths');
      const english = (body.subjects || []).find(s => s.subject === 'english');
      const mathsCurrent = (maths?.views || []).filter(v => v.current === true || v.group === 'current').map(v => v.viewId);
      const englishViews = (english?.views || []).map(v => v.viewId);
      return mathsCurrent.includes('maths-year3') && mathsCurrent.includes('maths-year4') && englishViews.includes('english-year2');
    });

    const maths = home.subjects.find(s => s.subject === 'maths');
    const mathsCurrent = maths.views.filter(v => v.current === true || v.group === 'current').map(v => v.viewId);
    assert.ok(mathsCurrent.includes('maths-year3') && mathsCurrent.includes('maths-year4'), 'Multiple simultaneous active Maths batches did not remain Current.');
    await openSubject(page, 'maths');
    const currentSection = page.locator('#view-grid .phase10-view-group').filter({ has: page.getByText('Current', { exact: true }) }).first();
    await currentSection.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await currentSection.getByRole('button', { name: /Year 3/ }).count() >= 1, true);
    assert.equal(await currentSection.getByRole('button', { name: /Year 4/ }).count() >= 1, true);
    await page.locator('#back-to-subjects').click();

    await openSubject(page, 'english');
    const current = page.locator('#view-grid .phase10-view-group').filter({ has: page.getByText('Current', { exact: true }) }).first();
    const previous = page.locator('#view-grid .phase10-view-group').filter({ has: page.getByText('Previous', { exact: true }) }).first();
    await current.waitFor({ state: 'visible', timeout: 10000 });
    await previous.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await current.getByRole('button', { name: /Year 5/ }).count() >= 1, true, 'Current Year 5 English missing.');
    assert.equal(await previous.getByRole('button', { name: /Year 2/ }).count() >= 1, true, 'Historical/manual Year 2 English not discoverable under Previous.');
    await previous.getByRole('button', { name: /Year 2/ }).first().click();
    await page.locator('#screen-lessons').waitFor({ state: 'visible', timeout: 30000 });
    const rows = page.locator('#lesson-list .phase6-lesson-row');
    assert.equal(await rows.count(), 29, 'Historical Year 2 view did not show the full canonical catalogue.');
    const available = page.locator('#lesson-list .phase6-lesson-state').filter({ hasText: 'Available' });
    const locked = page.locator('#lesson-list .phase6-lesson-state').filter({ hasText: 'Locked' });
    assert.equal(await available.count(), 1, 'Manual individual access should open exactly the controlled historical lesson.');
    assert.equal(await locked.count(), 28, 'Non-entitled historical lessons must remain visible and locked.');

    const listBody = await getViewLessons(page, 'english-year2');
    const lockedItem = listBody.lessons.find(item => item.locked);
    assert.ok(lockedItem);
    const lockedDetail = await getLessonDetail(page, 'english-year2', lockedItem.lessonId);
    assert.equal(lockedDetail.lesson.locked, true);
    assertLockedPayloadSafe(lockedDetail);
    const lockedIndex = listBody.lessons.findIndex(item => item.lessonId === lockedItem.lessonId);
    await rows.nth(lockedIndex).click();
    await page.locator('#screen-lesson').waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('#lesson-locked-note').waitFor({ state: 'visible', timeout: 10000 });
    assertNoRawR2(await page.locator('#lesson-content').innerHTML(), 'locked preview DOM');
    await page.locator('#back-to-lessons').click();
    await page.locator('#back-to-views').click();
    await page.locator('#back-to-subjects').click();
    evidence.navigation.currentPreviousMultiCurrentLocked = 'PASS';
    await shot(page, 'mobile-current-previous-locked');
  } finally {
    await context.close();
    await kvPutJson(settings.studentsKv, 'user:testy5e', testY5EOriginal);
    testY5EHistoryMutated = false;
    await waitForKvProfile(settings.studentsKv, 'user:testy5e', profile => JSON.stringify(profile) === JSON.stringify(testY5EOriginal));
  }
}

async function testSingleSessionAcrossContexts() {
  // Chrome desktop -> Chrome mobile.
  const a = await chrome.newContext(browserContextOptions({ width: 1440, height: 1100 }));
  const b = await chrome.newContext(browserContextOptions({ width: 412, height: 915 }, { mobile: true }));
  const pa = await a.newPage();
  const pb = await b.newPage();
  try {
    await login(pa, 'TestY5EM');
    await login(pb, 'TestY5EM');
    const old = await pageApi(pa, '/api/v1/student/session');
    const newest = await pageApi(pb, '/api/v1/student/session');
    assert.equal(old.status, 401, 'Newer mobile Chrome login did not invalidate older desktop Chrome session.');
    assert.equal(newest.status, 200, 'Newest mobile Chrome session was broken by single-session enforcement.');
    evidence.sessions.chromeDesktopToMobile = 'PASS';
  } finally {
    await a.close(); await b.close();
  }

  // Chrome -> Firefox.
  const c = await chrome.newContext(browserContextOptions({ width: 1440, height: 1100 }));
  const f = await ff.newContext(browserContextOptions({ width: 1440, height: 1100 }));
  const pc = await c.newPage();
  const pf = await f.newPage();
  try {
    await login(pc, 'TestY5EM');
    await login(pf, 'TestY5EM');
    assert.equal((await pageApi(pc, '/api/v1/student/session')).status, 401, 'Firefox login did not invalidate older Chrome session.');
    assert.equal((await pageApi(pf, '/api/v1/student/session')).status, 200, 'Newest Firefox session was broken.');
    evidence.sessions.chromeToFirefox = 'PASS';

    // Reverse: fresh Chrome must invalidate Firefox without breaking Chrome.
    const c2 = await chrome.newContext(browserContextOptions({ width: 1024, height: 768 }));
    const pc2 = await c2.newPage();
    try {
      await login(pc2, 'TestY5EM');
      assert.equal((await pageApi(pf, '/api/v1/student/session')).status, 401, 'New Chrome login did not invalidate older Firefox session.');
      assert.equal((await pageApi(pc2, '/api/v1/student/session')).status, 200, 'Newest Chrome session was broken.');
      evidence.sessions.firefoxToChrome = 'PASS';
    } finally {
      await c2.close();
    }
  } finally {
    await c.close(); await f.close();
  }
}

async function testSessionTimeoutAndVideoActivity() {
  // Navigation expiry.
  let context = await chrome.newContext(browserContextOptions({ width: 1440, height: 1100 }));
  let page = await context.newPage();
  try {
    await login(page, 'TestY5EM');
    const cookie = await sessionCookie(context);
    const hash = tokenHash(cookie.value);
    ageSessionByHash(hash);
    const session = await pageApi(page, '/api/v1/student/session');
    assert.equal(session.status, 401);
    assert.equal(session.body?.error, 'SESSION_EXPIRED');
    await openSubject(page, 'maths');
    const yearButton = page.locator('#view-grid').getByRole('button', { name: /Year 5/ }).first();
    await yearButton.click();
    await page.locator('#login-screen').waitFor({ state: 'visible', timeout: 30000 });
    evidence.sessions.twoHourNavigationExpiry = 'PASS';
  } finally {
    await context.close();
  }

  // Valid video play/activity signal then expiry while video is open.
  context = await chrome.newContext(browserContextOptions({ width: 1440, height: 1100 }));
  page = await context.newPage();
  try {
    await login(page, 'TestY5EM');
    await openSubject(page, 'maths');
    await openView(page, 'Year 5');
    const ordinary = await findLesson(page, 'maths-year5', lesson => lesson.video && !lesson.video.locked && lesson.video.resourceKey);
    assert.ok(ordinary);
    await openLessonByActualId(page, 'maths-year5', ordinary.item.lessonId);
    await page.locator('#video-frame').waitFor({ state: 'visible', timeout: 30000 });
    const cookie = await sessionCookie(context);
    const hash = tokenHash(cookie.value);
    const before = sessionStateByHash(hash);
    assert.ok(before?.last_activity_at);
    const activity = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/v1/student/session/activity'), { timeout: 10000 });
    await page.evaluate(() => window.postMessage('videoPlayerPlay', '*'));
    const response = await activity;
    assert.equal(response.status(), 200, 'Video play activity did not refresh valid session.');
    const after = sessionStateByHash(hash);
    assert.ok(after && after.last_activity_at >= before.last_activity_at, 'Video activity did not advance/retain authoritative session activity timestamp.');
    evidence.sessions.videoActivityRefresh = 'PASS';

    ageSessionByHash(hash);
    const expiredActivity = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/v1/student/session/activity'), { timeout: 10000 });
    await page.evaluate(() => window.postMessage('videoPlayerPlay', '*'));
    const expiredResponse = await expiredActivity;
    assert.equal(expiredResponse.status(), 401, 'Expired video session was incorrectly resurrected by activity signal.');
    const afterExpired = sessionStateByHash(hash);
    assert.ok(afterExpired && new Date(afterExpired.idle_expires_at).getTime() <= Date.now(), 'Expired session idle deadline was unexpectedly extended.');
    await page.locator('#back-to-lessons').click();
    // Back itself is local; opening a lesson forces the next authoritative call.
    await page.locator('#lesson-list .phase6-lesson-row').first().click();
    await page.locator('#login-screen').waitFor({ state: 'visible', timeout: 30000 });
    evidence.sessions.videoCannotResurrectExpired = 'PASS';
  } finally {
    await context.close();
  }
}

async function testFirefoxAndWebKitCompatibility() {
  const firefoxContext = await ff.newContext(browserContextOptions({ width: 1440, height: 1100 }));
  const firefoxPage = await firefoxContext.newPage();
  try {
    await login(firefoxPage, 'TestY2EM');
    await openSubject(firefoxPage, 'english');
    await openView(firefoxPage, 'Year 2');
    assert.equal(await firefoxPage.locator('#lesson-list .phase6-lesson-row').count(), 29);
    await assertNoHorizontalOverflow(firefoxPage, 'Firefox Year 2 list');
    await shot(firefoxPage, 'firefox-desktop');
    evidence.browsers.firefoxDesktop = 'PASS';
  } finally {
    await firefoxContext.close();
  }

  const webkitContext = await wk.newContext(browserContextOptions({ width: 1440, height: 1100 }));
  const webkitPage = await webkitContext.newPage();
  try {
    await login(webkitPage, 'TestY2EM');
    await openSubject(webkitPage, 'maths');
    await openView(webkitPage, 'Year 2');
    assert.equal(await webkitPage.locator('#lesson-list .phase6-lesson-row').count(), 36);
    await assertNoHorizontalOverflow(webkitPage, 'WebKit desktop list');
    await shot(webkitPage, 'webkit-desktop-compatibility');
    evidence.browsers.webkitDesktopCompatibility = 'PASS_ENGINE_SIGNAL_ONLY_NOT_SAFARI';
  } finally {
    await webkitContext.close();
  }

  const ipadLike = await wk.newContext({ ...browserContextOptions({ width: 820, height: 1180 }, { mobile: true }), isMobile: true, hasTouch: true });
  const ipadPage = await ipadLike.newPage();
  try {
    await login(ipadPage, 'TestY2EM');
    await assertNoHorizontalOverflow(ipadPage, 'WebKit iPad-like subjects');
    await openSubject(ipadPage, 'english');
    await openView(ipadPage, 'Year 2');
    await ipadPage.locator('#lesson-list .phase6-lesson-row').last().scrollIntoViewIfNeeded();
    await assertNoHorizontalOverflow(ipadPage, 'WebKit iPad-like long list');
    await shot(ipadPage, 'webkit-ipad-like-compatibility');
    evidence.browsers.webkitIPadLikeCompatibility = 'PASS_ENGINE_SIGNAL_ONLY_NOT_IPAD_SAFARI';
  } finally {
    await ipadLike.close();
  }
}

async function main() {
  let failure = null;
  try {
    settings = await assertWorkerSafety();
    evidence.preBaseline = assertExactBaseline('Phase 16 preflight');
    revokeExistingControlledSessions();
    assert.equal(activeControlledSessions(TEST_START), 0);
    insertNavigationFixtures(TEST_START);

    chrome = await chromium.launch({
      headless: true,
      executablePath: '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
    });
    ff = await firefox.launch({ headless: true });
    wk = await webkit.launch({ headless: true });

    evidence.browsers.desktopChromeBinary = await chrome.version();
    evidence.browsers.firefoxBinary = await ff.version();
    evidence.browsers.webkitBinary = await wk.version();

    await testDesktopNavigationAndResources();
    await testResponsiveContext('chromeCompact1024', { width: 1024, height: 768 }, { mobile: false });
    await testResponsiveContext('chromeMobile412', { width: 412, height: 915 }, { mobile: true, protectedDialog: true });
    await testResponsiveContext('chromeNarrow360', { width: 360, height: 800 }, { mobile: true });
    await testResponsiveContext('chromeTablet768', { width: 768, height: 1024 }, { mobile: true });
    await testCurrentPreviousLockedNavigation();
    await testSingleSessionAcrossContexts();
    await testSessionTimeoutAndVideoActivity();
    await testFirefoxAndWebKitCompatibility();

    evidence.automatedResult = 'PASS';
  } catch (error) {
    failure = error;
    evidence.automatedResult = 'FAIL';
    evidence.failure = String(error?.stack || error?.message || error).slice(0, 5000);
    throw error;
  } finally {
    if (wk) await wk.close().catch(() => {});
    if (ff) await ff.close().catch(() => {});
    if (chrome) await chrome.close().catch(() => {});

    // Exact restoration for any controlled KV mutation, even after an assertion failure.
    if (settings?.studentsKv && testY5EMAnswerMutated && testY5EMOriginal) {
      await kvPutJson(settings.studentsKv, 'user:testy5em', testY5EMOriginal).catch(() => {});
      testY5EMAnswerMutated = false;
    }
    if (settings?.studentsKv && testY5EHistoryMutated && testY5EOriginal) {
      await kvPutJson(settings.studentsKv, 'user:testy5e', testY5EOriginal).catch(() => {});
      testY5EHistoryMutated = false;
    }

    try { cleanupControlledSessions(TEST_START); } catch (error) { if (!failure) failure = error; }
    try { cleanupNavigationFixtures(); } catch (error) { if (!failure) failure = error; }

    if (settings?.studentsKv && testY5EMOriginal) {
      try {
        const restored = await kvGetJson(settings.studentsKv, 'user:testy5em');
        assert.deepEqual(restored, testY5EMOriginal, 'testy5em controlled KV profile was not restored exactly.');
      } catch (error) { if (!failure) failure = error; }
    }
    if (settings?.studentsKv && testY5EOriginal) {
      try {
        const restored = await kvGetJson(settings.studentsKv, 'user:testy5e');
        assert.deepEqual(restored, testY5EOriginal, 'testy5e controlled KV profile was not restored exactly.');
      } catch (error) { if (!failure) failure = error; }
    }

    try {
      evidence.postBaseline = assertExactBaseline('Phase 16 post-cleanup');
      evidence.activeControlledSessionsAfterCleanup = activeControlledSessions(TEST_START);
      assert.equal(evidence.activeControlledSessionsAfterCleanup, 0, 'Phase 16 created active controlled sessions remained after cleanup.');
      const safetyAfter = await assertWorkerSafety();
      evidence.workerSafetyAfter = { r2: safetyAfter.r2, loginEnabled: safetyAfter.loginEnabled, environment: 'development', legacyLessonKvBound: false };
    } catch (error) {
      if (!failure) failure = error;
      evidence.cleanupFailure = String(error?.stack || error?.message || error).slice(0, 5000);
    }

    evidence.testEnd = isoNow();
    await fs.writeFile(path.join(OUT, 'phase16-evidence.json'), JSON.stringify(safeEvidence(evidence), null, 2));
    console.log(`PHASE16_AUTOMATED_MATRIX_${evidence.automatedResult || 'UNKNOWN'}`);
    console.log(`PHASE16_PHYSICAL_ANDROID_CHROME_${evidence.physicalPlatforms.androidChrome}`);
    console.log(`PHASE16_MACOS_SAFARI_${evidence.physicalPlatforms.macOSSafari}`);
    console.log(`PHASE16_IPAD_SAFARI_${evidence.physicalPlatforms.iPadSafari}`);
    console.log(`PHASE16_SCREENPAL ordinaryPlayback=${evidence.screenPal.ordinaryPlayback} ordinaryFullscreen=${evidence.screenPal.ordinaryFullscreen} elevenPlusPlayback=${evidence.screenPal.elevenPlusPlayback} elevenPlusFullscreen=${evidence.screenPal.elevenPlusFullscreen}`);

    if (failure && evidence.automatedResult !== 'FAIL') throw failure;
  }
}

await main();
