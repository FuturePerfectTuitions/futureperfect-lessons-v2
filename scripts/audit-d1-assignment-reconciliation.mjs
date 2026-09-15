import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const clean = v => String(v ?? '').trim();
const norm = v => clean(v).toLowerCase();
const d10 = v => /^\d{4}-\d{2}-\d{2}/.test(clean(v)) ? clean(v).slice(0, 10) : '';
const authority = JSON.parse(fs.readFileSync('audit/d1-assignment-roster-authority.json', 'utf8'));
const asOf = clean(authority.asOfDate || '2026-09-15');
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const worker = clean(process.env.LEGACY_WORKER || 'fpt-portal-v2-worker');
if (!token || !account) throw new Error('Cloudflare credentials are required for the read-only audit.');

const apiBase = 'https://api.cloudflare.com/client/v4';
const headers = { Authorization: `Bearer ${token}` };

async function cf(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    throw new Error(`Cloudflare request failed ${response.status}: ${path}`);
  }
  return body.result;
}

async function sql(dbId, statement) {
  const text = clean(statement);
  if (!/^(SELECT|PRAGMA|WITH)\b/i.test(text) || /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|ATTACH|DETACH)\b/i.test(text)) {
    throw new Error(`Read-only SQL guard rejected statement: ${text.slice(0, 80)}`);
  }
  const result = await cf(`/accounts/${account}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql: text })
  });
  const first = Array.isArray(result) ? result[0] : result;
  return Array.isArray(first?.results) ? first.results : [];
}

async function kvJson(namespaceId, key) {
  const response = await fetch(
    `${apiBase}/accounts/${account}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    { headers }
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`KV read failed ${response.status}: ${key}`);
  return response.json().catch(() => null);
}

function activeWindow(row, date) {
  const from = d10(row?.effective_from || row?.active_from);
  const to = d10(row?.effective_to || row?.active_to);
  return (!from || from <= date) && (!to || date < to);
}

function profileCurrent(profile) {
  if (!profile) return false;
  const status = norm(profile.accountStatus || profile.status || 'active');
  const expires = d10(profile.expiresOn || profile.expires);
  return !['inactive', 'disabled', 'expired', 'withdrawn'].includes(status) && (!expires || expires > asOf);
}

const settings = await cf(`/accounts/${account}/workers/scripts/${encodeURIComponent(worker)}/settings`);
const binding = name => (settings?.bindings || []).find(item => item.name === name) || {};
const dbId = clean(binding('DB').database_id || binding('DB').id);
const studentsNs = clean(binding('STUDENTS_KV').namespace_id);
if (!dbId || !studentsNs) throw new Error('Production DB/STUDENTS_KV bindings could not be resolved.');

const [schema, definitions, assignments, entitlementEvidence, prelessonEvidence, releaseEvidence] = await Promise.all([
  sql(dbId, 'PRAGMA table_info(student_batch_assignments)'),
  sql(dbId, `SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to, created_at, updated_at FROM batch_definitions ORDER BY batch_key`),
  sql(dbId, `SELECT assignment_id, portal_user_id_norm, batch_key, effective_from, effective_to, created_at, updated_at FROM student_batch_assignments ORDER BY portal_user_id_norm, batch_key, effective_from`),
  sql(dbId, `SELECT portal_user_id_norm, source_batch_code AS batch_key, MIN(source_lesson_date) AS min_lesson_date, MAX(source_lesson_date) AS max_lesson_date, COUNT(*) AS entitlement_count, SUM(CASE WHEN vr_access = 1 THEN 1 ELSE 0 END) AS vr_rows FROM lesson_entitlements WHERE source_batch_code IS NOT NULL AND trim(source_batch_code) <> '' GROUP BY portal_user_id_norm, source_batch_code ORDER BY portal_user_id_norm, source_batch_code`),
  sql(dbId, `SELECT portal_user_id_norm, batch_key, MIN(lesson_date) AS min_lesson_date, MAX(lesson_date) AS max_lesson_date, COUNT(*) AS prelesson_count FROM online_prelesson_entitlements GROUP BY portal_user_id_norm, batch_key ORDER BY portal_user_id_norm, batch_key`),
  sql(dbId, `SELECT batch_key, COUNT(*) AS release_count, MIN(lesson_date) AS min_lesson_date, MAX(lesson_date) AS max_lesson_date FROM batch_lesson_releases GROUP BY batch_key ORDER BY batch_key`)
]);

const rosterUsers = [...new Set(authority.memberships.map(m => norm(m.portalUserId)))].sort();
const profiles = new Map();
for (const userId of rosterUsers) {
  const profile = await kvJson(studentsNs, `user:${userId}`);
  profiles.set(userId, {
    exists: Boolean(profile),
    current: profileCurrent(profile),
    expires: d10(profile?.expiresOn || profile?.expires),
    status: norm(profile?.accountStatus || profile?.status || (profile ? 'active' : 'missing'))
  });
}

const defBy = new Map(definitions.map(row => [clean(row.batch_key), row]));
const assignmentByPair = new Map();
for (const row of assignments) {
  const key = `${norm(row.portal_user_id_norm)}|${clean(row.batch_key)}`;
  if (!assignmentByPair.has(key)) assignmentByPair.set(key, []);
  assignmentByPair.get(key).push(row);
}
const entByPair = new Map(entitlementEvidence.map(row => [`${norm(row.portal_user_id_norm)}|${clean(row.batch_key)}`, row]));
const preByPair = new Map(prelessonEvidence.map(row => [`${norm(row.portal_user_id_norm)}|${clean(row.batch_key)}`, row]));
const releaseByBatch = new Map(releaseEvidence.map(row => [clean(row.batch_key), row]));

let sourceRefsText = '';
try {
  sourceRefsText = execFileSync('git', [
    'grep', '-n', '-I', '-E',
    'student_batch_assignments|batch_definitions|batch_lesson_releases',
    '--', 'worker', 'rebuild', 'tests', '.github'
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
} catch (error) {
  if (Number(error?.status) !== 1) throw error;
}
const sourceRefs = sourceRefsText.split('\n').map(line => line.trim()).filter(Boolean);
const assignmentRefs = sourceRefs.filter(line => line.includes('student_batch_assignments'));
const assignmentRuntimeRefs = assignmentRefs.filter(line => {
  const path = line.split(':', 1)[0];
  return (path.startsWith('worker/src/') || path.startsWith('rebuild/')) && !path.includes('/migrations/');
});
const rebuiltStudentAssignmentRefs = assignmentRefs.filter(line => line.startsWith('rebuild/student/'));

const classifications = [];
for (const membership of authority.memberships) {
  const userId = norm(membership.portalUserId);
  const batchKey = clean(membership.batchKey);
  const rosterFrom = d10(membership.effectiveFrom);
  const pairKey = `${userId}|${batchKey}`;
  const rows = assignmentByPair.get(pairKey) || [];
  const activeRows = rows.filter(row => activeWindow(row, asOf));
  const exact = activeRows.find(row => d10(row.effective_from) === rosterFrom && !d10(row.effective_to));
  const definition = defBy.get(batchKey) || null;
  const profile = profiles.get(userId) || { exists:false, current:false, status:'missing', expires:'' };
  const entitlement = entByPair.get(pairKey) || null;
  const prelesson = preByPair.get(pairKey) || null;
  const batchRelease = releaseByBatch.get(batchKey) || null;

  let discrepancy = 'MATCH';
  let classification = 'NO_ACTION';
  let rationale = 'D1 contains the same current user/batch assignment with the authoritative effective-from date.';

  if (!exact) {
    if (rows.length === 0) {
      discrepancy = 'MISSING_ASSIGNMENT';
      const configMatches = definition && norm(definition.subject) === norm(membership.subject) && activeWindow(definition, asOf);
      if (configMatches && profile.exists && profile.current) {
        classification = 'SAFE_TO_ADD_FROM_AUTHORITATIVE_ROSTER';
        rationale = 'Authoritative roster says the membership is current; the configured batch and current portal profile both exist. Adding the missing assignment would be additive and does not itself grant lesson entitlement.';
      } else {
        classification = 'UNPROVEN_DO_NOT_CHANGE';
        rationale = 'The roster/D1 discrepancy exists, but batch configuration or current-profile prerequisites are not fully satisfied.';
      }
    } else {
      discrepancy = 'DATE_OR_WINDOW_MISMATCH';
      classification = 'REVIEW_BEFORE_CHANGE';
      rationale = 'D1 has this user/batch pair, but its effective date/window differs from the authoritative current roster. Rewriting historical dates could affect temporal semantics, so no automatic correction is justified.';
    }
  }

  classifications.push({
    portalUserId: userId,
    batchKey,
    subject: norm(membership.subject),
    rosterEffectiveFrom: rosterFrom,
    discrepancy,
    classification,
    rationale,
    d1Rows: rows.map(row => ({
      assignmentId: row.assignment_id,
      effectiveFrom: d10(row.effective_from),
      effectiveTo: d10(row.effective_to),
      createdAt: clean(row.created_at),
      updatedAt: clean(row.updated_at)
    })),
    batchDefinition: definition ? {
      subject: norm(definition.subject),
      schoolYear: Number(definition.school_year),
      stream: norm(definition.stream),
      mathsLevel: definition.maths_level == null ? null : Number(definition.maths_level),
      activeFrom: d10(definition.active_from),
      activeTo: d10(definition.active_to),
      activeAsOf: activeWindow(definition, asOf)
    } : null,
    profile,
    corroboration: {
      lessonEntitlements: entitlement ? {
        count: Number(entitlement.entitlement_count || 0),
        minLessonDate: d10(entitlement.min_lesson_date),
        maxLessonDate: d10(entitlement.max_lesson_date),
        vrRows: Number(entitlement.vr_rows || 0)
      } : null,
      onlinePrelesson: prelesson ? {
        count: Number(prelesson.prelesson_count || 0),
        minLessonDate: d10(prelesson.min_lesson_date),
        maxLessonDate: d10(prelesson.max_lesson_date)
      } : null,
      batchRelease: batchRelease ? {
        count: Number(batchRelease.release_count || 0),
        minLessonDate: d10(batchRelease.min_lesson_date),
        maxLessonDate: d10(batchRelease.max_lesson_date)
      } : null
    }
  });
}

const rosterPairSet = new Set(authority.memberships.map(m => `${norm(m.portalUserId)}|${clean(m.batchKey)}`));
const extraAssignments = assignments
  .filter(row => !rosterPairSet.has(`${norm(row.portal_user_id_norm)}|${clean(row.batch_key)}`))
  .map(row => ({
    assignmentId: row.assignment_id,
    portalUserId: norm(row.portal_user_id_norm),
    batchKey: clean(row.batch_key),
    effectiveFrom: d10(row.effective_from),
    effectiveTo: d10(row.effective_to),
    activeAsOf: activeWindow(row, asOf),
    classification: activeWindow(row, asOf) ? 'CURRENT_NOT_IN_ROSTER_REVIEW_NO_DELETE' : 'HISTORICAL_RETAIN'
  }));

const counts = {
  rosterMemberships: classifications.length,
  exactMatches: classifications.filter(x => x.discrepancy === 'MATCH').length,
  missingAssignments: classifications.filter(x => x.discrepancy === 'MISSING_ASSIGNMENT').length,
  dateOrWindowMismatches: classifications.filter(x => x.discrepancy === 'DATE_OR_WINDOW_MISMATCH').length,
  safeToAdd: classifications.filter(x => x.classification === 'SAFE_TO_ADD_FROM_AUTHORITATIVE_ROSTER').length,
  reviewBeforeChange: classifications.filter(x => x.classification === 'REVIEW_BEFORE_CHANGE').length,
  unproven: classifications.filter(x => x.classification === 'UNPROVEN_DO_NOT_CHANGE').length,
  d1AssignmentRowsTotal: assignments.length,
  extraD1Assignments: extraAssignments.length,
  extraCurrentD1Assignments: extraAssignments.filter(x => x.activeAsOf).length,
  extraHistoricalD1Assignments: extraAssignments.filter(x => !x.activeAsOf).length,
  configuredBatches: definitions.length,
  batchesWithReleaseRows: releaseEvidence.length,
  sourceAssignmentReferences: assignmentRefs.length,
  runtimeAssignmentReferences: assignmentRuntimeRefs.length,
  rebuiltStudentAssignmentReferences: rebuiltStudentAssignmentRefs.length
};

const report = {
  marker: 'D1_BATCH_ASSIGNMENT_RECONCILIATION_READ_ONLY',
  status: 'PASS',
  readOnly: true,
  asOfDate: asOf,
  rosterSource: authority.source,
  rosterSourceModifiedAt: authority.sourceModifiedAt,
  productionWorker: worker,
  schemaColumns: schema.map(row => clean(row.name)),
  counts,
  runtimeReachability: {
    assignmentRuntimeReferences: assignmentRuntimeRefs,
    rebuiltStudentAssignmentReferences: rebuiltStudentAssignmentRefs,
    conclusion: rebuiltStudentAssignmentRefs.length === 0
      ? 'No direct student_batch_assignments reference exists in the rebuilt Student source tree.'
      : 'The rebuilt Student source tree contains student_batch_assignments references; runtime impact requires review.'
  },
  classifications,
  extraAssignments
};

fs.writeFileSync('/tmp/d1-assignment-reconciliation.json', JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync('/tmp/d1-assignment-source-refs.txt', sourceRefsText || '(no references found)\n');
fs.writeFileSync('/tmp/d1-assignment-current-rows.json', JSON.stringify(assignments, null, 2) + '\n');

const md = [];
md.push('# D1 Student Batch Assignment Reconciliation — Read-only');
md.push('');
md.push(`Status: **PASS — read-only audit completed**`);
md.push(`As of: ${asOf}`);
md.push(`Roster authority: ${authority.source} (modified ${authority.sourceModifiedAt})`);
md.push('');
md.push('## Summary');
md.push('');
md.push(`- Authoritative roster memberships: ${counts.rosterMemberships}`);
md.push(`- Exact D1 matches: ${counts.exactMatches}`);
md.push(`- Missing D1 assignments: ${counts.missingAssignments}`);
md.push(`- Date/window mismatches: ${counts.dateOrWindowMismatches}`);
md.push(`- Classified safe-to-add from roster authority: ${counts.safeToAdd}`);
md.push(`- Classified review-before-change: ${counts.reviewBeforeChange}`);
md.push(`- Classified unproven/do-not-change: ${counts.unproven}`);
md.push(`- Extra D1 assignment rows outside the current roster: ${counts.extraD1Assignments} (${counts.extraCurrentD1Assignments} current, ${counts.extraHistoricalD1Assignments} historical)`);
md.push(`- Direct references in rebuilt Student source: ${counts.rebuiltStudentAssignmentReferences}`);
md.push('');
md.push('The migration authority explicitly states that `student_batch_assignments` records batch membership windows and does **not itself grant Student + Lesson entitlement**. This audit therefore treats missing rows as data-integrity drift, not as proof of current portal entitlement failure.');
md.push('');
md.push('## Roster membership classification');
md.push('');
md.push('| Portal ID | Batch | From | D1 state | Classification | Entitlement corroboration |');
md.push('|---|---|---:|---|---|---|');
for (const row of classifications) {
  const ent = row.corroboration.lessonEntitlements;
  const pre = row.corroboration.onlinePrelesson;
  const evidence = [ent ? `${ent.count} entitlement row(s)` : '', pre ? `${pre.count} prelesson row(s)` : ''].filter(Boolean).join('; ') || 'none';
  md.push(`| ${row.portalUserId} | ${row.batchKey} | ${row.rosterEffectiveFrom} | ${row.discrepancy} | ${row.classification} | ${evidence} |`);
}
md.push('');
md.push('## Extra D1 assignments not present in the current roster snapshot');
md.push('');
if (!extraAssignments.length) {
  md.push('None.');
} else {
  md.push('| Portal ID | Batch | From | To | Active as of audit | Classification |');
  md.push('|---|---|---:|---:|---|---|');
  for (const row of extraAssignments) {
    md.push(`| ${row.portalUserId} | ${row.batchKey} | ${row.effectiveFrom} | ${row.effectiveTo || '—'} | ${row.activeAsOf ? 'yes' : 'no'} | ${row.classification} |`);
  }
}
md.push('');
md.push('## Runtime reachability');
md.push('');
md.push(report.runtimeReachability.conclusion);
md.push('');
for (const ref of assignmentRuntimeRefs) md.push(`- \`${ref.replace(/`/g, '')}\``);
md.push('');
md.push('## Mutation decision');
md.push('');
md.push('**No production mutation was performed by this audit.** Missing rows classified `SAFE_TO_ADD_FROM_AUTHORITATIVE_ROSTER` are candidates for a separate guarded additive repair. Date/window mismatches and extra current rows must not be rewritten or deleted automatically.');
md.push('');
fs.writeFileSync('/tmp/d1-assignment-reconciliation.md', md.join('\n') + '\n');

console.log(JSON.stringify({ marker: report.marker, status: report.status, readOnly: true, counts }, null, 2));
