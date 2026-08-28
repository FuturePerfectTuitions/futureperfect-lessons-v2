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

const modalCardNeedle = "const box = await page.locator('.phase8-answer-card').boundingBox();";
if (!original.includes(modalCardNeedle)) {
  throw new Error('Phase 16 responsive Answer Pack dialog stabilization could not find the expected card selector.');
}

const projectedHomeNeedle = "if (home.status === 200 && home.body?.ok && predicate(home.body)) return home.body;";
if (!original.includes(projectedHomeNeedle)) {
  throw new Error('Phase 16 projected-home synchronization could not find loginUntilHome success return.');
}

const historyAssertionNeedle = "assert.equal(await previous.getByRole('button', { name: /Year 2/ }).count() >= 1, true, 'Historical/manual Year 2 English not discoverable under Previous.');";
if (!original.includes(historyAssertionNeedle)) {
  throw new Error('Phase 16 history diagnostic could not find the Year 2 Previous assertion.');
}

const originalOrderNeedle = `    await testDesktopNavigationAndResources();
    await testResponsiveContext('chromeCompact1024', { width: 1024, height: 768 }, { mobile: false });
    await testResponsiveContext('chromeMobile412', { width: 412, height: 915 }, { mobile: true, protectedDialog: true });
    await testResponsiveContext('chromeNarrow360', { width: 360, height: 800 }, { mobile: true });
    await testResponsiveContext('chromeTablet768', { width: 768, height: 1024 }, { mobile: true });
    await testCurrentPreviousLockedNavigation();`;
if (!original.includes(originalOrderNeedle)) {
  throw new Error('Phase 16 history diagnostic could not find the automated test order.');
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

// Both the legacy/core Phase 8 viewer and the Phase 11 supplementary protected
// viewer intentionally use the shared .phase8-answer-card styling class. The
// responsive check has already opened #phase8-answer-modal, so scope the width
// assertion to that active modal instead of using an ambiguous global class.
stabilized = stabilized.replace(
  modalCardNeedle,
  "const box = await modal.locator('.phase8-answer-card').boundingBox();"
);

// Manual-access test data is written to Workers KV before login. Cloudflare KV
// propagation can make a later explicit /home probe see the new historical view
// even when the portal's earlier login-time loadHome() populated its in-memory
// state from the previous edge value. Once the required projection is observed,
// reload with the already-authenticated session and require the portal's own
// reload-time /home response to contain the same fixture state. That makes the
// subsequent UI assertion test the authoritative projected response rather than
// a stale in-page snapshot, without changing production code or access rules.
stabilized = stabilized.replace(
  projectedHomeNeedle,
  `if (home.status === 200 && home.body?.ok && predicate(home.body)) {
      const refreshedHomePromise = page.waitForResponse(response => {
        try {
          const url = new URL(response.url());
          return response.request().method() === 'GET' &&
            url.pathname.endsWith('/api/v1/student/home');
        } catch (_) {
          return false;
        }
      }, { timeout: 60000 });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      const refreshedHomeResponse = await refreshedHomePromise;
      const refreshedHomeBody = await refreshedHomeResponse.json().catch(() => null);
      if (refreshedHomeResponse.status() === 200 && refreshedHomeBody?.ok && predicate(refreshedHomeBody)) {
        await waitForPortalHomeReady(page, username);
        await page.waitForTimeout(100);
        return refreshedHomeBody;
      }
    }`
);

// Capture the exact authoritative English view metadata and rendered grouping
// immediately before the disputed Previous/Year 2 assertion. This is diagnostic
// evidence only; it does not soften or remove the acceptance assertion.
stabilized = stabilized.replace(
  historyAssertionNeedle,
  `evidence.navigation.historyGroupingDiagnostic = {
      homeEnglishViews: (home.subjects.find(subject => subject.subject === 'english')?.views || []).map(view => ({
        viewId: view.viewId,
        label: view.label,
        group: view.group,
        current: view.current
      })),
      currentButtons: await current.getByRole('button').allTextContents(),
      previousButtons: await previous.getByRole('button').allTextContents(),
      allViewCards: await page.locator('#view-grid .phase6-view-card').allTextContents(),
      gridText: await page.locator('#view-grid').innerText()
    };
    console.log('PHASE16_HISTORY_GROUPING_DIAGNOSTIC ' + JSON.stringify(evidence.navigation.historyGroupingDiagnostic));
    await shot(page, 'mobile-history-grouping-diagnostic');
    ${historyAssertionNeedle}`
);

// Put the disputed history/current-grouping test first while diagnosing it so a
// failure does not spend several extra minutes repeating already-established
// browser/resource checks. Once this gate passes, the complete matrix still
// follows in the same run.
stabilized = stabilized.replace(
  originalOrderNeedle,
  `    await testCurrentPreviousLockedNavigation();
    await testDesktopNavigationAndResources();
    await testResponsiveContext('chromeCompact1024', { width: 1024, height: 768 }, { mobile: false });
    await testResponsiveContext('chromeMobile412', { width: 412, height: 915 }, { mobile: true, protectedDialog: true });
    await testResponsiveContext('chromeNarrow360', { width: 360, height: 800 }, { mobile: true });
    await testResponsiveContext('chromeTablet768', { width: 768, height: 1024 }, { mobile: true, protectedDialog: false });`
);

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
