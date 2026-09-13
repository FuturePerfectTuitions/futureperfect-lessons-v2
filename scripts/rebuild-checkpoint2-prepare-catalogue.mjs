import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIEW_DEFINITIONS } from '../rebuild/shared/read-models/view-registry.mjs';
import {
  lessonIdsFromCurriculum,
  compileCatalogueReadModel,
  assertMetadataOnlyCatalogue
} from '../rebuild/shared/read-models/catalogue.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.resolve(
  process.argv[2] || path.join(root, 'rebuild', 'student', 'src', 'prepared-catalogue.generated.js')
);
const evidencePath = path.resolve(
  process.argv[3] || '/tmp/rebuild-checkpoint2-catalogue-evidence.json'
);

const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const namespaceId = String(process.env.LESSONS_KV_NAMESPACE_ID || '').trim();
if (!token || !accountId || !namespaceId) {
  throw new Error('Cloudflare account/token/LESSONS_KV namespace inputs are required.');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function cfJson(url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`Cloudflare metadata read failed with HTTP ${response.status}.`);
  const body = await response.json();
  if (body?.success === false) throw new Error('Cloudflare metadata read returned success=false.');
  return body;
}

async function kvJson(key) {
  const encoded = encodeURIComponent(key);
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encoded}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`KV read failed for ${key} with HTTP ${response.status}.`);
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error(`KV value is not JSON for ${key}.`); }
}

async function mapConcurrent(values, limit, worker) {
  const result = new Array(values.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      result[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length || 1) }, run));
  return result;
}

// Confirm the namespace exists, but never enumerate or read STUDENTS_KV.
const namespaceInfo = await cfJson(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`
);
if (!namespaceInfo?.result?.id || namespaceInfo.result.id !== namespaceId) {
  throw new Error('LESSONS_KV namespace identity could not be confirmed.');
}

const curriculumCodes = [...new Set(
  Object.values(VIEW_DEFINITIONS).flatMap(view => view.curricula)
)].sort();
const curriculumPairs = await mapConcurrent(curriculumCodes, 12, async code => [code, await kvJson(`curriculum:${code}`)]);
const curricula = Object.fromEntries(curriculumPairs);
for (const code of curriculumCodes) {
  if (!curricula[code] || lessonIdsFromCurriculum(curricula[code]).length === 0) {
    throw new Error(`Required live curriculum is missing or empty: ${code}`);
  }
}

const lessonIds = [...new Set(curriculumCodes.flatMap(code => lessonIdsFromCurriculum(curricula[code])))].sort();
const lessonPairs = await mapConcurrent(lessonIds, 32, async lessonId => [lessonId, await kvJson(`lesson:${lessonId}`)]);
const lessons = Object.fromEntries(lessonPairs);
for (const lessonId of lessonIds) {
  if (!lessons[lessonId]) throw new Error(`Live curriculum references missing lesson metadata: ${lessonId}`);
}

const sourceFingerprint = sha256(JSON.stringify({ curricula, lessons }));
const model = compileCatalogueReadModel(
  { curricula, lessons },
  { sourceType: 'production-lessons-kv-readonly', sourceRevision: sourceFingerprint }
);
assertMetadataOnlyCatalogue(model);

const modelJson = JSON.stringify(model);
const modelSha256 = sha256(modelJson);
const source = [
  '// Generated during the Checkpoint 2 staging workflow from read-only production LESSONS_KV metadata.',
  '// Resource URLs/R2 keys/video URLs/passwords are deliberately excluded by the compiler.',
  `// Prepared catalogue SHA-256: ${modelSha256}`,
  `const PREPARED_CATALOGUE = ${modelJson};`,
  `const PREPARED_CATALOGUE_SHA256 = '${modelSha256}';`,
  '',
  'export { PREPARED_CATALOGUE, PREPARED_CATALOGUE_SHA256 };',
  ''
].join('\n');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, source, 'utf8');

const evidence = {
  marker: 'REBUILD_CHECKPOINT2_CATALOGUE_PREPARED',
  sourceType: model.source.type,
  sourceRevision: model.source.revision,
  preparedCatalogueSha256: modelSha256,
  curriculumCodes: curriculumCodes.length,
  canonicalLessonIds: lessonIds.length,
  views: model.navigation.length,
  viewLessonCounts: Object.fromEntries(model.navigation.map(view => [view.viewId, view.lessonCount])),
  generatedBytes: Buffer.byteLength(source)
};
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(evidence));
