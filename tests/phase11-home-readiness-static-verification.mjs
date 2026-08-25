import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = fs.readFileSync(path.join(root, 'assets', 'phase11-home-readiness.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'phase11.html'), 'utf8');

assert.match(script, /HOME_TTL_MS = 5000/);
assert.match(script, /\/api\/v1\/student\/home/);
assert.match(script, /\/api\/v1\/student\/auth\/login/);
assert.match(script, /response\.clone\(\)/);
assert.match(script, /Curriculum navigation is still loading\. Please try again in a moment\./);
assert.match(script, /Loading your curriculum…/);
assert.ok(
  html.indexOf('assets/phase11-home-readiness.js') < html.indexOf('assets/phase7.js'),
  'home readiness wrapper must load before phase7.js'
);

console.log('Phase 11 home readiness static verification: PASS');
