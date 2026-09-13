import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const base = new URL(process.env.CP10_BROWSER_BASE_URL || 'https://fpt-portal-v2-rebuild-browser-staging-cp9.futureperfectlessons.workers.dev');
const loginPassword = String(process.env.UAT_LOGIN_PASSWORD || '');
const answerPassword = String(process.env.UAT_ANSWER_PASSWORD || '');
const candidateSha = String(process.env.GITHUB_SHA || '');
const seed = JSON.parse(fs.readFileSync('/tmp/checkpoint9-seed-summary.json', 'utf8'));
const selected = seed.selected || {};

const thresholds = Object.freeze({
  warmCatalogueMs: 300,
  coldCatalogueMs: 800,
  lessonDetailMs: 800,
  loginBootstrapMs: 1500,
  boundedFailureMs: 10000,
  heartbeatObservationMs: 31000
});

function validFour(value) {
  return /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{4}$/.test(String(value));
}
assert(validFour(loginPassword), 'Missing/invalid CP10 UAT login password');
assert(validFour(answerPassword), 'Missing/invalid CP10 Answer Pack password');

function percentile(values, p) {
  const rows = [...values].sort((a, b) => a - b);
  const index = Math.min(rows.length - 1, Math.max(0, Math.ceil(p * rows.length) - 1));
  return rows[index];
}
function stats(values) {
  const rows = values.map(value => Math.round(value));
  return {
    samplesMs: rows,
    minMs: Math.min(...rows),
    medianMs: percentile(rows, 0.5),
    p80Ms: percentile(rows, 0.8),
    maxMs: Math.max(...rows)
  };
}
function hostOf(value) { try { return new URL(value).hostname; } catch { return ''; } }
const screenPalHosts = new Set(['screenpal.com', 'www.screenpal.com', 'go.screenpal.com']);

const appSource = fs.readFileSync('cp7-frontend/src/app.js', 'utf8');
const viewerSource = fs.readFileSync('cp7-frontend/src/protected-viewer.js', 'utf8');
assert(!/new\s+Blob\s*\(/.test(appSource), 'Ordinary app reconstructs a Blob');
assert(!/URL\.createObjectURL\s*\(/.test(appSource), 'Ordinary app uses object URLs');
assert(!/\.blob\s*\(/.test(appSource), 'Ordinary app reads ordinary resource as Blob');
assert(!/heartbeat/i.test(appSource + '\n' + viewerSource), 'Heartbeat code remains in accepted frontend');
assert(!/setInterval\s*\(/.test(viewerSource), 'Protected viewer contains recurring interval');
assert(/NETWORK_TIMEOUT_MS\s*=\s*Number\(config\.networkTimeoutMs\s*\|\|\s*8_000\)/.test(appSource), 'Frontend default metadata/API deadline is not 8 seconds');

const browser = await chromium.launch({ headless: true });
const allRequests = [];
const assertions = {};
const measurements = {
  loginBootstrapMs: [],
  subjectClickMs: [],
  warmCatalogueMs: [],
  lessonDetailMs: []
};

function track(page, label) {
  page.on('request', request => allRequests.push({ label, url: request.url(), method: request.method(), at: Date.now() }));
}
function apiCount() {
  return allRequests.filter(row => {
    try { return new URL(row.url).pathname.startsWith('/api/v2/'); } catch { return false; }
  }).length;
}
function screenPalCount() {
  return allRequests.filter(row => screenPalHosts.has(hostOf(row.url))).length;
}
async function gotoLogin(page) {
  await page.goto(base.href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Student Login' }).waitFor({ state: 'visible', timeout: 15000 });
}
async function login(page, username) {
  await gotoLogin(page);
  await page.getByLabel('Username').fill(username);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(loginPassword);
  const started = performance.now();
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('heading', { name: /Welcome/ }).waitFor({ state: 'visible', timeout: 10000 });
  return performance.now() - started;
}
async function subjectLocal(page, subject) {
  const beforeApi = apiCount();
  const result = await page.evaluate(subjectName => {
    const button = [...document.querySelectorAll('[data-subject]')].find(row => row.dataset.subject === subjectName);
    if (!button) throw new Error(`Missing subject ${subjectName}`);
    const started = performance.now();
    button.click();
    const heading = document.querySelector('h1')?.textContent || '';
    return { elapsed: performance.now() - started, heading };
  }, subject.toLowerCase());
  await page.waitForTimeout(60);
  assert.equal(apiCount(), beforeApi, `${subject} subject click made a network/API call`);
  assert.equal(result.heading.trim().toLowerCase(), subject.toLowerCase(), `${subject} subject screen did not render synchronously`);
  measurements.subjectClickMs.push(result.elapsed);
}
async function openView(page, viewId) {
  const started = performance.now();
  await page.locator(`[data-view="${viewId}"]`).click();
  await page.getByLabel('Search lessons').waitFor({ state: 'visible', timeout: 10000 });
  return performance.now() - started;
}
async function backToViews(page, heading) {
  await page.locator('#back-views').click();
  await page.getByRole('heading', { name: heading, exact: true }).waitFor({ timeout: 3000 });
}
async function openLesson(page, lessonId) {
  const started = performance.now();
  await page.locator(`[data-lesson="${lessonId}"]`).click();
  await page.locator('.lesson-heading').waitFor({ state: 'visible', timeout: 10000 });
  return performance.now() - started;
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  track(page, 'main');
  measurements.loginBootstrapMs.push(await login(page, 'cp9normal'));

  await subjectLocal(page, 'Maths');
  const beforeColdScreenPal = screenPalCount();
  measurements.coldCatalogueMs = await openView(page, 'maths-year6');
  assert.equal(screenPalCount(), beforeColdScreenPal, 'Catalogue navigation contacted ScreenPal before View');
  assert(measurements.coldCatalogueMs < thresholds.coldCatalogueMs, `Cold Year/Level catalogue ${measurements.coldCatalogueMs.toFixed(1)}ms >= ${thresholds.coldCatalogueMs}ms`);

  for (let i = 0; i < 5; i += 1) {
    await backToViews(page, 'Maths');
    measurements.warmCatalogueMs.push(await openView(page, 'maths-year6'));
  }
  const warmStats = stats(measurements.warmCatalogueMs);
  assert(warmStats.medianMs < thresholds.warmCatalogueMs, `Warm catalogue median ${warmStats.medianMs}ms >= ${thresholds.warmCatalogueMs}ms`);
  assert(warmStats.p80Ms < thresholds.warmCatalogueMs, `Warm catalogue p80 ${warmStats.p80Ms}ms >= ${thresholds.warmCatalogueMs}ms`);
  assert(warmStats.maxMs < thresholds.coldCatalogueMs, `Warm catalogue outlier ${warmStats.maxMs}ms >= cold target ${thresholds.coldCatalogueMs}ms`);

  for (let i = 0; i < 5; i += 1) {
    const before = screenPalCount();
    measurements.lessonDetailMs.push(await openLesson(page, selected.ordinary));
    assert.equal(screenPalCount(), before, 'Lesson detail contacted ScreenPal before View');
    const player = page.locator('#lesson-player');
    assert.equal(await player.count(), 1, 'Expected lazy lesson video iframe');
    assert(!(await player.getAttribute('src')), 'Video iframe had a src before View');
    if (i < 4) {
      await page.locator('#back-lessons').click();
      await page.getByLabel('Search lessons').waitFor({ timeout: 3000 });
    }
  }
  const lessonStats = stats(measurements.lessonDetailMs);
  assert(lessonStats.medianMs < thresholds.lessonDetailMs, `Lesson detail median ${lessonStats.medianMs}ms >= ${thresholds.lessonDetailMs}ms`);
  assert(lessonStats.p80Ms < thresholds.lessonDetailMs, `Lesson detail p80 ${lessonStats.p80Ms}ms >= ${thresholds.lessonDetailMs}ms`);
  assert(lessonStats.maxMs < 5000, `Lesson detail had unbounded sample ${lessonStats.maxMs}ms`);
  assertions.zeroVideoBeforeView = true;

  const beforeViewScreenPal = screenPalCount();
  const screenPalRequest = page.waitForRequest(request => screenPalHosts.has(hostOf(request.url())), { timeout: 15000 });
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await screenPalRequest;
  assert.equal(beforeViewScreenPal, 0, 'ScreenPal was contacted before first View');
  assert(screenPalCount() > beforeViewScreenPal, 'View did not initiate ScreenPal request');
  assertions.videoLazy = true;

  const ordinaryLink = page.locator('[data-direct-resource]').first();
  assert.equal(await ordinaryLink.count(), 1, 'Ordinary direct resource link missing');
  const ordinaryHref = await ordinaryLink.getAttribute('href');
  assert(ordinaryHref && ordinaryHref.includes('/api/v2/student/lessons/'), 'Ordinary resource is not direct capability navigation');
  assertions.ordinaryPdfDirectNavigationNoBlob = true;

  const answerButton = page.locator('[data-answer]').first();
  assert.equal(await answerButton.count(), 1, 'Answer Pack control missing');
  let answerAuthorizations = 0;
  page.on('request', request => {
    try {
      const url = new URL(request.url());
      if (request.method() === 'POST' && /\/api\/v2\/student\/lessons\/[^/]+\/resources\/[^/]+\/open$/.test(url.pathname)) answerAuthorizations += 1;
    } catch {}
  });
  for (let openIndex = 0; openIndex < 2; openIndex += 1) {
    await answerButton.click();
    const passwordInput = page.getByLabel('Answer Pack password');
    await passwordInput.waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await page.locator('#protected-viewer-modal').count(), 0, 'Answer Pack viewer reopened without password');
    await passwordInput.fill(answerPassword);
    await page.getByRole('button', { name: 'Open Answer Pack' }).click();
    await page.locator('.protected-page canvas').first().waitFor({ state: 'visible', timeout: 30000 });
    if (openIndex === 0) {
      await page.getByRole('button', { name: 'Close protected viewer' }).click();
      await page.locator('#protected-viewer-modal').waitFor({ state: 'detached', timeout: 3000 });
    }
  }
  assert.equal(answerAuthorizations, 2, 'Answer Pack was not re-authorised on every open');
  const apiBeforeHeartbeatWindow = apiCount();
  await page.waitForTimeout(thresholds.heartbeatObservationMs);
  assert.equal(apiCount(), apiBeforeHeartbeatWindow, 'Recurring Answer Pack API heartbeat detected');
  assertions.answerPasswordEveryOpen = true;
  assertions.noAnswerHeartbeat = true;
  await context.close();

  for (let i = 0; i < 4; i += 1) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    track(p, `login-${i + 2}`);
    measurements.loginBootstrapMs.push(await login(p, 'cp9normal'));
    await ctx.close();
  }
  const loginStats = stats(measurements.loginBootstrapMs);
  assert(loginStats.medianMs < thresholds.loginBootstrapMs, `Login/bootstrap median ${loginStats.medianMs}ms >= ${thresholds.loginBootstrapMs}ms`);
  assert(loginStats.p80Ms < thresholds.loginBootstrapMs, `Login/bootstrap p80 ${loginStats.p80Ms}ms >= ${thresholds.loginBootstrapMs}ms`);
  assert(loginStats.maxMs < 5000, `Login/bootstrap had unbounded sample ${loginStats.maxMs}ms`);

  {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    track(p, 'locked-preview');
    await login(p, 'cp9l2');
    await subjectLocal(p, 'Maths');
    await openView(p, 'maths-level2');
    const beforeRequests = allRequests.length;
    await openLesson(p, selected.blocked);
    await p.getByText(/visible as a preview/).waitFor({ timeout: 3000 });
    assert.equal(await p.locator('[data-direct-resource]').count(), 0, 'Locked preview exposed direct resource capability');
    assert.equal(await p.locator('[data-answer]').count(), 0, 'Locked preview exposed Answer Pack control');
    assert.equal(await p.locator('#lesson-player').count(), 0, 'Locked preview exposed video player');
    const leaked = allRequests.slice(beforeRequests).filter(row => /\/resources\/|[?&]cap=/.test(row.url));
    assert.equal(leaked.length, 0, 'Locked preview emitted resource capability request');
    assertions.lockedPreviewZeroCapabilities = true;
    await ctx.close();
  }

  {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    track(p, 'bounded-failure');
    await login(p, 'cp9pre');
    await subjectLocal(p, 'English');
    await p.route('**/api/v2/student/views/english-year5/lessons', async route => {
      await new Promise(resolve => setTimeout(resolve, 12000));
      try { await route.continue(); } catch {}
    });
    const started = performance.now();
    await p.locator('[data-view="english-year5"]').click();
    await p.getByRole('button', { name: 'Try again' }).waitFor({ state: 'visible', timeout: thresholds.boundedFailureMs + 1000 });
    measurements.boundedFailureMs = performance.now() - started;
    assert(measurements.boundedFailureMs <= thresholds.boundedFailureMs, `Metadata failure was not bounded: ${measurements.boundedFailureMs.toFixed(1)}ms`);
    assert.equal(await p.locator('.spinner').count(), 0, 'Infinite spinner remained after bounded failure');
    assertions.boundedMetadataFailure = true;
    assertions.zeroInfiniteSpinner = true;
    await ctx.close();
  }

  const result = {
    marker: 'REBUILD_CHECKPOINT10_ACCEPTANCE_THRESHOLDS_PASS',
    candidateSha,
    frontendSha: 'a4513da67ee66f51212114620c8e401bd5e31a8c',
    thresholds,
    methodology: {
      normalCriterion: 'median and p80 below target across five samples; single cold catalogue must be below cold target',
      subjectClick: 'synchronous local render with zero API requests',
      coldCatalogue: 'first Year 6 catalogue after fresh staging deploy/login, measured click-to-render',
      warmCatalogue: 'five repeated same-session Year 6 click-to-render samples',
      lessonDetail: 'five repeated canonical lesson click-to-render samples',
      loginBootstrap: 'five fresh browser contexts, login click-to-Welcome',
      heartbeatObservationMs: thresholds.heartbeatObservationMs
    },
    measurements: {
      ...measurements,
      subjectClick: stats(measurements.subjectClickMs),
      loginBootstrap: loginStats,
      warmCatalogue: warmStats,
      lessonDetail: lessonStats
    },
    assertions,
    staticContracts: {
      ordinaryBlobReconstructionAbsent: true,
      heartbeatCodeAbsent: true,
      protectedViewerRecurringIntervalAbsent: true,
      defaultNetworkTimeoutMs: 8000
    },
    requestCount: allRequests.length
  };
  fs.writeFileSync('/tmp/checkpoint10-acceptance-summary.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const failure = {
    marker: 'REBUILD_CHECKPOINT10_ACCEPTANCE_THRESHOLDS_FAIL',
    candidateSha,
    error: String(error?.stack || error),
    measurements,
    requests: allRequests.slice(-40).map(row => ({ ...row, url: row.url.replace(/([?&]cap=)[^&]+/g, '$1<redacted>') }))
  };
  fs.writeFileSync('/tmp/checkpoint10-acceptance-failure.json', JSON.stringify(failure, null, 2));
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
