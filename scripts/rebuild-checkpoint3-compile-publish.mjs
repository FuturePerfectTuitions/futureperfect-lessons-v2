import crypto from 'node:crypto';
import fs from 'node:fs';
import { VIEW_DEFINITIONS } from '../rebuild/shared/read-models/view-registry.mjs';
import { lessonIdsFromCurriculum } from '../rebuild/shared/read-models/catalogue.mjs';
import { compileGlobalScope } from '../rebuild/adminops/src/lib/compiler.mjs';
import {
  stableStringify,
  publishScopeAtomic,
  resolveCurrentScope,
  pointerKey
} from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const evidencePath = process.argv[2] || '/tmp/rebuild-checkpoint3-publish-evidence.json';
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const lessonsNamespaceId = String(process.env.LESSONS_KV_NAMESPACE_ID || '').trim();
const readModelsNamespaceId = String(process.env.READ_MODELS_KV_NAMESPACE_ID || '').trim();
const failAfterCandidate = String(process.env.CHECKPOINT3_FAIL_AFTER_CANDIDATE || '') === '1';
const versionSuffix = String(process.env.CHECKPOINT3_VERSION_SUFFIX || '').trim();
if (!token || !accountId || !lessonsNamespaceId || !readModelsNamespaceId) {
  throw new Error('Cloudflare account/token and source/target KV namespace IDs are required.');
}
if (lessonsNamespaceId === readModelsNamespaceId) {
  throw new Error('Read-model target namespace must be isolated from production LESSONS_KV.');
}

function nodeSha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function cfJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok || body?.success === false) {
    throw new Error(`Cloudflare API request failed with HTTP ${response.status}.`);
  }
  return body;
}

async function assertNamespace(namespaceId, expectedTitle = '') {
  const body = await cfJson(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`
  );
  if (body?.result?.id !== namespaceId) throw new Error('KV namespace identity could not be confirmed.');
  if (expectedTitle && String(body?.result?.title || '') !== expectedTitle) {
    throw new Error('KV namespace title does not match the isolated staging target.');
  }
  return body.result;
}

function kvValueUrl(namespaceId, key) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
}

async function kvJson(namespaceId, key) {
  const response = await fetch(kvValueUrl(namespaceId, key), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`KV read failed with HTTP ${response.status}.`);
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error(`KV value is not JSON for ${key}.`); }
}

function restStore(namespaceId) {
  return {
    async get(key) {
      const response = await fetch(kvValueUrl(namespaceId, key), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Read-model KV read failed with HTTP ${response.status}.`);
      return response.text();
    },
    async put(key, value) {
      const response = await fetch(kvValueUrl(namespaceId, key), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json; charset=utf-8'
        },
        body: String(value)
      });
      if (!response.ok) throw new Error(`Read-model KV write failed with HTTP ${response.status}.`);
    }
  };
}

async function mapConcurrent(values, limit, worker) {
  const out = new Array(values.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      out[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length || 1) }, run));
  return out;
}

await assertNamespace(lessonsNamespaceId);
await assertNamespace(readModelsNamespaceId, 'FPT_PORTAL_V2_REBUILD_READ_MODELS_STAGING');

const curriculumCodes = [...new Set(Object.values(VIEW_DEFINITIONS).flatMap(view => view.curricula))].sort();
const curriculumPairs = await mapConcurrent(curriculumCodes, 12, async code => [
  code,
  await kvJson(lessonsNamespaceId, `curriculum:${code}`)
]);
const curricula = Object.fromEntries(curriculumPairs);
for (const code of curriculumCodes) {
  if (!curricula[code] || lessonIdsFromCurriculum(curricula[code]).length === 0) {
    throw new Error(`Required live curriculum is missing or empty: ${code}`);
  }
}

const lessonIds = [...new Set(curriculumCodes.flatMap(code => lessonIdsFromCurriculum(curricula[code])))].sort();
const lessonPairs = await mapConcurrent(lessonIds, 32, async lessonId => [
  lessonId,
  await kvJson(lessonsNamespaceId, `lesson:${lessonId}`)
]);
const lessons = Object.fromEntries(lessonPairs);
for (const lessonId of lessonIds) {
  if (!lessons[lessonId]) throw new Error(`Live curriculum references missing lesson metadata: ${lessonId}`);
}

const sourceRevision = nodeSha256(JSON.stringify({ curricula, lessons }));
const global = compileGlobalScope(
  { curricula, lessons },
  { sourceType: 'production-lessons-kv-readonly', sourceRevision }
);
const payloadSha256 = nodeSha256(stableStringify(global));
const baseVersion = `g-${payloadSha256.slice(0, 24)}`;
const version = versionSuffix ? `${baseVersion}-${versionSuffix}` : baseVersion;
const store = restStore(readModelsNamespaceId);
const pointerBefore = await store.get(pointerKey('global'));

try {
  const published = await publishScopeAtomic(store, {
    scope: 'global',
    payload: global,
    version,
    failAfterCandidate
  });
  const resolved = await resolveCurrentScope(store, 'global');
  if (resolved.version !== published.version || resolved.sha256 !== published.payloadSha256) {
    throw new Error('Published global scope did not resolve to the new verified version.');
  }
  const evidence = {
    marker: 'REBUILD_CHECKPOINT3_COMPILE_PUBLISH_PASS',
    sourceType: global.source.type,
    sourceRevision: global.source.revision,
    sourceCurriculumCodes: curriculumCodes.length,
    sourceCanonicalLessonIds: lessonIds.length,
    preparedViews: global.navigation.length,
    preparedLessonIndexRows: Object.keys(global.lessonToViews || {}).length,
    version: published.version,
    payloadSha256: published.payloadSha256,
    envelopeSha256: published.envelopeSha256,
    previousVersion: published.previousVersion,
    pointerKey: pointerKey('global'),
    pointerChanged: pointerBefore !== await store.get(pointerKey('global')),
    resolvedVersion: resolved.version,
    resolvedFallback: resolved.usedFallback,
    payloadBytes: Buffer.byteLength(stableStringify(global))
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(evidence));
} catch (error) {
  if (failAfterCandidate && String(error?.message || '').includes('CHECKPOINT3_INJECTED_FAILURE_AFTER_CANDIDATE')) {
    console.error(JSON.stringify({
      marker: 'REBUILD_CHECKPOINT3_EXPECTED_INJECTED_FAILURE',
      version,
      pointerUnchangedLocallyObserved: pointerBefore === await store.get(pointerKey('global'))
    }));
    process.exitCode = 42;
  } else {
    throw error;
  }
}
