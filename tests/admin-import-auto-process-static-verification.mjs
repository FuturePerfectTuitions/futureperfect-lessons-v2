import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../admin-import.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../assets/admin-import.js', import.meta.url), 'utf8');

assert.match(html, /<form id="loginForm"/);
assert.match(html, /There is no second confirmation step/);
assert.doesNotMatch(html, /id="confirmBtn"/);
assert.doesNotMatch(html, /Confirm Import &amp; Send Emails/);
assert.match(html, /id="loadLatestBtn"[^>]*>Process Latest CSV</);
assert.match(html, /data-import-state="idle"/);

assert.match(js, /localStorage\.getItem\(TOKEN_KEY\)/);
assert.match(js, /localStorage\.setItem\(TOKEN_KEY,token\)/);
assert.doesNotMatch(js, /sessionStorage/);
assert.match(js, /await api\('\/api\/v1\/admin\/lesson-releases\/preview',\{ rows \}\)/);
assert.match(js, /await api\('\/api\/v1\/admin\/lesson-releases\/confirm',\{ rows \}\)/);
assert.match(js, /await loadLatestAndProcess\(false\)/);

console.log('Automatic admin importer UI and persistent browser session wiring: PASS');
