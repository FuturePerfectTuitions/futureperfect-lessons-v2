import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  SCOPE_SALT_KEY,
  assertReadModelReconciliationReady,
  refreshStudentAccessReadModel,
  opaqueAccessScopeId,
  pointerKey
} from '../worker/src/access-read-model-sync.js';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const worker = clean(process.env.WORKER_NAME || 'fpt-portal-v2-worker');
const expectedStudents = clean(process.env.EXPECTED_STUDENTS_KV_ID || 'c9723c8806334e4ea54d1b456d31b794');
const expectedReadModels = clean(process.env.EXPECTED_READ_MODELS_KV_ID || '77b35165c8694087bc1b0515c35a7e89');
const expectedDb = clean(process.env.EXPECTED_PROD_D1_ID || '97250a54-fa91-45ad-a002-3c4566b1fc38');
const asOfDate = clean(process.env.RECONCILIATION_AS_OF_DATE) || new Intl.DateTimeFormat('en-CA', {
  timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'
}).format(new Date());
const concurrency = Math.max(1, Math.min(8, Number(process.env.RECONCILIATION_CONCURRENCY || 4)));

if (!token || !account) throw new Error('Cloudflare credentials are required.');
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new Error('RECONCILIATION_AS_OF_DATE must be YYYY-MM-DD.');

const base = 'https://api.cloudflare.com/client/v4';
const headers = { Authorization:`Bearer ${token}` };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

async function kvDelete(namespaceId, key) {
  const out = await request(`/accounts/${account}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`, {
    method:'DELETE'
  });
  if (!out.response.ok || out.body?.success !== true) throw new Error(`KV delete failed: ${out.response.status}`);
}

async function kvKeys(namespaceId, prefix) {
  const keys = [];
  let cursor = '';
  do {
    const query = new URLSearchParams({ limit:'1000', prefix });
    if (cursor) query.set('cursor', cursor);
    const body = await envelope(`/accounts/${account}/storage/kv/namespaces/${namespaceId}/keys?${query}`);
    keys.push(...(body.result || []).map(row => clean(row?.name)).filter(Boolean));
    cursor = clean(body.result_info?.cursor);
  } while (cursor);
  return keys;
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
    async put(key, value) { return kvPut(namespaceId, key, value); },
    async delete(key) { return kvDelete(namespaceId, key); }
  };
}

function remoteDb(databaseId) {
  class Statement {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...params) { return new Statement(this.sql, params); }
    async all() {
      if (!/^\s*(SELECT|PRAGMA)\b/i.test(this.sql)) {
        throw new Error('Reconciliation D1 adapter is read-only.');
      }
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

function isCurrentStudent(id, user) {
  const role = norm(user?.role || user?.accountType);
  if (id === 'admin' || role.includes('admin') || user?.isAdmin === true || user?.superuser === true) return { current:false, reason:'admin' };
  const status = norm(user?.accountStatus || user?.status || 'active');
  const expires = clean(user?.expiresOn || user?.expires);
  if (['inactive','disabled','expired','withdrawn'].includes(status) || (expires && expires <= asOfDate)) {
    return { current:false, reason:'inactive' };
  }
  return { current:true, reason:'current' };
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

async function mapLimit(values, limit, fn) {
  const results = new Array(values.length);
  let next = 0;
  async function runner() {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await fn(values[index], index);
    }
  }
  await Promise.all(Array.from({ length:Math.min(limit, Math.max(1, values.length)) }, runner));
  return results;
}

async function retry(fn, attempts = 3) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await fn(attempt); } catch (error) {
      last = error;
      if (attempt < attempts) await sleep(750 * attempt);
    }
  }
  throw last;
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

const scopeSalt = clean(await env.READ_MODELS_KV.get(SCOPE_SALT_KEY));
if (!/^[0-9a-f]{64}$/i.test(scopeSalt)) throw new Error('Production scope salt is missing or malformed.');

const profileKeys = (await kvKeys(studentsId, 'user:')).sort();
const current = [];
let excludedAdmin = 0;
let excludedInactive = 0;
for (const key of profileKeys) {
  const id = norm(key.replace(/^user:/, ''));
  const user = await env.STUDENTS_KV.get(key, { type:'json' });
  if (!id || !user) continue;
  const state = isCurrentStudent(id, user);
  if (!state.current) {
    if (state.reason === 'admin') excludedAdmin += 1;
    else excludedInactive += 1;
    continue;
  }
  const scopeId = await opaqueAccessScopeId(id, scopeSalt);
  const scope = `access:${scopeId}`;
  const keyName = pointerKey(scope);
  const previousPointerText = await env.READ_MODELS_KV.get(keyName);
  current.push({ id, scope, pointerKey:keyName, previousPointerText });
}

if (!current.length) throw new Error('No current student profiles were found to reconcile.');

const changed = [];
const failures = [];
try {
  await mapLimit(current, concurrency, async item => {
    try {
      const result = await retry(() => refreshStudentAccessReadModel(env, item.id, { asOfDate }), 3);
      changed.push({ item, result });
      return result;
    } catch (error) {
      failures.push({ digest:digest(item.id), message:String(error?.message || error) });
      throw error;
    }
  });
} catch (error) {
  const rollbackFailures = [];
  await mapLimit(changed, Math.min(concurrency, 4), async ({ item }) => {
    try {
      if (item.previousPointerText == null) await env.READ_MODELS_KV.delete(item.pointerKey);
      else await env.READ_MODELS_KV.put(item.pointerKey, item.previousPointerText);
    } catch (rollbackError) {
      rollbackFailures.push({ digest:digest(item.id), message:String(rollbackError?.message || rollbackError) });
    }
  });
  const summary = {
    marker:'CURRENT_STUDENT_ACCESS_RECONCILIATION_ROLLED_BACK',
    status:rollbackFailures.length ? 'ROLLBACK_INCOMPLETE' : 'ROLLED_BACK',
    asOfDate,
    profileKeyCount:profileKeys.length,
    eligibleCurrentStudents:current.length,
    attempted:changed.length + failures.length,
    failures:failures.length,
    rollbackFailures:rollbackFailures.length,
    canonicalSourcesMutated:false,
    studentIdentitiesIncluded:false,
    credentialsDisclosed:false
  };
  fs.writeFileSync('/tmp/current-student-access-reconciliation.json', JSON.stringify(summary, null, 2));
  console.error(JSON.stringify(summary, null, 2));
  if (failures.length) console.error(`First failed student digest: ${failures[0].digest}; ${failures[0].message}`);
  throw new Error(rollbackFailures.length ? 'Reconciliation failed and rollback was incomplete.' : 'Reconciliation failed; read-model pointers were rolled back.');
}

const reused = changed.filter(row => row.result?.reused === true).length;
const published = changed.length - reused;
const summary = {
  marker:'CURRENT_STUDENT_ACCESS_RECONCILIATION_PASS',
  status:'PASS',
  asOfDate,
  globalVersion:ready.globalVersion,
  profileKeyCount:profileKeys.length,
  eligibleCurrentStudents:current.length,
  excludedAdmin,
  excludedInactive,
  reconciled:changed.length,
  published,
  reused,
  failures:0,
  canonicalSourcesMutated:false,
  writeTarget:'READ_MODELS_KV_ONLY',
  atomicPerStudentPointers:true,
  studentIdentitiesIncluded:false,
  credentialsDisclosed:false,
  bindings:{ studentsKv:studentsId, readModelsKv:readModelsId, d1:dbId }
};
fs.writeFileSync('/tmp/current-student-access-reconciliation.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
