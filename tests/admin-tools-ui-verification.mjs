import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('admin-import.html', 'utf8');
const browser = fs.readFileSync('assets/admin-replace-resource.js', 'utf8');
const wrapper = fs.readFileSync('worker/src/index-admin-tools.js', 'utf8');
const wrangler = fs.readFileSync('worker/wrangler.toml', 'utf8');

assert.match(html, /Admin Tools/);
assert.match(html, /Create Trial ID/);
assert.match(html, /Replace Resource/);
assert.match(html, /Lesson Release Import/);
assert.match(html, /id="replaceResourceSection"/);
assert.match(html, /id="replaceLessonId"/);
assert.match(html, /id="replaceResourceSelect"/);
assert.match(html, /id="replacementFile"/);
assert.match(html, /id="replaceResourceBtn"/);
assert.match(html, /assets\/admin-replace-resource\.js/);
assert.match(html, /previous R2 object is deliberately retained for rollback/i);

assert.match(browser, /fptAdminImportToken/);
assert.match(browser, /\/api\/v1\/admin\/resources\/lesson/);
assert.match(browser, /\/api\/v1\/admin\/resources\/replace/);
assert.match(browser, /expectedR2Key/);
assert.match(browser, /resourcePath/);
assert.match(browser, /window\.confirm/);
assert.doesNotMatch(browser, /Csl1/);

assert.match(wrapper, /index-phase24-trial-vr\.js/);
assert.match(wrapper, /handleAdminResourceRequest/);
assert.match(wrapper, /startsWith\('\/api\/v1\/admin\/resources\/'\)/);
assert.match(wrangler, /main = "src\/index-admin-tools\.js"/);

console.log('ADMIN_TOOLS_UI_VERIFICATION_PASS');
