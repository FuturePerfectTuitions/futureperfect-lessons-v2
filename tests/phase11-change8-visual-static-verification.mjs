import assert from 'node:assert/strict';
import fs from 'node:fs';

const active = fs.readFileSync('phase11.html', 'utf8');
const approvedPreview = fs.readFileSync('phase11-change8.html', 'utf8');
const css = fs.readFileSync('assets/phase11-change8.css', 'utf8');
const phase16Css = fs.readFileSync('assets/phase16-ui-refinement.css', 'utf8');
const phase16Js = fs.readFileSync('assets/phase16-ui-refinement.js', 'utf8');

const phase16CssLink = '  <link rel="stylesheet" href="assets/phase16-ui-refinement.css">\n';
const phase16JsScript = '  <script src="assets/phase16-ui-refinement.js"></script>\n';
const underlyingChange8Shell = active
  .replace(phase16CssLink, '')
  .replace(phase16JsScript, '');

assert.equal(
  underlyingChange8Shell.trim(),
  approvedPreview.trim(),
  'Phase 16 UI refinement must remain an additive layer over the exact owner-approved Change 8 shell.'
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
  'assets/phase7-upsell.js',
  'assets/phase16-ui-refinement.js'
];

assert.deepEqual(ids(active), ids(approvedPreview), 'Phase 16 presentation refinement must preserve the complete DOM ID contract.');
assert.deepEqual(scripts(active), expectedScripts, 'Phase 16 refinement must preserve approved JavaScript order and append only its presentation layer.');
assert.match(active, /<body class="phase5-page phase11-change8">/);
assert.match(active, /assets\/phase11-change8\.css/);
assert.match(active, /assets\/phase16-ui-refinement\.css/);
assert.match(active, /assets\/phase16-ui-refinement\.js/);
assert.match(active, /<meta name="theme-color" content="#012169">/);

assert.match(css, /body\.phase11-change8/);
assert.doesNotMatch(css, /<script|javascript:/i);
assert.doesNotMatch(css, /@import/i);
assert.match(phase16Css, /body\.phase11-change8/);
assert.doesNotMatch(phase16Css, /<script|javascript:/i);
assert.doesNotMatch(phase16Css, /@import/i);
assert.doesNotMatch(phase16Js, /localStorage|sessionStorage|Authorization|Bearer|document\.cookie/i);

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

console.log('Phase 11 Change 8 shell + Phase 16 additive UI refinement verification: PASS');
