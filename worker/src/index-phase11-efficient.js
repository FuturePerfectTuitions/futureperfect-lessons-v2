import phase11Worker from './index-phase11-final.js';
import {
  prepareSessionProfileEnv,
  persistSessionProfile
} from './phase11-session-profile.js';
import {
  appendKvAuditHeaders,
  createKvAudit,
  kvAuditEnv
} from './phase11-kv-audit.js';

export default {
  async fetch(request, env, ctx) {
    const audit = createKvAudit();
    const measuredEnv = kvAuditEnv(env, audit);
    const prepared = await prepareSessionProfileEnv(request, measuredEnv);
    const response = await phase11Worker.fetch(request, prepared.env, ctx);
    await persistSessionProfile(request, response, measuredEnv, prepared.state);
    return appendKvAuditHeaders(response, env, audit);
  }
};
