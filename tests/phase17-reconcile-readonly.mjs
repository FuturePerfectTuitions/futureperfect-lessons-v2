import assert from 'node:assert/strict';

const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const workerName = String(process.env.WORKER_NAME || 'fpt-portal-v2-worker').trim();

if (!accountId || !token) throw new Error('Cloudflare credentials are required.');

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

async function bulkGetKv(namespaceId, keys) {
  const body = await cf(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk/get`, {
    method: 'POST',
    body: JSON.stringify({ keys, type: 'text', withMetadata: false })
  });
  return new Map(Object.entries(body?.result?.values || {}).map(([k, v]) => [k, String(v)]));
}

async function d1Query(databaseId, sql) {
  const body = await cf(`/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: 'POST', body: JSON.stringify({ sql })
  });
  const first = Array.isArray(body.result) ? body.result[0] : body.result;
  if (!first?.success) throw new Error('D1 query returned unsuccessful result.');
  return Array.isArray(first.results) ? first.results : [];
}

async function scalar(databaseId, sql) {
  return Number((await d1Query(databaseId, sql))[0]?.value ?? NaN);
}

function validExplicitScreenPalUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    return url.protocol === 'https:' && ['screenpal.com', 'www.screenpal.com', 'go.screenpal.com'].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

const settings = await cf(`/accounts/${accountId}/workers/scripts/${workerName}/settings`);
const environment = String(binding(settings, 'ENVIRONMENT', 'plain_text')?.text || '');
const loginRaw = String(binding(settings, 'STUDENT_LOGIN_ENABLED', 'plain_text')?.text || '');
const r2Bucket = String(binding(settings, 'MATERIALS_R2', 'r2_bucket')?.bucket_name || '');
const studentsId = String(binding(settings, 'STUDENTS_KV', 'kv_namespace')?.namespace_id || '');
const lessonsId = String(binding(settings, 'LESSONS_KV', 'kv_namespace')?.namespace_id || '');
const databaseId = String(binding(settings, 'DB', 'd1')?.id || '');
assert.equal(environment, 'development');
assert.ok(!loginRaw || loginRaw.toLowerCase() === 'false');
assert.equal(r2Bucket, 'fpt-materials-dev');
assert.ok(studentsId && lessonsId && databaseId);

const d1 = {
  entitlements: await scalar(databaseId, 'SELECT COUNT(*) AS value FROM lesson_entitlements'),
  batches: await scalar(databaseId, 'SELECT COUNT(*) AS value FROM batch_definitions'),
  assignments: await scalar(databaseId, 'SELECT COUNT(*) AS value FROM student_batch_assignments'),
  releases: await scalar(databaseId, 'SELECT COUNT(*) AS value FROM batch_lesson_releases'),
  realEntitlements: await scalar(databaseId, 'SELECT COUNT(*) AS value FROM lesson_entitlements WHERE portal_user_id_norm IN (SELECT DISTINCT portal_user_id_norm FROM student_batch_assignments)')
};
const quickCheck = String((await d1Query(databaseId, 'PRAGMA quick_check'))[0]?.quick_check || '');
const triggerPresent = (await d1Query(databaseId, "SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_student_sessions_single_active'")).length === 1;

let observed = null;
for (let attempt = 1; attempt <= 12; attempt += 1) {
  const userKeys = (await listKvKeys(studentsId)).filter(key => /^user:/i.test(key));
  const lessonKeys = await listKvKeys(lessonsId);
  const extras = lessonKeys.filter(key => !/^lesson:/i.test(key));
  let explicitVrHowToUrls = 0;
  let vrValid = false;
  if (lessonKeys.includes('special:VR_HOWTO')) {
    const raw = (await bulkGetKv(lessonsId, ['special:VR_HOWTO'])).get('special:VR_HOWTO');
    try {
      const vr = JSON.parse(raw || 'null');
      const items = Array.isArray(vr?.items) ? vr.items : [];
      explicitVrHowToUrls = items.filter(item => validExplicitScreenPalUrl(item?.video?.embedUrl)).length;
      vrValid = items.length === 11 && explicitVrHowToUrls === 11;
    } catch {}
  }
  observed = {
    attempt,
    userRecords: userKeys.length,
    lessonKvKeys: lessonKeys.length,
    nonLessonExtras: extras.length,
    onlyProductionSpecialExtra: extras.length === 1 && extras[0] === 'special:VR_HOWTO',
    explicitVrHowToUrls,
    vrValid
  };
  if (observed.userRecords === 2 && observed.lessonKvKeys === 381 && observed.onlyProductionSpecialExtra && observed.vrValid) break;
  if (attempt < 12) await sleep(10000);
}

const postCleanupExact =
  d1.entitlements === 173 && d1.batches === 4 && d1.assignments === 4 && d1.releases === 0 && d1.realEntitlements === 173 &&
  quickCheck === 'ok' && triggerPresent &&
  observed?.userRecords === 2 && observed?.lessonKvKeys === 381 && observed?.onlyProductionSpecialExtra === true && observed?.vrValid === true;

const preCleanupExact =
  d1.entitlements === 632 && d1.batches === 4 && d1.assignments === 4 && d1.releases === 0 && d1.realEntitlements === 173 &&
  quickCheck === 'ok' && triggerPresent &&
  observed?.userRecords === 18 && observed?.lessonKvKeys === 399;

const state = postCleanupExact ? 'POST_CLEANUP_EXACT' : preCleanupExact ? 'PRE_CLEANUP_EXACT' : 'MIXED_OR_UNEXPECTED';
const report = {
  status: state === 'MIXED_OR_UNEXPECTED' ? 'STOP' : 'PASS',
  state,
  worker: { environment, normalStudentLoginDisabled: true, r2Bucket },
  d1: { ...d1, quickCheck, triggerPresent },
  kv: observed,
  identitiesOrPasswordsExposed: false
};
console.log(JSON.stringify(report));
if (report.status !== 'PASS') process.exitCode = 2;
