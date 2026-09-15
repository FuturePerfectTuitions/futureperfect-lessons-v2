import fs from 'node:fs';
import crypto from 'node:crypto';

const clean = v => String(v ?? '').trim();
const norm = v => clean(v).toLowerCase();
const d10 = v => /^\d{4}-\d{2}-\d{2}/.test(clean(v)) ? clean(v).slice(0, 10) : '';
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const legacy = clean(process.env.LEGACY_WORKER || 'fpt-portal-v2-worker');
const browser = clean(process.env.BROWSER_WORKER || 'fpt-portal-v2-rebuild-browser-prod');
const student = clean(process.env.STUDENT_WORKER || 'fpt-portal-v2-rebuild-student-prod');
const host = clean(process.env.PROD_HOST || 'lessons.futureperfect.education').toLowerCase();
if (!token || !account) throw new Error('Cloudflare credentials are required.');

const audit = JSON.parse(fs.readFileSync('/tmp/d1-assignment-reconciliation.json', 'utf8'));
if (audit?.readOnly !== true || audit?.status !== 'PASS') throw new Error('Fresh read-only audit evidence is required before repair.');
const counts = audit.counts || {};
if (Number(counts.rosterMemberships) !== 25 || Number(counts.exactMatches) !== 4 || Number(counts.missingAssignments) !== 21 || Number(counts.dateOrWindowMismatches) !== 0 || Number(counts.extraD1Assignments) !== 0 || Number(counts.safeToAdd) !== 21 || Number(counts.unproven) !== 0 || Number(counts.reviewBeforeChange) !== 0) {
  throw new Error('Fresh audit preconditions differ from the approved 4-existing / 21-missing state.');
}
const targets = (audit.classifications || []).filter(x => x.classification === 'SAFE_TO_ADD_FROM_AUTHORITATIVE_ROSTER').map(x => ({
  user: norm(x.portalUserId),
  batch: clean(x.batchKey),
  from: d10(x.rosterEffectiveFrom)
}));
if (targets.length !== 21 || targets.some(x => !x.user || !x.batch || !x.from)) throw new Error('Fresh audit did not yield exactly 21 complete safe-to-add targets.');

const apiBase = 'https://api.cloudflare.com/client/v4';
const auth = { Authorization: `Bearer ${token}` };
const reportPath = '/tmp/d1-assignment-production-repair-v2.json';
const rollbackPath = '/tmp/d1-assignment-production-repair-v2-rollback.sql';

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, { ...options, headers: { ...auth, ...(options.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { response, text, body };
}
async function cf(path, options = {}) {
  const out = await request(path, options);
  if (!out.response.ok || out.body?.success !== true) throw new Error(`Cloudflare request failed ${out.response.status}: ${path}: ${clean(out.body?.errors?.[0]?.message || out.text).slice(0, 180)}`);
  return out.body.result;
}
async function d1(dbId, sql, params = []) {
  const result = await cf(`/accounts/${account}/d1/database/${dbId}/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql, params }) });
  const first = Array.isArray(result) ? result[0] : result;
  return { rows: Array.isArray(first?.results) ? first.results : [], meta: first?.meta || {} };
}
async function settings(name) { return await cf(`/accounts/${account}/workers/scripts/${encodeURIComponent(name)}/settings`); }
async function activeVersion(name) {
  const result = await cf(`/accounts/${account}/workers/scripts/${encodeURIComponent(name)}/deployments`);
  const deployments = Array.isArray(result?.deployments) ? result.deployments : Array.isArray(result) ? result : [];
  const versions = Array.isArray(deployments[0]?.versions) ? deployments[0].versions : [];
  return clean((versions.find(v => Number(v.percentage || 0) === 100) || versions[0])?.version_id);
}
async function topology() {
  const zones = await cf(`/zones?per_page=50&account.id=${encodeURIComponent(account)}`);
  const zone = (zones || []).filter(z => host === clean(z.name).toLowerCase() || host.endsWith(`.${clean(z.name).toLowerCase()}`)).sort((a, b) => clean(b.name).length - clean(a.name).length)[0];
  if (!zone) throw new Error('Production zone unresolved.');
  const routes = await cf(`/zones/${zone.id}/workers/routes`);
  const hostRoutes = (routes || []).filter(r => clean(r.pattern).toLowerCase().includes(host));
  if (hostRoutes.length !== 1 || clean(hostRoutes[0].pattern).toLowerCase() !== `${host}/*` || clean(hostRoutes[0].script) !== browser) throw new Error('Production Browser route drift detected.');
  const browserSettings = await settings(browser);
  const services = (browserSettings?.bindings || []).filter(b => clean(b.type) === 'service');
  if (services.length !== 1 || clean(services[0].service) !== student) throw new Error('Browser service-binding topology drift detected.');
  if ((browserSettings?.bindings || []).some(b => /admin/i.test(`${clean(b.name)} ${clean(b.service)}`))) throw new Error('Forbidden Browser Admin/AdminOps binding detected.');
  return {
    routePattern: clean(hostRoutes[0].pattern),
    routeScript: clean(hostRoutes[0].script),
    browserVersion: await activeVersion(browser),
    studentVersion: await activeVersion(student),
    legacyVersion: await activeVersion(legacy),
    browserServiceBinding: { name: clean(services[0].name), service: clean(services[0].service) }
  };
}
function essential(rows) {
  return rows.map(r => ({ id: Number(r.assignment_id), user: norm(r.portal_user_id_norm), batch: clean(r.batch_key), from: d10(r.effective_from), to: d10(r.effective_to), createdAt: clean(r.created_at), updatedAt: clean(r.updated_at) })).sort((a, b) => a.id - b.id);
}
function digest(rows) { return crypto.createHash('sha256').update(JSON.stringify(essential(rows))).digest('hex'); }

const legacySettings = await settings(legacy);
const binding = name => (legacySettings?.bindings || []).find(x => clean(x.name) === name) || {};
const dbId = clean(binding('DB').database_id || binding('DB').id);
if (!dbId) throw new Error('Production D1 binding unresolved.');

const beforeTopology = await topology();
const beforeRows = (await d1(dbId, 'SELECT assignment_id, portal_user_id_norm, batch_key, effective_from, effective_to, created_at, updated_at FROM student_batch_assignments ORDER BY assignment_id')).rows;
if (beforeRows.length !== 4) throw new Error(`Immediate pre-mutation guard expected 4 rows, found ${beforeRows.length}.`);
const targetPairs = new Set(targets.map(x => `${x.user}|${x.batch}|${x.from}`));
for (const row of beforeRows) {
  const classification = (audit.classifications || []).find(x => norm(x.portalUserId) === norm(row.portal_user_id_norm) && clean(x.batchKey) === clean(row.batch_key));
  if (!classification || classification.discrepancy !== 'MATCH' || d10(row.effective_from) !== d10(classification.rosterEffectiveFrom) || d10(row.effective_to)) throw new Error('Immediate pre-mutation guard found drift in an existing assignment.');
}
for (const target of targets) {
  const existing = (await d1(dbId, 'SELECT assignment_id FROM student_batch_assignments WHERE portal_user_id_norm = ? AND batch_key = ?', [target.user, target.batch])).rows;
  if (existing.length !== 0) throw new Error('A repair target appeared after the fresh audit; aborting without mutation.');
}

const stamp = new Date().toISOString();
const safe = {
  marker: 'D1_BATCH_ASSIGNMENT_PRODUCTION_REPAIR_V2',
  status: 'IN_PROGRESS',
  startedAt: stamp,
  freshAuditCounts: counts,
  beforeAssignmentRows: beforeRows.length,
  beforeSnapshotSha256: digest(beforeRows),
  plannedInsertCount: targets.length,
  insertMode: 'SEQUENTIAL_VARIABLE_SAFE_WITH_EXACT_ROLLBACK',
  beforeTopology,
  rollbackPerformed: false
};
let mutationStarted = false;
let insertedIds = [];

async function rollback() {
  const current = (await d1(dbId, 'SELECT assignment_id, portal_user_id_norm, batch_key, effective_from, effective_to, created_at, updated_at FROM student_batch_assignments ORDER BY assignment_id')).rows;
  const candidates = current.filter(r => clean(r.created_at) === stamp && targetPairs.has(`${norm(r.portal_user_id_norm)}|${clean(r.batch_key)}|${d10(r.effective_from)}`));
  const ids = candidates.map(r => Number(r.assignment_id)).filter(Number.isInteger);
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    await d1(dbId, `DELETE FROM student_batch_assignments WHERE assignment_id IN (${placeholders}) AND created_at = ?`, [...ids, stamp]);
  }
  const restored = (await d1(dbId, 'SELECT assignment_id, portal_user_id_norm, batch_key, effective_from, effective_to, created_at, updated_at FROM student_batch_assignments ORDER BY assignment_id')).rows;
  if (JSON.stringify(essential(restored)) !== JSON.stringify(essential(beforeRows))) throw new Error('Exact rollback verification failed.');
  insertedIds = ids.sort((a, b) => a - b);
  safe.rollbackPerformed = true;
  safe.rollbackDeletedCount = ids.length;
}

try {
  mutationStarted = true;
  for (const target of targets) {
    await d1(dbId, 'INSERT INTO student_batch_assignments (portal_user_id_norm, batch_key, effective_from, created_at, updated_at) VALUES (?,?,?,?,?)', [target.user, target.batch, target.from, stamp, stamp]);
  }

  const afterRows = (await d1(dbId, 'SELECT assignment_id, portal_user_id_norm, batch_key, effective_from, effective_to, created_at, updated_at FROM student_batch_assignments ORDER BY assignment_id')).rows;
  if (afterRows.length !== 25) throw new Error(`Postcondition expected 25 rows, found ${afterRows.length}.`);
  const expectedPairs = new Map((audit.classifications || []).map(x => [`${norm(x.portalUserId)}|${clean(x.batchKey)}`, d10(x.rosterEffectiveFrom)]));
  const seen = new Set();
  for (const row of afterRows) {
    const key = `${norm(row.portal_user_id_norm)}|${clean(row.batch_key)}`;
    if (!expectedPairs.has(key) || seen.has(key) || d10(row.effective_from) !== expectedPairs.get(key) || d10(row.effective_to)) throw new Error('Postcondition found an extra, duplicate, or date-mismatched assignment.');
    seen.add(key);
  }
  if (seen.size !== 25) throw new Error('Postcondition did not resolve all 25 authoritative memberships.');
  const inserted = afterRows.filter(r => clean(r.created_at) === stamp && targetPairs.has(`${norm(r.portal_user_id_norm)}|${clean(r.batch_key)}|${d10(r.effective_from)}`));
  if (inserted.length !== 21) throw new Error(`Postcondition expected 21 stamped inserts, found ${inserted.length}.`);
  insertedIds = inserted.map(r => Number(r.assignment_id)).sort((a, b) => a - b);

  const afterTopology = await topology();
  if (JSON.stringify(afterTopology) !== JSON.stringify(beforeTopology)) throw new Error('Public Worker topology or active versions changed during the data repair.');

  fs.writeFileSync(rollbackPath, `-- Emergency rollback for repair ${stamp}\n-- Removes only rows inserted by this exact repair run.\nDELETE FROM student_batch_assignments WHERE assignment_id IN (${insertedIds.join(',')}) AND created_at = '${stamp.replaceAll("'", "''")}';\n`, { mode: 0o600 });
  safe.status = 'PASS';
  safe.completedAt = new Date().toISOString();
  safe.insertedCount = 21;
  safe.afterAssignmentRows = 25;
  safe.afterSnapshotSha256 = digest(afterRows);
  safe.afterTopology = afterTopology;
  safe.rollbackSqlPrepared = true;
  fs.writeFileSync(reportPath, JSON.stringify(safe, null, 2) + '\n');
  console.log(JSON.stringify({ marker: 'D1_BATCH_ASSIGNMENT_PRODUCTION_REPAIR_V2_PASS', insertedCount: 21, finalAssignmentCount: 25, topologyUnchanged: true }, null, 2));
} catch (error) {
  safe.status = 'FAIL';
  safe.error = clean(error?.message || error);
  if (mutationStarted) {
    try { await rollback(); } catch (rollbackError) { safe.rollbackError = clean(rollbackError?.message || rollbackError); }
  }
  safe.completedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(safe, null, 2) + '\n');
  throw error;
}
