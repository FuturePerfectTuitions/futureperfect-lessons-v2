import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recentShareItems } from '../worker/src/index-phase20-change8.js';

const y5e = { lessonId:'Y5E2', subject:'English', title:'Descriptive Writing Settings and Atmosphere', displayIds:{ 'english-year5':'Y5T1E01', 'english-year5-11plus':'Y5T1EE01' } };
const y3m = { lessonId:'Y3M1', subject:'Maths', title:'Transitioning to Year 3', displayIds:{ 'maths-year3':'Y3T1M01' } };
const shares = recentShareItems([
  { lessonId:'Y3M1', mode:'full', viewId:'maths-year3', sharedAt:'2026-09-06T10:00:00.000Z', lessonDate:'2026-09-07', lesson:y3m },
  { lessonId:'Y5E2', mode:'prelesson', viewId:'english-year5-11plus', sharedAt:'2026-09-07T09:00:00.000Z', lessonDate:'2026-09-07', lesson:y5e }
]);
assert.equal(shares.length, 2);
assert.equal(shares[0].lessonId, 'Y5E2');
assert.equal(shares[0].displayLessonId, 'Y5T1EE01');
assert.equal(shares[0].accessLabel, 'PreLesson Sheets only');
assert.equal(shares[1].accessLabel, 'Full lesson');

const html = readFileSync(new URL('../phase11.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../assets/phase7.js', import.meta.url), 'utf8');
const collapse = readFileSync(new URL('../assets/phase20-collapsible-lessons.js', import.meta.url), 'utf8');
assert.match(html, /Just shared with you/);
assert.match(html, /recent-shares-list/);
assert.match(js, /openSharedLesson/);
assert.match(js, /Shared \$\{dateText\}/);
assert.match(collapse, /Description/);
assert.match(collapse, /phase7-resource-section/);
assert.match(collapse, /button\.textContent = expanded \? 'Hide' : 'View'/);
console.log('Recent shares + collapsible lesson UI verification: PASS');
