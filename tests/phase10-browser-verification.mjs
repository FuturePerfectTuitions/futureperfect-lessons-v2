import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const mockPassword = process.env.PHASE10_TEST_MOCK_PASSWORD || '';
if (!mockPassword) throw new Error('PHASE10_TEST_MOCK_PASSWORD is required');
const portalUrl = 'https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase10.html';
const outputDir = path.resolve('artifacts/phase10-browser');
await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const shot = name => page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });

try {
  await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#username').fill('test0505');
  await page.locator('#login-password').fill('M5ok');
  await page.locator('#login-button').click();
  await page.locator('#portal-screen').waitFor({ state: 'visible', timeout: 30000 });

  await page.locator('#maths-choice').click();
  await page.getByRole('button', { name: /Level 3/ }).click();
  await page.locator('#screen-lessons').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /Year 5 11\+ Mock Tests/ }).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByRole('button', { name: /11\+ Maths Assessments — Year 5 Term 1/ }).waitFor({ state: 'visible' });
  await shot('01-maths-level3-special-areas');

  await page.getByRole('button', { name: /Year 5 11\+ Mock Tests/ }).click();
  await page.locator('#screen-special').waitFor({ state: 'visible' });
  await page.getByText('Maths Mock 1 — Answer Video').waitFor({ state: 'visible' });
  await page.getByText('VR Mock 1 — Answer Video').waitFor({ state: 'visible' });
  const lockedSrc = await page.locator('#phase10-video-player').getAttribute('src');
  if (lockedSrc && lockedSrc !== 'about:blank') throw new Error(`Locked mock exposed a player src: ${lockedSrc}`);

  const form = page.locator('.phase10-mock-form').first();
  const input = form.locator('input[type="password"]');
  await input.fill('wrong-password');
  await form.getByRole('button', { name: /Unlock Mock 1/ }).click();
  await form.getByText('That daily password is not correct.').waitFor({ state: 'visible' });
  await input.fill(mockPassword);
  await form.getByRole('button', { name: /Unlock Mock 1/ }).click();
  await page.getByText('Unlocked this session').waitFor({ state: 'visible' });
  const watchButtons = page.locator('.phase10-mock-video-row button', { hasText: 'Watch' });
  if (await watchButtons.count() !== 2) throw new Error('Expected Maths and VR mock videos after unlock');
  await shot('02-mock-day-unlocked');

  await watchButtons.first().click();
  const unlockedSrc = await page.locator('#phase10-video-player').getAttribute('src');
  if (!unlockedSrc?.startsWith('https://go.screenpal.com/player/')) throw new Error(`Unexpected unlocked URL: ${unlockedSrc}`);
  await page.locator('#phase10-close-video').click();
  await page.locator('#phase10-back-to-lessons').click();
  await page.locator('#back-to-views').click();
  await page.locator('#back-to-subjects').click();

  await page.locator('#english-choice').click();
  await page.getByRole('button', { name: /Year 5 11\+/ }).click();
  await page.getByRole('button', { name: /^VR How-To/ }).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByRole('button', { name: /Year 5 11\+ Mock Tests/ }).waitFor({ state: 'visible' });
  await shot('03-english-11plus-special-areas');
  await page.getByRole('button', { name: /^VR How-To/ }).click();
  await page.getByText('VR How-To — Technique 1').waitFor({ state: 'visible' });
  await shot('04-vr-howto');
  console.log('Phase 10 real Chrome acceptance: PASS');
} finally {
  await browser.close();
}
