const API_PREFIX = '/api/v2/';

function upstreamUrl(request, env) {
  const incoming = new URL(request.url);
  const upstream = new URL(String(env.UPSTREAM_ORIGIN || ''));
  if (upstream.protocol !== 'https:' || !/\.workers\.dev$/i.test(upstream.hostname)) {
    throw new Error('INVALID_STAGING_UPSTREAM');
  }
  upstream.pathname = incoming.pathname;
  upstream.search = incoming.search;
  upstream.hash = '';
  return upstream;
}

async function proxyApi(request, env) {
  const target = upstreamUrl(request, env);
  const headers = new Headers(request.headers);
  headers.delete('host');

  const init = {
    method: request.method,
    headers,
    redirect: 'manual'
  };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = request.body;

  const upstream = await fetch(target, init);
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set('x-fpt-cp9-browser-facade', 'same-origin');
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
