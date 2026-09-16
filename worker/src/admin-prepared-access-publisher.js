import { compileAccessScope, globalToCatalogue } from '../../rebuild/adminops/src/lib/compiler.mjs';
import {
  kvBindingStore,
  publishScopeAtomic,
  resolveCurrentScope,
  stableStringify
} from '../../rebuild/adminops/src/lib/atomic-publisher.mjs';
import { opaqueAccessScopeId } from '../../rebuild/student/src/lib/access-scope.mjs';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function londonDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'
  }).format(now);
}

async function allRows(statement) {
  const result = await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function sourceForStudent(env, portalUserIdNorm, asOfDate) {
  const id = norm(portalUserIdNorm);
  if (!id) throw new Error('PREPARED_ACCESS_PORTAL_USER_REQUIRED');

  const user = await env.STUDENTS_KV.get(`user:${id}`, { type:'json' });
  if (!user || typeof user !== 'object') throw new Error('PREPARED_ACCESS_STUDENT_NOT_FOUND');

  const [batchDefinitions, batchAssignments, entitlements, onlinePreLessonEntitlements] = await Promise.all([
    allRows(env.DB.prepare(
      `SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to
       FROM batch_definitions`
    )),
    allRows(env.DB.prepare(
      `SELECT a.portal_user_id_norm, a.batch_key, a.effective_from, a.effective_to,
              b.subject, b.school_year, b.stream, b.maths_level,
              b.active_from AS batch_active_from, b.active_to AS batch_active_to
       FROM student_batch_assignments a
       JOIN batch_definitions b ON b.batch_key = a.batch_key
       WHERE lower(a.portal_user_id_norm) = lower(?)`
    ).bind(id)),
    allRows(env.DB.prepare(
      `SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source,
              first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date
       FROM lesson_entitlements
       WHERE lower(portal_user_id_norm) = lower(?)`
    ).bind(id)),
    allRows(env.DB.prepare(
      `SELECT portal_user_id_norm, lesson_id, batch_key, lesson_date, vr_access,
              source_row_id, first_granted_at, last_confirmed_at
       FROM online_prelesson_entitlements
       WHERE lower(portal_user_id_norm) = lower(?)`
    ).bind(id))
  ]);

  return {
    asOfDate,
    user,
    batchDefinitions,
    batchAssignments,
    entitlements,
    onlinePreLessonEntitlements
  };
}

async function publishStudentPreparedAccess(env, portalUserIdNorm, options = {}) {
  // Native Cloudflare bindings cannot be functions. This hook exists only so
  // the importer integration tests can prove confirm-result gating without
  // duplicating the full compiler fixture in every importer test.
  if (typeof env?.__TEST_PREPARED_ACCESS_PUBLISHER === 'function') {
    return env.__TEST_PREPARED_ACCESS_PUBLISHER(norm(portalUserIdNorm), options);
  }

  if (!env?.REBUILD_SHADOW_KV || typeof env.REBUILD_SHADOW_KV.get !== 'function' || typeof env.REBUILD_SHADOW_KV.put !== 'function') {
    throw new Error('PREPARED_ACCESS_KV_NOT_CONFIGURED');
  }
  if (!env?.DB || !env?.STUDENTS_KV) throw new Error('PREPARED_ACCESS_SOURCE_NOT_CONFIGURED');

  const store = kvBindingStore(env.REBUILD_SHADOW_KV);
  const scopeSalt = clean(await env.REBUILD_SHADOW_KV.get('meta:scope-salt'));
  if (!/^[0-9a-f]{64}$/i.test(scopeSalt)) throw new Error('PREPARED_ACCESS_SCOPE_SALT_INVALID');

  const global = await resolveCurrentScope(store, 'global');
  if (global?.payload?.kind !== 'prepared-global-read-model') {
    throw new Error('PREPARED_GLOBAL_MODEL_INVALID');
  }
  const catalogue = globalToCatalogue(global.payload);
  const asOfDate = clean(options.asOfDate) || londonDate(options.now || new Date());
  const id = norm(portalUserIdNorm);
  const scopeId = await opaqueAccessScopeId(id, scopeSalt);
  const scope = `access:${scopeId}`;
  const source = await sourceForStudent(env, id, asOfDate);
  const compiled = compileAccessScope(source, catalogue, { scopeId, asOfDate });

  let current = null;
  try {
    current = await resolveCurrentScope(store, scope);
  } catch (error) {
    if (clean(error?.message) !== 'READ_MODEL_POINTER_UNAVAILABLE' && clean(error?.message) !== 'READ_MODEL_NO_VERIFIED_VERSION') throw error;
  }

  if (current && stableStringify(current.payload) === stableStringify(compiled)) {
    return {
      ok:true,
      scope,
      scopeId,
      version:current.version,
      previousVersion:current.pointer?.previous?.version || null,
      published:false,
      reused:true,
      asOfDate
    };
  }

  const published = await publishScopeAtomic(store, {
    scope,
    payload:compiled,
    updatedAt:new Date().toISOString()
  });
  const verified = await resolveCurrentScope(store, scope);
  if (verified.version !== published.version || stableStringify(verified.payload) !== stableStringify(compiled)) {
    throw new Error('PREPARED_ACCESS_POST_PUBLISH_VERIFY_FAILED');
  }

  return {
    ok:true,
    scope,
    scopeId,
    version:published.version,
    previousVersion:published.previousVersion || null,
    published:true,
    reused:false,
    asOfDate
  };
}

export {
  londonDate,
  sourceForStudent,
  publishStudentPreparedAccess
};
