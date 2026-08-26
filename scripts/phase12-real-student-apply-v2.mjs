import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadPhase11Catalogue, validatePhase11Catalogue } from './phase11-catalogue.mjs';

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

const fail = message => { throw new Error(message); };
const q = value => `'${String(value).replaceAll("'", "''")}'`;

async function cf(path, options = {}) {
  return fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${API_TOKEN}`, ...(options.headers || {}) }
  });
}

function wrangler(args, json = false) {
  const result = spawnSync('npx', ['--yes', `wrangler@${WRANGLER_VERSION}`, ...args], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: process.env
  });
  if (result.status !== 0) fail('Wrangler command failed');
  if (!json) return result.stdout || '';
  const text = String(result.stdout || '').trim();
  const positions = [text.indexOf('['), text.indexOf('{')].filter(index => index >= 0);
  if (!positions.length) fail('Wrangler JSON output missing');
  return JSON.parse(text.slice(Math.min(...positions)));
}

function rows(raw) {
  return Array.isArray(raw) ? raw.flatMap(item => item?.results || []) : raw?.results || [];
}

function binding(settings, name, type) {
  return settings.result.bindings.find(item => item.name === name && (!type || item.type === type));
}

function validFour(value) {
  const text = String(value || '');
  return text.length === 4 && /[A-Z]/.test(text) && /[a-z]/.test(text) && /\d/.test(text);
}

async function kvRead(namespaceId, key) {
  const response = await cf(`/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`);
  if (response.status === 404) return { exists: false, text: null };
  if (!response.ok) fail('KV read failed');
  return { exists: true, text: await response.text() };
}

async function kvWrite(namespaceId, key, text) {
  const response = await cf(`/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text
  });
  if (!response.ok) fail('KV write failed');
}

async function kvDelete(namespaceId, key) {
  const response = await cf(`/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`, { method: 'DELETE' });
  if (!response.ok) fail('KV delete failed');
}

function decryptPayload(privateKey) {
  const envelope = JSON.parse(fs.readFileSync(PAYLOAD_PATH, 'utf8'));
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.alg, 'RSA-OAEP-256+A256GCM');
  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  const fingerprint = crypto.createHash('sha256').update(publicKey).digest('hex');
  assert.equal(fingerprint, envelope.keyFingerprintSha256);
  const aesKey = crypto.privateDecrypt({ key: privateKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(envelope.encryptedKey, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}

function buildPlan(payload, catalogue) {
  const viewCurriculum = {
    'english-year2': 'ENGLISH_Y2',
    'maths-year2': 'MATHS_Y2',
    'english-year4-11plus': 'ENGLISH_Y4',
    'maths-level1': 'MATHS_L1',
    'maths-level2': 'MATHS_L2'
  };
  const users = [];
  const collected = [];
  const expected = new Map();

  for (const student of payload.students) {
    const norm = String(student.portalUserId).trim().toLowerCase();
    users.push({
      norm,
      key: `user:${norm}`,
      login: { username: student.portalUserId, password: student.loginPassword },
      value: {
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
      }
    });

    const open = {};
    for (const viewId of student.expectedViews) {
      const code = viewCurriculum[viewId];
      if (!code) fail('Unsupported expected view');
      open[viewId] = catalogue.curricula[code].lessonIds.length;
    }
    expected.set(norm, { open, denied: [...student.deniedViews] });

    for (const code of student.curricula) {
      const curriculum = catalogue.curricula[code];
      if (!curriculum?.lessonIds?.length) fail('Unknown curriculum in encrypted plan');
      const vr = student.vrCurricula.includes(code) ? 1 : 0;
      for (const lessonId of curriculum.lessonIds) collected.push({ norm, lessonId, vr });
    }
  }

  const dedup = new Map();
  for (const item of collected) {
    const key = `${item.norm}|${item.lessonId}`;
    const existing = dedup.get(key);
    dedup.set(key, existing ? { ...existing, vr: Math.max(existing.vr, item.vr) } : item);
  }
  return { users, entitlements: [...dedup.values()], expected };
}

function applySql(plan) {
  const now = new Date().toISOString();
  const byUser = new Map();
  for (const row of plan.entitlements) {
    if (!byUser.has(row.norm)) byUser.set(row.norm, []);
    byUser.get(row.norm).push(row);
  }
  let sql = '';
  for (const [norm, list] of byUser) {
    sql += `DELETE FROM lesson_entitlements WHERE portal_user_id_norm=${q(norm)} AND lesson_id NOT IN (${list.map(item => q(item.lessonId)).join(',')});\n`;
  }
  sql += `INSERT INTO lesson_entitlements (portal_user_id_norm,lesson_id,core_access,vr_access,source,first_granted_at,last_confirmed_at,source_batch_code,source_lesson_date) VALUES\n`;
  sql += plan.entitlements.map(item => `(${q(item.norm)},${q(item.lessonId)},1,${item.vr},'excel',${q(now)},${q(now)},NULL,NULL)`).join(',\n');
  sql += `\nON CONFLICT(portal_user_id_norm,lesson_id) DO UPDATE SET core_access=1,vr_access=excluded.vr_access,last_confirmed_at=excluded.last_confirmed_at,source_batch_code=NULL,source_lesson_date=NULL;`;
  return sql;
}

function rollbackSql(ids, backup) {
  let sql = `DELETE FROM lesson_entitlements WHERE portal_user_id_norm IN (${ids.map(q).join(',')});\n`;
  if (backup.length) {
    sql += `INSERT INTO lesson_entitlements (portal_user_id_norm,lesson_id,core_access,vr_access,source,first_granted_at,last_confirmed_at,source_batch_code,source_lesson_date) VALUES\n`;
    sql += backup.map(row => `(${q(row.portal_user_id_norm)},${q(row.lesson_id)},${Number(row.core_access)},${Number(row.vr_access)},${q(row.source)},${q(row.first_granted_at)},${q(row.last_confirmed_at)},${row.source_batch_code == null ? 'NULL' : q(row.source_batch_code)},${row.source_lesson_date == null ? 'NULL' : q(row.source_lesson_date)})`).join(',\n');
    sql += ';';
  }
  return sql;
}

async function loginHome(login) {
  const loginResponse = await fetch(`${WORKER_BASE}/api/v1/student/auth/login`, {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(login)
  });
  if (!loginResponse.ok) fail('Controlled login acceptance failed');
  const loginBody = await loginResponse.json();
  if (loginBody.ok !== true) fail('Controlled login returned non-ok');
  const setCookie = loginResponse.headers.get('set-cookie');
  if (!setCookie) fail('Controlled login cookie missing');
  const cookie = setCookie.split(';')[0];
  const homeResponse = await fetch(`${WORKER_BASE}/api/v1/student/home`, { headers: { Origin: ORIGIN, Cookie: cookie } });
  if (!homeResponse.ok) fail('Controlled home acceptance failed');
  const home = await homeResponse.json();
  await fetch(`${WORKER_BASE}/api/v1/student/auth/logout`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: cookie } });
  if (home.ok !== true) fail('Controlled home returned non-ok');
  return home;
}

async function main() {
  if (!ACCOUNT_ID || !API_TOKEN) fail('Cloudflare credentials missing');
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  assert.equal(event.pull_request?.base?.sha, EXPECTED_MAIN_SHA);

  const catalogue = loadPhase11Catalogue();
  const catalogueSummary = validatePhase11Catalogue(catalogue);
  assert.equal(catalogueSummary.lessons, 369);
  assert.equal(catalogueSummary.curricula, 11);
  assert.equal(catalogueSummary.catalogueSha256, CATALOGUE_SHA);

  const settingsResponse = await cf(`/workers/scripts/${WORKER_NAME}/settings`);
  if (!settingsResponse.ok) fail('Worker settings read failed');
  const settings = await settingsResponse.json();
  assert.equal(settings.success, true);
  assert.equal(binding(settings, 'ENVIRONMENT', 'plain_text')?.text, 'development');
  assert.equal(binding(settings, 'MATERIALS_R2', 'r2_bucket')?.bucket_name, 'fpt-materials-dev');
  const generalLogin = String(binding(settings, 'STUDENT_LOGIN_ENABLED', 'plain_text')?.text || '').toLowerCase();
  if (generalLogin && generalLogin !== 'false') fail('Normal real-student login is enabled');
  const studentsId = binding(settings, 'STUDENTS_KV', 'kv_namespace')?.namespace_id;
  const dbId = binding(settings, 'DB', 'd1')?.id;
  if (!studentsId || !dbId) fail('Required isolated development bindings missing');

  const preflight = wrangler(['d1','execute','fpt_portal_v2_db','--remote','--json','--command',`SELECT COUNT(*) AS batch_count FROM batch_definitions; SELECT COUNT(*) AS assignment_count FROM student_batch_assignments; SELECT COUNT(*) AS release_count FROM batch_lesson_releases; SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_student_sessions_single_active'; PRAGMA quick_check;`], true);
  assert.equal(Number(preflight[0]?.results?.[0]?.batch_count), 0);
  assert.equal(Number(preflight[1]?.results?.[0]?.assignment_count), 0);
  assert.equal(Number(preflight[2]?.results?.[0]?.release_count), 0);
  assert.equal(preflight[3]?.results?.[0]?.name, 'trg_student_sessions_single_active');
  assert.equal(preflight[4]?.results?.[0]?.quick_check, 'ok');

  const privateKeyRecord = await kvRead(studentsId, PRIVATE_KEY_NAME);
  if (!privateKeyRecord.exists) fail('Private transport key missing');
  const payload = decryptPayload(privateKeyRecord.text);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.students?.length, 2, 'Exactly two real students required');
  const seen = new Set();
  for (const student of payload.students) {
    const norm = String(student.portalUserId || '').trim().toLowerCase();
    if (!norm || seen.has(norm)) fail('Invalid private student set');
    if (!validFour(student.loginPassword) || !validFour(student.answerPassword)) fail('Invalid four-character password');
    if (![3, 5].includes(Number(student.schoolYear))) fail('Unexpected September school year');
    if (!Array.isArray(student.curricula) || !student.curricula.length || !Array.isArray(student.vrCurricula) || !Array.isArray(student.expectedViews) || !Array.isArray(student.deniedViews)) fail('Incomplete encrypted access plan');
    if ((student.fullLibraries || []).length) fail('Full Library override not permitted for this exact apply');
    seen.add(norm);
  }

  const plan = buildPlan(payload, catalogue);
  const ids = plan.users.map(user => user.norm);
  const allowlist = new Set(String(binding(settings, 'DEV_LOGIN_ALLOWLIST', 'plain_text')?.text || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  for (const id of ids) if (!allowlist.has(id)) fail('Controlled owner-check allowlist is missing one of the two real students');

  const kvBackup = new Map();
  for (const user of plan.users) kvBackup.set(user.norm, await kvRead(studentsId, user.key));
  const selectSql = `SELECT portal_user_id_norm,lesson_id,core_access,vr_access,source,first_granted_at,last_confirmed_at,source_batch_code,source_lesson_date FROM lesson_entitlements WHERE portal_user_id_norm IN (${ids.map(q).join(',')});`;
  const d1Backup = rows(wrangler(['d1','execute','fpt_portal_v2_db','--remote','--json','--command',selectSql], true));
  const undoSql = rollbackSql(ids, d1Backup);

  let mutated = false;
  try {
    mutated = true;
    for (const user of plan.users) await kvWrite(studentsId, user.key, JSON.stringify(user.value));
    wrangler(['d1','execute','fpt_portal_v2_db','--remote','--command',applySql(plan),'--yes']);

    for (const user of plan.users) {
      const current = await kvRead(studentsId, user.key);
      assert.equal(current.exists, true);
      assert.deepEqual(JSON.parse(current.text), user.value);
    }

    const after = rows(wrangler(['d1','execute','fpt_portal_v2_db','--remote','--json','--command',selectSql], true));
    assert.equal(after.length, plan.entitlements.length);
    const wanted = new Map(plan.entitlements.map(row => [`${row.norm}|${row.lessonId}`, row]));
    for (const row of after) {
      const target = wanted.get(`${row.portal_user_id_norm}|${row.lesson_id}`);
      if (!target || Number(row.core_access) !== 1 || Number(row.vr_access) !== target.vr) fail('Permanent entitlement verification failed');
    }

    for (const user of plan.users) {
      const home = await loginHome(user.login);
      const views = (home.subjects || []).flatMap(subject => (subject.views || []).map(view => ({ ...view, subject: subject.subject })));
      const expected = plan.expected.get(user.norm);
      for (const [viewId, count] of Object.entries(expected.open)) {
        const view = views.find(item => item.viewId === viewId);
        if (!view || view.lockedPreview === true || Number(view.openLessonCount) !== Number(count)) fail('Required retained catalogue access missing');
      }
      for (const viewId of expected.denied) {
        const view = views.find(item => item.viewId === viewId);
        if (view && view.lockedPreview !== true && Number(view.openLessonCount) > 0) fail('Future catalogue access opened prematurely');
      }
    }

    const finalState = wrangler(['d1','execute','fpt_portal_v2_db','--remote','--json','--command',`SELECT COUNT(*) AS batch_count FROM batch_definitions; SELECT COUNT(*) AS assignment_count FROM student_batch_assignments; SELECT COUNT(*) AS release_count FROM batch_lesson_releases; SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_student_sessions_single_active'; PRAGMA quick_check;`], true);
    assert.equal(Number(finalState[0]?.results?.[0]?.batch_count), 0);
    assert.equal(Number(finalState[1]?.results?.[0]?.assignment_count), 0);
    assert.equal(Number(finalState[2]?.results?.[0]?.release_count), 0);
    assert.equal(finalState[3]?.results?.[0]?.name, 'trg_student_sessions_single_active');
    assert.equal(finalState[4]?.results?.[0]?.quick_check, 'ok');

    const settingsAfterResponse = await cf(`/workers/scripts/${WORKER_NAME}/settings`);
    if (!settingsAfterResponse.ok) fail('Final Worker settings read failed');
    const settingsAfter = await settingsAfterResponse.json();
    assert.equal(binding(settingsAfter, 'ENVIRONMENT', 'plain_text')?.text, 'development');
    assert.equal(binding(settingsAfter, 'MATERIALS_R2', 'r2_bucket')?.bucket_name, 'fpt-materials-dev');
    const finalGeneralLogin = String(binding(settingsAfter, 'STUDENT_LOGIN_ENABLED', 'plain_text')?.text || '').toLowerCase();
    if (finalGeneralLogin && finalGeneralLogin !== 'false') fail('Normal login became enabled');

    await kvDelete(studentsId, PRIVATE_KEY_NAME);
    assert.equal((await kvRead(studentsId, PRIVATE_KEY_NAME)).exists, false);
    mutated = false;
    console.log(`Phase 12 real-student apply: PASS (${plan.users.length} students, ${plan.entitlements.length} exact permanent entitlement rows, 0 September batches).`);
  } catch (error) {
    if (mutated) {
      try { wrangler(['d1','execute','fpt_portal_v2_db','--remote','--command',undoSql,'--yes']); } catch {}
      for (const user of plan.users) {
        const backup = kvBackup.get(user.norm);
        try {
          if (backup?.exists) await kvWrite(studentsId, user.key, backup.text);
          else await kvDelete(studentsId, user.key);
        } catch {}
      }
    }
    throw error;
  }
}

main().catch(error => {
  console.error(`Phase 12 real-student apply failed: ${error.message}`);
  process.exit(1);
});
