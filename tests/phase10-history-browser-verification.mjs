import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const portalUrl = 'https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase10.html';
const outputDir = path.resolve('artifacts/phase10-history-browser');
await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const shot = name => page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });

async function readGroups() {
  await page.locator('#view-grid > .phase10-view-group').first().waitFor({ state: 'visible', timeout: 20000 });
  return page.locator('#view-grid > .phase10-view-group').evaluateAll(sections => sections.map(section => ({
    heading: section.querySelector(':scope > .phase5-eyebrow')?.textContent?.trim() || '',
    views: [...section.querySelectorAll('.phase6-view-card-title')].map(node => node.textContent?.trim() || '')
  })));
}

function assertJson(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} mismatch. Got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

try {
  await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#username').fill('test0707');
  await page.locator('#login-password').fill('H7st');
  await page.locator('#login-button').click();
  await page.locator('#portal-screen').waitFor({ state: 'visible', timeout: 30000 });

  await page.locator('#maths-choice').click();
  const mathsGroups = await readGroups();
  assertJson(mathsGroups, [
    { heading: 'Current', views: ['Year 5'] },
    { heading: 'Previous', views: ['Year 3', 'Year 4'] }
  ], 'Maths grouping');
  await shot('01-maths-current-previous');

  await page.locator('#view-grid > .phase10-view-group').filter({ hasText: 'Previous' }).getByRole('button', { name: /Year 4/ }).click();
  await page.locator('#screen-lessons').waitFor({ state: 'visible' });
  await page.getByText('Year 4 History Proof').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#back-to-views').click();
  await page.locator('#back-to-subjects').click();

  await page.locator('#english-choice').click();
  const englishGroups = await readGroups();
  assertJson(englishGroups, [
    { heading: 'Current', views: ['Year 5'] },
    { heading: 'Previous', views: ['Year 4'] }
  ], 'English grouping');
  if (await page.getByRole('button', { name: /^Year 3/ }).count()) throw new Error('English incorrectly shows Year 3 history');
  await shot('02-english-current-previous');

  await page.locator('#view-grid > .phase10-view-group').filter({ hasText: 'Previous' }).getByRole('button', { name: /Year 4/ }).click();
  await page.getByText('Year 4 English History Proof').waitFor({ state: 'visible', timeout: 20000 });
  await shot('03-english-year4-history');

  console.log('Phase 10 multi-year history real Chrome acceptance: PASS');
} finally {
  await browser.close();
}
