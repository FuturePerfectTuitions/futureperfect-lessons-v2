import fs from 'node:fs';
import crypto from 'node:crypto';

const env = process.env;
const REQUIRED = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'EXPECTED_LESSONS_KV_ID',
  'EXPECTED_READ_MODELS_KV_ID',
  'TARGET_LESSON',
  'OLD_R2_KEY',
  'NEW_R2_KEY',
  'EXPECTED_NEW_PDF_SHA256'
];
for (const name of REQUIRED) {
  if (!String(env[name] || '').trim()) throw new Error(`MISSING_ENV_${name}`);
}

const api = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}`;
const headers = { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` };
const enc = value => encodeURIComponent(value);
const clean = value => String(value ?? '').trim();

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
  return out;
}
const stableStringify = value => JSON.stringify(stableValue(value));
const sha256 = text => crypto.createHash('sha256').update(String(text)).digest('hex');
const encodedScope = scope => encodeURIComponent(scope).replace(/%/g, '_');
const pointerKey = scope => `rm:v1:scope:${encodedScope(scope)}:current`;
const versionKey = (scope, version) => `rm:v1:scope:${encodedScope(scope)}:version:${encodeURIComponent(version).replace(/%/g, '_')}`;

async function cfJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`CLOUDFLARE_HTTP_${response.status}`);
  const body = await response.json();
  if (body?.success === false) throw new Error(`CLOUDFLARE_API_FAILURE:${JSON.stringify(body.errors || [])}`);
  return body;
}
async function kvGet(namespaceId, key) {
  const response = await fetch(`${api}/storage/kv/namespaces/${namespaceId}/values/${enc(key)}`, { headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`KV_GET_${key}_HTTP_${response.status}`);
  return await response.text();
}
async function kvPut(namespaceId, key, text) {
  const response = await fetch(`${api}/storage/kv/namespaces/${namespaceId}/values/${enc(key)}`, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' },
    body: text
  });
  if (!response.ok) throw new Error(`KV_PUT_${key}_HTTP_${response.status}:${await response.text()}`);
}
function parse(text, label) {
  if (text == null) throw new Error(`${label}_MISSING`);
  try { return JSON.parse(text); } catch { throw new Error(`${label}_INVALID_JSON`); }
}

const settings = await cfJson(`${api}/workers/scripts/${env.WORKER_NAME || 'fpt-portal-v2-worker'}/settings`);
const binding = name => settings.result.bindings.find(item => item.name === name);
const lessonsId = clean(binding('LESSONS_KV')?.namespace_id);
const readModelsId = clean(binding('READ_MODELS_KV')?.namespace_id);
if (lessonsId !== env.EXPECTED_LESSONS_KV_ID) throw new Error('LESSONS_KV_ID_MISMATCH');
if (readModelsId !== env.EXPECTED_READ_MODELS_KV_ID) throw new Error('READ_MODELS_KV_ID_MISMATCH');

const canonical = parse(await kvGet(lessonsId, `lesson:${env.TARGET_LESSON}`), 'CANONICAL_LESSON');
const canonicalText = JSON.stringify(canonical);
const oldCanonicalCount = canonicalText.split(env.OLD_R2_KEY).length - 1;
const newCanonicalCount = canonicalText.split(env.NEW_R2_KEY).length - 1;
if (oldCanonicalCount !== 0 || newCanonicalCount !== 1) {
  throw new Error(`CANONICAL_GATE_FAILED_old_${oldCanonicalCount}_new_${newCanonicalCount}`);
}

const scope = `lesson:${env.TARGET_LESSON}`;
const pKey = pointerKey(scope);
const originalPointer = parse(await kvGet(readModelsId, pKey), 'PREPARED_POINTER');
if (originalPointer.kind !== 'prepared-read-model-pointer' || originalPointer.scope !== scope || !originalPointer.current?.version) {
  throw new Error('PREPARED_POINTER_SHAPE_MISMATCH');
}
const currentEnvelope = parse(
  await kvGet(readModelsId, versionKey(scope, originalPointer.current.version)),
  'PREPARED_ENVELOPE'
);
if (currentEnvelope.kind !== 'prepared-read-model-envelope' || currentEnvelope.scope !== scope || !currentEnvelope.payload) {
  throw new Error('PREPARED_ENVELOPE_SHAPE_MISMATCH');
}

const resources = currentEnvelope.payload.resources;
if (!Array.isArray(resources)) throw new Error('PREPARED_RESOURCES_UNAVAILABLE');
const oldMatches = resources.filter(item => clean(item?.objectKey) === env.OLD_R2_KEY);
const newMatches = resources.filter(item => clean(item?.objectKey) === env.NEW_R2_KEY);
let wrote = false;

if (!(oldMatches.length === 0 && newMatches.length === 1)) {
  if (oldMatches.length !== 1 || newMatches.length !== 0) {
    throw new Error(`PREPARED_TARGET_GATE_FAILED_old_${oldMatches.length}_new_${newMatches.length}`);
  }

  const nextPayload = JSON.parse(JSON.stringify(currentEnvelope.payload));
  const nextMatches = nextPayload.resources.filter(item => clean(item?.objectKey) === env.OLD_R2_KEY);
  if (nextMatches.length !== 1) throw new Error('PREPARED_CLONE_TARGET_MISMATCH');
  nextMatches[0].objectKey = env.NEW_R2_KEY;

  const payloadSha256 = sha256(stableStringify(nextPayload));
  const publishedVersion = `resource-reconcile-y5e2-${Date.now()}`;
  const nextEnvelope = {
    schemaVersion: 1,
    kind: 'prepared-read-model-envelope',
    scope,
    version: publishedVersion,
    sha256: payloadSha256,
    payload: nextPayload
  };
  const nextEnvelopeText = stableStringify(nextEnvelope);
  const envelopeSha256 = sha256(nextEnvelopeText);
  const candidate = { version: publishedVersion, sha256: payloadSha256, envelopeSha256 };
  const previous = originalPointer.current?.version ? {
    version: clean(originalPointer.current.version),
    sha256: clean(originalPointer.current.sha256),
    envelopeSha256: clean(originalPointer.current.envelopeSha256)
  } : null;
  const nextPointer = {
    schemaVersion: 1,
    kind: 'prepared-read-model-pointer',
    scope,
    current: candidate,
    previous
  };

  await kvPut(readModelsId, versionKey(scope, publishedVersion), nextEnvelopeText);
  const versionReadback = await kvGet(readModelsId, versionKey(scope, publishedVersion));
  if (sha256(versionReadback) !== envelopeSha256) throw new Error('VERSION_READBACK_HASH_MISMATCH');
  await kvPut(readModelsId, pKey, stableStringify(nextPointer));
  wrote = true;
}

const finalPointer = parse(await kvGet(readModelsId, pKey), 'FINAL_POINTER');
const finalEnvelope = parse(
  await kvGet(readModelsId, versionKey(scope, finalPointer.current.version)),
  'FINAL_ENVELOPE'
);
const finalResources = Array.isArray(finalEnvelope?.payload?.resources) ? finalEnvelope.payload.resources : [];
const finalOld = finalResources.filter(item => clean(item?.objectKey) === env.OLD_R2_KEY).length;
const finalNew = finalResources.filter(item => clean(item?.objectKey) === env.NEW_R2_KEY).length;
if (finalOld !== 0 || finalNew !== 1) throw new Error(`FINAL_READBACK_FAILED_old_${finalOld}_new_${finalNew}`);

const evidence = {
  marker: 'Y5E2_RESOURCE_RECONCILIATION_PASS',
  status: 'PASS',
  targetLesson: env.TARGET_LESSON,
  canonicalNewKeyCount: newCanonicalCount,
  canonicalOldKeyCount: oldCanonicalCount,
  preparedOldKeyCount: finalOld,
  preparedNewKeyCount: finalNew,
  wrote,
  publishedVersion: finalPointer.current.version,
  payloadSha256: finalPointer.current.sha256,
  envelopeSha256: finalPointer.current.envelopeSha256,
  expectedNewPdfSha256: env.EXPECTED_NEW_PDF_SHA256,
  canonicalSourcesMutated: false,
  writeTarget: 'READ_MODELS_KV_ONLY',
  oldR2ObjectRetained: true,
  safeToRerun: true
};
fs.writeFileSync('/tmp/y5e2-resource-reconciliation.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
