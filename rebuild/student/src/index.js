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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        ok: true,
        checkpoint: 1,
        runtime: 'student',
        environment: String(env.ENVIRONMENT || 'unknown'),
        deploymentIdentity: String(env.DEPLOYMENT_IDENTITY || ''),
        baselineSourceSha: BASELINE_SOURCE_SHA,
        productionTarget: false
      });
    }
    return json({ error: 'NOT_FOUND' }, 404);
  }
};
