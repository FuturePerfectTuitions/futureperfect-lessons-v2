import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('worker/src/index-phase8.js', 'utf8');
const personas = JSON.parse(fs.readFileSync('docs/data/phase11/test_personas.json', 'utf8'));
const testY5EM = personas.personas.find(persona => persona.portalUserId === 'TestY5EM');

assert.ok(testY5EM, 'TestY5EM fixture must exist.');
assert.equal(testY5EM.user.firstName, 'TestY5EM');
assert.match(source, /function displayFirstName\(value\)/);
assert.match(source, /if \(\/\\d\/\.test\(firstName\)\)/);
assert.ok(
  source.includes('watermark: `Check your answers, ${displayFirstName(session.firstName)} - Future Perfect Tuitions`'),
  'Protected Answer Pack header must use firstName and the owner-approved wording.'
);
assert.ok(
  !source.includes('watermark: `${session.portalUserIdNorm} — Future Perfect Tuitions`'),
  'Lowercase Portal User ID watermark must not return.'
);

const syntheticDisplayName = testY5EM.user.firstName.charAt(0).toUpperCase() + testY5EM.user.firstName.slice(1).toLowerCase();
assert.equal(syntheticDisplayName, 'Testy5em');

console.log('Phase 11 protected answer first-name header static verification: PASS');
