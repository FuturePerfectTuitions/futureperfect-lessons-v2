import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPhase11KvBulk,
  loadPhase11Catalogue,
  validatePhase11Catalogue,
  EXPECTED
} from '../scripts/phase11-catalogue.mjs';

const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const workerName = String(process.env.WORKER_NAME || 'fpt-portal-v2-worker').trim();
const action = String(process.env.PHASE17_ACTION || 'plan').trim();
const planFile = String(process.env.PHASE17_PLAN_FILE || '/tmp/phase17-private-plan.json').trim();
const backupFile = String(process.env.PHASE17_KV_BACKUP_FILE || '/tmp/phase17-private-kv-backup.json').trim();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!accountId || !token) throw new Error('Cloudflare credentials are required.');
if (!['plan', 'backup', 'apply', 'postcheck'].includes(action)) throw new Error('Unsupported PHASE17_ACTION.');

const explicitMap = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/data/phase17/vr-howto-explicit-screenpal.json'), 'utf8'));
const catalogue = loadPhase11Catalogue(repoRoot);
const catalogueAudit = validatePhase11Catalogue(catalogue);
assert.equal(catalogueAudit.catalogueSha256, EXPECTED.catalogueSha256);
const canonicalBulk = buildPhase11KvBulk(catalogue);
const canonicalKeys = new Set(canonicalBulk.map(row => row.key));

function safeArray(value) {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
}

function collectProperty(value, property, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (typeof value[property] === 'string' && value[property].trim()) out.push(value[property].trim());
  if (Array.isArray(value)) {
    for (const item of value) collectProperty(item, property, out);
  } else {
    for (const item of Object.values(value)) collectProperty(item, property, out);
  }
  return out;
}

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
  if (!response.ok || !body?.success) {
    throw new Error(`Cloudflare request failed: ${pathname} (HTTP ${response.status})`);
  }
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
    for (const item of body.result || []) {
      if (typeof item?.name === 'string') keys.push(item.name);
    }
    cursor = String(body?.result_info?.cursor || '');
    if (!cursor) break;
  }
  return keys;
}

async function bulkGetKv(namespaceId, keys) {
  const values = new Map();
  for (let offset = 0; offset < keys.length; offset += 100) {
    const chunk = keys.slice(offset, offset + 100);
    const body = await cf(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk/get`, {
      method: 'POST',
      body: JSON.stringify({ keys: chunk, type: 'text', withMetadata: false })
    });
    for (const [key, value] of Object.entries(body?.result?.values || {})) values.set(key, String(value));
  }
  return values;
}

async function bulkDeleteKv(namespaceId, keys) {
  if (!keys.length) return;
  const body = await cf(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk/delete`, {
    method: 'POST',
    body: JSON.stringify(keys)
  });
  if ((body?.result?.unsuccessful_keys || []).length) throw new Error('KV bulk delete reported unsuccessful keys.');
}

async function bulkPutKv(namespaceId, pairs) {
  if (!pairs.length) return;
  const body = await cf(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`, {
    method: 'PUT',
    body: JSON.stringify(pairs.map(({ key, value }) => ({ key, value })))
  });
  if ((body?.result?.unsuccessful_keys || []).length) throw new Error('KV bulk update reported unsuccessful keys.');
}

async function d1Query(databaseId, sql, params = []) {
  const body = await cf(`/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: 'POST',
    body: JSON.stringify({ sql, params })
  });
  const first = Array.isArray(body.result) ? body.result[0] : body.result;
  if (!first?.success) throw new Error('D1 query returned unsuccessful result.');
  return Array.isArray(first.results) ? first.results : [];
}

async function scalar(databaseId, sql, params = []) {
  return Number((await d1Query(databaseId, sql, params))[0]?.value ?? NaN);
}

function parseRecord(raw, label) {
  try { return JSON.parse(raw); } catch { throw new Error(`Invalid JSON in ${label}.`); }
}

function confirmedTestUserKey(key, record) {
  const id = String(key || '').replace(/^user:/i, '').toLowerCase();
  return record?.testOnly === true || /^(test|p15|p16|__phase)/.test(id);
}

function confirmedDevelopmentLessonRecord(key, record) {
  const serialized = JSON.stringify(record);
  return record?.testOnly === true || /DEV-/i.test(String(key)) || /DEV-/i.test(serialized) || /development-only/i.test(serialized) || /development fixture/i.test(serialized);
}

function validExplicitScreenPalUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    return url.protocol === 'https:' && ['screenpal.com', 'www.screenpal.com', 'go.screenpal.com'].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function probeUrl(url) {
  try {
    let response = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(12000) });
    if (response.status === 405) {
      response = await fetch(url, { method: 'GET', redirect: 'manual', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(12000) });
    }
    return response.status;
  } catch {
    return 0;
  }
}

async function context() {
  const settings = await cf(`/accounts/${accountId}/workers/scripts/${workerName}/settings`);
  const environment = String(binding(settings, 'ENVIRONMENT', 'plain_text')?.text || '');
  const loginEnabledRaw = String(binding(settings, 'STUDENT_LOGIN_ENABLED', 'plain_text')?.text || '');
  const r2Bucket = String(binding(settings, 'MATERIALS_R2', 'r2_bucket')?.bucket_name || '');
  const studentsId = String(binding(settings, 'STUDENTS_KV', 'kv_namespace')?.namespace_id || '');
  const lessonsId = String(binding(settings, 'LESSONS_KV', 'kv_namespace')?.namespace_id || '');
  const databaseId = String(binding(settings, 'DB', 'd1')?.id || '');
  const normalLoginDisabled = !loginEnabledRaw || loginEnabledRaw.toLowerCase() === 'false';
  assert.equal(environment, 'development');
  assert.equal(normalLoginDisabled, true);
  assert.equal(r2Bucket, 'fpt-materials-dev');
  assert.ok(studentsId && lessonsId && databaseId);
  return { settings, studentsId, lessonsId, databaseId, r2Bucket };
}

async function buildPlan(ctx) {
  const studentKeys = (await listKvKeys(ctx.studentsId)).filter(key => /^user:/i.test(key));
  const studentValues = await bulkGetKv(ctx.studentsId, studentKeys);
  const assignments = await d1Query(ctx.databaseId, 'SELECT DISTINCT portal_user_id_norm FROM student_batch_assignments ORDER BY portal_user_id_norm');
  const realIds = new Set(assignments.map(row => String(row.portal_user_id_norm || '').toLowerCase()));
  assert.equal(realIds.size, 2, 'Exactly two assigned real development users are expected before launch.');

  const realRecords = new Map();
  const testStudentKeys = [];
  for (const key of studentKeys) {
    const record = parseRecord(studentValues.get(key), 'student record');
    const id = key.replace(/^user:/i, '').toLowerCase();
    if (realIds.has(id)) realRecords.set(id, record);
    else if (confirmedTestUserKey(key, record)) testStudentKeys.push(key);
    else throw new Error('Unknown unassigned student record: cleanup classification refused.');
  }
  assert.equal(realRecords.size, 2);

  const placeholders = [...realIds].map(() => '?').join(',');
  const realEntitlements = await scalar(ctx.databaseId, `SELECT COUNT(*) AS value FROM lesson_entitlements WHERE portal_user_id_norm IN (${placeholders})`, [...realIds]);
  assert.equal(realEntitlements, 173);
  const totalEntitlements = await scalar(ctx.databaseId, 'SELECT COUNT(*) AS value FROM lesson_entitlements');
  const testIds = testStudentKeys.map(key => key.replace(/^user:/i, '').toLowerCase());
  const testPlaceholders = testIds.map(() => '?').join(',');
  const testEntitlements = testIds.length
    ? await scalar(ctx.databaseId, `SELECT COUNT(*) AS value FROM lesson_entitlements WHERE portal_user_id_norm IN (${testPlaceholders})`, testIds)
    : 0;
  assert.equal(totalEntitlements, realEntitlements + testEntitlements, 'All non-real entitlement rows must belong to confirmed test accounts.');
  const testAssignments = testIds.length
    ? await scalar(ctx.databaseId, `SELECT COUNT(*) AS value FROM student_batch_assignments WHERE portal_user_id_norm IN (${testPlaceholders})`, testIds)
    : 0;
  assert.equal(testAssignments, 0, 'Confirmed test users must not have surviving batch assignments.');

  const lessonKeys = await listKvKeys(ctx.lessonsId);
  const nonCanonicalKeys = lessonKeys.filter(key => !canonicalKeys.has(key));
  const lessonValues = await bulkGetKv(ctx.lessonsId, nonCanonicalKeys);
  const productionSpecial = [];
  const testSpecialKeys = [];
  const developmentLessonKeys = [];
  const developmentR2Keys = new Set();

  const realSerialized = JSON.stringify([...realRecords.values()]);
  for (const key of nonCanonicalKeys) {
    const record = parseRecord(lessonValues.get(key), `lesson KV ${key}`);
    if (/^special:/i.test(key)) {
      if (record?.testOnly === true || /development fixture/i.test(String(record?.description || ''))) {
        const bucket = String(record?.bucketId || key.replace(/^special:/i, '')).trim();
        assert.ok(!realSerialized.includes(`\"${bucket}\"`), 'A real student references a test-only special bucket; cleanup refused.');
        testSpecialKeys.push(key);
        for (const r2Key of collectProperty(record, 'r2Key')) developmentR2Keys.add(r2Key);
      } else {
        productionSpecial.push({ key, record });
      }
      continue;
    }
    if (!confirmedDevelopmentLessonRecord(key, record)) throw new Error('Unknown noncanonical LESSONS_KV record: cleanup refused.');
    if (realSerialized.includes(String(record?.lessonId || '')) && record?.lessonId) throw new Error('A real student references a development lesson record; cleanup refused.');
    developmentLessonKeys.push(key);
    for (const r2Key of collectProperty(record, 'r2Key')) developmentR2Keys.add(r2Key);
  }

  assert.equal(productionSpecial.length, 1, 'Exactly one production special metadata record is expected before launch.');
  assert.equal(productionSpecial[0].key, 'special:VR_HOWTO');
  const vrRecord = structuredClone(productionSpecial[0].record);
  assert.equal(vrRecord.bucketId, 'VR_HOWTO');
  assert.equal(vrRecord.items?.length, explicitMap.items.length);
  const explicitByItem = new Map(explicitMap.items.map(item => [item.itemId, item]));
  for (const item of vrRecord.items) {
    const mapped = explicitByItem.get(String(item?.id || ''));
    assert.ok(mapped, 'VR How-To item missing explicit Phase 17 mapping.');
    assert.equal(String(item?.video?.screenpal || ''), mapped.screenpal, 'VR How-To ScreenPal identity drift.');
    assert.ok(validExplicitScreenPalUrl(mapped.embedUrl));
    item.video = { ...item.video, embedUrl: mapped.embedUrl };
  }

  const probeStatuses = await Promise.all(explicitMap.items.map(item => probeUrl(item.embedUrl)));
  const failedProbes = probeStatuses.filter(status => status === 0 || status === 404 || status === 410 || status === 429 || status >= 500);
  assert.equal(failedProbes.length, 0, 'One or more explicit VR How-To ScreenPal URLs could not be live-verified.');

  const requiredR2 = new Set(collectProperty(catalogue, 'r2Key'));
  const change7 = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/data/phase11/change7-owner-homeworks.json'), 'utf8'));
  for (const key of collectProperty(change7, 'r2Key')) requiredR2.add(key);
  const overrideSource = fs.readFileSync(path.join(repoRoot, 'worker/src/phase11-shared-maths-answer-pdf-overrides.js'), 'utf8');
  for (const match of overrideSource.matchAll(/\"overrideR2Key\":\"([^\"]+)\"/g)) requiredR2.add(match[1]);
  for (const key of collectProperty(vrRecord, 'r2Key')) requiredR2.add(key);
  for (const key of developmentR2Keys) assert.ok(!requiredR2.has(key), 'A development R2 candidate overlaps production-required R2 content.');

  return {
    realIds: [...realIds],
    testStudentKeys,
    testIds,
    testEntitlements,
    testSpecialKeys,
    developmentLessonKeys,
    developmentR2Keys: [...developmentR2Keys],
    vrRecord,
    counts: {
      studentUserRecords: studentKeys.length,
      realStudentRecords: realRecords.size,
      testStudentRecords: testStudentKeys.length,
      totalEntitlements,
      realEntitlements,
      testEntitlements,
      lessonKvKeys: lessonKeys.length,
      canonicalLessonKvKeys: canonicalKeys.size,
      productionSpecialRecords: productionSpecial.length,
      testSpecialRecords: testSpecialKeys.length,
      developmentLessonRecords: developmentLessonKeys.length,
      developmentR2References: developmentR2Keys.size,
      liveVerifiedVrHowToUrls: probeStatuses.length
    }
  };
}

async function writeBackup(ctx) {
  const studentsKeys = await listKvKeys(ctx.studentsId);
  const lessonsKeys = await listKvKeys(ctx.lessonsId);
  const [studentsValues, lessonsValues] = await Promise.all([
    bulkGetKv(ctx.studentsId, studentsKeys),
    bulkGetKv(ctx.lessonsId, lessonsKeys)
  ]);
  const plainTextBindings = (ctx.settings?.result?.bindings || [])
    .filter(item => item?.type === 'plain_text')
    .map(item => ({ name: item.name, text: item.text }));
  const bindingDescriptors = (ctx.settings?.result?.bindings || [])
    .filter(item => item?.type !== 'secret_text')
    .map(item => ({ name: item.name, type: item.type, namespace_id: item.namespace_id, bucket_name: item.bucket_name, id: item.id }));
  const backup = {
    format: 'FPT_PHASE17_PRIVATE_KV_BACKUP_V1',
    createdAt: new Date().toISOString(),
    workerName,
    workerPlainTextBindings: plainTextBindings,
    workerBindingDescriptors: bindingDescriptors,
    studentsKv: studentsKeys.map(key => ({ key, value: studentsValues.get(key) })),
    lessonsKv: lessonsKeys.map(key => ({ key, value: lessonsValues.get(key) }))
  };
  fs.writeFileSync(backupFile, `${JSON.stringify(backup)}\n`, { mode: 0o600 });
  return { studentsKvKeys: studentsKeys.length, lessonsKvKeys: lessonsKeys.length };
}

async function deleteUserScopedD1(ctx, testIds) {
  if (!testIds.length) return;
  const p = testIds.map(() => '?').join(',');
  const statements = [
    `DELETE FROM answer_password_rate_limits WHERE session_token_hash IN (SELECT token_hash FROM student_sessions WHERE portal_user_id_norm IN (${p}))`,
    `DELETE FROM answer_view_tokens WHERE portal_user_id_norm IN (${p})`,
    `DELETE FROM student_session_profiles WHERE portal_user_id_norm IN (${p})`,
    `DELETE FROM mock_password_rate_limits WHERE portal_user_id_norm IN (${p})`,
    `DELETE FROM curriculum_start_points WHERE portal_user_id_norm IN (${p})`,
    `DELETE FROM student_sessions WHERE portal_user_id_norm IN (${p})`,
    `DELETE FROM lesson_entitlements WHERE portal_user_id_norm IN (${p})`
  ];
  for (const sql of statements) await d1Query(ctx.databaseId, sql, testIds);
}

async function applyPlan(ctx, plan) {
  assert.equal(process.env.PHASE17_MUTATION_CONFIRM, 'PHASE17_CONFIRMED_FIXTURE_CLEANUP_AND_VR_METADATA');
  assert.equal(plan.counts.realStudentRecords, 2);
  assert.equal(plan.counts.realEntitlements, 173);
  assert.equal(plan.counts.testStudentRecords, 16);
  assert.equal(plan.counts.testEntitlements, 459);
  assert.equal(plan.counts.testSpecialRecords, 5);
  assert.equal(plan.counts.developmentLessonRecords, 13);

  await deleteUserScopedD1(ctx, plan.testIds);
  await bulkDeleteKv(ctx.studentsId, plan.testStudentKeys);
  await bulkDeleteKv(ctx.lessonsId, [...plan.testSpecialKeys, ...plan.developmentLessonKeys]);
  await bulkPutKv(ctx.lessonsId, [{ key: 'special:VR_HOWTO', value: JSON.stringify(plan.vrRecord) }]);
}

async function postcheck(ctx) {
  const userKeys = (await listKvKeys(ctx.studentsId)).filter(key => /^user:/i.test(key));
  const lessonKeys = await listKvKeys(ctx.lessonsId);
  const entitlements = await scalar(ctx.databaseId, 'SELECT COUNT(*) AS value FROM lesson_entitlements');
  const batches = await scalar(ctx.databaseId, 'SELECT COUNT(*) AS value FROM batch_definitions');
  const assignments = await scalar(ctx.databaseId, 'SELECT COUNT(*) AS value FROM student_batch_assignments');
  const releases = await scalar(ctx.databaseId, 'SELECT COUNT(*) AS value FROM batch_lesson_releases');
  const quick = String((await d1Query(ctx.databaseId, 'PRAGMA quick_check'))[0]?.quick_check || '');
  const trigger = (await d1Query(ctx.databaseId, "SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_student_sessions_single_active'")).length === 1;
  assert.equal(userKeys.length, 2);
  assert.equal(entitlements, 173);
  assert.equal(batches, 4);
  assert.equal(assignments, 4);
  assert.equal(releases, 0);
  assert.equal(quick, 'ok');
  assert.equal(trigger, true);
  assert.equal(lessonKeys.length, canonicalKeys.size + 1);
  const extras = lessonKeys.filter(key => !canonicalKeys.has(key));
  assert.deepEqual(extras, ['special:VR_HOWTO']);
  const value = (await bulkGetKv(ctx.lessonsId, ['special:VR_HOWTO'])).get('special:VR_HOWTO');
  const vr = parseRecord(value, 'post-cleanup VR How-To');
  assert.equal(vr.items.length, explicitMap.items.length);
  for (const item of vr.items) assert.ok(validExplicitScreenPalUrl(item?.video?.embedUrl));
  return { userRecords: userKeys.length, entitlements, batches, assignments, releases, lessonKvKeys: lessonKeys.length, quickCheck: quick, triggerPresent: trigger, explicitVrHowToUrls: vr.items.length };
}

const ctx = await context();

if (action === 'backup') {
  const result = await writeBackup(ctx);
  console.log(JSON.stringify({ action, status: 'PASS', ...result, sensitiveBackupContentsPrinted: false }));
} else if (action === 'plan') {
  const plan = await buildPlan(ctx);
  fs.writeFileSync(planFile, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ action, status: 'PASS', counts: plan.counts, privateCandidateNamesPrinted: false }));
} else if (action === 'apply') {
  const plan = await buildPlan(ctx);
  await applyPlan(ctx, plan);
  const result = await postcheck(ctx);
  console.log(JSON.stringify({ action, status: 'PASS', preCleanupCounts: plan.counts, postCleanup: result, privateCandidateNamesPrinted: false }));
} else if (action === 'postcheck') {
  const result = await postcheck(ctx);
  console.log(JSON.stringify({ action, status: 'PASS', ...result }));
}
