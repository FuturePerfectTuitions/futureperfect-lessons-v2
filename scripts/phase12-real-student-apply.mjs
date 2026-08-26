import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadPhase11Catalogue } from './phase11-catalogue.mjs';

const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const WORKER_NAME = 'fpt-portal-v2-worker';
const WORKER_BASE = 'https://fpt-portal-v2-worker.futureperfectlessons.workers.dev';
const ORIGIN = 'https://futureperfecttuitions.github.io';
const WRANGLER_VERSION = '4.125.0';
const EXPECTED_MAIN_SHA = '681b16d6344236168acb2d1824a0bb2e7bed9bb5';
const CATALOGUE_SHA = '7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663';
const PRIVATE_KEY_NAME = 'phase12:real-students:private-key';
const PAYLOAD_PATH = 'docs/data/phase12/real-students-payload.enc.json';

function fail(message) {
  throw new Error(message);
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function cf(path, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      ...(options.headers || {})
    }
  });
  return response;
}

function wrangler(args, { json = false } = {}) {
  const result = spawnSync('npx', ['--yes', `wrangler@${WRANGLER_VERSION}`, ...args], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: process.env
  });
  if (result.status !== 0) fail('Wrangler command failed');
  if (!json) return result.stdout || '';
  const text = String(result.stdout || '').trim();
  const startArray = text.indexOf('[');
  const startObject = text.indexOf('{');
  const starts = [startArray, startObject].filter(v => v >= 0);
  if (!starts.length) fail('Wrangler JSON output missing');
  return JSON.parse(text.slice(Math.min(...starts)));
}

function flattenD1(raw) {
  if (Array.isArray(raw)) return raw.flatMap(item => item?.results || []);
  return raw?.results || [];
}

function settingBinding(settings, name, type) {
  return settings.result.bindings.find(binding => binding.name === name && (!type || binding.type === type));
}

function validFour(value) {
  const s = String(value || '');
  return s.length === 4 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s);
}

function makeWorkerConfig({ studentsId, lessonsId, dbId, origins, allowlist }) {
  return `name = "fpt-portal-v2-worker"\nmain = "src/index-phase12.js"\ncompatibility_date = "2026-08-20"\nkeep_vars = true\nworkers_dev = true\n\n[vars]\nENVIRONMENT = "development"\nALLOWED_ORIGINS = ${JSON.stringify(origins)}\nDEV_LOGIN_ALLOWLIST = ${JSON.stringify(allowlist)}\n\n[[kv_namespaces]]\nbinding = "STUDENTS_KV"\nid = "${studentsId}"\n\n[[kv_namespaces]]\nbinding = "LESSONS_KV"\nid = "${lessonsId}"\n\n[[r2_buckets]]\nbinding = "MATERIALS_R2"\nbucket_name = "fpt-materials-dev"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "fpt_portal_v2_db"\ndatabase_id = "${dbId}"\n`;
}

function buildPlan(payload) {
  const catalogue = loadPhase11Catalogue();
  assert.equal(catalogue.lessonCount, 369);
  assert.equal(catalogue.curriculumCount, 11);
  assert.equal(catalogue.catalogueSha256, CATALOGUE_SHA);

  const viewCurriculum = {
    'english-year2': 'ENGLISH_Y2',
    'maths-year2': 'MATHS_Y2',
    'english-year4-11plus': 'ENGLISH_Y4',
    'maths-level1': 'MATHS_L1',
    'maths-level2': 'MATHS_L2'
  };

  const users = [];
  const rows = [];
  const expected = new Map();

  for (const student of payload.students) {
    const norm = String(student.portalUserId).trim().toLowerCase();
    const value = {
      firstName: String(student.firstName),
      p: String(student.loginPassword),
      answerPassword: String(student.answerPassword),
      schoolYear: Number(student.schoolYear),
      vrEligible: Boolean(student.vrEligible),
      status: 'active',
      expires: null,
      batches: [],
      fullLibraries: [],
      manualAccess: { coreLessons: [], vrLessons: [], specialBuckets: [] },
      blockedLessons: []
    };
    users.push({ norm, key: `user:${norm}`, value, login: { username: student.portalUserId, password: student.loginPassword } });

    const open = {};
    for (const viewId of student.expectedViews) {
      const code = viewCurriculum[viewId];
      if (!code) fail('Unsupported expected view');
      open[viewId] = catalogue.curricula[code].lessonIds.length;
    }
    expected.set(norm, { open, denied: [...student.deniedViews] });

    for (const code of student.curricula) {
      const curriculum = catalogue.curricula[code];
      if (!curriculum?.lessonIds?.length) fail('Unknown curriculum in private payload');
      const vr = student.vrCurricula.includes(code) ? 1 : 0;
      for (const lessonId of curriculum.lessonIds) rows.push({ norm, lessonId, vr });
    }
  }

  const dedup = new Map();
  for (const row of rows) {
    const key = `${row.norm}|${row.lessonId}`;
    const old = dedup.get(key);
    dedup.set(key, old ? { ...old, vr: Math.max(old.vr, row.vr) } : row);
  }

  return { catalogue, users, rows: [...dedup.values()], expected };
}

function buildApplySql(plan) {
  const now = new Date().toISOString();
  const byUser = new Map();
  for (const row of plan.rows) {
    if (!byUser.has(row.norm)) byUser.set(row.norm, []);
    byUser.get(row.norm).push(row);
  }

  let sql = '';
  for (const [norm, rows] of byUser) {
    sql += `DELETE FROM lesson_entitlements WHERE portal_user_id_norm=${sqlQuote(norm)} AND lesson_id NOT IN (${rows.map(row => sqlQuote(row.lessonId)).join(',')});\n`;
  }

  sql += `INSERT INTO lesson_entitlements (portal_user_id_norm,lesson_id,core_access,vr_access,source,first_granted_at,last_confirmed_at,source_batch_code,source_lesson_date) VALUES\n`;
  sql += plan.rows.map(row => `(${sqlQuote(row.norm)},${sqlQuote(row.lessonId)},1,${row.vr},'excel',${sqlQuote(now)},${sqlQuote(now)},NULL,NULL)`).join(',\n');
  sql += `\nON CONFLICT(portal_user_id_norm,lesson_id) DO UPDATE SET core_access=1,vr_access=excluded.vr_access,last_confirmed_at=excluded.last_confirmed_at,source_batch_code=NULL,source_lesson_date=NULL;`;
  return sql;
}

function buildRollbackSql(userIds, rows) {
  let sql = `DELETE FROM lesson_entitlements WHERE portal_user_id_norm IN (${userIds.map(sqlQuote).join(',')});\n`;
  if (rows.length) {
    sql += `INSERT INTO lesson_entitlements (portal_user_id_norm,lesson_id,core_access,vr_access,source,first_granted_at,last_confirmed_at,source_batch_code,source_lesson_date) VALUES\n`;
    sql += rows.map(row => `(${sqlQuote(row.portal_user_id_norm)},${sqlQuote(row.lesson_id)},${Number(row.core_access)},${Number(row.vr_access)},${sqlQuote(row.source)},${sqlQuote(row.first_granted_at)},${sqlQuote(row.last_confirmed_at)},${row.source_batch_code == null ? 'NULL' : sqlQuote(row.source_batch_code)},${row.source_lesson_date == null ? 'NULL' : sqlQuote(row.source_lesson_date)})`).join(',\n');
    sql += ';';
  }
  return sql;
}

async function kvRead(namespaceId, key) {
  const response = await cf(`/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`);
  if (response.status === 404) return { exists: false, text: null };
  if (!response.ok) fail('KV read failed');
  return { exists: true, text: await response.text() };
}

async function kvWrite(namespaceId, key, text, contentType = 'application/json') {
  const response = await cf(`/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: text
  });
  if (!response.ok) fail('KV write failed');
}

async function kvDelete(namespaceId, key) {
  const response = await cf(`/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`, { method: 'DELETE' });
  if (!response.ok) fail('KV delete failed');
}

async function loginAndHome(login) {
  const loginResponse = await fetch(`${WORKER_BASE}/api/v1/student/auth/login`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify(login)
  });
  if (!loginResponse.ok) fail('Controlled real-student login acceptance failed');
  const loginBody = await loginResponse.json();
  if (loginBody.ok !== true) fail('Controlled login did not return ok');
  const cookie = loginResponse.headers.get('set-cookie');
  if (!cookie) fail('Controlled login cookie missing');
  const cookieHeader = cookie.split(';')[0];
  const homeResponse = await fetch(`${WORKER_BASE}/api/v1/student/home`, { headers: { Origin: ORIGIN, Cookie: cookieHeader } });
  if (!homeResponse.ok) fail('Controlled home acceptance failed');
  const home = await homeResponse.json();
  if (home.ok !== true) fail('Controlled home did not return ok');
  await fetch(`${WORKER_BASE}/api/v1/student/auth/logout`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: cookieHeader } });
  return home;
}

async function main() {
  if (!ACCOUNT_ID || !API_TOKEN) fail('Cloudflare credentials missing');
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  assert.equal(event.pull_request?.base?.sha, EXPECTED_MAIN_SHA, 'PR base drifted from Phase 12 runtime checkpoint');

  const catalogue = loadPhase11Catalogue();
  assert.equal(catalogue.lessonCount, 369);
  assert.equal(catalogue.curriculumCount, 11);
  assert.equal(catalogue.catalogueSha256, CATALOGUE_SHA);

  const settingsResponse = await cf(`/workers/scripts/${WORKER_NAME}/settings`);
  if (!settingsResponse.ok) fail('Worker settings read failed');
  const settings = await settingsResponse.json();
  assert.equal(settings.success, true);
  assert.equal(settingBinding(settings, 'ENVIRONMENT', 'plain_text')?.text, 'development');
  assert.equal(settingBinding(settings, 'MATERIALS_R2', 'r2_bucket')?.bucket_name, 'fpt-materials-dev');
  const loginEnabled = String(settingBinding(settings, 'STUDENT_LOGIN_ENABLED', 'plain_text')?.text || '').toLowerCase();
  if (loginEnabled && loginEnabled !== 'false') fail('Normal student login is enabled');

  const studentsId = settingBinding(settings, 'STUDENTS_KV', 'kv_namespace')?.namespace_id;
  const lessonsId = settingBinding(settings, 'LESSONS_KV', 'kv_namespace')?.namespace_id;
  const dbId = settingBinding(settings, 'DB', 'd1')?.id;
  const oldAllowlist = String(settingBinding(settings, 'DEV_LOGIN_ALLOWLIST', 'plain_text')?.text || '');
  const origins = String(settingBinding(settings, 'ALLOWED_ORIGINS', 'plain_text')?.text || ORIGIN);
  if (!studentsId || !lessonsId || !dbId) fail('Development bindings incomplete');

  const preflight = wrangler(['d1','execute','fpt_portal_v2_db','--remote','--json','--command',`SELECT COUNT(*) AS batch_count FROM batch_definitions; SELECT COUNT(*) AS assignment_count FROM student_batch_assignments; SELECT COUNT(*) AS release_count FROM batch_lesson_releases; SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_student_sessions_single_active'; PRAGMA quick_check;`], { json: true });
  assert.equal(Number(preflight[0]?.results?.[0]?.batch_count), 0);
  assert.equal(Number(preflight[1]?.results?.[0]?.assignment_count), 0);
  assert.equal(Number(preflight[2]?.results?.[0]?.release_count), 0);
  assert.equal(preflight[3]?.results?.[0]?.name, 'trg_student_sessions_single_active');
  assert.equal(preflight[4]?.results?.[0]?.quick_check, 'ok');

  const privateKeyRead = await kvRead(studentsId, PRIVATE_KEY_NAME);
  if (!privateKeyRead.exists) fail('Private transport key missing');
  const privateKey = privateKeyRead.text;
  const envelope = JSON.parse(fs.readFileSync(PAYLOAD_PATH, 'utf8'));
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.alg, 'RSA-OAEP-256+A256GCM');
  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  const fingerprint = crypto.createHash('sha256').update(publicKey).digest('hex');
  assert.equal(fingerprint, envelope.keyFingerprintSha256, 'Encrypted payload key mismatch');
  const aesKey = crypto.privateDecrypt({ key: privateKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(envelope.encryptedKey, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.students?.length, 2, 'Exactly two real students are expected');
  const seen = new Set();
  for (const student of payload.students) {
    const norm = String(student.portalUserId || '').trim().toLowerCase();
    if (!norm || seen.has(norm)) fail('Invalid private student ID set');
    if (!validFour(student.loginPassword) || !validFour(student.answerPassword)) fail('Invalid private four-character password');
    if (![3, 5].includes(Number(student.schoolYear))) fail('Unexpected September school year');
    if (!Array.isArray(student.curricula) || !student.curricula.length || !Array.isArray(student.vrCurricula) || !Array.isArray(student.expectedViews) || !Array.isArray(student.deniedViews)) fail('Incomplete private access plan');
    if (Array.isArray(student.fullLibraries) && student.fullLibraries.length) fail('Full Library override is not permitted in this exact two-student apply');
    seen.add(norm);
  }

  const plan = buildPlan(payload);
  const userIds = plan.users.map(user => user.norm);
  const backups = new Map();
  for (const user of plan.users) backups.set(user.norm, await kvRead(studentsId, user.key));

  const selectSql = `SELECT portal_user_id_norm,lesson_id,core_access,vr_access,source,first_granted_at,last_confirmed_at,source_batch_code,source_lesson_date FROM lesson_entitlements WHERE portal_user_id_norm IN (${userIds.map(sqlQuote).join(',')});`;
  const d1BackupRaw = wrangler(['d1','execute','fpt_portal_v2_db','--remote','--json','--command',selectSql], { json: true });
  const d1Backup = flattenD1(d1BackupRaw);
  const rollbackSql = buildRollbackSql(userIds, d1Backup);

  let dataMutated = false;
  let allowlistChanged = false;
  try {
    const set = new Set(oldAllowlist.split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
    for (const id of userIds) set.add(id);
    const newAllowlist = [...set].join(',');
    if (newAllowlist !== oldAllowlist) {
      fs.writeFileSync('/tmp/phase12-real-students-wrangler.toml', makeWorkerConfig({ studentsId, lessonsId, dbId, origins, allowlist: newAllowlist }), { mode: 0o600 });
      wrangler(['deploy','--config','/tmp/phase12-real-students-wrangler.toml','--keep-vars','--message','Phase 12 controlled two-student owner access']);
      allowlistChanged = true;
    }

    dataMutated = true;
    for (const user of plan.users) await kvWrite(studentsId, user.key, JSON.stringify(user.value));
    wrangler(['d1','execute','fpt_portal_v2_db','--remote','--command',buildApplySql(plan),'--yes']);

    for (const user of plan.users) {
      const after = await kvRead(studentsId, user.key);
      assert.equal(after.exists, true);
      assert.deepEqual(JSON.parse(after.text), user.value);
    }

    const d1After = flattenD1(wrangler(['d1','execute','fpt_portal_v2_db','--remote','--json','--command',selectSql], { json: true }));
    assert.equal(d1After.length, plan.rows.length, 'Exact permanent entitlement row count mismatch');
    const wanted = new Map(plan.rows.map(row => [`${row.norm}|${row.lessonId}`, row]));
    for (const row of d1After) {
      const target = wanted.get(`${row.portal_user_id_norm}|${row.lesson_id}`);
      if (!target || Number(row.core_access) !== 1 || Number(row.vr_access) !== target.vr) fail('Exact permanent entitlement mismatch');
    }

    const finalDb = wrangler(['d1','execute','fpt_portal_v2_db','--remote','--json','--command',`SELECT COUNT(*) AS batch_count FROM batch_definitions; SELECT COUNT(*) AS assignment_count FROM student_batch_assignments; SELECT COUNT(*) AS release_count FROM batch_lesson_releases; SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_student_sessions_single_active'; PRAGMA quick_check;`], { json: true });
    assert.equal(Number(finalDb[0]?.results?.[0]?.batch_count), 0);
    assert.equal(Number(finalDb[1]?.results?.[0]?.assignment_count), 0);
    assert.equal(Number(finalDb[2]?.results?.[0]?.release_count), 0);
    assert.equal(finalDb[3]?.results?.[0]?.name, 'trg_student_sessions_single_active');
    assert.equal(finalDb[4]?.results?.[0]?.quick_check, 'ok');

    for (const user of plan.users) {
      const home = await loginAndHome(user.login);
      const views = (home.subjects || []).flatMap(subject => (subject.views || []).map(view => ({ ...view, subject: subject.subject })));
      const expected = plan.expected.get(user.norm);
      for (const [viewId, count] of Object.entries(expected.open)) {
        const view = views.find(item => item.viewId === viewId);
        if (!view || view.lockedPreview === true || Number(view.openLessonCount) !== Number(count)) fail('Required retained catalogue access is missing');
      }
      for (const viewId of expected.denied) {
        const view = views.find(item => item.viewId === viewId);
        if (view && view.lockedPreview !== true && Number(view.openLessonCount) > 0) fail('Future catalogue access opened prematurely');
      }
    }

    const settingsAfterResponse = await cf(`/workers/scripts/${WORKER_NAME}/settings`);
    if (!settingsAfterResponse.ok) fail('Final Worker settings read failed');
    const settingsAfter = await settingsAfterResponse.json();
    assert.equal(settingBinding(settingsAfter, 'ENVIRONMENT', 'plain_text')?.text, 'development');
    assert.equal(settingBinding(settingsAfter, 'MATERIALS_R2', 'r2_bucket')?.bucket_name, 'fpt-materials-dev');
    const finalLoginEnabled = String(settingBinding(settingsAfter, 'STUDENT_LOGIN_ENABLED', 'plain_text')?.text || '').toLowerCase();
    if (finalLoginEnabled && finalLoginEnabled !== 'false') fail('Normal student login became enabled');

    await kvDelete(studentsId, PRIVATE_KEY_NAME);
    const keyAfter = await kvRead(studentsId, PRIVATE_KEY_NAME);
    assert.equal(keyAfter.exists, false, 'Private transport key was not destroyed');
    console.log(`Phase 12 real-student apply: PASS (${plan.users.length} students, ${plan.rows.length} exact permanent entitlement rows, 0 September batches).`);
  } catch (error) {
    if (dataMutated) {
      try { wrangler(['d1','execute','fpt_portal_v2_db','--remote','--command',rollbackSql,'--yes']); } catch {}
      for (const user of plan.users) {
        const backup = backups.get(user.norm);
        try {
          if (backup?.exists) await kvWrite(studentsId, user.key, backup.text);
          else await kvDelete(studentsId, user.key);
        } catch {}
      }
    }
    if (allowlistChanged) {
      try {
        fs.writeFileSync('/tmp/phase12-real-students-rollback.toml', makeWorkerConfig({ studentsId, lessonsId, dbId, origins, allowlist: oldAllowlist }), { mode: 0o600 });
        wrangler(['deploy','--config','/tmp/phase12-real-students-rollback.toml','--keep-vars','--message','Rollback Phase 12 controlled owner access']);
      } catch {}
    }
    throw error;
  }
}

main().catch(error => {
  console.error(`Phase 12 real-student apply failed: ${error.message}`);
  process.exit(1);
});
