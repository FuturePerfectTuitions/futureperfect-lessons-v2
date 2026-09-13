import { createStudentRuntime } from './lib/runtime.mjs';
import { kvReadStore, resolveCurrentScope } from './lib/read-model-resolver.mjs';

const runtime = createStudentRuntime();

async function warmPreparedGlobal(env) {
  try {
    const global = await resolveCurrentScope(kvReadStore(env?.READ_MODELS_KV), 'global');
    return global?.payload?.kind === 'prepared-global-read-model' ? global : null;
  } catch {
    // Home keeps its normal failure semantics. A later catalogue request will
    // surface a genuine global-model failure through the Student Runtime.
    return null;
  }
}

export { createStudentRuntime };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const authenticatedHome = request.method === 'GET'
      && url.pathname === '/api/v2/student/home'
      && /(?:^|;\s*)fpt_session=/.test(request.headers.get('cookie') || '');

    if (!authenticatedHome) return runtime.fetch(request, env);

    // Warm the stable global prepared model in parallel with the compact Home
    // snapshot. No catalogue data is serialised to the browser and subject
    // selection remains entirely local. This removes the first Year/Level
    // request's otherwise-sequential global pointer + envelope KV cold read.
    const responsePromise = runtime.fetch(request, env);
    await warmPreparedGlobal(env);
    return responsePromise;
  }
};
