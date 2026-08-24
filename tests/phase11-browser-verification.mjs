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
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const shot = name => page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });

async function login(username) {
  await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (await page.locator('#portal-screen').isVisible().catch(() => false)) {
    await page.locator('#logout-button').click();
    await page.locator('#login-screen').waitFor({ state: 'visible', timeout: 10000 });
  }
  await page.locator('#username').fill(username);
  await page.locator('#login-password').fill('Te12');
  await page.locator('#login-button').click();
  await page.locator('#portal-screen').waitFor({ state: 'visible', timeout: 30000 });
}

async function openSubject(selector) {
  await page.locator(selector).click();
  await page.locator('#screen-views').waitFor({ state: 'visible', timeout: 20000 });
}

async function openView(label) {
  const button = page.locator('#view-grid').getByRole('button', { name: new RegExp(label) }).first();
  await button.waitFor({ state: 'visible', timeout: 20000 });
  await button.click();
  await page.locator('#screen-lessons').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#lesson-list .phase6-lesson-row').first().waitFor({ state: 'visible', timeout: 30000 });
}

async function lessonCount(expected) {
  const count = await page.locator('#lesson-list .phase6-lesson-row').count();
  if (count !== expected) throw new Error(`Expected ${expected} visible lessons; found ${count}`);
}

async function openLessonCode(code) {
  const row = page.locator('#lesson-list .phase6-lesson-row').filter({
    has: page.locator('.phase6-lesson-code', { hasText: code })
  }).first();
  await row.waitFor({ state: 'visible', timeout: 20000 });
  await row.click();
  await page.locator('#screen-lesson').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#lesson-content').waitFor({ state: 'visible', timeout: 30000 });
}

try {
  // Combined Year 2 account: both current subjects are open and the real catalogue renders.
  await login('TestY2EM');
  await openSubject('#english-choice');
  await openView('Year 2');
  await lessonCount(29);
  await page.locator('#lesson-list .phase6-lesson-row').first().click();
  await page.locator('#lesson-content').waitFor({ state: 'visible', timeout: 30000 });
  await shot('01-TestY2EM-English-real-catalogue');

  // Normal Year 5 Maths uses Year-style aliases and must not expose the 11+ quiz.
  await login('TestY5EM');
  await openSubject('#maths-choice');
  await openView('Year 5');
  await lessonCount(38);
  await page.locator('.phase6-lesson-code', { hasText: 'Y5T1M01' }).first().waitFor({ state: 'visible', timeout: 20000 });
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
  await page.locator('.phase6-lesson-code', { hasText: 'L2T1M01' }).first().waitFor({ state: 'visible', timeout: 20000 });
  await openLessonCode('L2T1M01');
  await page.locator('#phase9-quiz-section').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByRole('button', { name: 'Open Quiz' }).waitFor({ state: 'visible', timeout: 10000 });
  await shot('03-TestY411M-Level2-quiz');

  // Year 5 11+ English gets shared core plus nested VR on the same canonical lesson.
  await login('TestY511E');
  await openSubject('#english-choice');
  await openView('Year 5 11+');
  await lessonCount(32);
  await page.locator('#lesson-list .phase6-lesson-row').first().click();
  await page.locator('#lesson-content').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#phase9-vr-section').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByRole('heading', { name: 'Verbal Reasoning' }).waitFor({ state: 'visible', timeout: 10000 });
  await shot('04-TestY511E-English11-VR');

  // Combined Year 5 11+ account exposes both English 11+ and Level 3 Maths as current.
  await login('TestY511EM');
  await openSubject('#maths-choice');
  await page.getByRole('button', { name: /Level 3/ }).waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#back-to-subjects').click();
  await openSubject('#english-choice');
  await page.getByRole('button', { name: /Year 5 11\+/ }).waitFor({ state: 'visible', timeout: 20000 });
  await shot('05-TestY511EM-combined-11plus');

  console.log('Phase 11 real-catalogue Chrome acceptance: PASS');
} finally {
  await browser.close();
}
