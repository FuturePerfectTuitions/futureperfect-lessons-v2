import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit } from '@playwright/test';

const base = new URL(process.env.CP9_BROWSER_BASE_URL || 'https://fpt-portal-v2-rebuild-browser-staging-cp9.futureperfectlessons.workers.dev');
const loginPassword = String(process.env.UAT_LOGIN_PASSWORD || '');
const answerPassword = String(process.env.UAT_ANSWER_PASSWORD || '');
const frontendSha = String(process.env.CP7_FRONTEND_SHA || '');
const candidateSha = String(process.env.GITHUB_SHA || '');
const evidenceDir = '/tmp/checkpoint9-browser-evidence';
const seedPath = '/tmp/checkpoint9-seed-summary.json';
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const selected = seed.selected || {};
const timings = {};
const browserRequests = [];
const assertions = {};
let activePage = null;
fs.mkdirSync(evidenceDir, { recursive: true });

function validFour(value) {
  return /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{4}$/.test(String(value));
}
assert(validFour(loginPassword), 'Missing/invalid CP9 UAT login password');
assert(validFour(answerPassword), 'Missing/invalid CP9 UAT Answer Pack password');
assert(/^[0-9a-f]{40}$/.test(frontendSha), 'CP7 frontend SHA is not pinned');

const wrongAnswerPassword = answerPassword === 'Aa0x' ? 'Bb1y' : 'Aa0x';
const screenPalHosts = new Set(['screenpal.com', 'www.screenpal.com', 'go.screenpal.com']);
const prodWorkerHost = 'fpt-portal-v2-worker.futureperfectlessons.workers.dev';
const stagingBackendHost = 'fpt-portal-v2-rebuild-student-staging.futureperfectlessons.workers.dev';

function timed(name, started) { timings[name] = Date.now() - started; }
function hostOf(value) { try { return new URL(value).hostname; } catch { return ''; } }
function track(page, label) {
  activePage = page;
  page.on('request', request => browserRequests.push({ label, method: request.method(), url: request.url() }));
}
async function screenshot(page, name) {
  await page.screenshot({ path: path.join(evidenceDir, `${name}.png`), fullPage: true });
}
async function goLogin(page) {
  const started = Date.now();
  await page.goto(base.href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Student Login' }).waitFor({ state: 'visible', timeout: 15_000 });
  timed('initialLoginScreenMs', started);
}
async function login(page, username, captureHeaders = false) {
  await goLogin(page);
  await page.getByLabel('Username').fill(username);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(loginPassword);
  const responsePromise = page.waitForResponse(response => {
    try { return new URL(response.url()).pathname === '/api/v2/auth/login'; } catch { return false; }
  }, { timeout: 15_000 });
  const started = Date.now();
  await page.getByRole('button', { name: 'Log in' }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, `${username} login failed`);
  await page.getByRole('heading', { name: /Welcome/ }).waitFor({ state: 'visible', timeout: 15_000 });
  timed(`${username}LoginMs`, started);
  return captureHeaders ? response : null;
}
async function clickSubject(page, subject) {
  await page.getByRole('button', { name: new RegExp(subject, 'i') }).first().click();
  await page.getByRole('heading', { name: new RegExp(`^${subject}$`, 'i') }).waitFor({ timeout: 10_000 });
}
async function openView(page, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('button', { name: new RegExp(escaped, 'i') }).first().click();
  await page.getByLabel('Search lessons').waitFor({ state: 'visible', timeout: 15_000 });
}
async function openLessonById(page, lessonId, action = /Open|Preview/) {
  assert(/^[A-Za-z0-9._-]+$/.test(lessonId), `Unsafe lesson ID in UAT selector: ${lessonId}`);
  const search = page.getByLabel('Search lessons');
  if (await search.inputValue()) await search.fill('');
  const button = page.locator(`[data-lesson="${lessonId}"]`).first();
  await button.waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(await button.getAttribute('data-lesson'), lessonId, `Canonical lesson binding mismatch for ${lessonId}`);
  const label = String(await button.textContent());
  assert(action.test(label), `Expected ${lessonId} action ${action}, got ${label}`);
  const responsePromise = page.waitForResponse(response => {
    try { return new URL(response.url()).pathname === `/api/v2/student/lessons/${encodeURIComponent(lessonId)}`; }
    catch { return false; }
  }, { timeout: 15_000 });
  await button.click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, `Lesson detail request failed for ${lessonId}`);
  const payload = await response.json();
  assert.equal(payload?.lesson?.lessonId, lessonId, `Lesson detail canonical ID mismatch for ${lessonId}`);
  await page.locator('.lesson-heading').waitFor({ state: 'visible', timeout: 15_000 });
}
async function browserFetchResource(page, rowText) {
  const row = page.locator('.resource-row').filter({ hasText: rowText }).first();
  const link = row.locator('[data-direct-resource]');
  await link.waitFor({ state: 'visible', timeout: 10_000 });
  const href = await link.getAttribute('href');
  assert(href, `Missing direct resource link for ${rowText}`);
  return page.evaluate(async url => {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    const data = await response.arrayBuffer();
    return {
      status: response.status,
      bytes: data.byteLength,
      contentType: response.headers.get('content-type') || '',
      contentDisposition: response.headers.get('content-disposition') || '',
      cacheControl: response.headers.get('cache-control') || '',
      finalUrl: response.url
    };
  }, href);
}
async function home(page) {
  const subjects = page.getByRole('button', { name: /Maths|English/ });
  assert((await subjects.count()) >= 2, 'Home did not expose Maths and English');
}
async function returnSubjects(page) {
  const button = page.getByRole('button', { name: /Subjects/ });
  if (await button.count()) await button.first().click();
  await page.getByRole('heading', { name: /Welcome/ }).waitFor({ timeout: 10_000 });
}

async function chromiumGate(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  track(page, 'chromium-main');

  const loginResponse = await login(page, 'cp9normal', true);
  await home(page);
  const setCookie = await loginResponse.headerValue('set-cookie');
  assert(setCookie && /fpt_session=/.test(setCookie), 'Login did not return fpt_session');
  assert(/Max-Age=28800/i.test(setCookie), 'Session Max-Age is not 8 hours');
  assert(/HttpOnly/i.test(setCookie), 'Session cookie is not HttpOnly');
  assert(/Secure/i.test(setCookie), 'Session cookie is not Secure');
  assert(/SameSite=Lax/i.test(setCookie), 'Session cookie is not SameSite=Lax');

  const cookies = await context.cookies(base.href);
  const sessionCookie = cookies.find(cookie => cookie.name === 'fpt_session');
  assert(sessionCookie, 'Browser did not retain fpt_session');
  assert.equal(sessionCookie.httpOnly, true);
  assert.equal(sessionCookie.secure, true);
  assert.equal(sessionCookie.sameSite, 'Lax');
  assert.equal(sessionCookie.path, '/');
  assert.equal(sessionCookie.domain.replace(/^\./, ''), base.hostname);
  const lifetime = sessionCookie.expires - Math.floor(Date.now() / 1000);
  assert(lifetime > (7 * 60 * 60) && lifetime <= (8 * 60 * 60 + 60), `Unexpected session lifetime ${lifetime}`);
  assertions.cookieArchitecture = true;

  let started = Date.now();
  await clickSubject(page, 'Maths');
  await openView(page, 'Year 6');
  timed('mathsYear6NavigationMs', started);

  started = Date.now();
  await openLessonById(page, selected.ordinary);
  timed('ordinaryLessonOpenMs', started);
  assert(await page.getByRole('button', { name: 'View' }).count(), 'Ordinary lesson video missing');

  const screenPalRequest = page.waitForRequest(request => screenPalHosts.has(hostOf(request.url())), { timeout: 15_000 });
  await page.getByRole('button', { name: 'View' }).click();
  const videoRequest = await screenPalRequest;
  assert(screenPalHosts.has(hostOf(videoRequest.url())), 'Video did not redirect to approved ScreenPal host');
  assertions.videoRedirect = true;

  const ordinary = await browserFetchResource(page, 'Homework');
  assert.equal(ordinary.status, 200, 'Homework browser fetch failed');
  assert(ordinary.bytes > 0, 'Homework resource was empty');
  assert(/attachment/i.test(ordinary.contentDisposition), 'Ordinary resource is not attachment-delivered');
  assert(/no-store/i.test(ordinary.cacheControl), 'Ordinary resource is not no-store');
  assertions.ordinaryResource = true;

  const answerRow = page.locator('.resource-row').filter({ hasText: 'Answer Pack' }).first();
  await answerRow.getByRole('button', { name: 'Open' }).click();
  await page.getByLabel('Answer Pack password').fill(wrongAnswerPassword);
  await page.getByRole('button', { name: 'Open Answer Pack' }).click();
  await page.getByText('Incorrect Answer Pack password.').waitFor({ timeout: 10_000 });
  await page.getByLabel('Answer Pack password').fill(answerPassword);
  const protectedResponse = page.waitForResponse(response => {
    try { return new URL(response.url()).pathname === '/api/v2/student/resource' && response.status() === 200; }
    catch { return false; }
  }, { timeout: 20_000 });
  await page.getByRole('button', { name: 'Open Answer Pack' }).click();
  await page.getByText('Protected viewer').waitFor({ timeout: 15_000 });
  const protectedResource = await protectedResponse;
  const protectedDisposition = await protectedResource.headerValue('content-disposition');
  const protectedCache = await protectedResource.headerValue('cache-control');
  assert(/inline/i.test(protectedDisposition || ''), 'Answer Pack not inline-delivered');
  assert(/no-store/i.test(protectedCache || ''), 'Answer Pack not no-store');
  await page.locator('.protected-page canvas').first().waitFor({ state: 'visible', timeout: 30_000 });
  await screenshot(page, 'chromium-answer-pack');
  assertions.answerPackProtectedViewer = true;
  await page.getByRole('button', { name: 'Close protected viewer' }).click();

  await page.getByRole('button', { name: /Lessons/ }).click();
  await openLessonById(page, selected.sats);
  assert(await page.locator('.resource-row').filter({ hasText: 'Homework' }).count(), 'SATs Homework missing');
  const satsResource = await browserFetchResource(page, 'Homework');
  assert.equal(satsResource.status, 200);
  assert(satsResource.bytes > 0);
  assertions.sats = true;

  await page.getByRole('button', { name: /Lessons/ }).click();
  await page.getByRole('button', { name: /Maths/ }).click();
  await returnSubjects(page);
  await clickSubject(page, 'English');
  await openView(page, 'Year 6');
  await openLessonById(page, selected.english);
  assert(await page.locator('.resource-row').filter({ hasText: 'Homework' }).count(), 'English Homework missing');
  assertions.english = true;
  await screenshot(page, 'chromium-english');
  await context.close();
}

async function l2Gate(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  track(page, 'chromium-l2');
  await login(page, 'cp9l2');
  await clickSubject(page, 'Maths');
  await openView(page, 'L2');
  await openLessonById(page, selected.cumulative);
  const detail = await page.evaluate(async lessonId => {
    const response = await fetch(`/api/v2/student/lessons/${encodeURIComponent(lessonId)}?viewId=maths-level2`, { credentials: 'include' });
    return { status: response.status, body: await response.json() };
  }, selected.cumulative);
  assert.equal(detail.status, 200);
  const cumulative = detail.body.resources.find(resource => resource.type === 'cumulative-homework');
  assert(cumulative, 'L2 cumulative-homework missing from real lesson detail');
  const cumulativeControl = page.locator(`[data-direct-resource="${cumulative.resourceId}"]`);
  assert.equal(await cumulativeControl.count(), 1, 'Cumulative Homework not rendered as a resource');
  assertions.l2Cumulative = true;

  await page.getByRole('button', { name: /Lessons/ }).click();
  await openLessonById(page, selected.blocked, /Preview/);
  await page.getByText(/visible as a preview/).waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('[data-direct-resource]').count(), 0);
  assert.equal(await page.locator('[data-answer]').count(), 0);
  assert.equal(await page.locator('#lesson-player').count(), 0);
  assertions.lockedPreview = true;
  await screenshot(page, 'chromium-l2-locked-preview');
  await context.close();
}

async function l3Gate(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  track(page, 'chromium-l3');
  await login(page, 'cp9l3');
  await clickSubject(page, 'Maths');
  await openView(page, 'L3');
  await openLessonById(page, selected.l3);
  const external = page.waitForRequest(request => screenPalHosts.has(hostOf(request.url())), { timeout: 15_000 });
  await page.getByRole('button', { name: 'View' }).click();
  const request = await external;
  assert(screenPalHosts.has(hostOf(request.url())));
  assertions.l3Video = true;
  await screenshot(page, 'chromium-l3');
  await context.close();
}

async function historyGate(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await context.newPage();
  track(page, 'chromium-history');
  await login(page, 'cp9history');
  await clickSubject(page, 'Maths');
  const sections = page.locator('.view-section');
  const current = sections.filter({ hasText: 'Current' }).first();
  const previous = sections.filter({ hasText: 'Previous' }).first();
  assert((await current.textContent()).includes('L2'), 'Current L2 missing');
  assert((await previous.textContent()).includes('L1'), 'Previous L1 missing');
  assertions.currentPrevious = true;

  await openView(page, 'Year 3');
  await openLessonById(page, selected.guest);
  assertions.guestManual = true;
  await page.getByRole('button', { name: /Lessons/ }).click();
  await page.getByRole('button', { name: /Maths/ }).click();
  await returnSubjects(page);
  await clickSubject(page, 'English');
  await openView(page, 'Year 4');
  const preview = page.getByRole('button', { name: 'Preview' }).first();
  await preview.waitFor({ timeout: 10_000 });
  await preview.click();
  await page.getByText(/visible as a preview/).waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('[data-direct-resource]').count(), 0);
  assert.equal(await page.locator('[data-answer]').count(), 0);
  assertions.upsellLockedPreview = true;
  await screenshot(page, 'chromium-history');
  await context.close();
}

async function preLessonGate(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  track(page, 'chromium-prelesson');
  await login(page, 'cp9pre');
  await clickSubject(page, 'English');
  await openView(page, 'Year 5');
  await openLessonById(page, selected.preOnly);
  await page.getByText('PreLesson only').waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('#lesson-player').count(), 0, 'PreLesson-only exposed video');
  assert.equal(await page.locator('[data-answer]').count(), 0, 'PreLesson-only exposed Answer Pack');
  const kinds = await page.locator('.resource-kind').allTextContents();
  assert(kinds.length > 0 && kinds.every(value => /PreLesson Sheet/i.test(value)), `Unexpected PreLesson-only resources: ${kinds.join(', ')}`);
  assertions.preLessonOnly = true;
  await screenshot(page, 'chromium-prelesson-only');
  await context.close();
}

async function multiDeviceGate(browser) {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  track(pa, 'chromium-device-a');
  track(pb, 'chromium-device-b');
  await login(pa, 'cp9normal');
  await login(pb, 'cp9normal');
  await pa.getByRole('button', { name: 'Log out' }).click();
  await pa.getByRole('heading', { name: 'Student Login' }).waitFor({ timeout: 10_000 });
  await pb.reload({ waitUntil: 'domcontentloaded' });
  await pb.getByRole('heading', { name: /Welcome/ }).waitFor({ timeout: 10_000 });
  assertions.multiDeviceLogout = true;
  await a.close();
  await b.close();
}

async function navigationResilienceGate(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  track(page, 'chromium-resilience');
  await login(page, 'cp9normal');
  await clickSubject(page, 'Maths');
  await page.route('**/api/v2/student/views/maths-year6/lessons', async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    try { await route.continue(); } catch {}
  });
  await page.getByRole('button', { name: /Year 6/ }).click();
  await page.getByText(/Loading your knowledge bank/).waitFor({ timeout: 5_000 });
  await page.getByRole('button', { name: /Maths/ }).click();
  await page.getByRole('heading', { name: 'Maths' }).waitFor({ timeout: 5_000 });
  await page.waitForTimeout(900);
  assert.equal(await page.locator('.lesson-row').count(), 0, 'Stale Year 6 response overwrote Maths screen');
  assertions.staleNavigationCancelled = true;
  await context.close();

  const timeoutContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const timeoutPage = await timeoutContext.newPage();
  track(timeoutPage, 'chromium-timeout');
  await timeoutPage.addInitScript(() => { window.FPT_V2_CONFIG = { networkTimeoutMs: 150 }; });
  await login(timeoutPage, 'cp9normal');
  await clickSubject(timeoutPage, 'English');
  await timeoutPage.route('**/api/v2/student/views/english-year6/lessons', async route => {
    await new Promise(resolve => setTimeout(resolve, 800));
    try { await route.continue(); } catch {}
  });
  await timeoutPage.getByRole('button', { name: /Year 6/ }).click();
  await timeoutPage.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 3_000 });
  await timeoutPage.getByText(/taking longer than expected|could not be loaded/).waitFor({ timeout: 3_000 });
  assertions.boundedTimeout = true;
  await screenshot(timeoutPage, 'chromium-timeout-retry');
  await timeoutContext.close();
}

async function mobileGate(browser) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  track(page, 'chromium-mobile');
  await login(page, 'cp9normal');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 1, `Mobile horizontal overflow ${overflow}`);
  const maths = await page.getByRole('button', { name: /Maths/ }).boundingBox();
  const english = await page.getByRole('button', { name: /English/ }).boundingBox();
  assert(maths && english && english.y > maths.y + maths.height - 2, 'Mobile subject cards did not stack');
  assertions.mobileLayout = true;
  await screenshot(page, 'chromium-mobile-home');
  await context.close();
}

async function webkitGate() {
  const browser = await webkit.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 834, height: 1194 } });
    const page = await context.newPage();
    track(page, 'webkit-ipad');
    const response = await login(page, 'cp9normal', true);
    const setCookie = await response.headerValue('set-cookie');
    assert(/SameSite=Lax/i.test(setCookie || ''));
    const cookie = (await context.cookies(base.href)).find(item => item.name === 'fpt_session');
    assert(cookie?.httpOnly && cookie?.secure && cookie?.sameSite === 'Lax');
    await clickSubject(page, 'Maths');
    await openView(page, 'Year 6');
    await openLessonById(page, selected.ordinary);
    assert(await page.locator('.resource-row').count() > 0);
    assertions.webkitSmoke = true;
    await screenshot(page, 'webkit-ipad-ordinary');
    await context.close();
  } finally {
    await browser.close();
  }
}

let chromiumBrowser;
try {
  chromiumBrowser = await chromium.launch({ headless: true });
  await chromiumGate(chromiumBrowser);
  await l2Gate(chromiumBrowser);
  await l3Gate(chromiumBrowser);
  await historyGate(chromiumBrowser);
  await preLessonGate(chromiumBrowser);
  await multiDeviceGate(chromiumBrowser);
  await navigationResilienceGate(chromiumBrowser);
  await mobileGate(chromiumBrowser);
  await webkitGate();

  const productionRequests = browserRequests.filter(row => hostOf(row.url) === prodWorkerHost);
  const directBackendRequests = browserRequests.filter(row => hostOf(row.url) === stagingBackendHost);
  assert.equal(productionRequests.length, 0, 'Browser contacted production Worker');
  assert.equal(directBackendRequests.length, 0, 'Browser directly contacted staging backend; topology is not same-origin');
  const apiRequests = browserRequests.filter(row => {
    try { return new URL(row.url).pathname.startsWith('/api/v2/'); } catch { return false; }
  });
  assert(apiRequests.length > 0, 'No browser API requests captured');
  assert(apiRequests.every(row => hostOf(row.url) === base.hostname), 'Browser API request escaped facade origin');

  const summary = {
    marker: 'REBUILD_CHECKPOINT9_BROWSER_UAT_PASS',
    candidateSha,
    frontend: { repository: 'FuturePerfectTuitions/futureperfect-lessons-test', sha: frontendSha },
    browserOrigin: base.origin,
    backendOrigin: `https://${stagingBackendHost}`,
    cookieTopology: {
      architecture: 'same-origin-browser-facade-to-isolated-staging-backend-via-service-binding',
      approvedCookieArchitectureUnchanged: true,
      cookieName: 'fpt_session',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      maxAgeSeconds: 28800,
      browserCookieHost: base.hostname,
      browserApiSameOrigin: true,
      directBackendBrowserRequestCount: directBackendRequests.length,
      productionBrowserRequestCount: productionRequests.length
    },
    assertions,
    timingsMs: timings,
    requestCount: browserRequests.length,
    apiRequestCount: apiRequests.length
  };
  fs.writeFileSync('/tmp/checkpoint9-browser-uat-summary.json', JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(evidenceDir, 'browser-requests.json'), JSON.stringify(browserRequests.map(row => ({ ...row, url: row.url.replace(/([?&]cap=)[^&]+/g, '$1<redacted>') })), null, 2));
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  if (activePage) {
    try { await screenshot(activePage, 'failure-state'); } catch {}
    try { fs.writeFileSync(path.join(evidenceDir, 'failure-page-text.txt'), await activePage.locator('body').innerText()); } catch {}
  }
  const failure = { marker: 'REBUILD_CHECKPOINT9_BROWSER_UAT_FAIL', candidateSha, frontendSha, error: String(error?.stack || error) };
  fs.writeFileSync('/tmp/checkpoint9-browser-uat-failure.json', JSON.stringify(failure, null, 2));
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
} finally {
  await chromiumBrowser?.close();
}
