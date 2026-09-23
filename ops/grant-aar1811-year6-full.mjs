import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  VIEW_DEFINITIONS,
  assertReadModelReconciliationReady,
  refreshStudentAccessReadModel,
  opaqueAccessScopeId,
  resolveCurrentScope,
  globalToCatalogue
} from '../worker/src/access-read-model-sync.js';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const worker = clean(process.env.WORKER_NAME || 'fpt-portal-v2-worker');
const expectedStudents = clean(process.env.EXPECTED_STUDENTS_KV_ID || 'c9723c8806334e4ea54d1b456d31b794');
const expectedReadModels = clean(process.env.EXPECTED_READ_MODELS_KV_ID || '77b35165c8694087bc1b0515c35a7e89');
const expectedDb = clean(process.env.EXPECTED_PROD_D1_ID || '97250a54-fa91-45ad-a002-3c4566b1fc38');
const portalUserIdNorm = 'aar1811';
const userKey = `user:${portalUserIdNorm}`;
const requiredLibraries = Object.freeze(['MATHS_Y6_FULL', 'ENGLISH_Y6_FULL']);
const requiredViews = Object.freeze(['maths-year6', 'english-year6']);
const evidencePath = '/tmp/aar1811-year6-full-evidence.json';

if (!token || !account) throw new Error('Cloudflare credentials are required.');
if (!VIEW_DEFINITIONS['maths-year6']?.fullLibraryIds?.includes('MATHS_Y6_FULL')) throw new Error('MATHS_Y6_FULL mapping missing.');
if (!VIEW_DEFINITIONS['english-year6']?.fullLibraryIds?.includes('ENGLISH_Y6_FULL')) throw new Error('ENGLISH_Y6_FULL mapping missing.');

const base = 'https://api.cloudflare.com/client/v4';
const headers = { Authorization:`Bearer ${token}` };

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers:{ ...headers, ...(options.headers || {}) }
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { response, text, body };
}

async function envelope(path, options = {}) {
  const out = await request(path, options);
  if (!out.response.ok || out.body?.success !== true) {
    throw new Error(`Cloudflare request failed: ${out.response.status} ${path}`);
  }
  return out.body;
}

async function kvText(namespaceId, key) {
  const out = await request(`/accounts/${account}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`);
  if (out.response.status === 404) return null;
  if (!out.response.ok) throw new Error(`KV read failed: ${out.response.status}`);
  return out.text;
}

async function kvPut(namespaceId, key, value) {
  const out = await request(`/accounts/${account}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`, {
    method:'PUT',
    headers:{ 'content-type':'text/plain; charset=utf-8' },
    body:String(value)
  });
  if (!out.response.ok || out.body?.success !== true) throw new Error(`KV write failed: ${out.response.status}`);
}

function remoteKv(namespaceId) {
  return {
    async get(key, options = {}) {
      const text = await kvText(namespaceId, key);
      if (text == null) return null;
      if (options?.type === 'json') {
        try { return JSON.parse(text); } catch { return null; }
      }
      return text;
    },
    async put(key, value) { return kvPut(namespaceId, key, value); }
  };
}

function remoteDb(databaseId) {
  class Statement {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...params) { return new Statement(this.sql, params); }
    async all() {
      if (!/^\s*(SELECT|PRAGMA)\b/i.test(this.sql)) throw new Error('Production grant D1 adapter is read-only.');
      const body = await envelope(`/accounts/${account}/d1/database/${databaseId}/query`, {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body:JSON.stringify({ sql:this.sql, params:this.params })
      });
      const result = Array.isArray(body.result) ? body.result[0] : body.result;
      return { results:Array.isArray(result?.results) ? result.results : [] };
    }
  }
  return { prepare(sql) { return new Statement(sql); } };
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function withoutFullLibraries(record) {
  const copy = structuredClone(record);
  delete copy.fullLibraries;
  return copy;
}

const settings = (await envelope(`/accounts/${account}/workers/scripts/${worker}/settings`)).result || {};
const binding = name => (settings.bindings || []).find(row => row?.name === name) || {};
const studentsId = clean(binding('STUDENTS_KV').namespace_id);
const readModelsId = clean(binding('READ_MODELS_KV').namespace_id);
const dbId = clean(binding('DB').database_id || binding('DB').id);

if (studentsId !== expectedStudents) throw new Error('Production STUDENTS_KV binding drifted.');
if (readModelsId !== expectedReadModels) throw new Error('Production READ_MODELS_KV binding drifted.');
if (dbId !== expectedDb) throw new Error('Production D1 binding drifted.');

const env = {
  STUDENTS_KV:remoteKv(studentsId),
  READ_MODELS_KV:remoteKv(readModelsId),
  DB:remoteDb(dbId)
};

const ready = await assertReadModelReconciliationReady(env);
if (!ready?.ok) throw new Error('Prepared read-model reconciliation preflight failed.');

const originalText = await kvText(studentsId, userKey);
if (!originalText) throw new Error('AAR1811_STUDENT_NOT_FOUND');
let original;
try { original = JSON.parse(originalText); } catch { throw new Error('AAR1811_PROFILE_NOT_JSON'); }

if (norm(original?.portalUserId || portalUserIdNorm) !== portalUserIdNorm) throw new Error('AAR1811_PROFILE_ID_MISMATCH');
const role = norm(original?.role || original?.accountType);
if (portalUserIdNorm.startsWith('trial') || portalUserIdNorm === 'admin' || role.includes('admin') || original?.isAdmin === true || original?.superuser === true) {
  throw new Error('AAR1811_NOT_ORDINARY_STUDENT');
}
const status = norm(original?.accountStatus || original?.status || 'active');
if (['inactive','disabled','expired','withdrawn'].includes(status)) throw new Error('AAR1811_NOT_ACTIVE');

const global = await resolveCurrentScope(env.READ_MODELS_KV, 'global');
const catalogue = globalToCatalogue(global.payload);
const year6LessonIds = Object.entries(catalogue?.lessonToViews || {})
  .filter(([, views]) => Array.isArray(views) && views.some(viewId => requiredViews.includes(norm(viewId))))
  .map(([lessonId]) => clean(lessonId))
  .filter(Boolean)
  .sort();
if (!year6LessonIds.length) throw new Error('YEAR6_CATALOGUE_EMPTY');

const year6Set = new Set(year6LessonIds);
const blockedYear6 = (Array.isArray(original?.blockedLessons) ? original.blockedLessons : [])
  .map(clean).filter(lessonId => year6Set.has(lessonId));
if (blockedYear6.length) throw new Error(`AAR1811_EXPLICIT_YEAR6_BLOCKS_PRESENT:${blockedYear6.length}`);

const existingLibraries = Array.isArray(original?.fullLibraries) ? original.fullLibraries.map(clean).filter(Boolean) : [];
const existingUpper = new Set(existingLibraries.map(value => value.toUpperCase()));
const missingLibraries = requiredLibraries.filter(value => !existingUpper.has(value));
const updated = structuredClone(original);
updated.fullLibraries = [...existingLibraries, ...missingLibraries];

let canonicalWritten = false;
let rollbackInvoked = false;
try {
  if (missingLibraries.length) {
    await kvPut(studentsId, userKey, JSON.stringify(updated));
    canonicalWritten = true;
  }

  const canonicalReadbackText = await kvText(studentsId, userKey);
  if (!canonicalReadbackText) throw new Error('AAR1811_CANONICAL_READBACK_MISSING');
  const canonicalReadback = JSON.parse(canonicalReadbackText);
  const readbackUpper = new Set((canonicalReadback.fullLibraries || []).map(value => clean(value).toUpperCase()));
  for (const required of requiredLibraries) {
    if (!readbackUpper.has(required)) throw new Error(`AAR1811_CANONICAL_LIBRARY_MISSING:${required}`);
  }
  if (stable(withoutFullLibraries(canonicalReadback)) !== stable(withoutFullLibraries(original))) {
    throw new Error('AAR1811_UNRELATED_PROFILE_FIELD_CHANGED');
  }

  const published = await refreshStudentAccessReadModel(env, portalUserIdNorm);
  const scopeSalt = clean(await env.READ_MODELS_KV.get('meta:scope-salt'));
  if (!scopeSalt) throw new Error('READ_MODEL_SCOPE_SALT_MISSING');
  const scopeId = await opaqueAccessScopeId(portalUserIdNorm, scopeSalt);
  const prepared = await resolveCurrentScope(env.READ_MODELS_KV, `access:${scopeId}`);
  const snapshot = prepared?.payload?.snapshot;
  if (!snapshot) throw new Error('AAR1811_PREPARED_ACCESS_MISSING');

  const preparedFullViews = new Set((snapshot.fullViewIds || []).map(norm));
  for (const requiredView of requiredViews) {
    if (!preparedFullViews.has(requiredView)) throw new Error(`AAR1811_PREPARED_FULL_VIEW_MISSING:${requiredView}`);
  }

  const failedCore = [];
  for (const lessonId of year6LessonIds) {
    const state = snapshot.lessonAccess?.[lessonId];
    if (!state?.core || state?.blocked === true || state?.preLessonOnly === true) failedCore.push(lessonId);
  }
  if (failedCore.length) throw new Error(`AAR1811_YEAR6_CORE_PARITY_FAILED:${failedCore.length}`);

  const evidence = {
    marker:'AAR1811_YEAR6_FULL_ACCESS_PASS',
    status:'PASS',
    portalUserId:'Aar1811',
    canonicalKeyDigest:sha(userKey).slice(0, 16),
    requiredLibraries,
    requiredViews,
    addedLibraries:missingLibraries,
    alreadyPresent:missingLibraries.length === 0,
    year6CatalogueLessonCount:year6LessonIds.length,
    explicitYear6Blocks:0,
    unrelatedProfileFieldsPreserved:true,
    credentialsDisclosed:false,
    canonicalReadbackVerified:true,
    preparedReadbackVerified:true,
    preparedVersion:prepared.version,
    refreshVersion:published?.version || null,
    rollbackInvoked:false,
    bindings:{ studentsKv:studentsId, readModelsKv:readModelsId, d1:dbId }
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  if (canonicalWritten) {
    rollbackInvoked = true;
    try {
      await kvPut(studentsId, userKey, originalText);
      await refreshStudentAccessReadModel(env, portalUserIdNorm);
      const restored = await kvText(studentsId, userKey);
      if (restored !== originalText) throw new Error('CANONICAL_ROLLBACK_READBACK_MISMATCH');
    } catch (rollbackError) {
      throw new Error(`AAR1811_GRANT_FAILED_AND_ROLLBACK_FAILED:${String(error?.message || error)}:${String(rollbackError?.message || rollbackError)}`);
    }
  }
  const failureEvidence = {
    marker:'AAR1811_YEAR6_FULL_ACCESS_FAILED',
    status:'FAILED',
    portalUserId:'Aar1811',
    rollbackInvoked,
    credentialsDisclosed:false,
    error:String(error?.message || error)
  };
  fs.writeFileSync(evidencePath, JSON.stringify(failureEvidence, null, 2));
  console.error(JSON.stringify(failureEvidence, null, 2));
  throw error;
}
