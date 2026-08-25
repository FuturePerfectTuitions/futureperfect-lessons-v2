import assert from 'node:assert/strict';
import fs from 'node:fs';

const active = fs.readFileSync('phase11.html', 'utf8');
const approvedPreview = fs.readFileSync('phase11-change8.html', 'utf8');
const css = fs.readFileSync('assets/phase11-change8.css', 'utf8');

assert.equal(
  active.trim(),
  approvedPreview.trim(),
  'Activated phase11.html must exactly match the owner-approved Change 8 preview.'
);

const ids = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).sort();
const scripts = (html) => [...html.matchAll(/<script\s+[^>]*src="([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]);

const expectedScripts = [
  'config.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'assets/phase8.js',
  'assets/phase9.js',
  'assets/phase10.js',
  'assets/phase10-counts.js',
  'assets/phase10-history.js',
  'assets/phase11-protected-bridge.js',
  'assets/phase11-resources.js',
  'assets/phase11-other.js',
  'assets/phase11-home-readiness.js',
  'assets/phase7.js',
  'assets/phase7-upsell.js'
];

assert.deepEqual(ids(active), ids(approvedPreview), 'Change 8 activation must preserve the complete DOM ID contract.');
assert.deepEqual(scripts(active), expectedScripts, 'Change 8 activation must preserve the approved Phase 11 JavaScript order and sources.');
assert.match(active, /<body class="phase5-page phase11-change8">/);
assert.match(active, /assets\/phase11-change8\.css/);
assert.match(active, /<meta name="theme-color" content="#012169">/);

assert.match(css, /body\.phase11-change8/);
assert.doesNotMatch(css, /<script|javascript:/i);
assert.doesNotMatch(css, /@import/i);

const selectorHeaders = css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.endsWith('{') && !line.startsWith('@'));

for (const selector of selectorHeaders) {
  assert.ok(
    selector.includes('body.phase11-change8'),
    `Unscoped Change 8 selector detected: ${selector}`
  );
}

console.log('Phase 11 Change 8 activated visual-only verification: PASS');
