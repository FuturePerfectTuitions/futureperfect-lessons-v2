import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phase7 = fs.readFileSync(path.join(root, 'assets', 'phase7.js'), 'utf8');

assert.match(phase7, /homePromise: null/);
assert.match(phase7, /if \(state\.homePromise\) return state\.homePromise/);
assert.match(phase7, /const sessionResponsePromise = api\('\/api\/v1\/student\/session'/);
assert.match(phase7, /const homeResponsePromise = api\('\/api\/v1\/student\/home'/);
assert.match(phase7, /const homeResponsePromise = response\.ok\s*\? api\('\/api\/v1\/student\/home'/);
assert.match(phase7, /void loadHome\(homeResponsePromise\)/);
assert.match(phase7, /const home = await loadHome\(\)/);
assert.doesNotMatch(phase7, /const session = await readSession\(\)/);
assert.doesNotMatch(phase7, /Curriculum navigation is still loading/);

console.log('Phase 11 home/navigation readiness static verification: PASS');
