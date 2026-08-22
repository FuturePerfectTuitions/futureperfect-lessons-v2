import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const PAGE_URL = 'https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase9.html';
const OUT_DIR = 'artifacts/phase9-browser';

await fs.mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox']
});

function attachDiagnostics(page, label) {
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) {
      console.log(`[${label}] console ${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', error => {
    console.log(`[${label}] pageerror: ${error.message}`);
  });
}

async function login(page, username, password) {
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.locator('#login-button').click();
  await page.locator('#portal-screen').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#screen-subjects').waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await page.locator('#login-error').isHidden(), true, `${username}: login error should be hidden`);
}

async function openEnglishLesson(page, viewLabel) {
  await page.locator('#english-choice').click();
  await page.locator('#screen-views').waitFor({ state: 'visible', timeout: 10000 });

  const title = page.locator('#view-grid .phase6-view-card-title').filter({ hasText: new RegExp(`^${viewLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first();
  await title.waitFor({ state: 'visible', timeout: 10000 });
  const card = title.locator('xpath=ancestor::button[1]');
  await card.click();

  await page.locator('#screen-lessons').waitFor({ state: 'visible', timeout: 10000 });
  const row = page.locator('#lesson-list .phase6-lesson-row').filter({ hasText: 'Y5T3E99' }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  await row.click();

  await page.locator('#screen-lesson').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#lesson-content').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#lesson-code').filter({ hasText: /^Y5T3E99$/ }).waitFor({ state: 'visible', timeout: 10000 });

  // Phase 9 captures the lesson response before Phase 7 renders and then retries
  // until #lesson-content becomes visible. Allow that short render hand-off to finish.
  await page.waitForTimeout(450);
}

async function safeLogout(page) {
  try {
    if (await page.locator('#portal-screen').isVisible()) {
      await page.locator('#logout-button').click();
      await page.locator('#login-screen').waitFor({ state: 'visible', timeout: 10000 });
    }
  } catch (error) {
    console.log(`Logout cleanup warning: ${error.message}`);
  }
}

async function verifyNormalEnglish() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();
  attachDiagnostics(page, 'normal');

  try {
    await login(page, 'test0202', 'E2ng');
    await openEnglishLesson(page, 'Year 5');

    assert.equal(await page.locator('#lesson-code').textContent(), 'Y5T3E99');
    assert.equal(await page.locator('#phase9-quiz-section').isHidden(), true, 'Normal English must not render ScreenPal Quiz');
    assert.equal(await page.locator('#phase9-vr-section').isHidden(), true, 'Normal English must not render Verbal Reasoning');
    assert.equal(await page.getByRole('heading', { name: 'ScreenPal Quiz', exact: true }).isVisible(), false, 'Normal English must not expose quiz heading');
    assert.equal(await page.getByRole('heading', { name: 'Verbal Reasoning', exact: true }).isVisible(), false, 'Normal English must not expose VR heading');

    const answerButton = page.getByRole('button', { name: 'Open Answer Pack', exact: true }).first();
    await answerButton.waitFor({ state: 'visible', timeout: 10000 });
    await answerButton.click();
    await page.locator('#phase8-answer-modal').waitFor({ state: 'visible', timeout: 5000 });
    assert.match(
      (await page.locator('#phase8-answer-prompt').textContent()) || '',
      /asked again every time/i,
      'Ordinary Answer Pack should retain the Phase 8 prompt-every-open wording'
    );
    await page.locator('#phase8-answer-close').click();
    await page.locator('#phase8-answer-modal').waitFor({ state: 'hidden', timeout: 5000 });

    await page.screenshot({ path: `${OUT_DIR}/normal-english.png`, fullPage: true });
    console.log('Browser check passed: normal English renders core lesson only, with Phase 8 protected Answer Pack UI and no Quiz/VR sections.');
  } finally {
    await safeLogout(page);
    await context.close();
  }
}

async function verifyElevenPlusEnglish() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();
  attachDiagnostics(page, '11plus');

  try {
    await login(page, 'test0404', 'E4vr');
    await openEnglishLesson(page, 'Year 5 11+');

    assert.equal(await page.locator('#lesson-code').textContent(), 'Y5T3E99');
    await page.locator('#phase9-quiz-section').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#phase9-vr-section').waitFor({ state: 'visible', timeout: 10000 });

    assert.equal(await page.getByRole('heading', { name: 'ScreenPal Quiz', exact: true }).isVisible(), true, '11+ English should render ScreenPal Quiz');
    assert.equal(await page.getByRole('heading', { name: 'Verbal Reasoning', exact: true }).isVisible(), true, '11+ English should render Verbal Reasoning');

    const order = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('.phase7-resource-sections > section')].map(section => section.id);
      return ids;
    });
    const videoIndex = order.indexOf('video-section');
    const quizIndex = order.indexOf('phase9-quiz-section');
    const homeworkIndex = order.indexOf('homework-section');
    const otherIndex = order.indexOf('other-section');
    const vrIndex = order.indexOf('phase9-vr-section');
    assert(videoIndex >= 0 && quizIndex > videoIndex && homeworkIndex > quizIndex, `Quiz section order is wrong: ${order.join(', ')}`);
    assert(otherIndex >= 0 && vrIndex > otherIndex, `VR section should follow Other Resources: ${order.join(', ')}`);

    const vrText = (await page.locator('#phase9-vr-section').textContent()) || '';
    for (const expected of ['VR PreLesson', 'VR PreLesson Video', 'VR Homework', 'VR Homework Solution Video', 'Answer Key', 'Answer Pack']) {
      assert(vrText.includes(expected), `11+ VR section is missing ${expected}`);
    }

    await page.screenshot({ path: `${OUT_DIR}/english-11plus.png`, fullPage: true });

    const quizButton = page.locator('#phase9-quiz-section').getByRole('button', { name: 'Open Quiz', exact: true });
    await quizButton.click();
    const quizMessage = page.locator('#phase9-quiz-message');
    await page.waitForFunction(() => {
      const message = document.getElementById('phase9-quiz-message');
      return Boolean(
        message &&
        !message.hidden &&
        /gated correctly for 11\+/i.test(message.textContent || '')
      );
    }, null, { timeout: 10000 });
    assert.match(
      (await quizMessage.textContent()) || '',
      /gated correctly for 11\+/i,
      'Bare-ID development quiz should remain safely gated and explain that the explicit ScreenPal URL is required'
    );

    const protectedVrButton = page.locator('#phase9-vr-section .phase9-protected-button').first();
    await protectedVrButton.waitFor({ state: 'visible', timeout: 10000 });
    await protectedVrButton.click();
    await page.locator('#phase9-answer-overlay').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await page.locator('#phase9-answer-password').inputValue(), '', 'Protected VR password field should start empty');
    assert.match(
      (await page.locator('#phase9-answer-prompt-panel').textContent()) || '',
      /asked again every time/i,
      'Protected VR answer should use the prompt-every-open contract'
    );

    await page.locator('#phase9-answer-password').fill('V4ra');
    await page.locator('#phase9-answer-submit').click();
    await page.locator('#phase9-answer-viewer-panel').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#phase9-viewer-pages canvas').first().waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await page.locator('#phase9-viewer-error').isHidden(), true, 'Protected VR PDF viewer should not show an error');
    await page.screenshot({ path: `${OUT_DIR}/protected-vr-answer.png`, fullPage: true });

    await page.locator('#phase9-viewer-close').click();
    await page.locator('#phase9-answer-overlay').waitFor({ state: 'hidden', timeout: 5000 });

    // Re-open the same protected answer: the prompt must be shown again and the
    // password field must not remember the previous password.
    await protectedVrButton.click();
    await page.locator('#phase9-answer-overlay').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await page.locator('#phase9-answer-prompt-panel').isVisible(), true, 'Protected VR answer must prompt again on reopen');
    assert.equal(await page.locator('#phase9-answer-viewer-panel').isHidden(), true, 'Protected VR viewer must not be remembered across opens');
    assert.equal(await page.locator('#phase9-answer-password').inputValue(), '', 'Protected VR password must not be remembered');
    await page.locator('#phase9-answer-close').click();

    const vrVideoButton = page.locator('#phase9-vr-section .phase9-video-button').first();
    await vrVideoButton.click();
    const vrFrame = page.locator('#phase9-vr-section iframe[title="VR PreLesson Video"]');
    await page.waitForFunction(() => {
      const frame = document.querySelector('#phase9-vr-section iframe[title="VR PreLesson Video"]');
      return Boolean(frame && frame.getAttribute('src')?.startsWith('https://go.screenpal.com/player/'));
    }, null, { timeout: 10000 });
    assert.match(await vrFrame.getAttribute('src') || '', /^https:\/\/go\.screenpal\.com\/player\//);

    console.log('Browser check passed: English 11+ renders Quiz + VR in the correct structure, protected VR answers render through the Phase 8-style PDF viewer and prompt again on reopen.');
  } finally {
    await safeLogout(page);
    await context.close();
  }
}

try {
  await verifyNormalEnglish();
  await verifyElevenPlusEnglish();
  console.log('Phase 9 browser acceptance verification passed.');
} finally {
  await browser.close();
}