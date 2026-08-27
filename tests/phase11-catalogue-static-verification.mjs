import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadPhase11Catalogue, validatePhase11Catalogue, EXPECTED } from '../scripts/phase11-catalogue.mjs';

const payloadBase = 'docs/data/phase11/catalogue_payload';
const manifest = JSON.parse(fs.readFileSync(`${payloadBase}/catalogue.parts.json`, 'utf8'));
assert.equal(manifest.phase, 11);
assert.equal(manifest.encoding, 'gzip+base64');
assert.equal(manifest.parts, 14);
assert.equal(manifest.partFiles.length, manifest.parts);
assert.equal(manifest.combinedBase64Sha256, 'eaab7168caae92ca70a4bc245a56faf35695046787699a10e376f5f16bc6c959');
assert.equal(manifest.decodedJsonSha256, EXPECTED.catalogueSha256);

const combinedBase64 = manifest.partFiles
  .map(name => fs.readFileSync(`${payloadBase}/${name}`, 'utf8').replace(/\s+/g, ''))
  .join('');
const combinedBase64Sha256 = crypto.createHash('sha256').update(combinedBase64).digest('hex');
assert.equal(combinedBase64Sha256, manifest.combinedBase64Sha256, 'Phase 11 combined base64 transport hash mismatch');

for (const splitPart of [
  'catalogue.part05a.b64',
  'catalogue.part05b.b64',
  'catalogue.part05c.b64',
  'catalogue.part08a.b64',
  'catalogue.part08b.b64',
  'catalogue.part08c.b64'
]) {
  assert.equal(fs.statSync(`${payloadBase}/${splitPart}`).size, 4000, `${splitPart} must remain an exact 4,000-byte repaired chunk`);
}
assert.ok(!fs.existsSync(`${payloadBase}/catalogue.part05.b64`), 'Superseded corrupt catalogue.part05.b64 must not remain');
assert.ok(!fs.existsSync(`${payloadBase}/catalogue.part08.b64`), 'Superseded corrupt catalogue.part08.b64 must not remain');

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
assert.ok(
  wrangler.includes('main = "src/index-phase10-history.js"') ||
    wrangler.includes('main = "src/index-phase12.js"') ||
    wrangler.includes('main = "src/index-phase13.js"'),
  'catalogue lock verification must run against an approved Phase 10, Phase 12 or Phase 13 entrypoint'
);

console.log('Phase 11 canonical catalogue static verification: PASS');
console.log(JSON.stringify({ ...result, combinedBase64Sha256 }, null, 2));
