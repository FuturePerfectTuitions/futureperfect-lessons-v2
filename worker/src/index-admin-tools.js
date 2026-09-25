import currentWorker from './index-phase24-trial-vr.js';
import {
  liveBatchCompatEnv,
  needsCompatibility
} from './index-phase25-english-batch-code-compat.js';
import { handleAdminResourceRequest } from './admin-resource-replace-consistency.js';
import { handleAdminBatchManagerV2 } from './admin-batch-manager-v2.js';
import { handleAdminPortalLoginLookup } from './admin-portal-login-lookup.js';

// Admin-specific routes are composed here so fixes deploy with the shared Worker.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/v1/admin/resources/')) {
      return handleAdminResourceRequest(request, env, ctx);
    }
    const lookupResponse = await handleAdminPortalLoginLookup(request, env);
    if (lookupResponse) return lookupResponse;
    const batchResponse = await handleAdminBatchManagerV2(request, env);
    if (batchResponse) return batchResponse;
    return currentWorker.fetch(
      request,
      needsCompatibility(request) ? liveBatchCompatEnv(env) : env,
      ctx
    );
  }
};
