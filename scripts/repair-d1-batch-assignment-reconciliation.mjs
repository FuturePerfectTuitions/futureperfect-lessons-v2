import fs from 'node:fs';
import crypto from 'node:crypto';

const clean = v => String(v ?? '').trim();
const norm = v => clean(v).toLowerCase();
const d10 = v => /^\d{4}-\d{2}-\d{2}/.test(clean(v)) ? clean(v).slice(0, 10) : '';
const authority = JSON.parse(fs.readFileSync('audit/d1-assignment-roster-authority.json', 'utf8'));
const asOf = clean(authority.asOfDate || process.env.AS_OF_DATE || '2026-09-15');
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const legacy = clean(process.env.LEGACY_WORKER || 'fpt-portal-v2-worker');
const browser = clean(process.env.BROWSER_WORKER || 'fpt-portal-v2-rebuild-browser-prod');
const student = clean(process.env.STUDENT_WORKER || 'fpt-portal-v2-rebuild-student-prod');
const host = clean(process.env.PROD_HOST || 'lessons.futureperfect.education').toLowerCase();
if (!token || !account) throw new Error('Cloudflare credentials are required.');

const apiBase = 'https://api.cloudflare.com/client/v4';
const auth = { Authorization: `Bearer ${token}` };
const reportPath = '/tmp/d1-assignment-production-repair.json';
const rollbackPath = '/tmp/d1-assignment-production-repair-rollback.sql';
const privateSnapshotPath = '/tmp/d1-assignment-pre-repair-private.json';

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { ...auth, ...(options.headers || {}) }
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { response, text, body };
}

async function cf(path, options = {}) {
  const out = await request(path, options);
  if (!out.response.ok || out.body?.success !== true) {
    throw new Error(`Cloudflare request failed ${out.response.status}: ${path}: ${clean(out.body?.errors?.[0]?.message || out.text).slice(0, 220)}`);
  }
  return out.body.result;
}

async function d1(dbId, sql, params = []) {
  const result = await cf(`/accounts/${account}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params })
  });
  const first = Array.isArray(result) ? result[0] : result;
  return { rows: Array.isArray(first?.results) ? first.results : [], meta: first?.meta || {} };
}

async function kvJson(namespaceId, key) {
  const out = await request(`/accounts/${account}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`);
  if (out.response.status === 404) return null;
  if (!out.response.ok) throw new Error(`KV read failed ${out.response.status}`);
  try { return JSON.parse(out.text); } catch { return null; }
}

async function workerSettings(name) {
  return await cf(`/accounts/${account}/workers/scripts/${encodeURIComponent(name)}/settings`);
}

async function activeVersion(name) {
  const result = await cf(`/accounts/${account}/workers/scripts/${encodeURIComponent(name)}/deployments`);
  const deployments = Array.isArray(result?.deployments) ? result.deployments : Array.isArray(result) ? result : [];
  const versions = Array.isArray(deployments[0]?.versions) ? deployments[0].versions : [];
  return clean((versions.find(v => Number(v.percentage || 0) === 100) || versions[0])?.version_id);
}

async function topology() {
  const zones = await cf(`/zones?per_page=50&account.id=${encodeURIComponent(account)}`);
  const zone = (zones || []).filter(z => host === clean(z.name).toLowerCase() || host.endsWith(`.${clean(z.name).toLowerCase()}`)).sort((a, b) => clean(b.name).length - clean(a.name).length)[0];
  if (!zone) throw new Error('Production zone could not be resolved.');
  const routes = await cf(`/zones/${zone.id}/workers/routes`);
  const hostRoutes = (routes || []).filter(r => clean(r.pattern).toLowerCase().includes(host));
  if (hostRoutes.length !== 1 || clean(hostRoutes[0].pattern).toLowerCase() !== `${host}/*` || clean(hostRoutes[0].script) !== browser) {
    throw new Error('Production Browser route drift detected.');
  }
  const settings = await workerSettings(browser);
  const services = (settings?.bindings || []).filter(b => clean(b.type) === 'service');
  if (services.length !== 1 || clean(services[0].service) !== student) throw new Error('Browser service-binding topology drift detected.');
  if ((settings?.bindings || []).some(b => /admin/i.test(`${clean(b.name)} ${clean(b.service)}`))) throw new Error('Forbidden Browser Admin/AdminOps binding detected.');
  return {
    routePattern: clean(hostRoutes[0].pattern),
    routeScript: clean(hostRoutes[0].script),
    browserVersion: await activeVersion(browser),
    studentVersion: await activeVersion(student),
    legacyVersion: await activeVersion(legacy),
    browserServiceBinding: { name: clean(services[0].name), service: clean(services[0].service) }
  };
}

function activeRange(fromValue, toValue, date) {
  const from = d10(fromValue);
  const to = d10(toValue);
  return (!from || from <= date) && (!to || date < to);
}

function profileCurrent(profile) {
  if (!profile) return false;
  const status = norm(profile.accountStatus || profile.status || 'active');
  const expires = d10(profile.expiresOn || profile.expires);
  return !['inactive', 'disabled', 'expired', 'withdrawn'].includes(status) && (!expires || expires > asOf);
}

function essentialRows(rows) {
  return rows.map(r => ({
    assignmentId: Number(r.assignment_id),
    user: norm(r.portal_user_id_norm),
    batch: clean(r.batch_key),
    from: d10(r.effective_from),
    to: d10(r.effective_to),
    createdAt: clean(r.created_at),
    updatedAt: clean(r.updated_at)
  })).sort((a, b) => a.assignmentId - b.assignmentId);
}

function digestRows(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(essentialRows(rows))).digest('hex');
}

const legacySettings = await workerSettings(legacy);
const binding = name => (legacySettings?.bindings || []).find(item => clean(item.name) === name) || {};
const dbId = clean(binding('DB').database_id || binding('DB').id);
const studentsNs = clean(binding('STUDENTS_KV').namespace_id);
if (!dbId || !studentsNs) throw new Error('Production D1/STUDENTS_KV bindings could not be resolved.');

const beforeTopology = await topology();
const [definitionsResult, assignmentsResult] = await Promise.all([
  d1(dbId, `SELECT batch_key, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions ORDER BY batch_key`),
  d1(dbId, `SELECT assignment_id, portal_user_id_norm, batch_key, effective_from, effective_to, created_at, updated_at FROM student_batch_assignments ORDER BY assignment_id`)
]);
const definitions = definitionsResult.rows;
const beforeRows = assignmentsResult.rows;
fs.writeFileSync(privateSnapshotPath, JSON.stringify(beforeRows, null, 2) + '\n', { mode: 0o600 });

const memberships = Array.isArray(authority.memberships) ? authority.memberships : [];
if (memberships.length !== 25) throw new Error(`Authority drift: expected 25 memberships, found ${memberships.length}.`);
const expected = new Map(memberships.map(m => [`${norm(m.portalUserId)}|${clean(m.batchKey)}`, {
  user: norm(m.portalUserId),
  batch: clean(m.batchKey),
  from: d10(m.effectiveFrom),
  subject: norm(m.subject)
}]));
if (expected.size !== 25) throw new Error('Authority contains duplicate user/batch pairs.');

const byPair = new Map();
for (const row of beforeRows) {
  const key = `${norm(row.portal_user_id_norm)}|${clean(row.batch_key)}`;
  if (!byPair.has(key)) byPair.set(key, []);
  byPair.get(key).push(row);
}

if (beforeRows.length !== 4) throw new Error(`Precondition drift: expected exactly 4 D1 assignment rows before repair, found ${beforeRows.length}.`);
for (const row of beforeRows) {
  const key = `${norm(row.portal_user_id_norm)}|${clean(row.batch_key)}`;
  const e = expected.get(key);
  if (!e || d10(row.effective_from) !== e.from || d10(row.effective_to)) throw new Error('Precondition drift in one of the four existing assignment rows.');
}

const missing = memberships.map(m => expected.get(`${norm(m.portalUserId)}|${clean(m.batchKey)}`)).filter(e => (byPair.get(`${e.user}|${e.batch}`) || []).length === 0);
if (missing.length !== 21) throw new Error(`Precondition drift: expected exactly 21 missing assignments, found ${missing.length}.`);

const definitionByBatch = new Map(definitions.map(d => [clean(d.batch_key), d]));
const profileCache = new Map();
for (const target of missing) {
  const def = definitionByBatch.get(target.batch);
  if (!def) throw new Error('A target batch definition is missing.');
  if (norm(def.subject) !== target.subject) throw new Error('A target batch definition subject differs from authority.');
  if (!activeRange(def.active_from, def.active_to, asOf)) throw new Error('A target batch definition is not active as of the repair date.');
  if (d10(def.active_from) !== target.from) throw new Error('A target batch active-from date differs from the authoritative membership start date.');
  let profile = profileCache.get(target.user);
  if (profile === undefined) {
    profile = await kvJson(studentsNs, `user:${target.user}`);
    profileCache.set(target.user, profile);
  }
  if (!profileCurrent(profile)) throw new Error('A target portal profile is missing or not current.');
}

const safeReport = {
  marker: 'D1_BATCH_ASSIGNMENT_PRODUCTION_REPAIR',
  status: 'IN_PROGRESS',
  startedAt: new Date().toISOString(),
  authorityMemberships: memberships.length,
  beforeAssignmentRows: beforeRows.length,
  plannedInsertCount: missing.length,
  beforeSnapshotSha256: digestRows(beforeRows),
  beforeTopology,
  mutation: 'INSERT_ONLY',
  updates: 0,
  deletes: 0,
  rollbackPerformed: false
};

let insertedIds = [];
let mutationStarted = false;
const stamp = new Date().toISOString();

async function rollbackInsertedRows() {
  const current = (await d1(dbId, `SELECT assignment_id, portal_user_id_norm, batch_key, effective_from, effective_to, created_at, updated_at FROM student_batch_assignments ORDER BY assignment_id`)).rows;
  const targetSet = new Set(missing.map(x => `${x.user}|${x.batch}|${x.from}`));
  const candidates = current.filter(r => clean(r.created_at) === stamp && targetSet.has(`${norm(r.portal_user_id_norm)}|${clean(r.batch_key)}|${d10(r.effective_from)}`));
  const ids = candidates.map(r => Number(r.assignment_id)).filter(Number.isInteger);
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    await d1(dbId, `DELETE FROM student_batch_assignments WHERE assignment_id IN (${placeholders}) AND created_at = ?`, [...ids, stamp]);
  }
  const restored = (await d1(dbId, `SELECT assignment_id, portal_user_id_norm, batch_key, effective_from, effective_to, created_at, updated_at FROM student_batch_assignments ORDER BY assignment_id`)).rows;
  if (JSON.stringify(essentialRows(restored)) !== JSON.stringify(essentialRows(beforeRows))) throw new Error('Rollback verification failed: assignment table does not match pre-repair snapshot.');
  insertedIds = ids;
  safeReport.rollbackPerformed = true;
  safeReport.rollbackDeletedCount = ids.length;
}

try {
  const valueSql = missing.map(() => '(?,?,?,?,?)').join(',');
  const params = [];
  for (const target of missing) params.push(target.user, target.batch, target.from, stamp, stamp);
  mutationStarted = true;
  await d1(dbId, `INSERT INTO student_batch_assignments (portal_user_id_norm, batch_key, effective_from, created_at, updated_at) VALUES ${valueSql}`, params);

  const afterRows = (await d1(dbId, `SELECT assignment_id, portal_user_id_norm, batch_key, effective_from, effective_to, created_at, updated_at FROM student_batch_assignments ORDER BY assignment_id`)).rows;
  if (afterRows.length !== 25) throw new Error(`Postcondition failed: expected 25 D1 assignment rows, found ${afterRows.length}.`);

  const seen = new Set();
  for (const row of afterRows) {
    const key = `${norm(row.portal_user_id_norm)}|${clean(row.batch_key)}`;
    const e = expected.get(key);
    if (!e) throw new Error('Postcondition failed: D1 contains an assignment outside the authority roster.');
    if (seen.has(key)) throw new Error('Postcondition failed: duplicate user/batch assignment detected.');
    seen.add(key);
    if (d10(row.effective_from) !== e.from || d10(row.effective_to)) throw new Error('Postcondition failed: assignment date/window differs from authority.');
  }
  if (seen.size !== 25) throw new Error('Postcondition failed: not all authority memberships are present exactly once.');

  const targetSet = new Set(missing.map(x => `${x.user}|${x.batch}|${x.from}`));
  const inserted = afterRows.filter(r => clean(r.created_at) === stamp && targetSet.has(`${norm(r.portal_user_id_norm)}|${clean(r.batch_key)}|${d10(r.effective_from)}`));
  if (inserted.length !== 21) throw new Error(`Postcondition failed: expected 21 rows stamped by this repair, found ${inserted.length}.`);
  insertedIds = inserted.map(r => Number(r.assignment_id)).sort((a, b) => a - b);

  const afterTopology = await topology();
  if (JSON.stringify(afterTopology) !== JSON.stringify(beforeTopology)) throw new Error('Public Worker topology or active versions changed during the production data repair.');

  const rollbackSql = `-- Emergency rollback for D1 batch-assignment repair ${stamp}\n-- Removes only assignment IDs inserted by this exact repair run.\nDELETE FROM student_batch_assignments WHERE assignment_id IN (${insertedIds.join(',')}) AND created_at = '${stamp.replaceAll("'", "''")}';\n`;
  fs.writeFileSync(rollbackPath, rollbackSql, { mode: 0o600 });

  safeReport.status = 'PASS';
  safeReport.completedAt = new Date().toISOString();
  safeReport.insertedCount = inserted.length;
  safeReport.afterAssignmentRows = afterRows.length;
  safeReport.afterSnapshotSha256 = digestRows(afterRows);
  safeReport.afterTopology = afterTopology;
  safeReport.rollbackSqlPrepared = true;
  fs.writeFileSync(reportPath, JSON.stringify(safeReport, null, 2) + '\n');
  console.log(JSON.stringify({ marker: 'D1_BATCH_ASSIGNMENT_PRODUCTION_REPAIR_PASS', insertedCount: 21, finalAssignmentCount: 25, topologyUnchanged: true }, null, 2));
} catch (error) {
  safeReport.status = 'FAIL';
  safeReport.error = clean(error?.message || error);
  if (mutationStarted) {
    try {
      await rollbackInsertedRows();
    } catch (rollbackError) {
      safeReport.rollbackError = clean(rollbackError?.message || rollbackError);
    }
  }
  safeReport.completedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(safeReport, null, 2) + '\n');
  throw error;
}
