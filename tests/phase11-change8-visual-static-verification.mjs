import assert from 'node:assert/strict';
import fs from 'node:fs';

const base = fs.readFileSync('phase11.html', 'utf8');
const preview = fs.readFileSync('phase11-change8.html', 'utf8');
const css = fs.readFileSync('assets/phase11-change8.css', 'utf8');

const normalizedPreview = preview
  .replace('  <meta name="theme-color" content="#012169">\n', '')
  .replace('  <link rel="stylesheet" href="assets/phase11-change8.css">\n', '')
  .replace('<body class="phase5-page phase11-change8">', '<body class="phase5-page">');

assert.equal(
  normalizedPreview.trim(),
  base.trim(),
  'Change 8 preview must differ from approved phase11.html only by the theme meta, scoped body class and refinement stylesheet.'
);

const ids = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).sort();
const scripts = (html) => [...html.matchAll(/<script\s+[^>]*src="([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]);

assert.deepEqual(ids(preview), ids(base), 'Change 8 must preserve the complete DOM ID contract.');
assert.deepEqual(scripts(preview), scripts(base), 'Change 8 must preserve script order and script sources exactly.');
assert.match(preview, /<body class="phase5-page phase11-change8">/);
assert.match(preview, /assets\/phase11-change8\.css/);

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

console.log('Phase 11 Change 8 visual-only static verification: PASS');
