import assert from 'node:assert/strict';
import fs from 'node:fs';

const renderer = fs.readFileSync('assets/phase11-resources.js', 'utf8');
const protectedBridge = fs.readFileSync('assets/phase11-protected-bridge.js', 'utf8');

// Browser renderer must consume only the safe lesson model returned by the Worker.
assert.match(renderer, /captured\.lesson\?\.phase11Resources/);
assert.doesNotMatch(renderer, /\br2Key\b/);
assert.doesNotMatch(protectedBridge, /\br2Key\b/);

// Every Phase 11 resource family discovered during production reconciliation has UI support.
for (const token of [
  'corePreLessonPairs',
  'coreCumulativeHomeworks',
  'coreSupplementaryAnswers',
  'elevenPlus',
  'preLessonPairs',
  'homeworks',
  'cumulativeHomeworks',
  'supplementaryAnswers',
  'vrSupplementaryAnswers'
]) {
  assert.ok(renderer.includes(token), `Missing browser renderer support for ${token}`);
}

// Core PreLesson primary sheets already rendered by Phase 7 are not blindly duplicated.
assert.match(renderer, /suppressCorePreLessonDuplicate/);
assert.match(renderer, /captured\.lesson\?\.preLessonSheets/);

// Downloads always go back through the authorised Worker endpoint.
assert.match(renderer, /\/api\/v1\/student\/resources\/\$\{encodeURIComponent\(resource\.resourceKey\)\}\/download/);
assert.match(renderer, /credentials:\s*'include'/);

// Protected resources reuse the existing Phase 8 server-side authorise/view lease contract.
assert.match(protectedBridge, /\/answer\/authorize\?viewId=/);
assert.match(protectedBridge, /viewerPath/);
assert.match(protectedBridge, /status=1/);
assert.match(protectedBridge, /pdfjsLib\.getDocument/);
assert.match(protectedBridge, /maxlength="4"/);
assert.match(protectedBridge, /Protected viewer · download and print controls are not provided/);
assert.match(protectedBridge, /phase8-answer-backdrop/);
assert.match(protectedBridge, /phase8-answer-page/);

// The renderer opens protected resources through the compatibility hook only;
// it never constructs an answer URL itself.
assert.match(renderer, /FPT_PHASE9/);
assert.match(renderer, /openProtectedAnswer/);
assert.doesNotMatch(renderer, /\/answer\/authorize/);
assert.match(protectedBridge, /FPT_PHASE11_PROTECTED/);
assert.match(protectedBridge, /FPT_PHASE9\.openProtectedAnswer/);

// Navigation clears the additional resource surface and closes protected viewing.
for (const id of ['#back-to-lessons', '#back-to-views', '#back-to-subjects', '#logout-button']) {
  assert.ok(renderer.includes(id), `Renderer must clear on ${id}`);
  assert.ok(protectedBridge.includes(id), `Protected bridge must close on ${id}`);
}

// The source files are deliberately dormant: current Phase 10 HTML does not load them yet.
const phase10Html = fs.readFileSync('phase10.html', 'utf8');
assert.ok(!phase10Html.includes('assets/phase11-resources.js'));
assert.ok(!phase10Html.includes('assets/phase11-protected-bridge.js'));

console.log('Phase 11 extra-resource browser static verification: PASS');
