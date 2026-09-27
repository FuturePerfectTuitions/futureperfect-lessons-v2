import { compileAccessScope as compileAuthoritativeAccessScope } from '../../rebuild/adminops/src/lib/compiler.mjs';
import {
  SCOPE_SALT_KEY,
  assertCanonicalAccessProjected,
  publishScopeAtomic,
  resolveCurrentScope,
  opaqueAccessScopeId,
  globalToCatalogue
} from './access-read-model-sync.js';

const ACCESS_READ_MODEL_SYNC_V2_MARKER = 'd1-authoritative-sats-presentation-v2';
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'
  }).format(new Date());
}

function kvBindingStore(binding) {
  if (!binding || typeof binding.get !== 'function' || typeof binding.put !== 'function') {
    throw new Error('READ_MODELS_KV binding with get/put is required.');
  }
  return {
    async get(key) { return binding.get(key); },
    async put(key, value) { return binding.put(key, value); }
  };
}

async function allRows(statement) {
  const result = await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function optionalAllRows(statement) {
  try { return await allRows(statement); } catch { return []; }
}

async function loadStudentAccessInput(env, portalUserIdNorm, asOfDate = londonToday()) {
  const userId = norm(portalUserIdNorm);
  if (!userId) throw new Error('PORTAL_USER_ID_REQUIRED');
  const user = await env.STUDENTS_KV.get(`user:${userId}`, { type:'json' });
  if (!user) throw new Error('STUDENT_NOT_FOUND');

  const [batchDefinitions, batchAssignments, entitlements, preLesson] = await Promise.all([
    optionalAllRows(env.DB.prepare(
      `SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to
       FROM batch_definitions`
    )),
    optionalAllRows(env.DB.prepare(
      `SELECT a.portal_user_id_norm, a.batch_key, a.effective_from, a.effective_to,
              b.subject, b.school_year, b.stream, b.maths_level,
              b.active_from AS batch_active_from, b.active_to AS batch_active_to
       FROM student_batch_assignments a
       LEFT JOIN batch_definitions b ON b.batch_key = a.batch_key
       WHERE a.portal_user_id_norm = ?`
    ).bind(userId)),
    allRows(env.DB.prepare(
      `SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source,
              first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date
       FROM lesson_entitlements
       WHERE portal_user_id_norm = ?`
    ).bind(userId)),
    allRows(env.DB.prepare(
      `SELECT portal_user_id_norm, lesson_id, batch_key, lesson_date, vr_access,
              source_row_id, first_granted_at, last_confirmed_at
       FROM online_prelesson_entitlements
       WHERE portal_user_id_norm = ?`
    ).bind(userId))
  ]);

  return {
    asOfDate,
    user,
    batchDefinitions,
    batchAssignments,
    entitlements,
    onlinePreLessonEntitlements:preLesson
  };
}

async function assertReadModelReconciliationReady(env) {
  if (!env?.READ_MODELS_KV || !env?.STUDENTS_KV || !env?.DB) {
    throw new Error('READ_MODEL_RECONCILIATION_NOT_CONFIGURED');
  }
  const store = kvBindingStore(env.READ_MODELS_KV);
  const scopeSalt = clean(await env.READ_MODELS_KV.get(SCOPE_SALT_KEY));
  if (!/^[0-9a-f]{64}$/i.test(scopeSalt)) throw new Error('READ_MODEL_SCOPE_SALT_INVALID');
  const global = await resolveCurrentScope(store, 'global');
  const catalogue = globalToCatalogue(global.payload);
  if (!catalogue?.views?.['maths-sats'] || catalogue.views['maths-year6']?.label !== 'Lessons') {
    throw new Error('READ_MODEL_GLOBAL_PROGRAMME_MODEL_NOT_V2');
  }
  return { ok:true, globalVersion:global.version, marker:ACCESS_READ_MODEL_SYNC_V2_MARKER };
}

async function refreshStudentAccessReadModel(env, portalUserIdNorm, options = {}) {
  if (!env?.READ_MODELS_KV || !env?.STUDENTS_KV || !env?.DB) {
    throw new Error('READ_MODEL_RECONCILIATION_NOT_CONFIGURED');
  }
  const store = kvBindingStore(env.READ_MODELS_KV);
  const scopeSalt = clean(await env.READ_MODELS_KV.get(SCOPE_SALT_KEY));
  if (!/^[0-9a-f]{64}$/i.test(scopeSalt)) throw new Error('READ_MODEL_SCOPE_SALT_INVALID');

  const global = await resolveCurrentScope(store, 'global');
  const catalogue = globalToCatalogue(global.payload);
  if (!catalogue?.views?.['maths-sats'] || catalogue.views['maths-year6']?.label !== 'Lessons') {
    throw new Error('READ_MODEL_GLOBAL_PROGRAMME_MODEL_NOT_V2');
  }

  const asOfDate = clean(options.asOfDate) || londonToday();
  const input = await loadStudentAccessInput(env, portalUserIdNorm, asOfDate);
  const scopeId = await opaqueAccessScopeId(portalUserIdNorm, scopeSalt);
  const payload = compileAuthoritativeAccessScope(input, catalogue, { scopeId, asOfDate });
  assertCanonicalAccessProjected(input, payload);

  const published = await publishScopeAtomic(store, {
    scope:`access:${scopeId}`,
    payload,
    updatedAt:new Date().toISOString()
  });
  return {
    ok:true,
    portalUserIdNorm:norm(portalUserIdNorm),
    scopeId,
    version:published.version,
    sha256:published.payloadSha256,
    reused:published.reused === true,
    marker:ACCESS_READ_MODEL_SYNC_V2_MARKER
  };
}

export {
  ACCESS_READ_MODEL_SYNC_V2_MARKER,
  loadStudentAccessInput,
  assertReadModelReconciliationReady,
  refreshStudentAccessReadModel
};
