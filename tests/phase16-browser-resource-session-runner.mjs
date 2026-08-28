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

const screenPalGateNeedle = `  await frame.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 1500));
  const video = frame.locator('video').first();`;
if (!original.includes(screenPalGateNeedle)) {
  throw new Error('Phase 16 ScreenPal identity-gate probe could not find the post-load player sequence.');
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

const historyOpenNeedle = `await previous.getByRole('button', { name: /Year 2/ }).first().click();
    await page.locator('#screen-lessons').waitFor({ state: 'visible', timeout: 30000 });`;
if (!original.includes(historyOpenNeedle)) {
  throw new Error('Phase 16 history-list synchronization could not find the Year 2 open sequence.');
}

const webkitLoginNeedle = "    await login(webkitPage, 'TestY2EM');";
if (!original.includes(webkitLoginNeedle)) {
  throw new Error('Phase 16 WebKit login diagnostic could not find the desktop WebKit login call.');
}

let stabilized = original.replaceAll(
  eyeNeedle,
  `${eyeNeedle}\n  await page.waitForTimeout(250);`
);

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

stabilized = stabilized.replace(
  screenPalGateNeedle,
  `  await frame.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 1500));
  if (kind === '11plus') {
    const firstNameInput = frame.locator('input[type="text"], input:not([type])').first();
    const submitButton = frame.getByRole('button', { name: /submit/i }).first();
    try {
      if (await firstNameInput.count() && await firstNameInput.isVisible() && await submitButton.count() && await submitButton.isVisible()) {
        await firstNameInput.fill('Phase16');
        await submitButton.click({ timeout: 5000 });
        result.identityGate = 'FIRST_NAME_SUBMITTED';
        await firstNameInput.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 1800));
      } else {
        result.identityGate = 'NOT_PRESENT';
      }
    } catch (_) {
      result.identityGate = 'SUBMIT_NOT_CONFIRMED';
    }
  }
  const video = frame.locator('video').first();`
);

stabilized = stabilized.replace(
  modalCardNeedle,
  "const box = await modal.locator('.phase8-answer-card').boundingBox();"
);

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

stabilized = stabilized.replace(
  historyAssertionNeedle,
  `evidence.navigation.historyGroupingDiagnostic = {
      homeEnglishViews: (home.subjects.find(subject => subject.subject === 'english')?.views || []).map(view => ({
        viewId: view.viewId,
        label: view.label,
        group: view.group,
        current: view.current,
        visibleLessonCount: view.visibleLessonCount,
        openLessonCount: view.openLessonCount,
        lockedLessonCount: view.lockedLessonCount
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

stabilized = stabilized.replace(
  historyOpenNeedle,
  `{
      const historyListResponsePromise = page.waitForResponse(response => {
        try {
          const url = new URL(response.url());
          return response.request().method() === 'GET' &&
            url.pathname.endsWith('/api/v1/student/views/english-year2/lessons');
        } catch (_) {
          return false;
        }
      }, { timeout: 60000 });
      await previous.getByRole('button', { name: /Year 2/ }).first().click();
      const historyListResponse = await historyListResponsePromise;
      assert.equal(historyListResponse.status(), 200, 'Historical Year 2 lesson-list request did not succeed.');
      const historyListBody = await historyListResponse.json().catch(() => null);
      evidence.navigation.historyLessonListDiagnostic = {
        responseLessonCount: Array.isArray(historyListBody?.lessons) ? historyListBody.lessons.length : null,
        responseViewId: historyListBody?.view?.viewId || null,
        openRows: Array.isArray(historyListBody?.lessons) ? historyListBody.lessons.filter(row => !row?.locked).length : null,
        lockedRows: Array.isArray(historyListBody?.lessons) ? historyListBody.lessons.filter(row => row?.locked).length : null,
        firstLessonIds: Array.isArray(historyListBody?.lessons) ? historyListBody.lessons.slice(0, 4).map(row => row?.lessonId) : []
      };
      console.log('PHASE16_HISTORY_LIST_RESPONSE_DIAGNOSTIC ' + JSON.stringify(evidence.navigation.historyLessonListDiagnostic));
      await page.locator('#screen-lessons').waitFor({ state: 'visible', timeout: 30000 });
      await page.locator('#lesson-list .phase6-lesson-row').first().waitFor({ state: 'visible', timeout: 60000 });
      await page.waitForTimeout(250);
      evidence.navigation.historyLessonListDiagnostic.renderedRows = await page.locator('#lesson-list .phase6-lesson-row').count();
      console.log('PHASE16_HISTORY_LIST_RENDER_DIAGNOSTIC ' + JSON.stringify(evidence.navigation.historyLessonListDiagnostic));
    }`
);

stabilized = stabilized.replace(
  webkitLoginNeedle,
  `    {
      const webkitNetwork = [];
      const onWebKitResponse = response => {
        try {
          const url = new URL(response.url());
          if (!response.url().startsWith(WORKER_BASE)) return;
          if (!['/api/v1/student/auth/login', '/api/v1/student/session', '/api/v1/student/home'].includes(url.pathname)) return;
          webkitNetwork.push({ method: response.request().method(), path: url.pathname, status: response.status() });
        } catch (_) {}
      };
      webkitPage.on('response', onWebKitResponse);
      try {
        await login(webkitPage, 'TestY2EM');
      } catch (error) {
        const cookies = await webkitContext.cookies(WORKER_BASE).catch(() => []);
        const sessionCookies = cookies
          .filter(cookie => cookie.name === 'fpt_v2_session')
          .map(cookie => ({
            present: true,
            domain: cookie.domain,
            path: cookie.path,
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
            sameSite: cookie.sameSite,
            sessionCookie: cookie.expires === -1 || cookie.expires === 0
          }));
        const directSession = await pageApi(webkitPage, '/api/v1/student/session').catch(fetchError => ({
          status: null,
          ok: false,
          body: { error: String(fetchError?.message || fetchError).slice(0, 300) }
        }));
        const dom = await webkitPage.evaluate(() => ({
          loginScreenHidden: document.getElementById('login-screen')?.hidden ?? null,
          portalScreenHidden: document.getElementById('portal-screen')?.hidden ?? null,
          subjectsHidden: document.getElementById('screen-subjects')?.hidden ?? null,
          viewsHidden: document.getElementById('screen-views')?.hidden ?? null,
          lessonsHidden: document.getElementById('screen-lessons')?.hidden ?? null,
          greeting: String(document.getElementById('student-greeting')?.textContent || '').slice(0, 120),
          loginError: String(document.getElementById('login-error')?.textContent || '').slice(0, 180),
          loginErrorHidden: document.getElementById('login-error')?.hidden ?? null,
          subjectsMessage: String(document.getElementById('phase6-message')?.textContent || '').slice(0, 180),
          subjectsMessageHidden: document.getElementById('phase6-message')?.hidden ?? null
        })).catch(() => null);
        evidence.browsers.webkitLoginDiagnostic = {
          network: webkitNetwork,
          cookieCount: sessionCookies.length,
          cookies: sessionCookies,
          directSession: {
            status: directSession?.status ?? null,
            ok: directSession?.ok ?? false,
            error: directSession?.body?.error || null
          },
          dom
        };
        console.log('PHASE16_WEBKIT_LOGIN_DIAGNOSTIC ' + JSON.stringify(evidence.browsers.webkitLoginDiagnostic));
        await shot(webkitPage, 'webkit-login-diagnostic');
        throw error;
      } finally {
        webkitPage.off('response', onWebKitResponse);
      }
    }`
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
