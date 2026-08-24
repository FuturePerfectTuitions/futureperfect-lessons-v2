import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const portalUrl = 'https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase11.html';
const outputDir = path.resolve('artifacts/phase11-browser');
const localPhase11Other = await fs.readFile(path.resolve('assets/phase11-other.js'), 'utf8');
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

  await page.route(/\/assets\/phase11-other\.js(?:\?.*)?$/, route => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: localPhase11Other
  }));

  page.on('requestfailed', request => {
    if (request.url().includes('/api/v1/student/')) {
      console.error(`[${activePersona}] REQUEST FAILED ${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'unknown'}`);
    }
  });
  page.on('console', message => {
    if (message.type() === 'error') console.error(`[${activePersona}] browser console: ${message.text()}`);
  });
  page.on('pageerror', error => {
    console.error(`[${activePersona}] PAGE ERROR: ${error?.stack || error?.message || error}`);
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

async function lessonDomState() {
  return page.evaluate(() => {
    const state = {};
    for (const id of ['screen-lesson', 'lesson-loading', 'lesson-error', 'lesson-content', 'video-section', 'phase9-quiz-section', 'phase9-vr-section']) {
      const node = document.getElementById(id);
      state[id] = node ? {
        hidden: Boolean(node.hidden),
        text: String(node.textContent || '').trim().slice(0, 500)
      } : null;
    }
    return state;
  });
}

async function login(username) {
  await freshPage(username);
  const startupSessionPromise = waitForStudentGet('/api/v1/student/session');
  await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const startupSession = await startupSessionPromise;
  if (startupSession.ok()) throw new Error(`Fresh Phase 11 browser context unexpectedly had an existing session for ${username}.`);

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
  await response.finished().catch(() => {});
  let responseText = '';
  try { responseText = await response.text(); } catch (_) {}
  let responseJson = null;
  try { responseJson = JSON.parse(responseText); } catch (_) {}

  const summary = {
    persona: activePersona,
    status: response.status(),
    url: response.url(),
    bodyOk: responseJson?.ok ?? null,
    lessonId: responseJson?.lesson?.lessonId || responseJson?.lesson?.id || null,
    presentation: responseJson?.lesson?.presentation || responseJson?.view?.presentation || null,
    hasVideo: Boolean(responseJson?.lesson?.video),
    hasQuiz: Boolean(responseJson?.lesson?.quiz),
    hasVr: Boolean(responseJson?.lesson?.vr),
    hasPhase11Resources: Boolean(responseJson?.lesson?.phase11Resources),
    hasPhase11OtherResources: Boolean(responseJson?.lesson?.phase11OtherResources),
    topLevelKeys: responseJson && typeof responseJson === 'object' ? Object.keys(responseJson) : []
  };
  console.log(`[${activePersona}] lesson detail ${JSON.stringify(summary)}`);

  if (activePersona === 'TestY511E') {
    await fs.writeFile(path.join(outputDir, 'TestY511E-lesson-detail.json'), responseText || '');
  }

  if (!response.ok() || !responseJson?.ok || !responseJson?.lesson) {
    throw new Error(`Phase 11 lesson-detail response rejected by base renderer: ${JSON.stringify(summary)} body=${responseText.slice(0, 1200)}`);
  }

  try {
    await page.waitForFunction(() => {
      const content = document.getElementById('lesson-content');
      const error = document.getElementById('lesson-error');
      return Boolean((content && !content.hidden) || (error && !error.hidden));
    }, null, { timeout: 10000 });
  } catch (_) {
    const dom = await lessonDomState();
    await fs.writeFile(path.join(outputDir, `${activePersona}-lesson-dom-state.json`), JSON.stringify(dom, null, 2));
    throw new Error(`Lesson-detail HTTP payload was valid but base lesson rendering never completed for ${activePersona}. DOM=${JSON.stringify(dom)}`);
  }

  const dom = await lessonDomState();
  if (dom['lesson-error'] && !dom['lesson-error'].hidden) throw new Error(`Portal rendered lesson error for ${activePersona}: ${dom['lesson-error'].text}`);
  if (!dom['lesson-content'] || dom['lesson-content'].hidden) throw new Error(`Portal did not reveal lesson content for ${activePersona}. DOM=${JSON.stringify(dom)}`);
}

async function openLessonCode(code) {
  const row = page.locator('#lesson-list .phase6-lesson-row').filter({
    has: page.locator('.phase6-lesson-code', { hasText: code })
  }).first();
  await openLessonRow(row);
}

async function assertQuizSectionHidden() {
  const quizSection = page.locator('#phase9-quiz-section');
  await quizSection.waitFor({ state: 'attached', timeout: 10000 });
  if (!(await quizSection.evaluate(el => el.hidden))) throw new Error('A separate ScreenPal Quiz section is visible; quiz must be presented only as Lesson Video in 11+ views.');
}

async function lessonPlayerSrc() {
  await page.locator('#video-frame').waitFor({ state: 'visible', timeout: 30000 });
  return page.locator('#lesson-player').getAttribute('src');
}

try {
  await login('TestY511E');
  await openSubject('#english-choice');
  await openView('Year 5 11+');
  await lessonCount(32);
  await openLessonRow(page.locator('#lesson-list .phase6-lesson-row').first());
  await page.locator('#phase9-vr-section').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('heading', { name: 'Verbal Reasoning' }).waitFor({ state: 'visible', timeout: 10000 });
  await assertQuizSectionHidden();
  await shot('04-TestY511E-English11-VR');

  await login('TestY2EM');
  await openSubject('#english-choice');
  await openView('Year 2');
  await lessonCount(29);
  await openLessonRow(page.locator('#lesson-list .phase6-lesson-row').first());
  await shot('01-TestY2EM-English-real-catalogue');

  await login('TestY5EM');
  await openSubject('#maths-choice');
  await openView('Year 5');
  await lessonCount(38);
  await page.locator('.phase6-lesson-code', { hasText: 'Y5T1M01' }).first().waitFor({ state: 'visible', timeout: 30000 });
  await openLessonCode('Y5T1M01');
  await assertQuizSectionHidden();
  const normalSrc = await lessonPlayerSrc();
  if (!normalSrc || normalSrc.includes('quiz_id=')) throw new Error(`Normal Year 5 Maths must receive the ordinary Lesson Video, got ${normalSrc}`);
  await shot('02-TestY5EM-normal-Maths-video');

  await login('TestY411M');
  await openSubject('#maths-choice');
  await openView('Level 2');
  await lessonCount(38);
  await page.locator('.phase6-lesson-code', { hasText: 'L2T1M01' }).first().waitFor({ state: 'visible', timeout: 30000 });
  await openLessonCode('L2T1M01');
  await assertQuizSectionHidden();
  await page.getByRole('heading', { name: 'Lesson Video' }).waitFor({ state: 'visible', timeout: 10000 });
  const elevenSrc = await lessonPlayerSrc();
  if (!elevenSrc || !elevenSrc.includes('quiz_id=')) throw new Error(`11+ Level 2 must receive the interactive quiz variant in Lesson Video, got ${elevenSrc}`);
  await shot('03-TestY411M-Level2-interactive-video');

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