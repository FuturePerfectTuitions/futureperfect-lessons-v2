import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('admin-import.html', 'utf8');
const resourceBrowser = fs.readFileSync('assets/admin-replace-resource.js', 'utf8');
const adminBrowser = fs.readFileSync('assets/admin-trials.js', 'utf8');
const bridge = fs.readFileSync('worker/src/index-step10-quiz-bridge.js', 'utf8');
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
assert.match(html, /assets\/admin-trials\.js/);
assert.match(html, /previous R2 object is deliberately retained for rollback/i);

assert.match(resourceBrowser, /fptAdminImportToken/);
assert.match(resourceBrowser, /\/api\/v1\/admin\/resources\/lesson/);
assert.match(resourceBrowser, /\/api\/v1\/admin\/resources\/replace/);
assert.match(resourceBrowser, /expectedR2Key/);
assert.match(resourceBrowser, /resourcePath/);
assert.match(resourceBrowser, /window\.confirm/);
assert.match(resourceBrowser, /if \(raw === ''\) return null/);
assert.match(resourceBrowser, /await loadLesson\(resource\.resourceId\);[\s\S]*Replacement published for/);
assert.doesNotMatch(resourceBrowser, /Csl1/);

assert.match(adminBrowser, /function installAdminLayout/);
assert.match(adminBrowser, /data-admin-target="lessonReleaseSection"/);
assert.match(adminBrowser, /grid\.prepend\(releaseCard\)/);
assert.match(adminBrowser, /home\.after\(release\)/);
assert.match(adminBrowser, /Create Student Login/);
assert.match(adminBrowser, /studentManagerSection/);
assert.match(adminBrowser, /release\.after\(section\)/);
assert.match(adminBrowser, /scrollIntoView/);
assert.match(adminBrowser, /button\('Delete', 'delete'/);

assert.match(bridge, /import currentWorker from ['"]\.\/index-admin-tools\.js['"]/);
assert.match(wrapper, /index-phase24-trial-vr\.js/);
assert.match(wrapper, /handleAdminResourceRequest/);
assert.match(wrapper, /startsWith\('\/api\/v1\/admin\/resources\/'\)/);
assert.match(wrangler, /main = "src\/index-step10-quiz-bridge\.js"/);

console.log('ADMIN_TOOLS_UI_VERIFICATION_PASS');