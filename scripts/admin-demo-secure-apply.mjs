import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const workerName = String(process.env.WORKER_NAME || 'fpt-portal-v2-worker').trim();
const workerBase = String(process.env.WORKER_BASE || 'https://fpt-portal-v2-worker.futureperfectlessons.workers.dev').trim();
const wranglerVersion = String(process.env.WRANGLER_VERSION || '4.125.0').trim();
const productionOrigin = 'https://lessons.futureperfect.education';
if (!accountId || !token) throw new Error('Cloudflare credentials are required.');

function decryptPayload() {
  const wrappedPrivate = JSON.parse(fs.readFileSync('.secure-admin-provisioning/private.enc.json', 'utf8'));
  if (wrappedPrivate.schema !== 'fpt-admin-demo-private-wrap-v1') throw new Error('Unexpected private-key envelope');
  const wrapKey = crypto.createHash('sha256').update('fpt-admin-demo-provision-wrap-v1\0').update(token).digest();
  const privateDecipher = crypto.createDecipheriv('aes-256-gcm', wrapKey, Buffer.from(wrappedPrivate.iv, 'base64'));
  privateDecipher.setAuthTag(Buffer.from(wrappedPrivate.tag, 'base64'));
  const privatePem = Buffer.concat([
    privateDecipher.update(Buffer.from(wrappedPrivate.ciphertext, 'base64')),
    privateDecipher.final()
  ]).toString('utf8');

  const envelope = JSON.parse(fs.readFileSync('.secure-admin-provisioning/payload.enc.json', 'utf8'));
  if (envelope.schema !== 'fpt-admin-demo-payload-envelope-v1') throw new Error('Unexpected payload envelope');
  const dataKey = crypto.privateDecrypt({
    key: privatePem,
    oaepHash: 'sha256',
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
  }, Buffer.from(envelope.wrappedKey, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

const payload = decryptPayload();
if (payload.schema !== 'fpt-admin-demo-provision-v1') throw new Error('Unexpected provisioning schema');
if (payload.expectedStudentCount !== 9 || !Array.isArray(payload.students) || payload.students.length !== 9) throw new Error('Expected exactly nine accounts');

const validPassword = value => {
  const s = String(value || '');
  return s.length === 4 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s);
};
const clean = value => String(value ?? '').trim();
const normalise = value => clean(value).toLowerCase();
const seen = new Set();
const records = [];
for (const source of payload.students) {
  const portalUserId = clean(source.portalUserId);
  const id = normalise(portalUserId);
  if (!id || seen.has(id)) throw new Error('Duplicate or blank Portal User ID');
  seen.add(id);
  if (!validPassword(source.p) || !validPassword(source.answerPassword)) throw new Error(`Credential format invalid for ${id}`);
  if (normalise(source.status) !== 'active') throw new Error(`Account must be active for ${id}`);
  if (clean(source.expires) !== '') throw new Error(`Account must be permanent for ${id}`);
  if (!Array.isArray(source.fullLibraries) || !Array.isArray(source.batches) || !Array.isArray(source.blockedLessons)) throw new Error(`Invalid access shape for ${id}`);
  if (!source.manualAccess || !Array.isArray(source.manualAccess.coreLessons) || !Array.isArray(source.manualAccess.vrLessons) || !Array.isArray(source.manualAccess.specialBuckets)) throw new Error(`Invalid manual access shape for ${id}`);
  if (id.startsWith('admintrial') && (source.p !== 'Csl1' || source.answerPassword !== 'Csl1')) throw new Error(`Admin demo credentials must be fixed for ${id}`);
  records.push({ key: `user:${id}`, value: JSON.stringify(source) });
}
if ([...seen].filter(id => id.startsWith('admintrial')).length !== 7) throw new Error('Expected exactly seven AdminTrial owner-demo accounts');

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
  if (!response.ok || !body?.success) throw new Error(`Cloudflare request failed for ${pathname}: HTTP ${response.status}`);
  return body;
}
function binding(settings, name, type = null) {
  return settings?.result?.bindings?.find(item => item?.name === name && (!type || item?.type === type)) || null;
}
function plain(settings, name) {
  return String(binding(settings, name, 'plain_text')?.text || '');
}
function secretNames(settings) {
  return (settings?.result?.bindings || []).filter(item => String(item?.type || '').toLowerCase().includes('secret')).map(item => String(item.name)).sort();
}
function tomlString(value) {
  return JSON.stringify(String(value ?? ''));
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function kvBulkGet(namespaceId, keys) {
  const body = await cf(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk/get`, {
    method: 'POST', body: JSON.stringify({ keys, type: 'text', withMetadata: false })
  });
  return body?.result?.values || {};
}
async function kvBulkPut(namespaceId, pairs) {
  const body = await cf(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`, { method: 'PUT', body: JSON.stringify(pairs) });
  if ((body?.result?.unsuccessful_keys || []).length) throw new Error('KV bulk update reported unsuccessful keys');
}
async function kvDelete(namespaceId, key) {
  await cf(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`, { method: 'DELETE' });
}
function sameJson(a, b) {
  try { return JSON.stringify(JSON.parse(String(a))) === JSON.stringify(JSON.parse(String(b))); }
  catch { return false; }
}

const settingsBefore = await cf(`/accounts/${accountId}/workers/scripts/${workerName}/settings`);
if (plain(settingsBefore, 'ENVIRONMENT').toLowerCase() !== 'production') throw new Error('Worker is not production');
if (plain(settingsBefore, 'STUDENT_LOGIN_ENABLED').toLowerCase() !== 'true') throw new Error('Student login is not enabled');
const prodAllowBinding = binding(settingsBefore, 'PROD_LOGIN_ALLOWLIST', 'plain_text');
if (!prodAllowBinding) throw new Error('PROD_LOGIN_ALLOWLIST is not an editable plain-text production binding');
const studentsId = String(binding(settingsBefore, 'STUDENTS_KV', 'kv_namespace')?.namespace_id || '');
const lessonsId = String(binding(settingsBefore, 'LESSONS_KV', 'kv_namespace')?.namespace_id || '');
const databaseId = String(binding(settingsBefore, 'DB', 'd1')?.id || '');
const r2Bucket = String(binding(settingsBefore, 'MATERIALS_R2', 'r2_bucket')?.bucket_name || '');
if (!studentsId || !lessonsId || !databaseId || !r2Bucket) throw new Error('Required production bindings are missing');
const secretsBefore = secretNames(settingsBefore);

const keys = records.map(item => item.key);
const existing = await kvBulkGet(studentsId, keys);
if (Object.keys(existing).length) throw new Error('One or more requested account keys already exist; refusing to overwrite');

const oldAllow = plain(settingsBefore, 'PROD_LOGIN_ALLOWLIST').split(',').map(normalise).filter(Boolean);
const requestedIds = payload.students.map(student => normalise(student.portalUserId));
const newAllow = [...new Set([...oldAllow, ...requestedIds])];
const oldAllowText = oldAllow.join(',');
const newAllowText = newAllow.join(',');

function writeRuntimeConfig(path, allowText) {
  const text = [
    `name = ${tomlString(workerName)}`,
    `main = "src/index-phase19-access.js"`,
    `compatibility_date = "2026-08-20"`,
    `keep_vars = true`,
    `workers_dev = true`,
    ``,
    `[vars]`,
    `ENVIRONMENT = ${tomlString(plain(settingsBefore, 'ENVIRONMENT'))}`,
    `ALLOWED_ORIGINS = ${tomlString(plain(settingsBefore, 'ALLOWED_ORIGINS'))}`,
    `DEV_LOGIN_ALLOWLIST = ${tomlString(plain(settingsBefore, 'DEV_LOGIN_ALLOWLIST'))}`,
    `PROD_LOGIN_ALLOWLIST = ${tomlString(allowText)}`,
    `STUDENT_LOGIN_ENABLED = ${tomlString(plain(settingsBefore, 'STUDENT_LOGIN_ENABLED'))}`,
    ``,
    `[[kv_namespaces]]`, `binding = "STUDENTS_KV"`, `id = ${tomlString(studentsId)}`,
    ``, `[[kv_namespaces]]`, `binding = "LESSONS_KV"`, `id = ${tomlString(lessonsId)}`,
    ``, `[[r2_buckets]]`, `binding = "MATERIALS_R2"`, `bucket_name = ${tomlString(r2Bucket)}`,
    ``, `[[d1_databases]]`, `binding = "DB"`, `database_name = "fpt_portal_v2_db"`, `database_id = ${tomlString(databaseId)}`,
    ``
  ].join('\n');
  fs.writeFileSync(path, text, { mode: 0o600 });
}
function deploy(config, message) {
  execFileSync('npx', ['--yes', `wrangler@${wranglerVersion}`, 'deploy', '--config', config, '--keep-vars', '--message', message], {
    stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8'
  });
}

const prodConfig = '/tmp/fpt-admin-demo-production.toml';
const rollbackConfig = '/tmp/fpt-admin-demo-rollback.toml';
writeRuntimeConfig(prodConfig, newAllowText);
writeRuntimeConfig(rollbackConfig, oldAllowText);
let kvWritten = false;
let workerDeployed = false;

async function login(student, windowToken) {
  const response = await fetch(`${workerBase}/api/v1/student/auth/login`, {
    method: 'POST',
    headers: { Origin: productionOrigin, 'Content-Type': 'application/json', 'X-FPT-Window-Token': windowToken },
    body: JSON.stringify({ username: student.portalUserId, password: student.p })
  });
  if (response.status !== 200) throw new Error(`Login failed for ${normalise(student.portalUserId)} with HTTP ${response.status}`);
  const body = await response.json();
  if (!body?.ok) throw new Error(`Login body invalid for ${normalise(student.portalUserId)}`);
  const rawCookie = response.headers.get('set-cookie') || '';
  const cookie = rawCookie.split(';')[0];
  if (!cookie.startsWith('fpt_v2_session=')) throw new Error(`Session cookie missing for ${normalise(student.portalUserId)}`);
  return cookie;
}
async function home(cookie, windowToken) {
  const response = await fetch(`${workerBase}/api/v1/student/home`, {
    headers: { Origin: productionOrigin, Cookie: cookie, 'X-FPT-Window-Token': windowToken }
  });
  if (!response.ok) throw new Error(`Home request failed with HTTP ${response.status}`);
  return response.json();
}
function findView(homeBody, viewId) {
  for (const subject of homeBody?.subjects || []) {
    const found = (subject?.views || []).find(view => String(view?.viewId) === viewId);
    if (found) return found;
  }
  return null;
}
const libraryViews = {
  MATHS_Y2_FULL: 'maths-year2', MATHS_Y3_FULL: 'maths-year3', MATHS_Y4_FULL: 'maths-year4', MATHS_Y5_FULL: 'maths-year5', MATHS_Y6_FULL: 'maths-year6',
  MATHS_L1_FULL: 'maths-level1', MATHS_L2_FULL: 'maths-level2', MATHS_L3_FULL: 'maths-level3',
  ENGLISH_Y2_FULL: 'english-year2', ENGLISH_Y3_FULL: 'english-year3', ENGLISH_Y4_FULL: 'english-year4', ENGLISH_Y5_FULL: 'english-year5', ENGLISH_Y6_FULL: 'english-year6',
  ENGLISH_Y4_11PLUS_FULL: 'english-year4-11plus', ENGLISH_Y5_11PLUS_FULL: 'english-year5-11plus'
};

try {
  await kvBulkPut(studentsId, records);
  kvWritten = true;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const actual = await kvBulkGet(studentsId, keys);
    const ok = keys.every(key => Object.prototype.hasOwnProperty.call(actual, key) && sameJson(actual[key], records.find(item => item.key === key).value));
    if (ok) break;
    if (attempt === 17) throw new Error('Students KV did not reach verified parity in time');
    await sleep(3000);
  }

  deploy(prodConfig, 'Authorise and provision owner demo accounts');
  workerDeployed = true;
  await sleep(5000);

  const settingsAfter = await cf(`/accounts/${accountId}/workers/scripts/${workerName}/settings`);
  const afterAllow = new Set(plain(settingsAfter, 'PROD_LOGIN_ALLOWLIST').split(',').map(normalise).filter(Boolean));
  for (const id of requestedIds) if (!afterAllow.has(id)) throw new Error('Production login allowlist verification failed');
  if (String(binding(settingsAfter, 'STUDENTS_KV', 'kv_namespace')?.namespace_id || '') !== studentsId) throw new Error('Students KV binding changed');
  if (String(binding(settingsAfter, 'LESSONS_KV', 'kv_namespace')?.namespace_id || '') !== lessonsId) throw new Error('Lessons KV binding changed');
  if (String(binding(settingsAfter, 'DB', 'd1')?.id || '') !== databaseId) throw new Error('D1 binding changed');
  if (String(binding(settingsAfter, 'MATERIALS_R2', 'r2_bucket')?.bucket_name || '') !== r2Bucket) throw new Error('R2 binding changed');
  if (JSON.stringify(secretNames(settingsAfter)) !== JSON.stringify(secretsBefore)) throw new Error('Worker secret bindings changed');

  for (const student of payload.students) {
    const windowToken = crypto.randomBytes(24).toString('base64url');
    const cookie = await login(student, windowToken);
    const homeBody = await home(cookie, windowToken);
    const libraries = Array.isArray(student.fullLibraries) ? student.fullLibraries : [];
    if (!libraries.length) {
      const openTotal = (homeBody?.subjects || []).flatMap(subject => subject?.views || []).reduce((sum, view) => sum + Number(view?.openLessonCount || 0), 0);
      if (openTotal !== 0) throw new Error(`No-access account unexpectedly has open lessons: ${normalise(student.portalUserId)}`);
    } else {
      for (const library of libraries) {
        const viewId = libraryViews[library];
        if (!viewId) throw new Error(`Unknown Full Library ${library}`);
        const view = findView(homeBody, viewId);
        if (!view || Number(view.visibleLessonCount || 0) <= 0 || Number(view.openLessonCount || 0) !== Number(view.visibleLessonCount || 0)) {
          throw new Error(`Full Library verification failed for ${normalise(student.portalUserId)} ${viewId}`);
        }
      }
    }
    if (normalise(student.portalUserId).startsWith('admintrial')) {
      const secondWindow = crypto.randomBytes(24).toString('base64url');
      await login(student, secondWindow);
    }
  }

  console.log('ADMIN_DEMO_PROVISION_PASS users=9 kv=verified allowlist=verified login=verified admin_relogin=verified');
} catch (error) {
  console.error(`Admin demo provisioning failed: ${error.message}`);
  if (workerDeployed) {
    try { deploy(rollbackConfig, 'Rollback failed owner demo authorisation'); } catch { console.error('WARNING: Worker allowlist rollback failed'); }
  }
  if (kvWritten) {
    try { for (const key of keys) await kvDelete(studentsId, key); } catch { console.error('WARNING: Student KV rollback failed'); }
  }
  throw error;
} finally {
  for (const path of [prodConfig, rollbackConfig]) { try { fs.rmSync(path, { force: true }); } catch {} }
}
