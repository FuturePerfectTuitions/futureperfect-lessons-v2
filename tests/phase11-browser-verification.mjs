import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const portalUrl = 'https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase11.html';
const outputDir = path.resolve('artifacts/phase11-browser');
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

let context = null;
let page = null;
let activePersona = 'unknown';

async function freshPage(username) {
  if (context) await context.close().catch(() => {});
  context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  page = await context.newPage();
  activePersona = username;

  page.on('requestfailed', request => {
    if (request.url().includes('/api/v1/student/')) {
      console.error(`[${activePersona}] REQUEST FAILED ${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'unknown'}`);
    }
  });
  page.on('console', message => {
    if (message.type() === 'error') console.error(`[${activePersona}] browser console: ${message.text()}`);
  });
}

const shot = name => page?.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });

function waitForStudentGet(pathname, timeout = 30000) {
  return page.waitForResponse(response => {
    try {
      const url = new URL(response.url());
      return response.request().method() === 'GET' && url.pathname.endsWith(pathname);
    } catch (_) {
      return false;
    }
  }, { timeout });
}

function waitForLessonDetail(timeout = 60000) {
  return page.waitForResponse(response => {
    try {
      const url = new URL(response.url());
      return response.request().method() === 'GET' && url.pathname.includes('/api/v1/student/lessons/');
    } catch (_) {
      return false;
    }
  }, { timeout });
}

async function responseDiagnostic(response) {
  let body = '';
  try { body = await response.text(); } catch (_) {}
  return `HTTP ${response.status()} ${response.url()}${body ? ` body=${body.slice(0, 1200)}` : ''}`;
}

async function login(username) {
  await freshPage(username);

  // Each persona gets a completely fresh browser context. This prevents test-only
  // cookie/session/navigation state from one TestY* account leaking into another,
  // and mirrors the portal's single-device/session model more accurately.
  const startupSessionPromise = waitForStudentGet('/api/v1/student/session');
  await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const startupSession = await startupSessionPromise;
  if (startupSession.ok()) {
    throw new Error(`Fresh Phase 11 browser context unexpectedly had an existing session for ${username}.`);
  }

  await page.locator('#login-screen').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#username').fill(username);
  await page.locator('#login-password').fill('Te12');
  await page.locator('#login-button').click();

  await page.locator('#portal-screen').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => {
    const button = document.getElementById('login-button');
    return Boolean(button && button.disabled === false);
  }, null, { timeout: 90000 });
  await page.locator('#student-greeting').filter({ hasText: username }).waitFor({ state: 'visible', timeout: 10000 });
}

async function openSubject(selector) {
  await page.locator(selector).click();
  await page.locator('#screen-views').waitFor({ state: 'visible', timeout: 60000 });
}

async function openView(label) {
  const button = page.locator('#view-grid').getByRole('button', { name: new RegExp(label) }).first();
  await button.waitFor({ state: 'visible', timeout: 30000 });
  await button.click();
  await page.locator('#screen-lessons').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#lesson-list .phase6-lesson-row').first().waitFor({ state: 'visible', timeout: 60000 });
}

async function lessonCount(expected) {
  const count = await page.locator('#lesson-list .phase6-lesson-row').count();
  if (count !== expected) throw new Error(`Expected ${expected} visible lessons; found ${count}`);
}

async function openLessonRow(row) {
  await row.waitFor({ state: 'visible', timeout: 30000 });
  const detailPromise = waitForLessonDetail();
  await row.click();
  await page.locator('#screen-lesson').waitFor({ state: 'visible', timeout: 30000 });

  const response = await detailPromise;
  if (!response.ok()) {
    throw new Error(`Phase 11 lesson-detail request failed: ${await responseDiagnostic(response)}`);
  }

  await Promise.race([
    page.locator('#lesson-content').waitFor({ state: 'visible', timeout: 60000 }),
    page.locator('#lesson-error').waitFor({ state: 'visible', timeout: 60000 }).then(async () => {
      throw new Error(`Lesson detail returned HTTP ${response.status()} but the portal rendered an error: ${await page.locator('#lesson-error').innerText()}`);
    })
  ]);
}

async function openLessonCode(code) {
  const row = page.locator('#lesson-list .phase6-lesson-row').filter({
    has: page.locator('.phase6-lesson-code', { hasText: code })
  }).first();
  await openLessonRow(row);
}

try {
  // Combined Year 2 account: both current subjects are open and the real catalogue renders.
  await login('TestY2EM');
  await openSubject('#english-choice');
  await openView('Year 2');
  await lessonCount(29);
  await openLessonRow(page.locator('#lesson-list .phase6-lesson-row').first());
  await shot('01-TestY2EM-English-real-catalogue');

  // Normal Year 5 Maths uses Year-style aliases and must not expose the 11+ quiz.
  await login('TestY5EM');
  await openSubject('#maths-choice');
  await openView('Year 5');
  await lessonCount(38);
  await page.locator('.phase6-lesson-code', { hasText: 'Y5T1M01' }).first().waitFor({ state: 'visible', timeout: 30000 });
  await openLessonCode('Y5T1M01');
  await page.locator('#phase9-quiz-section').waitFor({ state: 'attached', timeout: 10000 });
  if (!(await page.locator('#phase9-quiz-section').evaluate(el => el.hidden))) {
    throw new Error('Normal Year 5 Maths incorrectly exposes the 11+ quiz section.');
  }
  await shot('02-TestY5EM-normal-Maths-no-quiz');

  // Year 4 11+ Maths sees the same canonical Y5M1 as Level 2 and gets the quiz.
  await login('TestY411M');
  await openSubject('#maths-choice');
  await openView('Level 2');
  await lessonCount(38);
  await page.locator('.phase6-lesson-code', { hasText: 'L2T1M01' }).first().waitFor({ state: 'visible', timeout: 30000 });
  await openLessonCode('L2T1M01');
  await page.locator('#phase9-quiz-section').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('button', { name: 'Open Quiz' }).waitFor({ state: 'visible', timeout: 10000 });
  await shot('03-TestY411M-Level2-quiz');

  // Year 5 11+ English gets shared core plus nested VR on the same canonical lesson.
  await login('TestY511E');
  await openSubject('#english-choice');
  await openView('Year 5 11+');
  await lessonCount(32);
  await openLessonRow(page.locator('#lesson-list .phase6-lesson-row').first());
  await page.locator('#phase9-vr-section').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('heading', { name: 'Verbal Reasoning' }).waitFor({ state: 'visible', timeout: 10000 });
  await shot('04-TestY511E-English11-VR');

  // Combined Year 5 11+ account exposes both English 11+ and Level 3 Maths as current.
  await login('TestY511EM');
  await openSubject('#maths-choice');
  await page.getByRole('button', { name: /Level 3/ }).waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#back-to-subjects').click();
  await openSubject('#english-choice');
  await page.getByRole('button', { name: /Year 5 11\+/ }).waitFor({ state: 'visible', timeout: 30000 });
  await shot('05-TestY511EM-combined-11plus');

  console.log('Phase 11 real-catalogue Chrome acceptance: PASS');
} catch (error) {
  await shot('00-phase11-browser-failure').catch(() => {});
  throw error;
} finally {
  if (context) await context.close().catch(() => {});
  await browser.close();
}
