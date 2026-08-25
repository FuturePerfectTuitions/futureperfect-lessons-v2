import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('phase11.html', 'utf8');
const css = fs.readFileSync('assets/phase6.css', 'utf8');
const answerCss = fs.readFileSync('assets/phase8.css', 'utf8');

for (const id of ['back-to-subjects', 'back-to-views', 'back-to-lessons']) {
  const pattern = new RegExp(`<button[^>]*id=["']${id}["'][^>]*class=["'][^"']*phase6-back-button[^"']*["']`, 'g');
  assert.equal((html.match(pattern) || []).length, 1, `${id} must remain the existing Phase 6 back control`);
}

const backBlock = css.match(/\.phase6-back-button\s*\{([\s\S]*?)\}/);
assert.ok(backBlock, 'phase6-back-button CSS block missing');
assert.match(backBlock[1], /position:\s*fixed\s*;/, 'Back control must remain viewport-visible while scrolling');
assert.match(backBlock[1], /bottom:\s*calc\(/, 'Back control must be anchored above the viewport bottom/safe area');
assert.match(backBlock[1], /z-index:\s*90\s*;/, 'Back control z-index regression');
assert.match(backBlock[1], /box-shadow:/, 'Floating control must stay visually distinct from page content');

assert.match(
  css,
  /\.phase6-screen:not\(#screen-subjects\),\s*\n\.phase7-lesson-screen\s*\{[\s\S]*?padding-bottom:\s*max\(104px,/,
  'Long screens must reserve space so the floating Back control cannot cover the last row'
);
assert.match(
  css,
  /@media\s*\(max-width:\s*760px\)[\s\S]*?\.phase6-back-button\s*\{[\s\S]*?left:\s*18px;[\s\S]*?safe-area-inset-bottom/,
  'Mobile Back control positioning/safe-area rule missing'
);

const modalBlock = answerCss.match(/\.phase8-answer-backdrop\s*\{([\s\S]*?)\}/);
assert.ok(modalBlock && /z-index:\s*1000\s*;/.test(modalBlock[1]), 'Protected Answer Pack modal must stay above the floating Back control');

console.log('Phase 11 floating Back button static verification: PASS');
