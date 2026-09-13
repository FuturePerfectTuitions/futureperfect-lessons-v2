import { kvBindingStore, resolveCurrentScope } from './lib/atomic-publisher.mjs';

const BASELINE_SOURCE_SHA = 'e4c7bde7ad9a9402136da5798d7ab690ab30322c';

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

async function currentGlobalSummary(env) {
  if (!hasReadModelBinding(env)) throw new Error('READ_MODELS_KV_UNAVAILABLE');
  const resolved = await resolveCurrentScope(kvBindingStore(env.READ_MODELS_KV), 'global');
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        ok: true,
        checkpoint: 3,
        runtime: 'admin-operations',
        environment: String(env.ENVIRONMENT || 'unknown'),
        deploymentIdentity: String(env.DEPLOYMENT_IDENTITY || ''),
        baselineSourceSha: BASELINE_SOURCE_SHA,
        productionTarget: false,
        atomicPublishing: {
          schemaVersion: 1,
          readModelsBindingPresent: hasReadModelBinding(env),
          pointerStrategy: 'immutable-candidate-then-current-pointer-with-previous-fallback'
        }
      });
    }
    if (request.method === 'GET' && url.pathname === '/read-models/current') {
      try {
        return json({ ok: true, checkpoint: 3, current: await currentGlobalSummary(env) });
      } catch (error) {
        return json({
          ok: false,
          error: 'READ_MODEL_UNAVAILABLE',
          message: String(error?.message || 'Read model unavailable.')
        }, 503);
      }
    }
    return json({ error: 'NOT_FOUND' }, 404);
  }
};
