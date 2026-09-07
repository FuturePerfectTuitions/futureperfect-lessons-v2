import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hasUsablePreLesson, usablePreLessonResource } from '../worker/src/index-phase20-change10.js';

assert.equal(usablePreLessonResource(null), false);
assert.equal(usablePreLessonResource({ resourceKey:'r2/a.pdf', available:true, locked:false }), true);
assert.equal(usablePreLessonResource({ resourceKey:'r2/a.pdf', available:false, locked:false }), false);
assert.equal(usablePreLessonResource({ resourceKey:'r2/a.pdf', available:true, locked:true }), false);

assert.equal(hasUsablePreLesson({}), false);
assert.equal(hasUsablePreLesson({ preLessonSheets:[] }), false);
assert.equal(hasUsablePreLesson({ preLessonSheets:[{ resourceKey:'core/pre.pdf', available:true, locked:false }] }), true);
assert.equal(hasUsablePreLesson({
  phase11Resources:{ corePreLessonPairs:[{ primary:{ resourceKey:'p11/core.pdf', available:true, locked:false } }] }
}), true);
assert.equal(hasUsablePreLesson({
  phase11Resources:{ elevenPlus:{ preLessonPairs:[{ primary:{ resourceKey:'p11/11plus.pdf', available:true, locked:false } }] } }
}), true);
assert.equal(hasUsablePreLesson({
  vr:{ preLesson:[{ sheet:{ resourceKey:'vr/pre.pdf', available:true, locked:false } }] }
}), true);

const ui = await readFile(new URL('../assets/phase7.js', import.meta.url), 'utf8');
assert.match(ui, /No PreLesson Sheets/);
assert.match(ui, /noPreLesson \? 'div' : 'button'/);
assert.match(ui, /if \(!noPreLesson\) row\.addEventListener/);
assert.match(ui, /shareClickable \? 'a' : 'span'/);
assert.match(ui, /item\?\.clickable === false/);

const wrangler = await readFile(new URL('../worker/wrangler.toml', import.meta.url), 'utf8');
assert.match(wrangler, /main = "src\/index-phase20-change10\.js"/);

console.log('PASS: empty PRELESSON_ONLY releases are identified and rendered non-clickable');
