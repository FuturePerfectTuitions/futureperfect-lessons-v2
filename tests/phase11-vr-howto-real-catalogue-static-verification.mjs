import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = 'worker/fixtures/phase11/special-VR_HOWTO.json';
const catalogue = JSON.parse(fs.readFileSync(file, 'utf8'));

const expected = [
  ['Mirroring Codes', 'cOnF1kn0uLz'],
  ['Jumping Codes', 'cOnF1zn0uM7'],
  ['4-Letter Code Matching', 'cOnFoTn0vHl'],
  ['Solving Big Riddles', 'cOnqQ2n0ywq'],
  ['Solving Synonyms', 'cOnrjAn0kh3'],
  ['Words 2 codes and Vice Versa', 'cOnOivn0Ndc'],
  ['Move one letter', 'cOntiAn0RGm'],
  ['One in the Middle', 'cOnuignZcLM'],
  ['Alphabet Code Pairs', 'cOee2ynZQ5T'],
  ['Word Ladders', 'cOeDjpnZdb7'],
  ['Hidden Words', 'cOeFodnZ9WB']
];

assert.equal(catalogue.bucketId, 'VR_HOWTO');
assert.equal(catalogue.type, 'vr-howto');
assert.equal(catalogue.title, 'VR How To');
assert.equal(catalogue.active, true);
assert.equal(catalogue.testOnly, undefined, 'Phase 11 catalogue must not remain a Phase 10 test fixture.');
assert.equal(catalogue.source, 'legacy-live-VR_HOWTO');
assert.equal(catalogue.items.length, expected.length);
assert.ok(!JSON.stringify(catalogue).includes('DEV-P10-'));
assert.ok(!JSON.stringify(catalogue).includes('Development-only'));
assert.ok(!catalogue.description.toLowerCase().includes('manually assigned'));

for (let i = 0; i < expected.length; i += 1) {
  const item = catalogue.items[i];
  const [title, screenpal] = expected[i];
  assert.equal(item.n, i + 1);
  assert.equal(item.id, `vr-howto-${i + 1}`);
  assert.equal(item.title, title);
  assert.equal(item.video?.screenpal, screenpal);
  assert.match(item.video.screenpal, /^[A-Za-z0-9_-]+$/);
  assert.ok(String(item.description || '').trim().length > 40, `${title} must retain the authoritative description.`);
}

console.log('Phase 11 real VR How To catalogue static verification: PASS');
