import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const REPO = 'FuturePerfectTuitions/futureperfect-lessons-v2';
export const WORKER_NAME = process.env.WORKER_NAME || 'fpt-portal-v2-worker';
export const WORKER_BASE = process.env.WORKER_BASE || 'https://fpt-portal-v2-worker.futureperfectlessons.workers.dev';
export const PORTAL_URL = process.env.PHASE16_PORTAL_URL || 'https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase11.html';
export const ORIGIN = 'https://futureperfecttuitions.github.io';
export const WRANGLER_VERSION = process.env.WRANGLER_VERSION || '4.125.0';
export const PHASE15_MAIN = 'e9f1085c6797d51a9a14b2d6b118a4fb94576f38';
export const CATALOGUE_SHA256 = '7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663';

const apiToken = process.env.CLOUDFLARE_API_TOKEN || '';
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';

export function assertCloudflareEnv() {
  assert.ok(apiToken, 'CLOUDFLARE_API_TOKEN is required for guarded Phase 16 development tests.');
  assert.ok(accountId, 'CLOUDFLARE_ACCOUNT_ID is required for guarded Phase 16 development tests.');
}

export function isoNow() {
  return new Date().toISOString();
}

export function londonDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function randomFourCharacterPassword() {
  const upper = String.fromCharCode(65 + crypto.randomInt(0, 26));
  const lower = String.fromCharCode(97 + crypto.randomInt(0, 26));
  const digit = String(crypto.randomInt(0, 10));
  const extra = String.fromCharCode(65 + crypto.randomInt(0, 26));
  return `${upper}${lower}${digit}${extra}`;
}

export function d1Exec(sql) {
  assertCloudflareEnv();
  const result = spawnSync(
    'npx',
    [
      '--yes', `wrangler@${WRANGLER_VERSION}`,
      'd1', 'execute', 'fpt_portal_v2_db', '--remote', '--json', '--command', sql
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, CLOUDFLARE_API_TOKEN: apiToken, CLOUDFLARE_ACCOUNT_ID: accountId },
      maxBuffer: 20 * 1024 * 1024
    }
  );
  if (result.status !== 0) {
    throw new Error(`D1 command failed (exit ${result.status}). ${String(result.stderr || '').slice(0, 1200)}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`D1 command returned non-JSON output: ${String(result.stdout || '').slice(0, 1200)}`);
  }
}

async function cfJson(path, options = {}) {
  assertCloudflareEnv();
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) {}
  if (!response.ok || body?.success === false) {
    throw new Error(`Cloudflare API request failed (${response.status}) for ${path}.`);
  }
  return body;
}

export async function workerSettings() {
  const body = await cfJson(`/workers/scripts/${WORKER_NAME}/settings`);
  assert.equal(body?.success, true, 'Worker settings request did not succeed.');
  return body.result;
}

function binding(settings, name) {
  return (settings?.bindings || []).find(item => item?.name === name) || null;
}

export async function assertWorkerSafety() {
  const settings = await workerSettings();
  assert.equal(binding(settings, 'ENVIRONMENT')?.text, 'development', 'Worker ENVIRONMENT must remain development.');
  const enabled = String(binding(settings, 'STUDENT_LOGIN_ENABLED')?.text || '').toLowerCase();
  assert.ok(enabled === '' || enabled === 'false', 'Normal V2 student login must remain disabled.');
  assert.equal(binding(settings, 'MATERIALS_R2')?.bucket_name, 'fpt-materials-dev', 'Phase 16 must remain on fpt-materials-dev.');
  const lessons = binding(settings, 'LESSONS_KV');
  const students = binding(settings, 'STUDENTS_KV');
  assert.equal(lessons?.type, 'kv_namespace');
  assert.equal(students?.type, 'kv_namespace');

  const namespaces = await cfJson('/storage/kv/namespaces?per_page=100');
  const legacy = (namespaces?.result || []).find(item => item?.title === 'FPT_LESSONS_TEST');
  if (legacy?.id) assert.notEqual(lessons.namespace_id, legacy.id, 'Legacy FPT_LESSONS_TEST must not be bound to V2.');

  return {
    settings,
    lessonsKv: lessons.namespace_id,
    studentsKv: students.namespace_id,
    r2: binding(settings, 'MATERIALS_R2')?.bucket_name,
    loginEnabled: enabled
  };
}

function kvValueUrl(namespaceId, key) {
  return `/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
}

export async function kvGetJson(namespaceId, key) {
  assertCloudflareEnv();
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${kvValueUrl(namespaceId, key)}`, {
    headers: { Authorization: `Bearer ${apiToken}` }
  });
  if (!response.ok) throw new Error(`KV GET failed (${response.status}) for controlled key ${key}.`);
  return JSON.parse(await response.text());
}

export async function kvPutJson(namespaceId, key, value) {
  assertCloudflareEnv();
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${kvValueUrl(namespaceId, key)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(value)
  });
  if (!response.ok) throw new Error(`KV PUT failed (${response.status}) for controlled key ${key}.`);
}

export async function curriculumLessonIds(lessonsKv, curriculumCode) {
  const body = await kvGetJson(lessonsKv, `curriculum:${curriculumCode}`);
  const raw = Array.isArray(body) ? body : (body?.lessonIds || body?.lessons || body?.items || []);
  return raw.map(item => typeof item === 'string' ? item : String(item?.lessonId || '')).filter(Boolean);
}

export function assertExactBaseline(label = 'baseline') {
  const sql = [
    'SELECT COUNT(*) AS entitlement_count FROM lesson_entitlements',
    'SELECT COUNT(*) AS batch_count FROM batch_definitions',
    'SELECT COUNT(*) AS assignment_count FROM student_batch_assignments',
    'SELECT COUNT(*) AS release_count FROM batch_lesson_releases',
    'SELECT COUNT(DISTINCT portal_user_id_norm) AS assigned_users FROM student_batch_assignments',
    'SELECT COUNT(*) AS assigned_user_entitlements FROM lesson_entitlements WHERE portal_user_id_norm IN (SELECT DISTINCT portal_user_id_norm FROM student_batch_assignments)',
    "SELECT COUNT(*) AS temp_entitlements FROM lesson_entitlements WHERE source_batch_code LIKE 'P16_%'",
    "SELECT COUNT(*) AS temp_batches FROM batch_definitions WHERE batch_key LIKE 'P16_%'",
    "SELECT COUNT(*) AS temp_assignments FROM student_batch_assignments WHERE batch_key LIKE 'P16_%'",
    "SELECT COUNT(*) AS temp_releases FROM batch_lesson_releases WHERE batch_key LIKE 'P16_%'",
    "SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_student_sessions_single_active'",
    'PRAGMA quick_check'
  ].map(statement => `${statement};`).join(' ');
  const r = d1Exec(sql);
  assert.equal(Number(r[0]?.results?.[0]?.entitlement_count), 632, `${label}: entitlement baseline changed.`);
  assert.equal(Number(r[1]?.results?.[0]?.batch_count), 4, `${label}: batch baseline changed.`);
  assert.equal(Number(r[2]?.results?.[0]?.assignment_count), 4, `${label}: assignment baseline changed.`);
  assert.equal(Number(r[3]?.results?.[0]?.release_count), 0, `${label}: release baseline changed.`);
  assert.equal(Number(r[4]?.results?.[0]?.assigned_users), 2, `${label}: assigned-user baseline changed.`);
  assert.equal(Number(r[5]?.results?.[0]?.assigned_user_entitlements), 173, `${label}: assigned-user entitlement baseline changed.`);
  for (let i = 6; i <= 9; i += 1) assert.equal(Number(Object.values(r[i]?.results?.[0] || {})[0]), 0, `${label}: Phase 16 temporary D1 fixture remained.`);
  assert.equal(r[10]?.results?.[0]?.name, 'trg_student_sessions_single_active', `${label}: single-session trigger missing.`);
  assert.equal(r[11]?.results?.[0]?.quick_check, 'ok', `${label}: D1 quick_check failed.`);
  return {
    entitlementCount: 632,
    batchDefinitions: 4,
    assignments: 4,
    releases: 0,
    assignedUsers: 2,
    assignedUserEntitlements: 173,
    quickCheck: 'ok',
    singleSessionTrigger: true
  };
}

export function insertNavigationFixtures(testStart) {
  const today = londonDate();
  const now = isoNow();
  const before = d1Exec("SELECT COUNT(*) AS c FROM batch_definitions WHERE batch_key LIKE 'P16_%'; SELECT COUNT(*) AS c FROM student_batch_assignments WHERE batch_key LIKE 'P16_%'; SELECT COUNT(*) AS c FROM batch_lesson_releases WHERE batch_key LIKE 'P16_%'; SELECT COUNT(*) AS c FROM lesson_entitlements WHERE source_batch_code LIKE 'P16_%';");
  before.forEach((part, index) => assert.equal(Number(part?.results?.[0]?.c), 0, `Phase 16 D1 fixture preguard ${index} was not empty.`));

  const q = value => `'${String(value).replaceAll("'", "''")}'`;
  const sql = `
    INSERT INTO batch_definitions (batch_key,academic_year,subject,school_year,stream,maths_level,active_from,active_to,created_at,updated_at)
    VALUES
      ('P16_M3_CURRENT','2026-27','maths',3,'normal',NULL,${q(today)},NULL,${q(now)},${q(now)}),
      ('P16_M4_CURRENT','2026-27','maths',4,'normal',NULL,${q(today)},NULL,${q(now)},${q(now)});
    INSERT INTO student_batch_assignments (portal_user_id_norm,batch_key,effective_from,effective_to,created_at,updated_at)
    VALUES
      ('testy5e','P16_M3_CURRENT',${q(today)},NULL,${q(now)},${q(now)}),
      ('testy5e','P16_M4_CURRENT',${q(today)},NULL,${q(now)},${q(now)});
  `;
  d1Exec(sql);
  const verify = d1Exec("SELECT COUNT(*) AS c FROM batch_definitions WHERE batch_key IN ('P16_M3_CURRENT','P16_M4_CURRENT'); SELECT COUNT(*) AS c FROM student_batch_assignments WHERE portal_user_id_norm='testy5e' AND batch_key IN ('P16_M3_CURRENT','P16_M4_CURRENT'); SELECT COUNT(*) AS c FROM batch_lesson_releases WHERE batch_key LIKE 'P16_%';");
  assert.equal(Number(verify[0]?.results?.[0]?.c), 2);
  assert.equal(Number(verify[1]?.results?.[0]?.c), 2);
  assert.equal(Number(verify[2]?.results?.[0]?.c), 0);
  return { today, testStart };
}

export function cleanupNavigationFixtures() {
  d1Exec(`
    DELETE FROM batch_lesson_releases WHERE batch_key LIKE 'P16_%';
    DELETE FROM student_batch_assignments WHERE batch_key LIKE 'P16_%';
    DELETE FROM batch_definitions WHERE batch_key LIKE 'P16_%';
    DELETE FROM lesson_entitlements WHERE source_batch_code LIKE 'P16_%';
  `);
}

export function cleanupControlledSessions(testStart) {
  const q = `'${String(testStart).replaceAll("'", "''")}'`;
  const ids = "'testy2e','testy2m','testy2em','testy4em','testy411m','testy511e','testy5em','testy5e','testy511em'";
  d1Exec(`
    DELETE FROM answer_password_rate_limits WHERE session_token_hash IN (SELECT token_hash FROM student_sessions WHERE portal_user_id_norm IN (${ids}) AND created_at >= ${q});
    DELETE FROM answer_view_tokens WHERE portal_user_id_norm IN (${ids}) AND created_at >= ${q};
    DELETE FROM student_session_profiles WHERE portal_user_id_norm IN (${ids}) AND created_at >= ${q};
    DELETE FROM student_sessions WHERE portal_user_id_norm IN (${ids}) AND created_at >= ${q};
  `);
}

export function revokeExistingControlledSessions() {
  const ids = "'testy2e','testy2m','testy2em','testy4em','testy411m','testy511e','testy5em','testy5e','testy511em'";
  d1Exec(`UPDATE student_sessions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE portal_user_id_norm IN (${ids}) AND revoked_at IS NULL AND idle_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now');`);
}

export function activeControlledSessions(testStart) {
  const q = `'${String(testStart).replaceAll("'", "''")}'`;
  const r = d1Exec(`SELECT COUNT(*) AS c FROM student_sessions WHERE portal_user_id_norm LIKE 'testy%' AND created_at >= ${q} AND revoked_at IS NULL AND idle_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now');`);
  return Number(r[0]?.results?.[0]?.c || 0);
}

export function ageSessionByHash(hash) {
  assert.match(hash, /^[a-f0-9]{64}$/);
  d1Exec(`UPDATE student_sessions SET idle_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 second'), last_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 hours','-1 second') WHERE token_hash='${hash}';`);
}

export function revokeSessionByHash(hash) {
  assert.match(hash, /^[a-f0-9]{64}$/);
  d1Exec(`UPDATE student_sessions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash='${hash}' AND revoked_at IS NULL;`);
}

export function deleteAnswerRateLimit(hash) {
  assert.match(hash, /^[a-f0-9]{64}$/);
  d1Exec(`DELETE FROM answer_password_rate_limits WHERE session_token_hash='${hash}';`);
}

export function sessionStateByHash(hash) {
  assert.match(hash, /^[a-f0-9]{64}$/);
  const r = d1Exec(`SELECT portal_user_id_norm,created_at,last_activity_at,idle_expires_at,revoked_at FROM student_sessions WHERE token_hash='${hash}' LIMIT 1;`);
  return r[0]?.results?.[0] || null;
}

export async function waitForKvProfile(studentsKv, key, predicate, { attempts = 20, delayMs = 1500 } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    last = await kvGetJson(studentsKv, key);
    if (predicate(last)) return last;
    if (i + 1 < attempts) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  throw new Error(`Controlled KV value ${key} did not reach the requested state in time.`);
}

export function safeEvidence(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (/password|token|cookie|secret|authorization/i.test(key)) return '[REDACTED]';
    return item;
  }));
}
