import assert from 'node:assert/strict';
import fs from 'node:fs';

const phase11 = JSON.parse(fs.readFileSync('worker/fixtures/phase11/special-VR_HOWTO.json', 'utf8'));
const explicit = JSON.parse(fs.readFileSync('docs/data/phase17/vr-howto-explicit-screenpal.json', 'utf8'));
const wrapper = fs.readFileSync('worker/src/index-phase17.js', 'utf8');
const wrangler = fs.readFileSync('worker/wrangler.toml', 'utf8');

assert.equal(phase11.bucketId, 'VR_HOWTO');
assert.equal(phase11.items.length, 11);
assert.equal(explicit.items.length, phase11.items.length);

const byItem = new Map(explicit.items.map(item => [item.itemId, item]));
assert.equal(byItem.size, explicit.items.length);

for (const item of phase11.items) {
  const mapped = byItem.get(item.id);
  assert.ok(mapped, `${item.id} must have an explicit Phase 17 ScreenPal URL.`);
  assert.equal(mapped.screenpal, item.video?.screenpal, `${item.id} ScreenPal identity must remain unchanged.`);
  const url = new URL(mapped.embedUrl);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'go.screenpal.com');
  assert.equal(url.pathname, `/player/${mapped.screenpal}`);
  assert.equal(url.searchParams.get('ff'), '1');
  assert.equal(url.searchParams.get('title'), '0');
  assert.equal(url.searchParams.get('dcc'), '0');
  assert.equal(url.searchParams.get('bg'), 'transparent');
  assert.equal(url.searchParams.get('embedded'), '1');
}

assert.match(wrapper, /item\?\.video\?\.embedUrl/);
assert.match(wrapper, /explicit !== String\(body\.embedUrl\)/);
assert.match(wrapper, /SPECIAL_RESOURCE_NOT_FOUND/);
assert.ok(!wrapper.includes('`https://go.screenpal.com/player/${'), 'Phase 17 wrapper must not construct ScreenPal URLs from IDs.');
assert.match(wrangler, /^main = "src\/index-phase17\.js"$/m);
assert.match(wrangler, /^DEV_LOGIN_ALLOWLIST = ""$/m);

console.log('Phase 17 explicit special ScreenPal static verification: PASS');
