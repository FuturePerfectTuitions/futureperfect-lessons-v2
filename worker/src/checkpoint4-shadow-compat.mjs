import { compileAccessReadModel, deriveOpaqueScopeId, clean, norm } from './checkpoint4-shadow-access.mjs';
import { kvStore, publishScopeAtomic, resolveCurrentScope } from './checkpoint4-shadow-atomic.mjs';

const SCOPE_SALT_KEY = 'meta:scope-salt';

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

async function loadScopeSalt(env) {
  if (!env?.REBUILD_SHADOW_KV) throw new Error('SHADOW_KV_UNAVAILABLE');
  const salt = clean(await env.REBUILD_SHADOW_KV.get(SCOPE_SALT_KEY));
  if (salt.length < 32) throw new Error('SHADOW_SCOPE_SALT_UNAVAILABLE');
  return salt;
}

async function loadUser(env, portalUserIdNorm) {
  const key = `user:${norm(portalUserIdNorm)}`;
  const user = await env.STUDENTS_KV.get(key, { type:'json' });
  if (!user || typeof user !== 'object') throw new Error('SHADOW_USER_NOT_FOUND');
  return user;
}

async function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

async function loadAccessRows(env, portalUserIdNorm) {
  const userId = norm(portalUserIdNorm);
  const [assignments, definitions, entitlements, prelessons] = await Promise.all([
    env.DB.prepare(`SELECT
        a.assignment_id, a.portal_user_id_norm, a.batch_key, a.effective_from, a.effective_to,
        b.subject, b.school_year, b.stream, b.maths_level,
        b.active_from AS batch_active_from, b.active_to AS batch_active_to
      FROM student_batch_assignments a
      JOIN batch_definitions b ON b.batch_key = a.batch_key
      WHERE a.portal_user_id_norm = ?
      ORDER BY a.effective_from, a.assignment_id`).bind(userId).all(),
    env.DB.prepare(`SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to
      FROM batch_definitions ORDER BY batch_key`).all(),
    env.DB.prepare(`SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source_batch_code, source_lesson_date
      FROM lesson_entitlements WHERE portal_user_id_norm = ? ORDER BY lesson_id`).bind(userId).all(),
    env.DB.prepare(`SELECT portal_user_id_norm, lesson_id, batch_key, lesson_date, vr_access
      FROM online_prelesson_entitlements WHERE portal_user_id_norm = ? ORDER BY lesson_id, batch_key`).bind(userId).all()
  ]);
  return {
    batchAssignments: await rows(assignments),
    batchDefinitions: await rows(definitions),
    entitlements: await rows(entitlements),
    onlinePreLessonEntitlements: await rows(prelessons)
  };
}

async function loadGlobal(env) {
  const resolved = await resolveCurrentScope(kvStore(env.REBUILD_SHADOW_KV), 'global');
  if (!resolved?.payload || resolved.payload.kind !== 'prepared-global-read-model') {
    throw new Error('SHADOW_GLOBAL_MODEL_INVALID');
  }
  return resolved;
}

async function recordReconciliation(env, row) {
  if (!env?.REBUILD_SHADOW_DB) return;
  const now = new Date().toISOString();
  await env.REBUILD_SHADOW_DB.prepare(`INSERT INTO rebuild_shadow_reconciliation (
      operation_id, user_scope, status, shadow_scope, shadow_version,
      shadow_sha256, error_message, source_route, first_seen_at, last_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(operation_id) DO UPDATE SET
      status = excluded.status,
      shadow_scope = excluded.shadow_scope,
      shadow_version = excluded.shadow_version,
      shadow_sha256 = excluded.shadow_sha256,
      error_message = excluded.error_message,
      last_updated_at = excluded.last_updated_at`)
    .bind(
      clean(row.operationId), clean(row.userScope), clean(row.status),
      clean(row.shadowScope) || null, clean(row.shadowVersion) || null,
      clean(row.shadowSha256) || null, clean(row.error) || null,
      clean(row.sourceRoute || '/api/v1/admin/lesson-releases/confirm'), now, now
    ).run();
}

async function publishUserShadow(env, portalUserIdNorm, options = {}) {
  if (!env?.REBUILD_SHADOW_KV || !env?.STUDENTS_KV || !env?.DB) throw new Error('SHADOW_BINDINGS_UNAVAILABLE');
  const userId = norm(portalUserIdNorm);
  if (!userId) throw new Error('SHADOW_USER_ID_REQUIRED');
  const [salt, globalResolved, user, accessRows] = await Promise.all([
    loadScopeSalt(env),
    loadGlobal(env),
    loadUser(env, userId),
    loadAccessRows(env, userId)
  ]);
  const scopeId = await deriveOpaqueScopeId(userId, salt);
  const scope = `access:${scopeId}`;
  const asOfDate = clean(options.asOfDate) || londonToday();
  const input = { asOfDate, user, ...accessRows };
  const payload = compileAccessReadModel(input, globalResolved.payload, scopeId, asOfDate);
  const operationId = clean(options.operationId) || `cp4-${crypto.randomUUID()}`;
  const version = `a-${operationId}-${Date.now()}`.slice(0,120);
  const published = await publishScopeAtomic(kvStore(env.REBUILD_SHADOW_KV), {
    scope, payload, version, updatedAt:new Date().toISOString()
  });
  await recordReconciliation(env, {
    operationId,
    userScope:scopeId,
    status:'SYNCED',
    shadowScope:scope,
    shadowVersion:published.version,
    shadowSha256:published.payloadSha256,
    error:'',
    sourceRoute:options.sourceRoute
  });
  return {
    scopeId,
    scope,
    version:published.version,
    sha256:published.payloadSha256,
    unchanged:published.unchanged === true,
    payload
  };
}

async function markShadowFailure(env, portalUserIdNorm, options = {}, error) {
  try {
    const scopeId = await deriveOpaqueScopeId(portalUserIdNorm, await loadScopeSalt(env));
    await recordReconciliation(env, {
      operationId:clean(options.operationId) || `cp4-failure-${crypto.randomUUID()}`,
      userScope:scopeId,
      status:'RECONCILE_REQUIRED',
      error:clean(error?.message || 'Shadow update failed').slice(0,500),
      sourceRoute:options.sourceRoute
    });
  } catch {}
}

function successfulAffectedUsers(confirmBody) {
  const users = new Set();
  if (!confirmBody || confirmBody.ok !== true || !Array.isArray(confirmBody.results)) return [];
  for (const row of confirmBody.results) {
    if (row?.ok !== true) continue;
    const status = clean(row?.status).toUpperCase();
    if (status === 'SKIPPED' || status === 'IGNORED') continue;
    const user = norm(row?.portalUserIdNorm);
    if (user) users.add(user);
  }
  return [...users];
}

async function updateAffectedUsersFromConfirm(env, confirmBody, options = {}) {
  const users = successfulAffectedUsers(confirmBody);
  const results = [];
  for (let index = 0; index < users.length; index += 1) {
    const user = users[index];
    const operationId = `${clean(options.operationPrefix || 'cp4-confirm')}-${index + 1}-${crypto.randomUUID()}`;
    try {
      const published = await publishUserShadow(env, user, {
        operationId,
        sourceRoute:'/api/v1/admin/lesson-releases/confirm'
      });
      results.push({ ok:true, scopeId:published.scopeId, version:published.version, sha256:published.sha256 });
    } catch (error) {
      await markShadowFailure(env, user, { operationId, sourceRoute:'/api/v1/admin/lesson-releases/confirm' }, error);
      results.push({ ok:false, error:clean(error?.message || 'shadow failure') });
    }
  }
  return { affectedUsers:users.length, results };
}

export {
  SCOPE_SALT_KEY,
  londonToday,
  loadScopeSalt,
  loadUser,
  loadAccessRows,
  loadGlobal,
  recordReconciliation,
  publishUserShadow,
  markShadowFailure,
  successfulAffectedUsers,
  updateAffectedUsersFromConfirm
};
