import assert from 'node:assert/strict';
import fs from 'node:fs';

const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const workerName = String(process.env.WORKER_NAME || 'fpt-portal-v2-worker').trim();
const action = String(process.env.PHASE17_FINALIZE_ACTION || 'precheck').trim();
const backupFile = String(process.env.PHASE17_REAL_BACKUP_FILE || '/tmp/phase17-real-pre-finalize.json').trim();

if (!accountId || !token) throw new Error('Cloudflare credentials are required.');
if (!['precheck', 'backup-real', 'fix-real-full-library', 'postcheck'].includes(action)) throw new Error('Unsupported Phase 17 finalize action.');

async function cf(pathname, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) throw new Error(`Cloudflare request failed: ${pathname} (HTTP ${response.status})`);
  return body;
}

function binding(settings, name, type) {
  return settings?.result?.bindings?.find(item => item?.name === name && (!type || item?.type === type)) || null;
}

async function listKvKeys(namespaceId) {
  const keys = [];
  let cursor = '';
  for (;;) {
    const query = new URLSearchParams({ limit: '1000' });
    if (cursor) query.set('cursor', cursor);
    const body = await cf(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys?${query}`);
    for (const item of body.result || []) if (typeof item?.name === 'string') keys.push(item.name);
    cursor = String(body?.result_info?.cursor || '');
    if (!cursor) break;
  }
  return keys;
}

async function bulkGet(namespaceId, keys) {
  const body = await cf(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk/get`, {
    method: 'POST', body: JSON.stringify({ keys, type: 'text', withMetadata: false })
  });
  return new Map(Object.entries(body?.result?.values || {}).map(([key, value]) => [key, String(value)]));
}

async function bulkPut(namespaceId, pairs) {
  const body = await cf(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`, {
    method: 'PUT', body: JSON.stringify(pairs.map(({ key, value }) => ({ key, value })))
  });
  assert.equal((body?.result?.unsuccessful_keys || []).length, 0, 'KV bulk update reported unsuccessful keys.');
}

async function d1Query(databaseId, sql, params = []) {
  const body = await cf(`/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: 'POST', body: JSON.stringify({ sql, params })
  });
  const first = Array.isArray(body.result) ? body.result[0] : body.result;
  if (!first?.success) throw new Error('D1 query returned unsuccessful result.');
  return Array.isArray(first.results) ? first.results : [];
}

async function scalar(databaseId, sql, params = []) {
  return Number((await d1Query(databaseId, sql, params))[0]?.value ?? NaN);
}

function parse(raw) {
  try { return JSON.parse(raw); } catch { throw new Error('Invalid student KV JSON.'); }
}

function credentialValid(value) {
  const s = String(value || '');
  return s.length === 4 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s);
}

function array(value) { return Array.isArray(value) ? value : []; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function getContext() {
  const settings = await cf(`/accounts/${accountId}/workers/scripts/${workerName}/settings`);
  const environment = String(binding(settings, 'ENVIRONMENT', 'plain_text')?.text || '');
  const login = String(binding(settings, 'STUDENT_LOGIN_ENABLED', 'plain_text')?.text || '');
  const r2Bucket = String(binding(settings, 'MATERIALS_R2', 'r2_bucket')?.bucket_name || '');
  const studentsId = String(binding(settings, 'STUDENTS_KV', 'kv_namespace')?.namespace_id || '');
  const lessonsId = String(binding(settings, 'LESSONS_KV', 'kv_namespace')?.namespace_id || '');
  const databaseId = String(binding(settings, 'DB', 'd1')?.id || '');
  assert.equal(environment, 'development');
  assert.ok(!login || login.toLowerCase() === 'false');
  assert.equal(r2Bucket, 'fpt-materials-dev');
  assert.ok(studentsId && lessonsId && databaseId);
  return { settings, studentsId, lessonsId, databaseId, r2Bucket };
}

async function loadRealState(ctx) {
  const assigned = await d1Query(ctx.databaseId, 'SELECT DISTINCT portal_user_id_norm FROM student_batch_assignments ORDER BY portal_user_id_norm');
  const realIds = assigned.map(row => String(row.portal_user_id_norm || '').toLowerCase()).filter(Boolean);
  assert.equal(realIds.length, 2, 'Exactly two assigned real records are required.');
  const userKeys = (await listKvKeys(ctx.studentsId)).filter(key => /^user:/i.test(key));
  assert.equal(userKeys.length, 2, 'Post-clean STUDENTS_KV must contain exactly two user records.');
  const realKeySet = new Set(realIds.map(id => `user:${id}`));
  assert.deepEqual(new Set(userKeys.map(key => key.toLowerCase())), realKeySet, 'STUDENTS_KV users must exactly equal D1 assigned users.');
  const values = await bulkGet(ctx.studentsId, userKeys);
  const records = userKeys.map(key => ({ key, record: parse(values.get(key)) }));

  const schoolYears = records.map(({ record }) => Number(record?.schoolYear)).sort((a, b) => a - b);
  assert.deepEqual(schoolYears, [3, 5], 'Expected one Year 3 and one Year 5 real profile.');
  assert.equal(records.filter(({ record }) => record?.vrEligible === true).length, 1, 'Exactly one real profile must be VR eligible.');
  assert.equal(records.filter(({ record }) => String(record?.status || '').toLowerCase() === 'active').length, 2);
  assert.equal(records.filter(({ record }) => record?.expires == null).length, 2);
  assert.equal(records.filter(({ record }) => credentialValid(record?.p)).length, 2, 'Login credential composition drift.');
  assert.equal(records.filter(({ record }) => credentialValid(record?.answerPassword)).length, 2, 'Answer-password composition drift.');

  const manualCore = records.reduce((n, { record }) => n + array(record?.manualAccess?.coreLessons).length, 0);
  const manualVr = records.reduce((n, { record }) => n + array(record?.manualAccess?.vrLessons).length, 0);
  const manualSpecial = records.reduce((n, { record }) => n + array(record?.manualAccess?.specialBuckets).length, 0);
  const blocked = records.reduce((n, { record }) => n + array(record?.blockedLessons).length, 0);
  assert.equal(manualCore, 0, 'Unexpected real manual core access.');
  assert.equal(manualVr, 0, 'Unexpected real manual VR access.');
  assert.equal(manualSpecial, 0, 'Unexpected real manual special access.');
  assert.equal(blocked, 0, 'Unexpected real blocked-lesson override.');

  const fullLibraryAssignments = records.reduce((n, { record }) => n + array(record?.fullLibraries).length, 0);
  assert.ok([0, 3].includes(fullLibraryAssignments), `Unexpected Full Library assignment count: ${fullLibraryAssignments}`);

  const d1 = {
    entitlements: await scalar(ctx.databaseId, 'SELECT COUNT(*) AS value FROM lesson_entitlements'),
    batches: await scalar(ctx.databaseId, 'SELECT COUNT(*) AS value FROM batch_definitions'),
    assignments: await scalar(ctx.databaseId, 'SELECT COUNT(*) AS value FROM student_batch_assignments'),
    releases: await scalar(ctx.databaseId, 'SELECT COUNT(*) AS value FROM batch_lesson_releases'),
    realEntitlements: await scalar(ctx.databaseId, 'SELECT COUNT(*) AS value FROM lesson_entitlements WHERE portal_user_id_norm IN (SELECT DISTINCT portal_user_id_norm FROM student_batch_assignments)')
  };
  assert.deepEqual(d1, { entitlements: 173, batches: 4, assignments: 4, releases: 0, realEntitlements: 173 });
  const quick = String((await d1Query(ctx.databaseId, 'PRAGMA quick_check'))[0]?.quick_check || '');
  assert.equal(quick, 'ok');
  const trigger = await d1Query(ctx.databaseId, "SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_student_sessions_single_active'");
  assert.equal(trigger.length, 1);

  return { realIds, userKeys, records, fullLibraryAssignments, d1, quickCheck: quick, triggerPresent: true };
}

const ctx = await getContext();
const state = await loadRealState(ctx);

if (action === 'backup-real') {
  const backup = {
    schema: 'fpt-portal-v2-phase17-real-kv-pre-finalize-v1',
    createdAt: new Date().toISOString(),
    records: state.records.map(({ key, record }) => ({ key, value: JSON.stringify(record) }))
  };
  fs.writeFileSync(backupFile, `${JSON.stringify(backup)}\n`, { mode: 0o600 });
}

if (action === 'fix-real-full-library' && state.fullLibraryAssignments === 3) {
  const pairs = state.records.map(({ key, record }) => ({ key, value: JSON.stringify({ ...record, fullLibraries: [] }) }));
  await bulkPut(ctx.studentsId, pairs);
  let observed = -1;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const values = await bulkGet(ctx.studentsId, state.userKeys);
    observed = state.userKeys.reduce((n, key) => n + array(parse(values.get(key))?.fullLibraries).length, 0);
    if (observed === 0) break;
    await sleep(5000);
  }
  assert.equal(observed, 0, 'Real Full Library baseline correction did not propagate.');
}

const finalState = action === 'fix-real-full-library' || action === 'postcheck' ? await loadRealState(ctx) : state;
if (action === 'postcheck') assert.equal(finalState.fullLibraryAssignments, 0, 'Real Full Library access must match the Phase 12 production seed baseline.');

console.log(JSON.stringify({
  status: 'PASS',
  action,
  worker: { environment: 'development', normalStudentLoginDisabled: true, r2Bucket: ctx.r2Bucket },
  realStudentRecords: finalState.records.length,
  credentialFormatFailures: 0,
  fullLibraryAssignments: finalState.fullLibraryAssignments,
  manualCoreAssignments: 0,
  manualVrAssignments: 0,
  manualSpecialAssignments: 0,
  blockedLessonOverrides: 0,
  d1: finalState.d1,
  quickCheck: finalState.quickCheck,
  triggerPresent: finalState.triggerPresent,
  identitiesOrPasswordsExposed: false,
  backupWritten: action === 'backup-real'
}));
