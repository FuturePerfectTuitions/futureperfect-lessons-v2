import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadPhase11Catalogue, validatePhase11Catalogue, EXPECTED } from '../scripts/phase11-catalogue.mjs';

const catalogue = loadPhase11Catalogue();
const result = validatePhase11Catalogue(catalogue);
assert.equal(result.lessons, 369);
assert.equal(result.curricula, 11);
assert.equal(result.kvKeys, 380);
assert.equal(result.r2Keys, 1669);
assert.equal(result.pendingVideos, 246);
assert.equal(result.videos, 123);
assert.equal(result.quizzes, 79);
assert.equal(result.vrLessons, 66);
assert.equal(result.elevenPlusOther, 9);
assert.equal(result.catalogueSha256, EXPECTED.catalogueSha256);
assert.equal(result.kvBulkSha256, EXPECTED.kvBulkSha256);

const phase11 = fs.readFileSync('phase11.html', 'utf8');
for (const asset of [
  'assets/phase11-protected-bridge.js',
  'assets/phase11-resources.js',
  'assets/phase11-other.js'
]) {
  assert.ok(phase11.includes(asset), `phase11.html must load ${asset}`);
}
const phase10 = fs.readFileSync('phase10.html', 'utf8');
assert.ok(!phase10.includes('assets/phase11-resources.js'));
assert.ok(!phase10.includes('assets/phase11-other.js'));
assert.ok(!phase10.includes('assets/phase11-protected-bridge.js'));
const wrangler = fs.readFileSync('worker/wrangler.toml', 'utf8');
assert.ok(wrangler.includes('main = "src/index-phase10-history.js"'), 'pre-apply PR must leave deployed entrypoint on Phase 10');

console.log('Phase 11 canonical catalogue static verification: PASS');
console.log(JSON.stringify(result, null, 2));
