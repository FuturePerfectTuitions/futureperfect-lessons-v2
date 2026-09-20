import { handleAdminLessonReleaseImport as handleBaseImport } from './admin-lesson-release-import.js';
import {
  assertReadModelReconciliationReady,
  refreshStudentAccessReadModel
} from './access-read-model-sync.js';

const CONFIRM_PATH = '/api/v1/admin/lesson-releases/confirm';
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function json(body, status = 200, response = null) {
  const headers = new Headers(response?.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { status, headers });
}

function reconciliationFailure() {
  return json({
    ok:false,
    error:'READ_MODEL_RECONCILIATION_NOT_READY',
    message:'Portal access synchronisation is temporarily unavailable. No lesson access changes were applied. Please retry.'
  }, 503);
}

function successfulStudents(results) {
  return [...new Set((Array.isArray(results) ? results : [])
    .filter(result => result?.ok === true)
    .map(result => norm(result?.portalUserIdNorm || result?.portalUserId))
    .filter(Boolean))];
}

function applySyncOutcome(body, outcomes) {
  const results = (Array.isArray(body?.results) ? body.results : []).map(result => {
    const userId = norm(result?.portalUserIdNorm || result?.portalUserId);
    const outcome = outcomes.get(userId);
    if (!outcome || result?.ok !== true) return result;
    if (outcome.ok) {
      return {
        ...result,
        readModelSynced:true,
        readModelVersion:outcome.version,
        readModelReused:outcome.reused === true
      };
    }
    return {
      ...result,
      ok:false,
      status:'READ_MODEL_SYNC_FAILED',
      legacyApplied:true,
      readModelSynced:false,
      message:'Lesson access was saved but the student Portal access model did not publish. It is safe to retry this same import.'
    };
  });

  const readModelResults = [...outcomes.entries()].map(([portalUserIdNorm, outcome]) => ({
    portalUserIdNorm,
    ok:outcome.ok,
    status:outcome.ok ? (outcome.reused ? 'READ_MODEL_ALREADY_CURRENT' : 'READ_MODEL_PUBLISHED') : 'READ_MODEL_SYNC_FAILED',
    ...(outcome.ok ? { version:outcome.version, reused:outcome.reused === true } : {})
  }));

  return {
    ...body,
    results,
    readModelResults,
    summary:{
      ...(body?.summary || {}),
      succeeded:results.filter(result => result?.ok === true).length,
      failed:results.filter(result => result?.ok === false).length,
      readModelsSucceeded:readModelResults.filter(result => result.ok).length,
      readModelsFailed:readModelResults.filter(result => !result.ok).length
    }
  };
}

export async function handleAdminLessonReleaseImport(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== CONFIRM_PATH) {
    return handleBaseImport(request, env);
  }

  // Fail closed before the canonical D1 mutation if the rebuilt Portal's
  // prepared-access publication path is not available.
  try {
    await assertReadModelReconciliationReady(env);
  } catch {
    return reconciliationFailure();
  }

  const response = await handleBaseImport(request, env);
  const body = await response.clone().json().catch(() => null);
  if (!response.ok || body?.ok !== true || !Array.isArray(body.results)) return response;

  const outcomes = new Map();
  for (const portalUserIdNorm of successfulStudents(body.results)) {
    try {
      outcomes.set(portalUserIdNorm, await refreshStudentAccessReadModel(env, portalUserIdNorm));
    } catch {
      outcomes.set(portalUserIdNorm, { ok:false });
    }
  }

  return json(applySyncOutcome(body, outcomes), response.status, response);
}

export {
  successfulStudents,
  applySyncOutcome
};
