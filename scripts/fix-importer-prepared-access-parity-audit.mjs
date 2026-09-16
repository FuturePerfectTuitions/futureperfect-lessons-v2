import fs from 'node:fs';
import { compileAccessScope, globalToCatalogue } from '../rebuild/adminops/src/lib/compiler.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { stableStringify, pointerKey, versionKey } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const worker = clean(process.env.LEGACY_WORKER || 'fpt-portal-v2-worker');
const readModelsKv = clean(process.env.READ_MODELS_KV_ID || '77b35165c8694087bc1b0515c35a7e89');
const asOfDate = clean(process.env.AS_OF_DATE) || new Intl.DateTimeFormat('en-CA', {
  timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'
}).format(new Date());
const output = clean(process.env.PARITY_OUTPUT || '/tmp/fix-importer-prepared-access-parity.json');
const explicitTestUsers = new Set(['mahu1907']);
if (!account || !token) throw new Error('Cloudflare credentials are required.');

const base = 'https://api.cloudflare.com/client/v4';
const headers = { Authorization:`Bearer ${token}` };
async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers:{ ...headers, ...(options.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { response, text, body };
}
async function envelope(path, options = {}) {
  const out = await request(path, options);
  if (!out.response.ok || out.body?.success !== true) {
    throw new Error(`Cloudflare request failed ${out.response.status}: ${path}`);
  }
  return out.body.result;
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
  return JSON.parse(text);
}
async function kvKeys(ns, prefix) {
  const keys = [];
  let cursor = '';
  do {
    const q = new URLSearchParams({ prefix, limit:'1000' });
    if (cursor) q.set('cursor', cursor);
    const body = await envelope(`/accounts/${account}/storage/kv/namespaces/${ns}/keys?${q}`);
    keys.push(...(body || []).map?.(x => x.name).filter(Boolean) || []);
    // user:* is far below 1000 in this portal.
    cursor = '';
  } while (cursor);
  return keys;
}
async function d1Query(db, sql) {
  if (!/^\s*(SELECT|PRAGMA)\b/i.test(sql)) throw new Error('Read-only audit rejected a mutating D1 statement.');
  const result = await envelope(`/accounts/${account}/d1/database/${db}/query`, {
    method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ sql })
  });
  const first = Array.isArray(result) ? result[0] : result;
  return Array.isArray(first?.results) ? first.results : [];
}
function semanticPayload(payload) {
  if (payload == null) return null;
  const copy = JSON.parse(JSON.stringify(payload));
  // asOfDate is snapshot metadata, not an access semantic. A previous day's
  // prepared model may be semantically current even when this date differs.
  if (copy && typeof copy === 'object') {
    delete copy.asOfDate;
    if (copy.snapshot && typeof copy.snapshot === 'object') delete copy.snapshot.asOfDate;
  }
  return copy;
}

const settings = await envelope(`/accounts/${account}/workers/scripts/${encodeURIComponent(worker)}/settings`);
const binding = name => (settings.bindings || []).find(row => row.name === name) || {};
const studentsKv = clean(binding('STUDENTS_KV').namespace_id);
const db = clean(binding('DB').database_id || binding('DB').id);
const boundReadModels = (settings.bindings || []).find(row => clean(row.namespace_id) === readModelsKv);
if (!studentsKv || !db || !boundReadModels) throw new Error('Production source/read-model bindings do not match the expected topology.');

const salt = clean(await kvText(readModelsKv, 'meta:scope-salt'));
if (!/^[0-9a-f]{64}$/i.test(salt)) throw new Error('Prepared-access scope salt missing or malformed.');
const globalPointer = await kvJson(readModelsKv, pointerKey('global'));
const globalVersion = clean(globalPointer?.current?.version);
if (!globalVersion) throw new Error('Prepared global pointer missing.');
const globalEnvelope = await kvJson(readModelsKv, versionKey('global', globalVersion));
if (globalEnvelope?.payload?.kind !== 'prepared-global-read-model') throw new Error('Prepared global payload invalid.');
const catalogue = globalToCatalogue(globalEnvelope.payload);

const [definitions, assignments, entitlements, preLesson] = await Promise.all([
  d1Query(db, 'SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions'),
  d1Query(db, `SELECT a.portal_user_id_norm, a.batch_key, a.effective_from, a.effective_to,
      b.subject, b.school_year, b.stream, b.maths_level,
      b.active_from AS batch_active_from, b.active_to AS batch_active_to
    FROM student_batch_assignments a JOIN batch_definitions b ON b.batch_key = a.batch_key`),
  d1Query(db, `SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source,
      first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date
    FROM lesson_entitlements`),
  d1Query(db, `SELECT portal_user_id_norm, lesson_id, batch_key, lesson_date, vr_access,
      source_row_id, first_granted_at, last_confirmed_at
    FROM online_prelesson_entitlements`)
]);
function group(rows) {
  const map = new Map();
  for (const row of rows) {
    const id = norm(row?.portal_user_id_norm);
    if (!id) continue;
    const list = map.get(id) || [];
    list.push(row);
    map.set(id, list);
  }
  return map;
}
const assignmentsByUser = group(assignments);
const entitlementsByUser = group(entitlements);
const preByUser = group(preLesson);

function isCurrentStudent(id, user) {
  const role = norm(user?.role || user?.accountType);
  if (id === 'admin' || role.includes('admin') || user?.isAdmin === true || user?.superuser === true) return false;
  const status = norm(user?.accountStatus || user?.status || 'active');
  const expires = clean(user?.expiresOn || user?.expires);
  if (['inactive','disabled','expired','withdrawn'].includes(status)) return false;
  if (expires && expires <= asOfDate) return false;
  return true;
}

const userKeys = (await kvKeys(studentsKv, 'user:')).sort();
const rows = [];
const skippedTestUsers = [];
for (const key of userKeys) {
  const id = norm(key.replace(/^user:/, ''));
  const user = await kvJson(studentsKv, key);
  if (!user || !isCurrentStudent(id, user)) continue;
  if (explicitTestUsers.has(id)) {
    skippedTestUsers.push(id);
    continue;
  }
  const scopeId = await opaqueAccessScopeId(id, salt);
  const scope = `access:${scopeId}`;
  const input = {
    asOfDate,
    user,
    batchDefinitions:definitions,
    batchAssignments:assignmentsByUser.get(id) || [],
    entitlements:entitlementsByUser.get(id) || [],
    onlinePreLessonEntitlements:preByUser.get(id) || []
  };
  const expected = compileAccessScope(input, catalogue, { scopeId, asOfDate });
  const pointer = await kvJson(readModelsKv, pointerKey(scope));
  const version = clean(pointer?.current?.version);
  const envelopeRow = version ? await kvJson(readModelsKv, versionKey(scope, version)) : null;
  const actual = envelopeRow?.payload || null;
  const exactMatch = actual != null && stableStringify(actual) === stableStringify(expected);
  const semanticMatch = actual != null && stableStringify(semanticPayload(actual)) === stableStringify(semanticPayload(expected));
  rows.push({ portalUserIdNorm:id, scope, version:version || null, exactMatch, semanticMatch });
}

const mismatches = rows.filter(row => !row.semanticMatch);
const report = {
  marker:mismatches.length ? 'FIX_IMPORTER_PREPARED_ACCESS_PARITY_FAIL' : 'FIX_IMPORTER_PREPARED_ACCESS_PARITY_PASS',
  status:mismatches.length ? 'FAIL' : 'PASS',
  readOnly:true,
  comparison:'semantic_access_ignoring_snapshot_asOfDate',
  asOfDate,
  currentRealStudents:rows.length,
  skippedExplicitTestUsers:skippedTestUsers,
  exactMatches:rows.filter(row => row.exactMatch).length,
  semanticMatches:rows.filter(row => row.semanticMatch).length,
  mismatches:mismatches.length,
  mismatchUsers:mismatches.map(row => row.portalUserIdNorm),
  rows
};
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, rows:undefined }, null, 2));
if (mismatches.length) process.exitCode = 2;
