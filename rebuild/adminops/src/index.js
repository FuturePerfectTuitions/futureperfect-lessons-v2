import { kvBindingStore, resolveCurrentScope, pointerKey } from './lib/atomic-publisher.mjs';
import {
  opaqueAccessScopeId,
  runDualWriteCompatibility,
  loadD1AccessRows,
  legacyLessonState,
  applyLegacyFullRelease,
  recordD1Reconciliation,
  releaseParity
} from './lib/compatibility.mjs';
import { resolvePendingReconciliationD1 } from './lib/reconciliation.mjs';

const BASELINE_SOURCE_SHA = 'e4c7bde7ad9a9402136da5798d7ab690ab30322c';
const COMPAT_USER = 'cp4synthetic';
const COMPAT_BATCH = 'CP4-Y5M';

function clean(value) {
  return String(value ?? '').trim();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

function hasReadModelBinding(env) {
  return Boolean(env?.READ_MODELS_KV && typeof env.READ_MODELS_KV.get === 'function');
}

function hasCompatDb(env) {
  return Boolean(env?.COMPAT_DB && typeof env.COMPAT_DB.prepare === 'function');
}

function compatibilityHarnessEnabled(env) {
  return String(env?.ENVIRONMENT || '') === 'staging' &&
    String(env?.COMPAT_TEST_ENABLED || '').toLowerCase() === 'true' &&
    hasReadModelBinding(env) && hasCompatDb(env) && Boolean(clean(env?.COMPAT_SCOPE_TEST_KEY));
}

async function currentGlobal(env) {
  if (!hasReadModelBinding(env)) throw new Error('READ_MODELS_KV_UNAVAILABLE');
  return resolveCurrentScope(kvBindingStore(env.READ_MODELS_KV), 'global');
}

async function currentGlobalSummary(env) {
  const resolved = await currentGlobal(env);
  const payload = resolved.payload || {};
  return {
    scope: 'global',
    version: resolved.version,
    sha256: resolved.sha256,
    usedFallback: resolved.usedFallback,
    previousVersion: String(resolved.pointer?.previous?.version || ''),
    sourceType: String(payload?.source?.type || ''),
    sourceRevision: String(payload?.source?.revision || ''),
    views: Array.isArray(payload?.navigation) ? payload.navigation.length : 0,
    uniqueLessons: Object.keys(payload?.lessonToViews || {}).length
  };
}

async function seedCompatibilityFixture(env) {
  const now = new Date().toISOString();
  const userJson = JSON.stringify({
    firstName: 'Checkpoint4',
    accountStatus: 'active',
    fullLibraries: [],
    blockedLessons: [],
    upsellViews: [],
    specialAccess: [],
    manualAccess: { coreLessons: [], vrLessons: [], specialBuckets: [] }
  });

  await env.COMPAT_DB.batch([
    env.COMPAT_DB.prepare(`INSERT INTO batch_definitions (
        batch_key, academic_year, subject, school_year, stream, maths_level,
        active_from, active_to, created_at, updated_at
      ) VALUES (?, '2026-27', 'maths', 5, 'normal', NULL, '2026-09-01', NULL, ?, ?)
      ON CONFLICT(batch_key) DO UPDATE SET updated_at = excluded.updated_at`)
      .bind(COMPAT_BATCH, now, now),
    env.COMPAT_DB.prepare(`INSERT INTO student_batch_assignments (
        portal_user_id_norm, batch_key, effective_from, effective_to, created_at, updated_at
      ) VALUES (?, ?, '2026-09-01', NULL, ?, ?)
      ON CONFLICT(portal_user_id_norm, batch_key, effective_from) DO UPDATE SET
        effective_to = NULL, updated_at = excluded.updated_at`)
      .bind(COMPAT_USER, COMPAT_BATCH, now, now),
    env.COMPAT_DB.prepare(`INSERT INTO compat_synthetic_users (
        portal_user_id_norm, user_json, updated_at
      ) VALUES (?, ?, ?)
      ON CONFLICT(portal_user_id_norm) DO UPDATE SET
        user_json = excluded.user_json, updated_at = excluded.updated_at`)
      .bind(COMPAT_USER, userJson, now)
  ]);
}

async function syntheticAccessInput(env, asOfDate = '2026-09-13') {
  const userRow = await env.COMPAT_DB.prepare(
    `SELECT user_json FROM compat_synthetic_users WHERE portal_user_id_norm = ?`
  ).bind(COMPAT_USER).first();
  if (!userRow?.user_json) throw new Error('COMPAT_SYNTHETIC_USER_MISSING');
  let user;
  try { user = JSON.parse(String(userRow.user_json)); } catch { throw new Error('COMPAT_SYNTHETIC_USER_INVALID'); }
  const d1 = await loadD1AccessRows(env.COMPAT_DB, COMPAT_USER);
  return { asOfDate, user, ...d1 };
}

function testLessonIds(globalPayload) {
  const lessons = globalPayload?.catalogues?.['maths-year5']?.lessons || [];
  const ids = lessons.map(row => clean(row?.lessonId)).filter(Boolean);
  if (ids.length < 2) throw new Error('CHECKPOINT4_REQUIRES_TWO_MATHS_YEAR5_LESSONS');
  return ids;
}

async function runCompatibilityRelease(request, env) {
  if (!compatibilityHarnessEnabled(env)) {
    return json({ ok:false, error:'COMPATIBILITY_HARNESS_DISABLED' }, 404);
  }
  const url = new URL(request.url);
  const scenario = clean(url.searchParams.get('scenario') || 'completed').toLowerCase();
  if (!['completed', 'continuing', 'shadow-failure', 'reconcile'].includes(scenario)) {
    return json({ ok:false, error:'INVALID_SCENARIO' }, 400);
  }

  await seedCompatibilityFixture(env);
  const globalResolved = await currentGlobal(env);
  const [firstLessonId, secondLessonId] = testLessonIds(globalResolved.payload);
  const lessonId = ['shadow-failure', 'reconcile'].includes(scenario) ? secondLessonId : firstLessonId;
  const failShadow = scenario === 'shadow-failure';
  const operationId = `cp4-${scenario}-${lessonId}`;
  const item = {
    portalUserIdNorm: COMPAT_USER,
    lessonId,
    batchKey: COMPAT_BATCH,
    lessonDate: '2026-09-13',
    vrAccess: 0
  };

  const accessScopeId = await opaqueAccessScopeId(COMPAT_USER, env.COMPAT_SCOPE_TEST_KEY);
  const readModelStore = kvBindingStore(env.READ_MODELS_KV);
  let pointerBefore = null;
  try { pointerBefore = await env.READ_MODELS_KV.get(pointerKey(`access:${accessScopeId}`)); } catch {}

  const result = await runDualWriteCompatibility({
    operationId,
    portalUserIdNorm: COMPAT_USER,
    scopeId: accessScopeId,
    scopeSecret: env.COMPAT_SCOPE_TEST_KEY,
    readModelStore,
    globalReadModel: globalResolved.payload,
    asOfDate: '2026-09-13',
    updatedAt: new Date().toISOString(),
    failShadowAfterCandidate: failShadow,
    legacyWrite: () => applyLegacyFullRelease(env.COMPAT_DB, item),
    loadAccessInput: () => syntheticAccessInput(env),
    recordReconciliation: row => recordD1Reconciliation(env.COMPAT_DB, row)
  });

  if (result.shadowApplied && result.shadow) {
    await resolvePendingReconciliationD1(env.COMPAT_DB, {
      portalUserIdNorm: COMPAT_USER,
      operationId,
      shadowScope: result.shadow.scope,
      shadowVersion: result.shadow.version,
      shadowSha256: result.shadow.payloadSha256
    });
  }

  const legacyState = await legacyLessonState(env.COMPAT_DB, COMPAT_USER, lessonId);
  let shadowResolved = null;
  try { shadowResolved = await resolveCurrentScope(readModelStore, `access:${accessScopeId}`); } catch {}
  const parity = shadowResolved
    ? releaseParity(lessonId, legacyState, shadowResolved.payload)
    : { lessonId, match:false, compiledUnavailable:true };
  let pointerAfter = null;
  try { pointerAfter = await env.READ_MODELS_KV.get(pointerKey(`access:${accessScopeId}`)); } catch {}
  const reconciliation = await env.COMPAT_DB.prepare(`SELECT
      operation_id, status, shadow_scope, shadow_version, shadow_sha256, error_message
    FROM rebuild_shadow_reconciliation WHERE operation_id = ?`).bind(operationId).first();

  return json({
    ok: true,
    checkpoint: 4,
    scenario,
    fixture: 'synthetic-only',
    lessonId,
    legacy: {
      full: Number(legacyState?.full?.core_access) === 1,
      prelessonOnly: Boolean(legacyState?.prelesson) && Number(legacyState?.full?.core_access) !== 1,
      sourceBatchCode: clean(legacyState?.full?.source_batch_code)
    },
    shadow: shadowResolved ? {
      scopeId: accessScopeId,
      version: shadowResolved.version,
      sha256: shadowResolved.sha256,
      usedFallback: shadowResolved.usedFallback,
      lessonAccess: shadowResolved.payload?.snapshot?.lessonAccess?.[lessonId] || null
    } : null,
    parity,
    compatibility: {
      legacyApplied: result.legacyApplied,
      shadowApplied: result.shadowApplied,
      reconciliationRequired: result.reconciliationRequired,
      pointerUnchangedOnInjectedFailure: failShadow ? pointerBefore === pointerAfter : null
    },
    reconciliation: reconciliation || null
  });
}

async function compatibilityStatus(env) {
  if (!compatibilityHarnessEnabled(env)) {
    return { enabled:false };
  }
  const scopeId = await opaqueAccessScopeId(COMPAT_USER, env.COMPAT_SCOPE_TEST_KEY);
  const store = kvBindingStore(env.READ_MODELS_KV);
  let resolved = null;
  try { resolved = await resolveCurrentScope(store, `access:${scopeId}`); } catch {}
  const entitlementCount = await env.COMPAT_DB.prepare(
    `SELECT COUNT(*) AS count FROM lesson_entitlements WHERE portal_user_id_norm = ?`
  ).bind(COMPAT_USER).first();
  const pendingCount = await env.COMPAT_DB.prepare(
    `SELECT COUNT(*) AS count FROM rebuild_shadow_reconciliation WHERE portal_user_id_norm = ? AND status = 'RECONCILE_REQUIRED'`
  ).bind(COMPAT_USER).first();
  return {
    enabled:true,
    fixture:'synthetic-only',
    legacyEntitlements:Number(entitlementCount?.count || 0),
    reconcileRequired:Number(pendingCount?.count || 0),
    accessScopeId:scopeId,
    currentVersion:clean(resolved?.version),
    currentSha256:clean(resolved?.sha256)
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        ok: true,
        checkpoint: 4,
        runtime: 'admin-operations',
        environment: String(env.ENVIRONMENT || 'unknown'),
        deploymentIdentity: String(env.DEPLOYMENT_IDENTITY || ''),
        baselineSourceSha: BASELINE_SOURCE_SHA,
        productionTarget: false,
        atomicPublishing: {
          schemaVersion: 1,
          readModelsBindingPresent: hasReadModelBinding(env),
          pointerStrategy: 'immutable-candidate-then-current-pointer-with-previous-fallback'
        },
        compatibility: {
          legacyRemainsAuthoritative: true,
          shadowReadModelWrites: true,
          compatDbPresent: hasCompatDb(env),
          syntheticHarnessEnabled: compatibilityHarnessEnabled(env),
          destructiveMigrations: false
        }
      });
    }
    if (request.method === 'GET' && url.pathname === '/read-models/current') {
      try {
        return json({ ok: true, checkpoint: 4, current: await currentGlobalSummary(env) });
      } catch (error) {
        return json({ ok:false, error:'READ_MODEL_UNAVAILABLE', message:String(error?.message || 'Read model unavailable.') }, 503);
      }
    }
    if (request.method === 'GET' && url.pathname === '/compatibility/status') {
      return json({ ok:true, checkpoint:4, compatibility:await compatibilityStatus(env) });
    }
    if (request.method === 'POST' && url.pathname === '/compatibility/test-release') {
      return runCompatibilityRelease(request, env);
    }
    return json({ error: 'NOT_FOUND' }, 404);
  }
};
