import legacyWorker from './index-phase23-protected-view-stability.js';
import { updateAffectedUsersFromConfirm } from './checkpoint4-shadow-compat.mjs';

const CONFIRM_PATH = '/api/v1/admin/lesson-releases/confirm';
const SHADOW_VERSION = 'checkpoint4-production-shadow-v1';

function isConfirmRequest(request) {
  if (!request || String(request.method || '').toUpperCase() !== 'POST') return false;
  try { return new URL(request.url).pathname === CONFIRM_PATH; } catch { return false; }
}

async function shadowFromLegacyResponse(env, responseClone) {
  if (!responseClone || !responseClone.ok) return { skipped:true, reason:'legacy-http-failure' };
  let body;
  try { body = await responseClone.json(); } catch { return { skipped:true, reason:'legacy-non-json' }; }
  if (!body || body.ok !== true) return { skipped:true, reason:'legacy-body-failure' };
  return updateAffectedUsersFromConfirm(env, body, { operationPrefix:'cp4-prod-confirm' });
}

function scheduleShadow(ctx, task) {
  const guarded = Promise.resolve(task).catch(() => undefined);
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(guarded);
    return true;
  }
  return false;
}

export default {
  async fetch(request, env, ctx) {
    const targeted = isConfirmRequest(request);
    const legacyResponse = await legacyWorker.fetch(request, env, ctx);
    if (!targeted) return legacyResponse;

    // The response returned to the Admin importer is the untouched legacy V2
    // response. Shadow compilation starts only after legacy processing has
    // completed and is isolated from the request outcome.
    const clone = legacyResponse.clone();
    scheduleShadow(ctx, shadowFromLegacyResponse(env, clone));
    return legacyResponse;
  }
};

export {
  CONFIRM_PATH,
  SHADOW_VERSION,
  isConfirmRequest,
  shadowFromLegacyResponse,
  scheduleShadow
};
