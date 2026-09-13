const API_PREFIX = '/api/v2/';

function internalApiUrl(request) {
  const incoming = new URL(request.url);
  return new URL(`${incoming.pathname}${incoming.search}`, 'https://cp9-staging-api.internal');
}

async function proxyApi(request, env) {
  if (!env.STAGING_API || typeof env.STAGING_API.fetch !== 'function') {
    throw new Error('MISSING_STAGING_API_SERVICE_BINDING');
  }

  const headers = new Headers(request.headers);
  headers.delete('host');
  const init = {
    method: request.method,
    headers,
    redirect: 'manual'
  };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = request.body;

  const upstream = await env.STAGING_API.fetch(internalApiUrl(request), init);
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set('x-fpt-cp9-browser-facade', 'service-binding');
  responseHeaders.set('cache-control', responseHeaders.get('cache-control') || 'private, no-store');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(API_PREFIX)) return proxyApi(request, env);
    return env.ASSETS.fetch(request);
  }
};
