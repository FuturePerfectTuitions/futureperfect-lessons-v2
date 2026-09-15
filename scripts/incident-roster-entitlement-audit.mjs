import fs from 'node:fs';

const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const account = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const worker = String(process.env.LEGACY_WORKER || 'fpt-portal-v2-worker').trim();
const asOf = String(process.env.AS_OF_DATE || '2026-09-15').trim();
if (!token || !account) throw new Error('Cloudflare credentials required.');

const roster = JSON.parse(fs.readFileSync('incident/roster-authority-2026-09-11.json', 'utf8'));
const memberships = Array.isArray(roster.memberships) ? roster.memberships : [];
const realUsers = [...new Set(memberships.map(x => String(x.portalUserId || '').trim().toLowerCase()).filter(Boolean))].sort();

const base = 'https://api.cloudflare.com/client/v4';
const headers = { Authorization: `Bearer ${token}` };
const clean = v => String(v ?? '').trim();
const norm = v => clean(v).toLowerCase();
const d10 = v => /^\d{4}-\d{2}-\d{2}/.test(clean(v)) ? clean(v).slice(0, 10) : '';
const pair = (u, l) => `${norm(u)}|${clean(l)}`;

async function api(path, options = {}) {
  const r = await fetch(`${base}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const b = await r.json().catch(() => null);
  if (!r.ok || b?.success !== true) throw new Error(`Cloudflare read failed ${r.status}: ${path}`);
  return b;
}
async function sql(db, statement) {
  const s = clean(statement);
  if (!/^(SELECT|PRAGMA|WITH)\b/i.test(s) || /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM)\b/i.test(s)) throw new Error('Read-only SQL guard rejected statement.');
  const b = await api(`/accounts/${account}/d1/database/${db}/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql: s }) });
  const x = Array.isArray(b.result) ? b.result[0] : b.result;
  return Array.isArray(x?.results) ? x.results : [];
}
async function kvGet(ns, key) {
  const r = await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`, { headers });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`KV read failed ${r.status}: ${key}`);
  return r.json().catch(() => null);
}
async function kvKeys(ns, prefix) {
  const out = []; let cursor = '';
  do {
    const q = new URLSearchParams({ prefix, limit: '1000' }); if (cursor) q.set('cursor', cursor);
    const b = await api(`/accounts/${account}/storage/kv/namespaces/${ns}/keys?${q}`);
    out.push(...(b.result || []).map(x => clean(x.name)).filter(Boolean)); cursor = clean(b.result_info?.cursor);
  } while (cursor);
  return out;
}
function isEnglish11(def) { return norm(def?.subject) === 'english' && norm(def?.stream) === '11plus'; }

const settings = (await api(`/accounts/${account}/workers/scripts/${worker}/settings`)).result;
const binding = n => (settings?.bindings || []).find(x => x.name === n) || {};
const studentsNs = clean(binding('STUDENTS_KV').namespace_id);
const db = clean(binding('DB').database_id || binding('DB').id);
if (!studentsNs || !db) throw new Error('Production bindings unresolved.');

const [defs, releases, ents, assignments] = await Promise.all([
  sql(db, 'SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions'),
  sql(db, 'SELECT batch_key, lesson_id, lesson_date, first_completed_at, last_confirmed_at FROM batch_lesson_releases'),
  sql(db, 'SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source, first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date FROM lesson_entitlements'),
  sql(db, 'SELECT portal_user_id_norm, batch_key, effective_from, effective_to FROM student_batch_assignments')
]);
const defBy = new Map(defs.map(d => [clean(d.batch_key), d]));
const relBy = new Map();
for (const r of releases) { const k = clean(r.batch_key); const a = relBy.get(k) || []; a.push(r); relBy.set(k, a); }
const entBy = new Map(ents.map(e => [pair(e.portal_user_id_norm, e.lesson_id), e]));
const assignmentKeys = new Set(assignments.map(a => `${norm(a.portal_user_id_norm)}|${clean(a.batch_key)}|${d10(a.effective_from)}`));

const profiles = new Map();
for (const k of await kvKeys(studentsNs, 'user:')) {
  const id = norm(k.replace(/^user:/, ''));
  const u = await kvGet(studentsNs, k);
  if (u) profiles.set(id, u);
}

const configProblems = [];
for (const m of memberships) {
  const def = defBy.get(clean(m.batchKey));
  if (!def) configProblems.push({ portalUserId: norm(m.portalUserId), batchKey: clean(m.batchKey), problem: 'BATCH_DEFINITION_MISSING' });
  else if (norm(def.subject) !== norm(m.subject)) configProblems.push({ portalUserId: norm(m.portalUserId), batchKey: clean(m.batchKey), problem: 'ROSTER_SUBJECT_DIFFERS_FROM_BATCH_DEFINITION', rosterSubject: norm(m.subject), definitionSubject: norm(def.subject) });
}

const expected = new Map();
for (const m of memberships) {
  const u = norm(m.portalUserId), batch = clean(m.batchKey), start = d10(m.effectiveFrom), def = defBy.get(batch);
  for (const r of relBy.get(batch) || []) {
    const lessonDate = d10(r.lesson_date) || d10(r.first_completed_at) || d10(r.last_confirmed_at);
    if (start && lessonDate && lessonDate < start) continue;
    const k = pair(u, r.lesson_id);
    const x = expected.get(k) || { portalUserId: u, lessonId: clean(r.lesson_id), expectedCore: true, expectedVr: false, reasons: [], batches: [], lessonDates: [] };
    if (def && isEnglish11(def)) x.expectedVr = true;
    x.reasons.push('ROSTER_MEMBERSHIP_PLUS_BATCH_RELEASE'); x.batches.push(batch); if (lessonDate) x.lessonDates.push(lessonDate);
    expected.set(k, x);
  }
}

const missingOrWrong = [];
for (const x of expected.values()) {
  const e = entBy.get(pair(x.portalUserId, x.lessonId));
  const core = Number(e?.core_access || 0) === 1;
  const vr = Number(e?.vr_access || 0) === 1;
  if (!e || !core || (x.expectedVr && !vr)) {
    missingOrWrong.push({
      portalUserId: x.portalUserId, lessonId: x.lessonId,
      expected: { core: true, vr: x.expectedVr },
      stored: e ? { core, vr, source: clean(e.source), sourceBatch: clean(e.source_batch_code), sourceLessonDate: d10(e.source_lesson_date), firstGrantedAt: clean(e.first_granted_at), lastConfirmedAt: clean(e.last_confirmed_at) } : { exists: false },
      batches: [...new Set(x.batches)].sort(), lessonDates: [...new Set(x.lessonDates)].sort()
    });
  }
}
missingOrWrong.sort((a,b) => a.portalUserId.localeCompare(b.portalUserId) || a.lessonId.localeCompare(b.lessonId));

const profileProblems = [];
for (const u of realUsers) {
  const p = profiles.get(u);
  if (!p) { profileProblems.push({ portalUserId: u, problem: 'PROFILE_MISSING' }); continue; }
  const shouldVr = memberships.some(m => norm(m.portalUserId) === u && isEnglish11(defBy.get(clean(m.batchKey))));
  if (shouldVr && p.vrEligible !== true) profileProblems.push({ portalUserId: u, problem: 'VR_ELIGIBLE_FALSE_DESPITE_ENGLISH11_ROSTER' });
}

const assignmentProblems = [];
for (const m of memberships) {
  const exact = `${norm(m.portalUserId)}|${clean(m.batchKey)}|${d10(m.effectiveFrom)}`;
  if (!assignmentKeys.has(exact)) assignmentProblems.push({ portalUserId: norm(m.portalUserId), batchKey: clean(m.batchKey), effectiveFrom: d10(m.effectiveFrom), problem: 'D1_BATCH_ASSIGNMENT_MISSING_OR_DIFFERENT' });
}

// Independent source-batch semantic check catches bad VR rows even where assignment data is absent.
const sourceBatchVrProblems = [];
for (const e of ents) {
  const def = defBy.get(clean(e.source_batch_code));
  if (!realUsers.includes(norm(e.portal_user_id_norm)) || !isEnglish11(def)) continue;
  if (Number(e.vr_access || 0) !== 1) sourceBatchVrProblems.push({ portalUserId: norm(e.portal_user_id_norm), lessonId: clean(e.lesson_id), sourceBatch: clean(e.source_batch_code), storedVr: false, expectedVr: true, sourceLessonDate: d10(e.source_lesson_date) });
}
sourceBatchVrProblems.sort((a,b) => a.portalUserId.localeCompare(b.portalUserId) || a.lessonId.localeCompare(b.lessonId));

const demoUsers = [...profiles.keys()].filter(id => /^demo/i.test(id)).sort();
const byUser = {};
for (const row of missingOrWrong) {
  byUser[row.portalUserId] ||= { portalUserId: row.portalUserId, defectRows: 0, lessonIds: [] };
  byUser[row.portalUserId].defectRows += 1; byUser[row.portalUserId].lessonIds.push(row.lessonId);
}

const report = {
  marker: 'FPT_ROSTER_BACKED_ENTITLEMENT_AUDIT', readOnly: true, asOfDate: asOf,
  authority: { source: roster.source, sourceModifiedAt: roster.sourceModifiedAt, realUsers: realUsers.length, memberships: memberships.length },
  population: { productionProfiles: profiles.size, rosterBackedRealUsers: realUsers.length, demoUsers: demoUsers.length, demoIds: demoUsers },
  releaseCoverage: { configuredBatches: [...new Set(memberships.map(m => clean(m.batchKey)))].length, batchReleaseRowsRelevant: [...expected.values()].length },
  defects: {
    configProblems,
    entitlementRows: missingOrWrong,
    entitlementAffectedUsers: Object.values(byUser).sort((a,b) => a.portalUserId.localeCompare(b.portalUserId)),
    profileProblems,
    assignmentProblems,
    sourceBatchVrProblems
  }
};
report.status = configProblems.length || missingOrWrong.length || profileProblems.length || assignmentProblems.length || sourceBatchVrProblems.length ? 'FAIL' : 'PASS';
fs.writeFileSync('/tmp/roster-entitlement-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ marker: report.marker, status: report.status, readOnly: true, authority: report.authority, population: report.population, releaseCoverage: report.releaseCoverage, entitlementDefectRows: missingOrWrong.length, entitlementAffectedUsers: report.defects.entitlementAffectedUsers, profileProblems, assignmentProblemCount: assignmentProblems.length, sourceBatchVrProblems }, null, 2));
if (report.status === 'FAIL') process.exitCode = 2;
