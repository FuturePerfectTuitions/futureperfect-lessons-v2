import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const fixture = JSON.parse(await fs.readFile('worker/fixtures/phase11/special-VR_HOWTO.json', 'utf8'));
const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  for (const item of fixture.items) {
    const id = String(item?.video?.screenpal || '').trim();
    if (!id) throw new Error(`Missing ScreenPal ID for ${item?.title || 'unknown item'}`);
    const url = `https://go.screenpal.com/player/${encodeURIComponent(id)}?ff=1&title=0&dcc=0&bg=transparent&embedded=1`;
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (!response || response.status() >= 400) {
      throw new Error(`${item.title}: ScreenPal returned HTTP ${response?.status() ?? 'no response'}`);
    }
    await page.waitForTimeout(1200);
    const text = String(await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (/whoops/i.test(text) || /doesn['’]?t live here anymore/i.test(text) || /content.*not.*(available|exist)/i.test(text)) {
      throw new Error(`${item.title}: ScreenPal reports missing content: ${text.slice(0, 240)}`);
    }
    console.log(`${item.n}. ${item.title}: ScreenPal player reachable`);
  }
  console.log(`Phase 11 VR How To ScreenPal live verification: PASS (${fixture.items.length} videos)`);
} finally {
  await browser.close();
}
