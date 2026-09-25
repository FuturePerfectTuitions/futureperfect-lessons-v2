import currentWorker from './index-phase24-trial-vr.js';
import {
  liveBatchCompatEnv,
  needsCompatibility
} from './index-phase25-english-batch-code-compat.js';
import { handleAdminResourceRequest } from './admin-resource-replace-consistency.js';
import { handleAdminBatchManagerV2 } from './admin-batch-manager-v2.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/v1/admin/resources/')) {
      return handleAdminResourceRequest(request, env, ctx);
    }
    const batchResponse = await handleAdminBatchManagerV2(request, env);
    if (batchResponse) return batchResponse;
    return currentWorker.fetch(
      request,
      needsCompatibility(request) ? liveBatchCompatEnv(env) : env,
      ctx
    );
  }
};
