import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../admin-import.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../assets/admin-import.js', import.meta.url), 'utf8');

assert.match(html, /<form id="loginForm"/);
assert.match(html, /Parent emails are not sent automatically/);
assert.doesNotMatch(html, /id="confirmBtn"/);
assert.doesNotMatch(html, /Confirm Import &amp; Send Emails/);
assert.match(html, /id="loadLatestBtn"[^>]*>Process Latest CSV</);
assert.match(html, /data-import-state="idle"/);
assert.match(html, /admin-import\.js\?v=20261008-confirmed-v2/);
assert.match(html, /id="importDiagnosticsVersion"/);
assert.match(js, /confirmed-results v2 \(8 October 2026\)/);

assert.match(js, /localStorage\.getItem\(TOKEN_KEY\)/);
assert.match(js, /localStorage\.setItem\(TOKEN_KEY,token\)/);
assert.doesNotMatch(js, /sessionStorage/);
assert.match(js, /await api\('\/api\/v1\/admin\/lesson-releases\/preview',\{ rows \}\)/);
assert.match(js, /await api\('\/api\/v1\/admin\/lesson-releases\/confirm',\{ rows \}\)/);
assert.match(js, /await loadLatestAndProcess\(false\)/);

// The preview is not a release result: after POST /confirm the UI must display
// the actual per-student confirmation outcomes, with explicit failure details.
assert.match(js, /const confirmedResults = Array\.isArray\(data\.results\)/);
assert.match(js, /render\(confirmedResults, data\.summary\)/);
assert.doesNotMatch(js, /renderSummary\(data\.summary\);/);
assert.match(js, /failedPortalResults = confirmedResults\.filter\(r => r\.ok === false\)/);
assert.match(js, /portalDetails\.join\('\s*\|\s*'\)/);
assert.match(js, /tr\.classList\.add\('failed-import-row'\)/);
assert.match(js, /r\.readModelErrorCode/);
assert.match(html, /\.failed-import-row\{/);
assert.match(html, /<th>Result \/ error<\/th>/);

console.log('Automatic admin importer UI and persistent browser session wiring: PASS');
