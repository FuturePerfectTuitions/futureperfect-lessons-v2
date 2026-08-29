import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('phase11.html', 'utf8');
const css = fs.readFileSync('assets/phase16-ui-refinement.css', 'utf8');
const js = fs.readFileSync('assets/phase16-ui-refinement.js', 'utf8');

const count = (text, needle) => text.split(needle).length - 1;

assert.equal(count(html, 'assets/phase16-ui-refinement.css'), 1, 'Phase 16 UI stylesheet must load exactly once.');
assert.equal(count(html, 'assets/phase16-ui-refinement.js'), 1, 'Phase 16 UI script must load exactly once.');

assert.match(css, /\.phase6-back-button\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?left:\s*0;[\s\S]*?width:\s*52px;[\s\S]*?font-size:\s*0;/, 'Back control must be a collapsed extreme-left arrow control.');
assert.match(css, /\.phase6-back-button::before\s*\{[\s\S]*?content:\s*"←";/, 'Collapsed Back control must visibly retain the arrow.');
assert.match(css, /#back-to-subjects::after\s*\{\s*content:\s*"Subjects";/);
assert.match(css, /#back-to-views::after\s*\{\s*content:\s*"Back";/);
assert.match(css, /#back-to-lessons::after\s*\{\s*content:\s*"Lessons";/);
assert.match(css, /\.phase6-back-button:hover,[\s\S]*?\.phase6-back-button:focus-visible\s*\{[\s\S]*?width:\s*142px;/, 'Back label must unfurl on pointer hover or keyboard focus.');

assert.match(css, /\.phase7-state:not\(\.locked\),[\s\S]*?\.phase6-lesson-state:not\(\.locked\)[\s\S]*?display:\s*none\s*!important;/, 'Normal Available badges must be removed while locked state remains exceptional.');

assert.match(css, /#video-section\s+\.phase12-video-toggle-row\s+\.phase7-resource-copy\s*\{[\s\S]*?display:\s*none;/, 'Duplicate inner Lesson Video copy must be hidden.');
assert.match(css, /#video-section\s+\.phase12-video-toggle\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?right:\s*22px;/, 'Existing View/Hide video control must be retained at the heading side.');

assert.match(js, /ready to download/i, 'Redundant Ready to download copy must be explicitly suppressed.');
assert.ok(
  js.includes('available\\s+·\\s+') && js.includes('locked$/i') && js.includes('${openCount} open · ${lockedCount} locked'),
  'Mixed availability copy must be normalized without losing locked-count information.'
);
assert.match(js, /\$\{count\} lesson/, 'Fully open view cards must reduce to a neutral lesson count.');

assert.doesNotMatch(js, /fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie|Authorization|Bearer/i, 'UI refinement must not add network, storage or session transport behaviour.');
assert.doesNotMatch(css, /@import|javascript:|url\s*\(/i, 'UI refinement CSS must remain self-contained and presentation-only.');

console.log('Phase 16 owner UI refinement static verification: PASS');
