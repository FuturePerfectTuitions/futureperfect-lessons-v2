import fs from 'node:fs';
import { compileLessonDetail } from '../rebuild/adminops/src/lib/compiler.mjs';
import { stableStringify, sha256Hex, versionKey } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const clean = value => String(value ?? '').trim();
const action = clean(process.env.CP12_METADATA_ACTION || 'apply').toLowerCase();
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const lessonsKv = clean(process.env.EXPECTED_LESSONS_KV);
const readKv = clean(process.env.EXPECTED_READ_MODELS_KV);
const runId = clean(process.env.GITHUB_RUN_ID || 'manual');
const backupPath = clean(process.env.CP12_METADATA_BACKUP || '/tmp/cp12-resource-ui-pointer-backup.json');
const reportPath = clean(process.env.CP12_METADATA_REPORT || '/tmp/cp12-resource-ui-metadata-report.json');
const verifyTimeoutMs = Number(process.env.CP12_KV_VERIFY_TIMEOUT_MS || 120000);
const verifyPollMs = Number(process.env.CP12_KV_VERIFY_POLL_MS || 1500);
const verifyConcurrency = Number(process.env.CP12_KV_VERIFY_CONCURRENCY || 12);

if (!account || !token || !readKv) throw new Error('Cloudflare account/token and READ_MODELS_KV are required.');
if (action !== 'rollback' && !lessonsKv) throw new Error('LESSONS_KV is required for metadata publication.');
if (!Number.isFinite(verifyTimeoutMs) || verifyTimeoutMs < 1000) throw new Error('CP12_KV_VERIFY_TIMEOUT_MS must be at least 1000ms.');
if (!Number.isFinite(verifyPollMs) || verifyPollMs < 100) throw new Error('CP12_KV_VERIFY_POLL_MS must be at least 100ms.');
if (!Number.isInteger(verifyConcurrency) || verifyConcurrency < 1 || verifyConcurrency > 32) throw new Error('CP12_KV_VERIFY_CONCURRENCY must be an integer from 1 to 32.');

const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const authHeaders = { Authorization: `Bearer ${token}` };
const allowedGroups = new Set([
  'core-prelesson','core-homework','core-other','core-cumulative','core-answers',
  'elevenplus-prelesson','elevenplus-homework','elevenplus-cumulative','elevenplus-answers',
  'vr-prelesson','vr-homework','vr-answers'
]);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(path, options = {}) {
  const response = await fetch(api + path, {
    ...options,
    headers: { ...authHeaders, ...(options.headers || {}) }
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { response, text, body };
}

async function kvText(namespace, key) {
  const out = await request(`/storage/kv/namespaces/${namespace}/values/${encodeURIComponent(key)}`);
  if (out.response.status === 404) return null;
  if (!out.response.ok) throw new Error(`KV read HTTP ${out.response.status}: ${key}`);
  return out.text;
}

async function kvJson(namespace, key) {
  const text = await kvText(namespace, key);
  if (text == null) return null;
  return JSON.parse(text);
}

async function listKeys(namespace, prefix) {
  let cursor = '';
  const keys = [];
  do {
    const query = new URLSearchParams({ prefix, limit: '1000' });
    if (cursor) query.set('cursor', cursor);
    const out = await request(`/storage/kv/namespaces/${namespace}/keys?${query}`);
    if (!out.response.ok || out.body?.success !== true) throw new Error(`KV list failed: ${prefix}`);
    keys.push(...(out.body.result || []).map(row => clean(row?.name)).filter(Boolean));
    cursor = clean(out.body.result_info?.cursor);
  } while (cursor);
  return keys;
}

async function bulkPut(items) {
  for (let offset = 0; offset < items.length; offset += 40) {
    const batch = items.slice(offset, offset + 40);
    const out = await request(`/storage/kv/namespaces/${readKv}/bulk`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch)
    });
    if (!out.response.ok || out.body?.success !== true || (out.body?.result?.unsuccessful_keys || []).length) {
      throw new Error(`KV bulk write failed HTTP ${out.response.status} at offset ${offset}`);
    }
  }
}

async function verifyKvRowsEventually(rows, label) {
  let pending = rows.map(row => ({ ...row }));
  const deadline = Date.now() + verifyTimeoutMs;
  let attempts = 0;
  let lastReadError = null;
  while (pending.length) {
    attempts += 1;
    const next = [];
    let index = 0;
    async function worker() {
      while (true) {
        const i = index++;
        if (i >= pending.length) return;
        const row = pending[i];
        try {
          const observed = await kvText(readKv, row.key);
          if (observed !== row.expected) next.push(row);
        } catch (error) {
          lastReadError = error;
          next.push(row);
        }
      }
    }
    const workers = Math.min(verifyConcurrency, Math.max(1, pending.length));
    await Promise.all(Array.from({ length: workers }, () => worker()));
    if (!next.length) return { attempts, verified: rows.length };
    if (Date.now() >= deadline) {
      const first = next.slice(0, 8).map(row => row.scope || row.key).join(',');
      const suffix = lastReadError ? ` lastReadError=${lastReadError?.message || lastReadError}` : '';
      throw new Error(`${label} verification timed out after ${attempts} passes; pending=${next.length}; first=${first}${suffix}`);
    }
    pending = next;
    await sleep(verifyPollMs);
  }
  return { attempts, verified: rows.length };
}

function stripPresentationGroup(value) {
  if (Array.isArray(value)) return value.map(stripPresentationGroup);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'presentationGroup')
        .map(([key, nested]) => [key, stripPresentationGroup(nested)])
    );
  }
  return value;
}

async function restoreBackup(reason = 'requested') {
  if (!fs.existsSync(backupPath)) throw new Error(`Metadata rollback backup is missing: ${backupPath}`);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  if (clean(backup?.readModelsKv) !== readKv || !Array.isArray(backup?.pointers) || !backup.pointers.length) {
    throw new Error('Metadata rollback backup is malformed or targets a different namespace.');
  }
  await bulkPut(backup.pointers.map(row => ({ key: row.pointerKey, value: row.pointerRaw })));
  const verification = await verifyKvRowsEventually(
    backup.pointers.map(row => ({ scope: row.scope, key: row.pointerKey, expected: row.pointerRaw })),
    'Metadata rollback'
  );
  const report = {
    marker: 'CP12_RESOURCE_UI_METADATA_ROLLBACK_PASS', status: 'PASS', reason,
    restoredPointers: backup.pointers.length, sourceRunId: clean(backup.runId), candidateEnvelopesDeleted: false,
    verification
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}

if (action === 'rollback') {
  await restoreBackup(clean(process.env.CP12_ROLLBACK_REASON || 'requested'));
  process.exit(0);
}

const pointerKeys = (await listKeys(readKv, 'rm:v1:scope:lesson_3A'))
  .filter(key => key.endsWith(':current'))
  .sort();
if (pointerKeys.length < 250) throw new Error(`Unexpected published lesson pointer count: ${pointerKeys.length}`);

const candidates = [];
const allPointers = [];
let totalResources = 0;
let coreResources = 0;
let elevenPlusResources = 0;
let vrResources = 0;
let unchangedScopes = 0;

for (const pointerKey of pointerKeys) {
  const pointerRaw = await kvText(readKv, pointerKey);
  if (!pointerRaw) throw new Error(`Published pointer disappeared: ${pointerKey}`);
  const pointer = JSON.parse(pointerRaw);
  const scope = clean(pointer?.scope);
  const oldVersion = clean(pointer?.current?.version);
  if (!scope.startsWith('lesson:') || !oldVersion) throw new Error(`Invalid published lesson pointer: ${pointerKey}`);
  const lessonId = scope.slice('lesson:'.length);
  const record = await kvJson(lessonsKv, `lesson:${lessonId}`);
  if (!record?.lessonId || clean(record.lessonId) !== lessonId) throw new Error(`Missing canonical source for published scope: ${scope}`);
  const candidate = await compileLessonDetail(record, { resourceExists: async () => true });
  const oldEnvelopeRaw = await kvText(readKv, versionKey(scope, oldVersion));
  if (!oldEnvelopeRaw) throw new Error(`Current prepared envelope missing: ${scope}`);
  const oldEnvelope = JSON.parse(oldEnvelopeRaw);
  if (!oldEnvelope?.payload) throw new Error(`Current prepared payload missing: ${scope}`);
  if (stableStringify(stripPresentationGroup(oldEnvelope.payload)) !== stableStringify(stripPresentationGroup(candidate))) {
    throw new Error(`NON_PRESENTATION_GROUP_DRIFT:${scope}`);
  }
  for (const resource of candidate.resources || []) {
    const group = clean(resource?.presentationGroup);
    if (!group || !allowedGroups.has(group)) throw new Error(`Missing/unknown presentationGroup:${scope}:${clean(resource?.objectKey)}:${group}`);
    totalResources += 1;
    if (group.startsWith('vr-')) vrResources += 1;
    else if (group.startsWith('elevenplus-')) elevenPlusResources += 1;
    else if (group.startsWith('core-')) coreResources += 1;
  }
  allPointers.push({ scope, pointerKey, pointerRaw, oldCurrent: pointer.current });
  if (stableStringify(oldEnvelope.payload) === stableStringify(candidate)) {
    unchangedScopes += 1;
    continue;
  }
  const payloadText = stableStringify(candidate);
  const payloadSha256 = await sha256Hex(payloadText);
  const newVersion = `cp12-ui-${payloadSha256.slice(0, 16)}-${runId}`;
  const envelope = {
    schemaVersion: 1,
    kind: 'prepared-read-model-envelope',
    scope,
    version: newVersion,
    sha256: payloadSha256,
    payload: candidate
  };
  const envelopeText = stableStringify(envelope);
  const envelopeSha256 = await sha256Hex(envelopeText);
  candidates.push({
    scope, pointerKey, pointerRaw, oldCurrent: pointer.current,
    newVersion, payloadSha256, envelopeSha256, envelopeText,
    envelopeKey: versionKey(scope, newVersion)
  });
}

if (!candidates.length) throw new Error('No published prepared lesson requires presentation metadata migration.');
if (coreResources === 0 || elevenPlusResources === 0 || vrResources === 0) {
  throw new Error(`Expected all presentation families: core=${coreResources}, elevenPlus=${elevenPlusResources}, vr=${vrResources}`);
}

const backup = {
  marker: 'CP12_RESOURCE_UI_POINTER_BACKUP',
  runId,
  readModelsKv: readKv,
  publishedScopes: pointerKeys.length,
  changedScopes: candidates.length,
  pointers: candidates.map(row => ({ scope: row.scope, pointerKey: row.pointerKey, pointerRaw: row.pointerRaw }))
};
fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2) + '\n');

if (action === 'preview') {
  const report = {
    marker: 'CP12_RESOURCE_UI_METADATA_PREVIEW_PASS', status: 'PASS', writes: false,
    publishedLessonScopes: pointerKeys.length, changedLessonScopes: candidates.length,
    unchangedLessonScopes: unchangedScopes, totalResources, coreResources, elevenPlusResources, vrResources,
    nonPresentationGroupDiffs: 0
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  process.exit(0);
}

if (action !== 'apply') throw new Error(`Unsupported CP12_METADATA_ACTION: ${action}`);

let pointerMutationStarted = false;
try {
  await bulkPut(candidates.map(row => ({ key: row.envelopeKey, value: row.envelopeText })));
  const envelopeVerification = await verifyKvRowsEventually(
    candidates.map(row => ({ scope: row.scope, key: row.envelopeKey, expected: row.envelopeText })),
    'Candidate envelope'
  );

  const updatedAt = new Date().toISOString();
  const pointerUpdates = candidates.map(row => {
    const value = stableStringify({
      schemaVersion: 1,
      kind: 'prepared-read-model-pointer',
      scope: row.scope,
      current: { version: row.newVersion, sha256: row.payloadSha256, envelopeSha256: row.envelopeSha256 },
      previous: row.oldCurrent || null,
      updatedAt
    });
    return { scope: row.scope, key: row.pointerKey, expected: value };
  });
  pointerMutationStarted = true;
  await bulkPut(pointerUpdates.map(row => ({ key: row.key, value: row.expected })));
  const pointerVerification = await verifyKvRowsEventually(pointerUpdates, 'Published pointer');

  const report = {
    marker: 'CP12_RESOURCE_UI_METADATA_APPLY_PASS', status: 'PASS', writes: true,
    publishedLessonScopes: pointerKeys.length, changedLessonScopes: candidates.length,
    unchangedLessonScopes: unchangedScopes, totalResources, coreResources, elevenPlusResources, vrResources,
    onlyPresentationGroupChanged: true, accessScopesChanged: false, globalScopeChanged: false,
    sourceLessonWrites: 0, pointerBackup: backupPath,
    verification: { envelope: envelopeVerification, pointer: pointerVerification }
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch (error) {
  if (pointerMutationStarted) {
    try { await restoreBackup(`automatic after apply failure: ${error?.message || error}`); }
    catch (rollbackError) { console.error('METADATA_ROLLBACK_FAILED', rollbackError); }
  }
  throw error;
}
