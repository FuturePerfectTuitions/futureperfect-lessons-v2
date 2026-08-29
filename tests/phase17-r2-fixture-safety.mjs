import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPhase11Catalogue, validatePhase11Catalogue } from '../scripts/phase11-catalogue.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = String(process.env.PHASE17_R2_FIXTURE_MANIFEST || '').trim();
if (!manifest || !fs.existsSync(manifest)) throw new Error('Private R2 fixture manifest is required.');

function collectProperty(value, property, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (typeof value[property] === 'string' && value[property].trim()) out.push(value[property].trim());
  if (Array.isArray(value)) for (const item of value) collectProperty(item, property, out);
  else for (const item of Object.values(value)) collectProperty(item, property, out);
  return out;
}

const catalogue = loadPhase11Catalogue(root);
const audit = validatePhase11Catalogue(catalogue);
assert.equal(audit.catalogueSha256, '7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663');
const required = new Set(collectProperty(catalogue, 'r2Key'));
const change7 = JSON.parse(fs.readFileSync(path.join(root, 'docs/data/phase11/change7-owner-homeworks.json'), 'utf8'));
for (const key of collectProperty(change7, 'r2Key')) required.add(key);
const overrides = fs.readFileSync(path.join(root, 'worker/src/phase11-shared-maths-answer-pdf-overrides.js'), 'utf8');
for (const match of overrides.matchAll(/\"overrideR2Key\":\"([^\"]+)\"/g)) required.add(match[1]);

const rows = fs.readFileSync(manifest, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
  const tab = line.indexOf('\t');
  if (tab < 1) throw new Error('Invalid private fixture manifest row.');
  return { file: line.slice(0, tab), key: line.slice(tab + 1) };
});
assert.equal(rows.length, 3, 'Exactly three backed-up development R2 fixture objects are expected.');
assert.equal(new Set(rows.map(row => row.key)).size, 3, 'Development R2 fixture keys must be unique.');
for (const row of rows) {
  assert.ok(row.key && !row.key.startsWith('_internal/'), 'Invalid development R2 fixture key.');
  assert.ok(!required.has(row.key), 'Development R2 fixture overlaps production-required resource set.');
}
console.log(JSON.stringify({ status: 'PASS', backedUpDevelopmentR2Fixtures: 3, overlapsProductionRequiredResources: 0, objectNamesExposed: false }));
