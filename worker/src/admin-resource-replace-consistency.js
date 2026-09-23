import { handleAdminResourceRequest as baseHandleAdminResourceRequest } from './admin-resource-replace.js';
import {
  pointerKey,
  publishScopeAtomic,
  resolveCurrentScope
} from './access-read-model-sync.js';

const REPLACE_PATH = '/api/v1/admin/resources/replace';
const CONSISTENCY_MARKER = 'replace-resource-consistency-v1';
const PREFLIGHT_GUARD_MARKER = 'replace-resource-preflight-pass-v1';

const clean = value => String(value ?? '').trim();
const cloneJson = value => JSON.parse(JSON.stringify(value));

function jsonFrom(response, body, status = response.status) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-fpt-replace-resource-consistency', CONSISTENCY_MARKER);
  return new Response(JSON.stringify(body), { status, headers });
}

function withPreflightGuardMarker(response) {
  const headers = new Headers(response.headers);
  headers.set('x-fpt-replace-resource-preflight-guard', PREFLIGHT_GUARD_MARKER);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function countR2Key(value, key) {
  if (!value || typeof value !== 'object') return 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countR2Key(item, key), 0);
  let count = clean(value.r2Key) === key ? 1 : 0;
  for (const [field, child] of Object.entries(value)) {
    if (field === 'r2Key') continue;
    count += countR2Key(child, key);
  }
  return count;
}

function replaceUniqueR2Key(value, fromKey, toKey) {
  let count = 0;
  const visit = current => {
    if (!current || typeof current !== 'object') return;
    if (!Array.isArray(current) && clean(current.r2Key) === fromKey) {
      current.r2Key = toKey;
      count += 1;
    }
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    for (const [field, child] of Object.entries(current)) {
      if (field === 'r2Key') continue;
      visit(child);
    }
  };
  visit(value);
  if (count !== 1) throw new Error(`CANONICAL_ROLLBACK_TARGET_COUNT_${count}`);
  return value;
}

function projectPreparedPayload(payload, oldObjectKey, newObjectKey) {
  const next = cloneJson(payload);
  if (!Array.isArray(next?.resources)) throw new Error('PREPARED_RESOURCES_UNAVAILABLE');
  const matches = next.resources.filter(resource => clean(resource?.objectKey) === oldObjectKey);
  if (matches.length !== 1) throw new Error(`PREPARED_RESOURCE_TARGET_COUNT_${matches.length}`);
  matches[0].objectKey = newObjectKey;
  return next;
}

async function verifyCanonical(env, lessonId, newR2Key) {
  const lesson = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
  if (!lesson || countR2Key(lesson, newR2Key) !== 1) throw new Error('CANONICAL_READBACK_MISMATCH');
  return lesson;
}

async function restoreCanonical(env, lessonId, oldR2Key, newR2Key) {
  const current = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
  if (!current) throw new Error('CANONICAL_ROLLBACK_LESSON_MISSING');
  const restored = replaceUniqueR2Key(cloneJson(current), newR2Key, oldR2Key);
  await env.LESSONS_KV.put(`lesson:${lessonId}`, JSON.stringify(restored));
  const readback = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
  if (!readback || countR2Key(readback, newR2Key) !== 0 || countR2Key(readback, oldR2Key) < 1) {
    throw new Error('CANONICAL_ROLLBACK_VERIFY_FAILED');
  }
}

async function restorePointer(store, key, rawPointer) {
  if (rawPointer == null) return;
  await store.put(key, rawPointer);
  const confirmed = await store.get(key);
  if (String(confirmed ?? '') !== String(rawPointer)) throw new Error('PREPARED_POINTER_ROLLBACK_VERIFY_FAILED');
}

async function publishPreparedReplacement(env, lessonId, oldR2Key, newR2Key) {
  if (!env?.READ_MODELS_KV || typeof env.READ_MODELS_KV.get !== 'function' || typeof env.READ_MODELS_KV.put !== 'function') {
    throw new Error('READ_MODELS_KV_REQUIRED');
  }

  const scope = `lesson:${lessonId}`;
  const pKey = pointerKey(scope);
  const rawPointer = await env.READ_MODELS_KV.get(pKey);
  if (rawPointer == null) {
    return { status: 'not-published', scope, pointerKey: pKey, previousPointer: null };
  }

  const current = await resolveCurrentScope(env.READ_MODELS_KV, scope);
  const nextPayload = projectPreparedPayload(current.payload, oldR2Key, newR2Key);
  const version = `resource-replace-${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;

  try {
    const published = await publishScopeAtomic(env.READ_MODELS_KV, {
      scope,
      payload: nextPayload,
      version
    });
    const confirmed = await resolveCurrentScope(env.READ_MODELS_KV, scope);
    const newMatches = Array.isArray(confirmed?.payload?.resources)
      ? confirmed.payload.resources.filter(resource => clean(resource?.objectKey) === newR2Key).length
      : 0;
    const oldMatches = Array.isArray(confirmed?.payload?.resources)
      ? confirmed.payload.resources.filter(resource => clean(resource?.objectKey) === oldR2Key).length
      : 0;
    if (newMatches !== 1 || oldMatches !== 0) throw new Error('PREPARED_READBACK_MISMATCH');
    return {
      status: 'published',
      scope,
      pointerKey: pKey,
      previousPointer: rawPointer,
      version: published.version,
      sha256: published.payloadSha256,
      envelopeSha256: published.envelopeSha256
    };
  } catch (error) {
    try { await restorePointer(env.READ_MODELS_KV, pKey, rawPointer); } catch (rollbackError) {
      error.pointerRollbackError = clean(rollbackError?.message) || 'PREPARED_POINTER_ROLLBACK_FAILED';
    }
    throw error;
  }
}

async function handleAdminResourceRequest(request, env, ctx) {
  const url = new URL(request.url);
  // Only a real replacement POST is subject to canonical->prepared consistency
  // processing. CORS OPTIONS keeps the base handler's status/body/CORS semantics
  // and receives only a diagnostic header so production can prove the guard is live.
  if (url.pathname !== REPLACE_PATH || request.method !== 'POST') {
    const response = await baseHandleAdminResourceRequest(request, env, ctx);
    if (url.pathname === REPLACE_PATH && request.method === 'OPTIONS') {
      return withPreflightGuardMarker(response);
    }
    return response;
  }

  const baseResponse = await baseHandleAdminResourceRequest(request, env, ctx);
  if (!baseResponse.ok) return baseResponse;

  let result;
  try { result = await baseResponse.clone().json(); } catch {
    return jsonFrom(baseResponse, { ok: false, error: 'RESOURCE_REPLACE_INVALID_SUCCESS_RESPONSE' }, 500);
  }
  if (!result?.ok || !clean(result.lessonId) || !clean(result.oldR2Key) || !clean(result.newR2Key)) {
    return jsonFrom(baseResponse, { ok: false, error: 'RESOURCE_REPLACE_INCOMPLETE_SUCCESS_RESPONSE' }, 500);
  }

  const lessonId = clean(result.lessonId);
  const oldR2Key = clean(result.oldR2Key);
  const newR2Key = clean(result.newR2Key);
  let projection = null;

  try {
    await verifyCanonical(env, lessonId, newR2Key);
    projection = await publishPreparedReplacement(env, lessonId, oldR2Key, newR2Key);
    return jsonFrom(baseResponse, {
      ...result,
      preparedReadModel: {
        status: projection.status,
        scope: projection.scope,
        version: projection.version || null,
        sha256: projection.sha256 || null
      },
      consistency: CONSISTENCY_MARKER,
      message: projection.status === 'published'
        ? 'Replacement published to the canonical lesson and the current student lesson.'
        : 'Replacement published to the canonical lesson. No current prepared student lesson exists yet; future publication will use this replacement.'
    }, 200);
  } catch (error) {
    const rollback = { pointer: 'not-needed', canonical: 'pending', r2: 'retained' };
    if (projection?.previousPointer) {
      try {
        await restorePointer(env.READ_MODELS_KV, projection.pointerKey, projection.previousPointer);
        rollback.pointer = 'restored';
      } catch {
        rollback.pointer = 'failed';
      }
    }
    try {
      await restoreCanonical(env, lessonId, oldR2Key, newR2Key);
      rollback.canonical = 'restored';
      try {
        if (env?.MATERIALS_R2?.delete) {
          await env.MATERIALS_R2.delete(newR2Key);
          rollback.r2 = 'deleted';
        }
      } catch {
        rollback.r2 = 'retained';
      }
    } catch {
      rollback.canonical = 'failed';
    }

    return jsonFrom(baseResponse, {
      ok: false,
      error: 'RESOURCE_REPLACE_PROJECTION_FAILED',
      detail: clean(error?.message) || 'UNKNOWN_PROJECTION_FAILURE',
      pointerRollbackError: clean(error?.pointerRollbackError) || null,
      rollback,
      consistency: CONSISTENCY_MARKER,
      message: rollback.canonical === 'restored'
        ? 'Replacement was not published because the student-facing lesson could not be updated. The canonical lesson was restored.'
        : 'Replacement consistency failed and automatic canonical rollback could not be verified. Manual intervention is required.'
    }, 500);
  }
}

export {
  CONSISTENCY_MARKER,
  PREFLIGHT_GUARD_MARKER,
  handleAdminResourceRequest,
  projectPreparedPayload
};