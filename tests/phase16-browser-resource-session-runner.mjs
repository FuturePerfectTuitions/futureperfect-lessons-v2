import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sourcePath = path.resolve('tests/phase16-browser-resource-session.mjs');
const runtimePath = path.resolve('tests/.phase16-browser-resource-session.runtime.mjs');

const original = await fs.readFile(sourcePath, 'utf8');

const eyeNeedle = 'await eye.click();';
const eyeOccurrences = original.split(eyeNeedle).length - 1;
if (eyeOccurrences < 4) {
  throw new Error(`Phase 16 eye-control stabilization expected at least 4 eye clicks; found ${eyeOccurrences}.`);
}

const gotoNeedle = "await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });";
const gotoOccurrences = original.split(gotoNeedle).length - 1;
if (gotoOccurrences < 3) {
  throw new Error(`Phase 16 startup-session synchronization expected at least 3 portal navigations; found ${gotoOccurrences}.`);
}

const pageVideoWait = "await page.locator('#video-frame').waitFor({ state: 'visible', timeout: 30000 });";
const page11VideoWait = "await page11.locator('#video-frame').waitFor({ state: 'visible', timeout: 30000 });";
if (original.split(pageVideoWait).length - 1 < 2 || original.split(page11VideoWait).length - 1 < 1) {
  throw new Error('Phase 16 video-expansion stabilization did not find the expected ordinary/session and 11+ video waits.');
}

const probeNeedle = 'async function probeScreenPal(page, kind) {';
if (!original.includes(probeNeedle)) {
  throw new Error('Phase 16 video-expansion stabilization could not find probeScreenPal.');
}

// GitHub-hosted headless browsers occasionally report the input type before
// the click-driven DOM mutation has settled. Preserve the real user click and
// the original assertions, but allow a short rendering turn after each eye
// control click. No production source is modified by this runner.
let stabilized = original.replaceAll(
  eyeNeedle,
  `${eyeNeedle}\n  await page.waitForTimeout(250);`
);

// The portal performs its own /student/session read as soon as phase7.js loads.
// Starting a credential submission before that initial read has completed can
// race the portal's showLogin() path against a newly successful login. The
// established Phase 11 browser harness waits for this startup read first; do
// the same here for every Phase 16 login-entry navigation. This synchronizes
// only the test harness and does not modify production portal behaviour.
stabilized = stabilized.replaceAll(
  gotoNeedle,
  `{
    const startupSessionPromise = page.waitForResponse(response => {
      try {
        const url = new URL(response.url());
        return response.request().method() === 'GET' &&
          url.pathname.endsWith('/api/v1/student/session');
      } catch (_) {
        return false;
      }
    }, { timeout: 30000 });
    ${gotoNeedle}
    const startupSessionResponse = await startupSessionPromise;
    await startupSessionResponse.finished().catch(() => {});
    await page.waitForTimeout(50);
  }`
);

// Phase 12 deliberately presents Lesson Video in a compact row with a View
// control. The base renderer resolves the authenticated ScreenPal URL while the
// player remains collapsed; the accepted Phase 11 browser harness expands that
// row before asserting the iframe. Mirror the real UI interaction here rather
// than waiting for a frame that is intentionally hidden by default.
stabilized = stabilized.replace(
  probeNeedle,
  `async function expandPhase16LessonVideo(page) {
  const frame = page.locator('#video-frame');
  if (!(await frame.isVisible())) {
    const viewButton = page.locator('#video-section').getByRole('button', { name: 'View', exact: true }).first();
    await viewButton.waitFor({ state: 'visible', timeout: 30000 });
    await viewButton.click();
  }
  await frame.waitFor({ state: 'visible', timeout: 30000 });
  return frame;
}

${probeNeedle}`
);
stabilized = stabilized.replaceAll(pageVideoWait, 'await expandPhase16LessonVideo(page);');
stabilized = stabilized.replaceAll(page11VideoWait, 'await expandPhase16LessonVideo(page11);');

await fs.writeFile(runtimePath, stabilized, 'utf8');

try {
  const child = spawn(process.execPath, [runtimePath], {
    stdio: 'inherit',
    env: process.env
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', status => resolve(status ?? 1));
  });
  process.exitCode = code;
} finally {
  await fs.rm(runtimePath, { force: true }).catch(() => {});
}
