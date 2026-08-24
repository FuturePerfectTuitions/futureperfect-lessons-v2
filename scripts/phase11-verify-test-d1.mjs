import fs from 'node:fs';

const [resultsFile] = process.argv.slice(2);
if (!resultsFile) throw new Error('Usage: node scripts/phase11-verify-test-d1.mjs <wrangler-d1-json>');

const raw = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
const resultBlocks = Array.isArray(raw) ? raw : [raw];
const rows = resultBlocks.flatMap(block => Array.isArray(block?.results) ? block.results : []);
if (!rows.length) throw new Error('No D1 verification rows returned.');

const expected = new Map([
  ['testy2e', [29, 0]],
  ['testy2m', [36, 0]],
  ['testy2em', [65, 0]],
  ['testy4em', [70, 0]],
  ['testy411m', [38, 0]],
  ['testy511e', [32, 32]],
  ['testy5em', [70, 0]],
  ['testy5e', [32, 0]],
  ['testy511em', [75, 32]],
  ['test0707', [5, 0]]
]);

const found = new Map();
for (const row of rows) {
  const id = String(row.portal_user_id_norm || '').trim().toLowerCase();
  if (!id) continue;
  if (found.has(id)) throw new Error(`Duplicate D1 verification row for ${id}.`);
  found.set(id, [Number(row.entitlement_count || 0), Number(row.vr_count || 0)]);
}

for (const [id, [expectedCount, expectedVr]] of expected) {
  if (!found.has(id)) throw new Error(`Missing D1 verification row for ${id}.`);
  const [count, vr] = found.get(id);
  if (count !== expectedCount || vr !== expectedVr) {
    throw new Error(`D1 count mismatch for ${id}: count=${count}, vr=${vr}; expected ${expectedCount}/${expectedVr}.`);
  }
}

for (const id of found.keys()) {
  if (!expected.has(id)) throw new Error(`Unexpected D1 verification row for ${id}.`);
}

const total = [...found.values()].reduce((sum, [count]) => sum + count, 0);
const totalVr = [...found.values()].reduce((sum, [, vr]) => sum + vr, 0);
if (total !== 452) throw new Error(`Expected 452 total Phase 11 test/history entitlement rows; found ${total}.`);
if (totalVr !== 64) throw new Error(`Expected 64 total VR entitlement rows; found ${totalVr}.`);

console.log(JSON.stringify({
  status: 'PASS',
  verifiedUsers: found.size,
  totalEntitlementRows: total,
  totalVrRows: totalVr
}, null, 2));
