import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED,
  buildPhase11KvBulk,
  loadPhase11Catalogue,
  validatePhase11Catalogue
} from '../scripts/phase11-catalogue.mjs';

const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const workerName = String(process.env.WORKER_NAME || 'fpt-portal-v2-worker').trim();
const reportFile = String(process.env.PHASE17_REPORT_FILE || 'phase17-readonly-report.json').trim();
const expectedMain = String(process.env.PHASE17_EXPECTED_MAIN || '').trim();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!accountId || !token) throw new Error('Cloudflare credentials are required.');

const report = {
  phase: 17,
  mode: 'read-only-prelaunch',
  generatedAt: new Date().toISOString(),
  expectedMain,
  catalogue: {},
  worker: {},
  d1: {},
  lessonsKv: {},
  students: {},
  resources: {},
  screenpal: {},
  cleanupCandidates: {},
  stopReasons: []
};

function stop(code) {
  if (!report.stopReasons.includes(code)) report.stopReasons.push(code);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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
    for (const [key, value] of Object.entries(body?.result?.values || {})) {
      values.set(key, String(value));
    }
  }
  return values;
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

async function listR2Objects(bucketName) {
  const objects = [];
  let cursor = '';
  for (;;) {
    let url = `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/objects?per_page=1000`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    const body = await cf(url);
    for (const item of body.result || []) {
      if (typeof item?.key === 'string') objects.push(item);
    }
    cursor = String(body?.result_info?.cursor || '');
    if (!cursor) break;
  }
  return objects;
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

function collectScreenPal(value, context = 'unknown', out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectScreenPal(item, context, out);
    return out;
  }

  const keys = ['embedUrl', 'contentUrl', 'watchUrl', 'shareUrl'];
  const urls = Object.fromEntries(keys
    .filter(key => typeof value[key] === 'string' && value[key].trim())
    .map(key => [key, value[key].trim()]));
  const rawId = typeof value.screenpal === 'string' ? value.screenpal.trim() : '';
  const rawSp = typeof value.sp === 'string' ? value.sp.trim() : '';
  const looksScreenPal = rawId || rawSp || Object.values(urls).some(url => /screenpal\.com/i.test(url));
  if (looksScreenPal) out.push({ context, rawId: rawId || rawSp, urls });

  for (const [key, child] of Object.entries(value)) collectScreenPal(child, `${context}.${key}`, out);
  return out;
}

function validScreenPalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['screenpal.com', 'www.screenpal.com', 'go.screenpal.com'].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function validFourCharacterPassword(value) {
  const password = String(value || '');
  return password.length === 4 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password);
}

function isTestStudentKey(key) {
  const id = String(key || '').replace(/^user:/i, '').toLowerCase();
  return /^(test|p15|p16|__phase)/.test(id);
}

function safeArray(value) {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
}

function parseJsonValue(raw, label) {
  try { return JSON.parse(raw); } catch { throw new Error(`Invalid JSON in ${label}.`); }
}

async function probeUrl(url) {
  const options = { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(12000) };
  try {
    let response = await fetch(url, options);
    if (response.status === 405) {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: { Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(12000)
      });
    }
    return { status: response.status, networkError: false };
  } catch {
    return { status: 0, networkError: true };
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const current = index++;
      if (current >= items.length) break;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

try {
  const catalogue = loadPhase11Catalogue(repoRoot);
  const catalogueAudit = validatePhase11Catalogue(catalogue);
  assert.equal(catalogueAudit.catalogueSha256, EXPECTED.catalogueSha256);
  report.catalogue = { ...catalogueAudit, status: 'PASS' };

  const settings = await cf(`/accounts/${accountId}/workers/scripts/${workerName}/settings`);
  const environment = String(binding(settings, 'ENVIRONMENT', 'plain_text')?.text || '');
  const loginEnabledRaw = String(binding(settings, 'STUDENT_LOGIN_ENABLED', 'plain_text')?.text || '');
  const r2Bucket = String(binding(settings, 'MATERIALS_R2', 'r2_bucket')?.bucket_name || '');
  const studentsId = String(binding(settings, 'STUDENTS_KV', 'kv_namespace')?.namespace_id || '');
  const lessonsId = String(binding(settings, 'LESSONS_KV', 'kv_namespace')?.namespace_id || '');
  const databaseId = String(binding(settings, 'DB', 'd1')?.id || '');
  const loginDisabled = !loginEnabledRaw || loginEnabledRaw.toLowerCase() === 'false';
  const bindingsPresent = Boolean(studentsId && lessonsId && databaseId && r2Bucket);
  if (environment !== 'development') stop('WORKER_NOT_DEVELOPMENT');
  if (!loginDisabled) stop('NORMAL_STUDENT_LOGIN_ENABLED');
  if (r2Bucket !== 'fpt-materials-dev') stop('WRONG_R2_BUCKET');
  if (!bindingsPresent) stop('REQUIRED_BINDING_MISSING');

  const namespaceBody = await cf(`/accounts/${accountId}/storage/kv/namespaces?per_page=100`);
  const legacy = (namespaceBody.result || []).find(item => item?.title === 'FPT_LESSONS_TEST');
  const legacyExcluded = !legacy || String(legacy.id || '') !== lessonsId;
  if (!legacyExcluded) stop('LEGACY_LESSONS_NAMESPACE_BOUND');

  const deploymentBody = await cf(`/accounts/${accountId}/workers/scripts/${workerName}/deployments`);
  const deploymentCount = Array.isArray(deploymentBody.result) ? deploymentBody.result.length
    : Array.isArray(deploymentBody?.result?.deployments) ? deploymentBody.result.deployments.length : 0;
  if (deploymentCount < 1) stop('NO_WORKER_DEPLOYMENT_METADATA');

  report.worker = {
    environment,
    normalStudentLoginDisabled: loginDisabled,
    r2Bucket,
    requiredBindingsPresent: bindingsPresent,
    legacyLessonsNamespaceExcluded: legacyExcluded,
    deploymentMetadataPresent: deploymentCount > 0,
    status: report.stopReasons.length ? 'CHECK' : 'PASS'
  };

  const scalar = async sql => Number((await d1Query(databaseId, sql))[0]?.value ?? NaN);
  const entitlementCount = await scalar('SELECT COUNT(*) AS value FROM lesson_entitlements');
  const batchCount = await scalar('SELECT COUNT(*) AS value FROM batch_definitions');
  const assignmentCount = await scalar('SELECT COUNT(*) AS value FROM student_batch_assignments');
  const releaseCount = await scalar('SELECT COUNT(*) AS value FROM batch_lesson_releases');
  const assignedUsers = await scalar('SELECT COUNT(DISTINCT portal_user_id_norm) AS value FROM student_batch_assignments');
  const assignedEntitlements = await scalar('SELECT COUNT(*) AS value FROM lesson_entitlements WHERE portal_user_id_norm IN (SELECT DISTINCT portal_user_id_norm FROM student_batch_assignments)');
  const quick = String((await d1Query(databaseId, 'PRAGMA quick_check'))[0]?.quick_check || '');
  const triggerPresent = (await d1Query(databaseId, "SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_student_sessions_single_active'" )).length === 1;
  const tempRows = await scalar("SELECT (SELECT COUNT(*) FROM batch_definitions WHERE batch_key LIKE 'P15_%' OR batch_key LIKE 'P16_%') + (SELECT COUNT(*) FROM student_batch_assignments WHERE batch_key LIKE 'P15_%' OR batch_key LIKE 'P16_%') AS value");

  if (entitlementCount !== 632) stop('D1_ENTITLEMENT_BASELINE_DRIFT');
  if (batchCount !== 4) stop('D1_BATCH_BASELINE_DRIFT');
  if (assignmentCount !== 4) stop('D1_ASSIGNMENT_BASELINE_DRIFT');
  if (releaseCount !== 0) stop('D1_BATCH_RELEASE_BASELINE_DRIFT');
  if (assignedUsers !== 2) stop('D1_ASSIGNED_USER_BASELINE_DRIFT');
  if (assignedEntitlements !== 173) stop('D1_ASSIGNED_ENTITLEMENT_BASELINE_DRIFT');
  if (quick !== 'ok') stop('D1_QUICK_CHECK_FAILED');
  if (!triggerPresent) stop('SINGLE_SESSION_TRIGGER_MISSING');
  if (tempRows !== 0) stop('D1_P15_P16_FIXTURE_PRESENT');

  const assignmentRows = await d1Query(databaseId, `
    SELECT a.portal_user_id_norm, a.batch_key, a.effective_from, a.effective_to,
           b.subject, b.school_year, b.stream, b.maths_level
    FROM student_batch_assignments a
    JOIN batch_definitions b ON b.batch_key = a.batch_key
    ORDER BY a.portal_user_id_norm, a.batch_key`);
  const batchShape = new Map(assignmentRows.map(row => [row.batch_key, row]));
  const expectedBatches = new Map([
    ['Y3FE', { subject: 'english', schoolYear: 3, stream: 'normal', mathsLevel: null, effectiveFrom: '2026-09-10' }],
    ['Y3FM', { subject: 'maths', schoolYear: 3, stream: 'normal', mathsLevel: null, effectiveFrom: '2026-09-07' }],
    ['Y511FE', { subject: 'english', schoolYear: 5, stream: '11plus', mathsLevel: null, effectiveFrom: '2026-09-12' }],
    ['Y511FM', { subject: 'maths', schoolYear: 5, stream: '11plus', mathsLevel: 3, effectiveFrom: '2026-09-08' }]
  ]);
  let exactBatchShape = assignmentRows.length === expectedBatches.size;
  for (const [key, expected] of expectedBatches) {
    const row = batchShape.get(key);
    if (!row) { exactBatchShape = false; continue; }
    const actualLevel = row.maths_level == null ? null : Number(row.maths_level);
    if (
      String(row.subject) !== expected.subject ||
      Number(row.school_year) !== expected.schoolYear ||
      String(row.stream) !== expected.stream ||
      actualLevel !== expected.mathsLevel ||
      String(row.effective_from) !== expected.effectiveFrom ||
      row.effective_to != null
    ) exactBatchShape = false;
  }
  if (!exactBatchShape) stop('REAL_BATCH_CONFIGURATION_DRIFT');

  const groupedAssignments = new Map();
  for (const row of assignmentRows) {
    const id = String(row.portal_user_id_norm || '');
    if (!groupedAssignments.has(id)) groupedAssignments.set(id, []);
    groupedAssignments.get(id).push(String(row.batch_key));
  }
  const groupShapes = [...groupedAssignments.values()].map(values => values.sort().join('|')).sort();
  const expectedShapes = ['Y3FE|Y3FM', 'Y511FE|Y511FM'].sort();
  if (JSON.stringify(groupShapes) !== JSON.stringify(expectedShapes)) stop('REAL_BATCH_PAIRING_DRIFT');

  const entitlementByAssignedUser = (await d1Query(databaseId, `
    SELECT portal_user_id_norm, COUNT(*) AS entitlement_count
    FROM lesson_entitlements
    WHERE portal_user_id_norm IN (SELECT DISTINCT portal_user_id_norm FROM student_batch_assignments)
    GROUP BY portal_user_id_norm`))
    .map(row => Number(row.entitlement_count)).sort((a, b) => a - b);
  if (JSON.stringify(entitlementByAssignedUser) !== JSON.stringify([65, 108])) stop('REAL_RETAINED_ENTITLEMENT_PROFILE_DRIFT');

  report.d1 = {
    entitlementCount,
    batchCount,
    assignmentCount,
    batchLessonReleaseCount: releaseCount,
    assignedUserCount: assignedUsers,
    assignedUserEntitlementCount: assignedEntitlements,
    retainedEntitlementProfileCounts: entitlementByAssignedUser,
    exactSubjectSpecificBatchShape: exactBatchShape,
    exactAssignmentPairing: JSON.stringify(groupShapes) === JSON.stringify(expectedShapes),
    p15P16TemporaryRows: tempRows,
    singleActiveSessionTriggerPresent: triggerPresent,
    quickCheck: quick,
    status: report.stopReasons.some(code => code.startsWith('D1_') || code.startsWith('REAL_') || code === 'SINGLE_SESSION_TRIGGER_MISSING') ? 'FAIL' : 'PASS'
  };

  const plannedBulk = buildPhase11KvBulk(catalogue);
  const plannedMap = new Map(plannedBulk.map(row => [row.key, row.value]));
  const canonicalRemote = await bulkGetKv(lessonsId, [...plannedMap.keys()]);
  let canonicalMismatches = 0;
  for (const [key, value] of plannedMap) {
    if (canonicalRemote.get(key) !== value) canonicalMismatches += 1;
  }
  if (canonicalRemote.size !== plannedMap.size || canonicalMismatches) stop('CANONICAL_LESSONS_KV_MISMATCH');

  const lessonKeys = await listKvKeys(lessonsId);
  const canonicalKeySet = new Set(plannedMap.keys());
  const nonCanonicalKeys = lessonKeys.filter(key => !canonicalKeySet.has(key));
  const specialKeys = nonCanonicalKeys.filter(key => /^special:/i.test(key));
  const developmentKeys = nonCanonicalKeys.filter(key => !/^special:/i.test(key));
  const extraValues = await bulkGetKv(lessonsId, nonCanonicalKeys);
  const productionSpecialRecords = [];
  let testOnlySpecialCount = 0;
  let invalidExtraJson = 0;
  for (const key of nonCanonicalKeys) {
    const raw = extraValues.get(key);
    if (raw == null) continue;
    let value;
    try { value = JSON.parse(raw); } catch { invalidExtraJson += 1; continue; }
    if (/^special:/i.test(key)) {
      if (value?.testOnly === true || /development fixture/i.test(String(value?.description || ''))) testOnlySpecialCount += 1;
      else productionSpecialRecords.push({ key, value });
    }
  }
  if (invalidExtraJson) stop('NONCANONICAL_LESSONS_KV_INVALID_JSON');

  report.lessonsKv = {
    totalKeyCount: lessonKeys.length,
    canonicalExpectedKeyCount: plannedMap.size,
    canonicalExactValueMatches: plannedMap.size - canonicalMismatches,
    canonicalMismatches,
    nonCanonicalKeyCount: nonCanonicalKeys.length,
    specialRecordCount: specialKeys.length,
    productionSpecialRecordCount: productionSpecialRecords.length,
    testOnlySpecialRecordCount: testOnlySpecialCount,
    otherDevelopmentKeyCount: developmentKeys.length,
    invalidExtraJsonCount: invalidExtraJson,
    status: canonicalMismatches || invalidExtraJson ? 'FAIL' : 'PASS'
  };

  const studentKeys = (await listKvKeys(studentsId)).filter(key => /^user:/i.test(key));
  const studentValues = await bulkGetKv(studentsId, studentKeys);
  const testStudentKeys = studentKeys.filter(isTestStudentKey);
  const realStudentKeys = studentKeys.filter(key => !isTestStudentKey(key));
  if (realStudentKeys.length !== 2) stop('REAL_STUDENT_RECORD_COUNT_DRIFT');

  let invalidStudentJson = 0;
  let credentialRuleFailures = 0;
  let identityFailures = 0;
  let accountStateFailures = 0;
  let vrEligibleCount = 0;
  let fullLibraryAssignments = 0;
  let manualCoreAssignments = 0;
  let specialBucketAssignments = 0;
  let blockedLessonAssignments = 0;
  const realRecords = new Map();
  for (const key of studentKeys) {
    const raw = studentValues.get(key);
    let user;
    try { user = parseJsonValue(raw, 'student record'); } catch { invalidStudentJson += 1; continue; }
    const keyId = key.replace(/^user:/i, '').toLowerCase();
    const portalId = String(user?.portalUserId || '').trim().toLowerCase();
    if (portalId && portalId !== keyId) identityFailures += 1;
    if (!isTestStudentKey(key)) {
      realRecords.set(keyId, user);
      if (!validFourCharacterPassword(user?.p) || !validFourCharacterPassword(user?.answerPassword)) credentialRuleFailures += 1;
      const status = String(user?.status || 'active').trim().toLowerCase();
      if (status !== 'active') accountStateFailures += 1;
      const expires = String(user?.expires || '').trim();
      if (expires && /^\d{4}-\d{2}-\d{2}$/.test(expires) && expires < '2026-08-29') accountStateFailures += 1;
      if (user?.vrEligible === true) vrEligibleCount += 1;
      fullLibraryAssignments += safeArray(user?.fullLibraries).length;
      manualCoreAssignments += safeArray(user?.manualAccess?.coreLessons).length;
      specialBucketAssignments += safeArray(user?.manualAccess?.specialBuckets).length;
      blockedLessonAssignments += safeArray(user?.blockedLessons).length;
    }
  }
  if (invalidStudentJson) stop('STUDENT_KV_INVALID_JSON');
  if (identityFailures) stop('STUDENT_KV_IDENTITY_MISMATCH');
  if (credentialRuleFailures) stop('REAL_STUDENT_CREDENTIAL_RULE_FAILURE');
  if (accountStateFailures) stop('REAL_STUDENT_ACCOUNT_NOT_ACTIVE');

  for (const assignedId of groupedAssignments.keys()) {
    if (!realRecords.has(String(assignedId).toLowerCase())) stop('ASSIGNED_REAL_STUDENT_MISSING_FROM_KV');
  }
  let y3ProfileOk = false;
  let y5ProfileOk = false;
  for (const [id, batches] of groupedAssignments) {
    const shape = [...batches].sort().join('|');
    const user = realRecords.get(String(id).toLowerCase());
    if (!user) continue;
    if (shape === 'Y3FE|Y3FM') {
      y3ProfileOk = Number(user.schoolYear) === 3 && user.vrEligible !== true;
    }
    if (shape === 'Y511FE|Y511FM') {
      y5ProfileOk = Number(user.schoolYear) === 5 && user.vrEligible === true;
    }
  }
  if (!y3ProfileOk) stop('Y3_REAL_PROFILE_STATE_DRIFT');
  if (!y5ProfileOk) stop('Y5_11PLUS_REAL_PROFILE_STATE_DRIFT');

  report.students = {
    userRecordCount: studentKeys.length,
    confirmedTestAccountCount: testStudentKeys.length,
    realRecordCount: realStudentKeys.length,
    invalidJsonCount: invalidStudentJson,
    identityMismatchCount: identityFailures,
    credentialRuleFailureCount: credentialRuleFailures,
    inactiveOrExpiredRealRecordCount: accountStateFailures,
    realVrEligibleCount: vrEligibleCount,
    realFullLibraryAssignmentCount: fullLibraryAssignments,
    realManualCoreAssignmentCount: manualCoreAssignments,
    realSpecialBucketAssignmentCount: specialBucketAssignments,
    realBlockedLessonAssignmentCount: blockedLessonAssignments,
    y3AssignedProfileValid: y3ProfileOk,
    y5ElevenPlusAssignedProfileValid: y5ProfileOk,
    passwordValuesExposed: false,
    status: report.stopReasons.some(code => code.includes('STUDENT') || code.includes('PROFILE') || code.includes('CREDENTIAL')) ? 'FAIL' : 'PASS'
  };

  const canonicalR2 = collectProperty(catalogue, 'r2Key');
  const change7 = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/data/phase11/change7-owner-homeworks.json'), 'utf8'));
  const change7R2 = collectProperty(change7, 'r2Key');
  const overrideSource = fs.readFileSync(path.join(repoRoot, 'worker/src/phase11-shared-maths-answer-pdf-overrides.js'), 'utf8');
  const overrideR2 = [...overrideSource.matchAll(/"overrideR2Key":"([^"]+)"/g)].map(match => match[1]);
  const productionSpecialR2 = productionSpecialRecords.flatMap(item => collectProperty(item.value, 'r2Key'));
  const requiredR2 = new Set([...canonicalR2, ...change7R2, ...overrideR2, ...productionSpecialR2]);
  if (canonicalR2.length !== EXPECTED.r2Keys) stop('CANONICAL_R2_REFERENCE_COUNT_DRIFT');
  if (change7R2.length !== 21) stop('CHANGE7_R2_REFERENCE_COUNT_DRIFT');

  const r2Objects = await listR2Objects(r2Bucket);
  const r2Map = new Map(r2Objects.map(object => [object.key, object]));
  const missingR2 = [];
  const zeroByteR2 = [];
  for (const key of requiredR2) {
    const object = r2Map.get(key);
    if (!object) missingR2.push(key);
    else if (Number(object.size || 0) <= 0) zeroByteR2.push(key);
  }
  if (missingR2.length) stop('REQUIRED_R2_OBJECT_MISSING');
  if (zeroByteR2.length) stop('REQUIRED_R2_OBJECT_EMPTY');

  report.resources = {
    canonicalR2ReferenceCount: canonicalR2.length,
    change7OverlayR2ReferenceCount: change7R2.length,
    sharedMathsOverrideR2ReferenceCount: overrideR2.length,
    productionSpecialR2ReferenceCount: productionSpecialR2.length,
    totalUniqueRequiredR2ObjectCount: requiredR2.size,
    developmentBucketObjectCount: r2Objects.length,
    missingRequiredObjectCount: missingR2.length,
    zeroByteRequiredObjectCount: zeroByteR2.length,
    exactObjectKeysExposedInReport: false,
    status: missingR2.length || zeroByteR2.length ? 'FAIL' : 'PASS'
  };

  const canonicalSp = collectScreenPal(catalogue, 'canonical');
  const specialSp = productionSpecialRecords.flatMap(item => collectScreenPal(item.value, 'special'));
  const allSp = [...canonicalSp, ...specialSp];
  let unsafeUrlCount = 0;
  let bareOnlyCount = 0;
  const probeUrls = new Set();
  for (const ref of allSp) {
    const urls = Object.values(ref.urls || {});
    if (ref.rawId && !urls.length) bareOnlyCount += 1;
    for (const url of urls) {
      if (!validScreenPalUrl(url)) unsafeUrlCount += 1;
    }
    if (ref.urls?.contentUrl) probeUrls.add(ref.urls.contentUrl);
    else if (ref.urls?.shareUrl) probeUrls.add(ref.urls.shareUrl);
    else if (ref.urls?.watchUrl) probeUrls.add(ref.urls.watchUrl);
    else if (ref.urls?.embedUrl) probeUrls.add(ref.urls.embedUrl);
  }
  if (unsafeUrlCount) stop('SCREENPAL_UNSAFE_OR_NONEXPLICIT_URL');
  if (bareOnlyCount) stop('PRODUCTION_SCREENPAL_BARE_ID_ONLY');

  const uniqueProbeUrls = [...probeUrls];
  const probeResults = await mapLimit(uniqueProbeUrls, 5, probeUrl);
  let notFoundCount = 0;
  let reachableRestrictedCount = 0;
  let uncertainCount = 0;
  for (const result of probeResults) {
    if ([404, 410].includes(result.status)) notFoundCount += 1;
    else if ([401, 403].includes(result.status)) reachableRestrictedCount += 1;
    else if (result.networkError || result.status === 0 || result.status >= 500 || result.status === 429) uncertainCount += 1;
  }
  if (notFoundCount) stop('SCREENPAL_REFERENCE_NOT_FOUND');
  if (uncertainCount) stop('SCREENPAL_LIVE_PROBE_UNCONFIRMED');

  const canonicalQuizCount = [...Object.values(catalogue.lessons || {})].filter(lesson => lesson?.core?.video?.quiz).length;
  if (canonicalQuizCount !== 79) stop('QUIZ_REFERENCE_COUNT_DRIFT');

  report.screenpal = {
    canonicalVideoCount: EXPECTED.videos,
    canonicalInteractiveQuizCount: canonicalQuizCount,
    canonicalStoredReferenceObjectCount: canonicalSp.length,
    productionSpecialStoredReferenceObjectCount: specialSp.length,
    unsafeUrlCount,
    bareIdWithoutExplicitUrlCount: bareOnlyCount,
    livePrimaryUrlProbeCount: uniqueProbeUrls.length,
    liveNotFoundCount: notFoundCount,
    liveReachableButRestrictedCount: reachableRestrictedCount,
    liveUnconfirmedCount: uncertainCount,
    elevenPlusQuizPresentationStaticGate: 'covered-by-existing-test',
    status: unsafeUrlCount || bareOnlyCount || notFoundCount || uncertainCount ? 'FAIL' : 'PASS'
  };

  report.cleanupCandidates = {
    confirmedTestStudentAccountCount: testStudentKeys.length,
    nonCanonicalDevelopmentLessonKvKeyCount: developmentKeys.length,
    testOnlySpecialRecordCount: testOnlySpecialCount,
    candidateKeyNamesExposedInReport: false
  };

  report.finalStatus = report.stopReasons.length ? 'STOP' : 'PASS';
} catch (error) {
  report.finalStatus = 'ERROR';
  report.errorCode = String(error?.message || error).replace(/[A-Za-z0-9+/=_-]{24,}/g, '[redacted-token-like-value]');
}

fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
const safeSummary = {
  finalStatus: report.finalStatus,
  stopReasons: report.stopReasons,
  catalogue: report.catalogue,
  worker: report.worker,
  d1: report.d1,
  lessonsKv: report.lessonsKv,
  students: report.students,
  resources: report.resources,
  screenpal: report.screenpal,
  cleanupCandidates: report.cleanupCandidates,
  reportSha256: sha256(fs.readFileSync(reportFile))
};
console.log(JSON.stringify(safeSummary));
if (report.finalStatus !== 'PASS') process.exit(2);
