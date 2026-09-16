import fs from 'node:fs';
import { compileAccessScope, globalToCatalogue } from '../rebuild/adminops/src/lib/compiler.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import {
  stableStringify,
  sha256Hex,
  pointerKey,
  publishScopeAtomic,
  resolveCurrentScope
} from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const clean = v => String(v ?? '').trim();
const norm = v => clean(v).toLowerCase();
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const allowWrite = clean(process.env.ALLOW_WRITE).toLowerCase() === 'true';
const asOfDate = clean(process.env.AS_OF_DATE || '2026-09-16');
const runTag = clean(process.env.GITHUB_RUN_ID || Date.now()).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40);
const worker = clean(process.env.LEGACY_WORKER || 'fpt-portal-v2-worker');
const readModelsNs = clean(process.env.READ_MODELS_KV || '77b35165c8694087bc1b0515c35a7e89');
const expectedStudentsNs = clean(process.env.STUDENTS_KV || 'c9723c8806334e4ea54d1b456d31b794');
const expectedDb = clean(process.env.D1_ID || '97250a54-fa91-45ad-a002-3c4566b1fc38');
if (!token || !account) throw new Error('Cloudflare credentials are required.');

const targetLessons = new Map([
  ['ame0503', ['Y6M2.2', 'Y6M2.3']],
  ['conn2209', ['Y6M2.2', 'Y6M2.3']],
  ['kiaan1312', ['Y6M2.3', 'Y6M2.4']],
  ['ma0605', ['Y6M2.3', 'Y6M2.4']],
  ['zar0603', ['Y6E2']]
]);
const targetUsers = [...targetLessons.keys()];
const base = 'https://api.cloudflare.com/client/v4';
const headers = { Authorization: `Bearer ${token}` };

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { response, text, body };
}
async function envelope(path, options = {}) {
  const out = await request(path, options);
  if (!out.response.ok || out.body?.success !== true) {
    throw new Error(`Cloudflare request failed ${out.response.status}: ${path}: ${JSON.stringify(out.body?.errors || [])}`);
  }
  return out.body;
}
async function kvText(ns, key) {
  const out = await request(`/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`);
  if (out.response.status === 404) return null;
  if (!out.response.ok) throw new Error(`KV read failed ${out.response.status}: ${key}`);
  return out.text;
}
async function kvJson(ns, key) {
  const text = await kvText(ns, key);
  if (text == null) return null;
  try { return JSON.parse(text); } catch { throw new Error(`KV JSON invalid: ${key}`); }
}
async function kvPut(ns, key, value) {
  if (!allowWrite) throw new Error('WRITE_GUARD_BLOCKED');
  const out = await request(`/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: String(value)
  });
  if (!out.response.ok) throw new Error(`KV write failed ${out.response.status}: ${key}: ${out.text.slice(0, 300)}`);
}
async function d1Query(db, sql) {
  if (!/^\s*(SELECT|PRAGMA)\b/i.test(sql) || /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM)\b/i.test(sql)) {
    throw new Error('Read-only D1 guard blocked a non-read statement.');
  }
  const body = await envelope(`/accounts/${account}/d1/database/${db}/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql })
  });
  const first = Array.isArray(body.result) ? body.result[0] : body.result;
  return Array.isArray(first?.results) ? first.results : [];
}
function group(rows) {
  const map = new Map();
  for (const row of rows) {
    const id = norm(row?.portal_user_id_norm);
    if (!id) continue;
    const bucket = map.get(id) || [];
    bucket.push(row);
    map.set(id, bucket);
  }
  return map;
}
const readStore = {
  get: key => kvText(readModelsNs, key),
  put: (key, value) => kvPut(readModelsNs, key, value)
};

const settings = (await envelope(`/accounts/${account}/workers/scripts/${encodeURIComponent(worker)}/settings`)).result || {};
const binding = name => (settings.bindings || []).find(x => x.name === name) || {};
const studentsNs = clean(binding('STUDENTS_KV').namespace_id);
const dbId = clean(binding('DB').database_id || binding('DB').id);
if (studentsNs !== expectedStudentsNs || dbId !== expectedDb) {
  throw new Error(`Production source binding drift: students=${studentsNs}, db=${dbId}`);
}
const shadowBinding = (settings.bindings || []).find(x => clean(x.namespace_id) === readModelsNs);
if (!shadowBinding) throw new Error('Production Worker no longer retains the prepared-model KV source binding used by CP11.');
const scopeSecret = clean(await kvText(readModelsNs, 'meta:scope-salt'));
if (!/^[0-9a-f]{64}$/i.test(scopeSecret)) throw new Error('Prepared-model scope salt missing or malformed.');

const globalResolved = await resolveCurrentScope(readStore, 'global');
const catalogue = globalToCatalogue(globalResolved.payload);
const [definitions, assignments, entitlements, prelessons] = await Promise.all([
  d1Query(dbId, 'SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions'),
  d1Query(dbId, 'SELECT a.portal_user_id_norm, a.batch_key, a.effective_from, a.effective_to, b.subject, b.school_year, b.stream, b.maths_level, b.active_from AS batch_active_from, b.active_to AS batch_active_to FROM student_batch_assignments a JOIN batch_definitions b ON b.batch_key = a.batch_key'),
  d1Query(dbId, 'SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source, first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date FROM lesson_entitlements'),
  d1Query(dbId, 'SELECT portal_user_id_norm, lesson_id, batch_key, lesson_date, vr_access, source_row_id, first_granted_at, last_confirmed_at FROM online_prelesson_entitlements')
]);
const byAssignments = group(assignments), byEntitlements = group(entitlements), byPre = group(prelessons);

const prepared = [];
for (const id of targetUsers) {
  const user = await kvJson(studentsNs, `user:${id}`);
  if (!user) throw new Error(`Missing production profile ${id}`);
  const scopeId = await opaqueAccessScopeId(id, scopeSecret);
  const scope = `access:${scopeId}`;
  const beforeRaw = await kvText(readModelsNs, pointerKey(scope));
  if (!beforeRaw) throw new Error(`Missing prepared pointer for ${id}`);
  let beforePointer;
  try { beforePointer = JSON.parse(beforeRaw); } catch { throw new Error(`Invalid prepared pointer for ${id}`); }
  const before = await resolveCurrentScope(readStore, scope);
  const input = {
    asOfDate,
    user,
    batchDefinitions: definitions,
    batchAssignments: byAssignments.get(id) || [],
    entitlements: byEntitlements.get(id) || [],
    onlinePreLessonEntitlements: byPre.get(id) || []
  };
  const expected = compileAccessScope(input, catalogue, { scopeId, asOfDate });
  const wanted = targetLessons.get(id) || [];
  const targetState = wanted.map(lessonId => ({
    lessonId,
    d1: (byEntitlements.get(id) || []).find(r => clean(r.lesson_id) === lessonId) || null,
    before: before.payload?.snapshot?.lessonAccess?.[lessonId] || null,
    expected: expected?.snapshot?.lessonAccess?.[lessonId] || null
  }));
  for (const row of targetState) {
    if (Number(row.d1?.core_access || 0) !== 1) throw new Error(`Target D1 entitlement no longer full: ${id}/${row.lessonId}`);
    if (row.expected?.core !== true || row.expected?.blocked === true) throw new Error(`Compiler does not expect target lesson open: ${id}/${row.lessonId}`);
    if (row.before?.core === true && row.before?.blocked !== true) throw new Error(`Preflight drift: target already open before repair: ${id}/${row.lessonId}`);
  }
  prepared.push({ id, user, scopeId, scope, beforeRaw, beforePointer, before, expected, targetState });
}

const mismatchPairs = prepared.flatMap(x => x.targetState.filter(r => r.before?.core !== true || r.before?.blocked === true).map(r => `${x.id}|${r.lessonId}`)).sort();
const expectedMismatchPairs = targetUsers.flatMap(id => (targetLessons.get(id) || []).map(l => `${id}|${l}`)).sort();
if (stableStringify(mismatchPairs) !== stableStringify(expectedMismatchPairs)) {
  throw new Error(`Exact mismatch set drifted before repair: ${JSON.stringify(mismatchPairs)}`);
}

const report = {
  marker: 'FPT_RELEASE_VISIBILITY_REPAIR',
  mode: allowWrite ? 'WRITE' : 'DRY_RUN',
  asOfDate,
  observedAt: new Date().toISOString(),
  globalVersion: globalResolved.version,
  targets: prepared.map(x => ({
    portalUserId: x.id,
    scope: x.scope,
    pointerBefore: x.beforePointer,
    targetLessons: x.targetState
  })),
  exactMismatchCount: mismatchPairs.length,
  exactMismatchPairs,
  published: [],
  rollback: null,
  status: allowWrite ? 'PENDING' : 'DRY_RUN_PASS'
};

if (!allowWrite) {
  fs.writeFileSync('/tmp/release-visibility-repair.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ marker: report.marker, mode: report.mode, status: report.status, exactMismatchCount: report.exactMismatchCount, exactMismatchPairs }, null, 2));
  process.exit(0);
}

const mutated = [];
async function restorePointers(reason) {
  const rows = [];
  for (const entry of mutated.slice().reverse()) {
    await kvPut(readModelsNs, pointerKey(entry.scope), entry.beforeRaw);
    const restored = await resolveCurrentScope(readStore, entry.scope);
    const ok = clean(restored.version) === clean(entry.beforePointer?.current?.version) && clean(restored.sha256) === clean(entry.beforePointer?.current?.sha256);
    rows.push({ portalUserId: entry.id, scope: entry.scope, restoredVersion: restored.version, ok });
    if (!ok) throw new Error(`Rollback pointer verification failed for ${entry.id}`);
  }
  report.rollback = { attempted: true, reason, rows };
}

try {
  for (const entry of prepared) {
    // Abort if the current pointer moved since preflight; do not overwrite concurrent publication.
    const immediate = await kvText(readModelsNs, pointerKey(entry.scope));
    if (immediate !== entry.beforeRaw) throw new Error(`Concurrent pointer change detected for ${entry.id}`);
    const payloadSha = await sha256Hex(stableStringify(entry.expected));
    const version = `incident-vis-${payloadSha.slice(0, 16)}-${runTag}`;
    const published = await publishScopeAtomic(readStore, {
      scope: entry.scope,
      payload: entry.expected,
      version,
      updatedAt: new Date().toISOString()
    });
    mutated.push(entry);
    report.published.push({
      portalUserId: entry.id,
      scope: entry.scope,
      version: published.version,
      payloadSha256: published.payloadSha256,
      previousVersion: published.previousVersion
    });
  }

  for (const entry of prepared) {
    const after = await resolveCurrentScope(readStore, entry.scope);
    if (stableStringify(after.payload) !== stableStringify(entry.expected)) {
      throw new Error(`Published payload does not equal freshly compiled source for ${entry.id}`);
    }
    for (const lessonId of targetLessons.get(entry.id) || []) {
      const state = after.payload?.snapshot?.lessonAccess?.[lessonId];
      if (state?.core !== true || state?.blocked === true || state?.preLessonOnly === true) {
        throw new Error(`Target lesson still not full after publication: ${entry.id}/${lessonId}`);
      }
    }
  }
  report.status = 'WRITE_PASS';
  report.completedAt = new Date().toISOString();
} catch (error) {
  try { await restorePointers(String(error?.message || error)); }
  catch (rollbackError) {
    report.rollbackFailure = String(rollbackError?.message || rollbackError);
  }
  report.status = 'WRITE_FAILED_ROLLED_BACK';
  report.error = String(error?.message || error);
  fs.writeFileSync('/tmp/release-visibility-repair.json', JSON.stringify(report, null, 2) + '\n');
  throw error;
}

fs.writeFileSync('/tmp/release-visibility-repair.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  marker: report.marker,
  mode: report.mode,
  status: report.status,
  exactMismatchCount: report.exactMismatchCount,
  published: report.published.map(x => ({ portalUserId: x.portalUserId, version: x.version, previousVersion: x.previousVersion }))
}, null, 2));
