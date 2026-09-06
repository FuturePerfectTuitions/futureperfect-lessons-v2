import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const workerName = String(process.env.WORKER_NAME || 'fpt-portal-v2-worker').trim();
const workerBase = String(process.env.WORKER_BASE || 'https://fpt-portal-v2-worker.futureperfectlessons.workers.dev').trim();
const wranglerVersion = String(process.env.WRANGLER_VERSION || '4.125.0').trim();
const productionOrigin = 'https://lessons.futureperfect.education';
const devOrigin = 'https://futureperfecttuitions.github.io';

if (!accountId || !token) throw new Error('Cloudflare credentials are required.');

const payload = JSON.parse(fs.readFileSync('/tmp/fpt-provision-payload.json', 'utf8'));
const pairs = JSON.parse(fs.readFileSync('/tmp/fpt-provision-bulk.json', 'utf8'));
const meta = JSON.parse(fs.readFileSync('/tmp/fpt-provision-meta.json', 'utf8'));
const expectedKeys = pairs.map(item => item.key).sort();
const expectedKeySet = new Set(expectedKeys);
const productionStudentIds = payload.students.map(item => String(item.portalUserId || '').trim().toLowerCase()).sort();
const productionLoginAllowlist = productionStudentIds.join(',');
const preservedNonStudentUserKeys = new Set(['user:admin']);

if (pairs.length !== 13 || payload.students.length !== 13 || new Set(productionStudentIds).size !== 13) {
  throw new Error('Expected exactly 13 unique production users.');
}
if (productionStudentIds.includes('admin')) throw new Error('Admin must never be part of the student production allowlist.');

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
    throw new Error(`Cloudflare request failed: ${pathname} HTTP ${response.status}`);
  }
  return body;
}

function binding(settings, name, type = null) {
  return settings?.result?.bindings?.find(item => item?.name === name && (!type || item?.type === type)) || null;
}

function plain(settings, name) {
  return String(binding(settings, name, 'plain_text')?.text || '');
}

function secretNames(settings) {
  return (settings?.result?.bindings || [])
    .filter(item => item?.type === 'secret_text')
    .map(item => String(item.name))
    .sort();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeConfig({ environment, origins, login, prodAllowlist, studentsId, lessonsId, databaseId, r2Bucket }, path) {
  const content = `name = "fpt-portal-v2-worker"\nmain = "src/index-phase17.js"\ncompatibility_date = "2026-08-20"\nkeep_vars = true\nworkers_dev = true\n\n[vars]\nENVIRONMENT = "${environment}"\nALLOWED_ORIGINS = "${origins}"\nDEV_LOGIN_ALLOWLIST = ""\nPROD_LOGIN_ALLOWLIST = "${prodAllowlist}"\nSTUDENT_LOGIN_ENABLED = "${login}"\n\n[[kv_namespaces]]\nbinding = "STUDENTS_KV"\nid = "${studentsId}"\n\n[[kv_namespaces]]\nbinding = "LESSONS_KV"\nid = "${lessonsId}"\n\n[[r2_buckets]]\nbinding = "MATERIALS_R2"\nbucket_name = "${r2Bucket}"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "fpt_portal_v2_db"\ndatabase_id = "${databaseId}"\n`;
  fs.writeFileSync(path, content, { mode: 0o600 });
}

function wranglerDeploy(config, message, dryRun = false) {
  const args = ['--yes', `wrangler@${wranglerVersion}`, 'deploy', '--config', config];
  if (dryRun) args.push('--dry-run', '--outdir', '/tmp/fpt-prod-build');
  else args.push('--keep-vars', '--message', message);
  execFileSync('npx', args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
}

async function kvBulkGet(namespaceId, keys) {
  if (!keys.length) return {};
  const body = await cf(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk/get`, {
    method: 'POST',
    body: JSON.stringify({ keys, type: 'text', withMetadata: false })
  });
  return body?.result?.values || {};
}

async function kvBulkPut(namespaceId, putPairs) {
  if (!putPairs.length) return;
  const body = await cf(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`, {
    method: 'PUT',
    body: JSON.stringify(putPairs)
  });
  if ((body?.result?.unsuccessful_keys || []).length) throw new Error('KV bulk update reported unsuccessful keys.');
}

async function kvDelete(namespaceId, key) {
  await cf(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

async function listUserKeys(namespaceId) {
  const body = await cf(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys?prefix=user%3A&limit=1000`);
  return (body.result || []).map(item => String(item.name)).filter(name => name.startsWith('user:')).sort();
}

function sameJsonString(a, b) {
  try {
    return JSON.stringify(JSON.parse(String(a))) === JSON.stringify(JSON.parse(String(b)));
  } catch {
    return false;
  }
}

async function waitForKv(namespaceId) {
  const expected = new Map(pairs.map(item => [item.key, item.value]));
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    const actual = await kvBulkGet(namespaceId, expectedKeys);
    let ok = Object.keys(actual).length === 13;
    if (ok) {
      for (const [key, value] of expected) {
        if (!sameJsonString(actual[key], value)) { ok = false; break; }
      }
    }
    if (ok) return;
    await sleep(5000);
  }
  throw new Error('Student KV provisioning did not reach exact verified parity in time.');
}

async function login(id) {
  const student = payload.students.find(item => String(item.portalUserId).toLowerCase() === id);
  if (!student) throw new Error(`Missing payload student ${id}`);
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    const response = await fetch(`${workerBase}/api/v1/student/auth/login`, {
      method: 'POST',
      headers: { Origin: productionOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: id, password: student.p })
    });
    lastStatus = response.status;
    if (response.status === 200) {
      if (response.headers.get('access-control-allow-origin') !== productionOrigin) throw new Error(`CORS mismatch for ${id}`);
      const body = await response.json();
      if (!body?.ok) throw new Error(`Login body invalid for ${id}`);
      const setCookie = response.headers.get('set-cookie') || '';
      const cookie = setCookie.split(';')[0];
      if (!cookie.startsWith('fpt_v2_session=')) throw new Error(`Session cookie missing for ${id}`);
      return cookie;
    }
    if (response.status !== 401) throw new Error(`Unexpected login status ${response.status} for ${id}`);
    await sleep(5000);
  }
  throw new Error(`Login did not become available for ${id}; last status ${lastStatus}`);
}

async function rejectedLogin(username) {
  const response = await fetch(`${workerBase}/api/v1/student/auth/login`, {
    method: 'POST',
    headers: { Origin: productionOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Aa1x' })
  });
  if (response.status !== 401) throw new Error(`Disallowed login ${username} did not fail closed.`);
  const body = await response.json().catch(() => null);
  if (body?.error !== 'INVALID_LOGIN') throw new Error(`Disallowed login ${username} returned unexpected body.`);
}

async function home(cookie) {
  const response = await fetch(`${workerBase}/api/v1/student/home`, {
    headers: { Origin: productionOrigin, Cookie: cookie }
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

const settingsBefore = await cf(`/accounts/${accountId}/workers/scripts/${workerName}/settings`);
if (plain(settingsBefore, 'ENVIRONMENT') !== 'development') throw new Error('Worker is not at the expected development pre-state.');
const loginBefore = plain(settingsBefore, 'STUDENT_LOGIN_ENABLED').toLowerCase();
if (loginBefore && loginBefore !== 'false') throw new Error('Normal student login is already enabled.');

const studentsId = String(binding(settingsBefore, 'STUDENTS_KV', 'kv_namespace')?.namespace_id || '');
const lessonsId = String(binding(settingsBefore, 'LESSONS_KV', 'kv_namespace')?.namespace_id || '');
const databaseId = String(binding(settingsBefore, 'DB', 'd1')?.id || '');
const r2Bucket = String(binding(settingsBefore, 'MATERIALS_R2', 'r2_bucket')?.bucket_name || '');
if (!studentsId || !lessonsId || !databaseId) throw new Error('Required Cloudflare bindings are missing.');
if (r2Bucket !== 'fpt-materials-dev') throw new Error(`Unexpected R2 bucket ${r2Bucket}`);

const secretsBefore = secretNames(settingsBefore);
if (!secretsBefore.includes('EXCEL_SYNC_TOKEN')) throw new Error('EXCEL_SYNC_TOKEN secret is missing.');

const existingKeys = await listUserKeys(studentsId);
const unexpected = existingKeys.filter(key => !expectedKeySet.has(key) && !preservedNonStudentUserKeys.has(key));
if (unexpected.length) {
  console.error(`STOP: unexpected STUDENTS_KV user keys: ${unexpected.join(', ')}`);
  process.exit(2);
}
const preservedFound = existingKeys.filter(key => preservedNonStudentUserKeys.has(key));
if (preservedFound.length !== 1 || preservedFound[0] !== 'user:admin') throw new Error('Expected preserved non-student admin record was not found exactly once.');
const existingTargetKeys = existingKeys.filter(key => expectedKeySet.has(key));
const existingValues = await kvBulkGet(studentsId, existingTargetKeys);
const newlyCreated = expectedKeys.filter(key => !existingTargetKeys.includes(key));
let kvWritten = false;
let workerDeployed = false;

const prodConfig = 'worker/wrangler.production.runtime.toml';
const rollbackConfig = 'worker/wrangler.production.rollback.toml';
makeConfig({
  environment: 'production',
  origins: `${devOrigin},${productionOrigin}`,
  login: 'true',
  prodAllowlist: productionLoginAllowlist,
  studentsId, lessonsId, databaseId, r2Bucket
}, prodConfig);
makeConfig({
  environment: 'development',
  origins: devOrigin,
  login: 'false',
  prodAllowlist: '',
  studentsId, lessonsId, databaseId, r2Bucket
}, rollbackConfig);

try {
  wranglerDeploy(prodConfig, 'Portal V2 production dry run', true);

  await kvBulkPut(studentsId, pairs);
  kvWritten = true;
  await waitForKv(studentsId);

  wranglerDeploy(prodConfig, 'Productionise Portal V2 and enable authorised student login', false);
  workerDeployed = true;
  await sleep(4000);

  const settingsAfter = await cf(`/accounts/${accountId}/workers/scripts/${workerName}/settings`);
  if (plain(settingsAfter, 'ENVIRONMENT') !== 'production') throw new Error('Production ENVIRONMENT binding was not applied.');
  if (plain(settingsAfter, 'STUDENT_LOGIN_ENABLED').toLowerCase() !== 'true') throw new Error('Student login was not enabled.');
  if (!plain(settingsAfter, 'ALLOWED_ORIGINS').split(',').map(x => x.trim()).includes(productionOrigin)) throw new Error('Production origin is not allowed.');
  const deployedAllowlist = plain(settingsAfter, 'PROD_LOGIN_ALLOWLIST').split(',').map(x => x.trim().toLowerCase()).filter(Boolean).sort();
  if (JSON.stringify(deployedAllowlist) !== JSON.stringify(productionStudentIds)) throw new Error('Production login allowlist mismatch.');
  if (deployedAllowlist.includes('admin')) throw new Error('Admin appeared in the production student allowlist.');
  if (String(binding(settingsAfter, 'STUDENTS_KV', 'kv_namespace')?.namespace_id || '') !== studentsId) throw new Error('Students KV binding changed.');
  if (String(binding(settingsAfter, 'LESSONS_KV', 'kv_namespace')?.namespace_id || '') !== lessonsId) throw new Error('Lessons KV binding changed.');
  if (String(binding(settingsAfter, 'DB', 'd1')?.id || '') !== databaseId) throw new Error('D1 binding changed.');
  if (String(binding(settingsAfter, 'MATERIALS_R2', 'r2_bucket')?.bucket_name || '') !== r2Bucket) throw new Error('R2 binding changed.');
  if (JSON.stringify(secretNames(settingsAfter)) !== JSON.stringify(secretsBefore)) throw new Error('Worker secret binding names changed.');

  const abiCookie = await login('abi3007');
  const abiHome = await home(abiCookie);
  const abiExpected = meta.students.find(item => item.id === 'abi3007')?.expectedViews.find(view => view.viewId === 'english-year3')?.expectedOpen;
  const abiView = findView(abiHome, 'english-year3');
  if (!abiView || Number(abiView.openLessonCount) !== Number(abiExpected)) throw new Error('Abigail Year 3 English full access verification failed.');

  const annCookie = await login('ann3009');
  const annHome = await home(annCookie);
  const annMeta = meta.students.find(item => item.id === 'ann3009');
  for (const expected of annMeta.expectedViews) {
    const view = findView(annHome, expected.viewId);
    if (!view || Number(view.openLessonCount) !== Number(expected.expectedOpen)) throw new Error(`Annisha access verification failed for ${expected.viewId}`);
  }

  const reiCookie = await login('rei0710');
  const reiHome = await home(reiCookie);
  const openTotal = (reiHome?.subjects || []).flatMap(subject => subject?.views || []).reduce((sum, view) => sum + Number(view?.openLessonCount || 0), 0);
  if (openTotal !== 0) throw new Error('Reina should have zero lesson access.');

  await rejectedLogin('__not_a_student__');
  await rejectedLogin('admin');

  console.log('PORTAL_V2_PRODUCTION_PROVISIONING_PASS students=13 login=allowlisted admin=preserved-and-blocked origin=lessons.futureperfect.education');
} catch (error) {
  console.error(`Production provisioning failed: ${error.message}`);
  if (workerDeployed) {
    try { wranglerDeploy(rollbackConfig, 'Rollback failed Portal V2 production provisioning', false); }
    catch { console.error('WARNING: Worker rollback command failed.'); }
  }
  if (kvWritten) {
    try {
      const restorePairs = Object.entries(existingValues).map(([key, value]) => ({ key, value: String(value) }));
      await kvBulkPut(studentsId, restorePairs);
      for (const key of newlyCreated) await kvDelete(studentsId, key);
    } catch {
      console.error('WARNING: Student KV rollback failed.');
    }
  }
  throw error;
} finally {
  for (const path of ['/tmp/fpt-provision-payload.json', '/tmp/fpt-provision-bulk.json']) {
    try { fs.rmSync(path, { force: true }); } catch {}
  }
}
