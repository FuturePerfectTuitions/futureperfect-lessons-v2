import phase11Worker from './index-phase11-final.js';

const VR_HOWTO_BUCKET = 'VR_HOWTO';
const ELIGIBLE_ENGLISH_11PLUS_VIEWS = new Set([
  'english-year4-11plus',
  'english-year5-11plus'
]);

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

function allowedOrigins(env) {
  return new Set([
    'https://futureperfecttuitions.github.io',
    ...String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  ]);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'Content-Type',
    Vary: 'Origin'
  };
}

function json(body, init = {}) {
  const headers = new Headers(init.headers || {});
  for (const [key, value] of Object.entries(JSON_HEADERS)) headers.set(key, value);
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { ...init, headers });
}

function jsonLike(response, body) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(JSON_HEADERS)) headers.set(key, value);
  headers.delete('content-length');
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function cleanViewId(value) {
  return String(value || '').trim().toLowerCase();
}

function eligibleViewId(value) {
  const viewId = cleanViewId(value);
  return ELIGIBLE_ENGLISH_11PLUS_VIEWS.has(viewId) ? viewId : '';
}

function screenpalEmbedUrl(screenpalId) {
  const id = String(screenpalId || '').trim();
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return `https://go.screenpal.com/player/${encodeURIComponent(id)}?ff=1&title=0&dcc=0&bg=transparent&embedded=1`;
}

async function delegatedJson(request, env, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = '';
  const internal = new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  });
  const response = await phase11Worker.fetch(internal, env);
  const body = await response.clone().json().catch(() => null);
  return { response, body };
}

async function requireOpenEnglishElevenPlusView(request, env, requestedViewId) {
  const viewId = eligibleViewId(requestedViewId);
  if (!viewId) return { error: 'VR_HOWTO_NOT_AVAILABLE', status: 403 };

  const { response, body } = await delegatedJson(
    request,
    env,
    `/api/v1/student/views/${encodeURIComponent(viewId)}/lessons`
  );

  if (!response.ok || !body?.ok || !body.view) {
    return {
      error: body?.error || 'VR_HOWTO_NOT_AVAILABLE',
      status: response.status || 403
    };
  }
  if (body.view.lockedPreview) {
    return { error: 'VR_HOWTO_NOT_AVAILABLE_IN_PREVIEW', status: 403 };
  }

  return { viewId, view: body.view };
}

async function loadVrHowToCatalogue(env) {
  const catalogue = await env.LESSONS_KV.get(`special:${VR_HOWTO_BUCKET}`, { type: 'json' });
  if (!catalogue || catalogue.active === false) return null;
  return catalogue;
}

function safeItems(catalogue) {
  const items = Array.isArray(catalogue?.items) ? catalogue.items : [];
  return items.map((item, index) => {
    const itemId = String(item?.id || `item-${index + 1}`).trim();
    const separator = item?.type === 'separator' || !item?.video?.screenpal;
    return {
      itemId,
      title: String(item?.title || `Item ${index + 1}`),
      description: String(item?.description || ''),
      separator,
      resourceKey: separator
        ? null
        : `special~${VR_HOWTO_BUCKET}~${encodeURIComponent(itemId)}`
    };
  });
}

function parseVrHowToResourceKey(value) {
  let decoded = '';
  try {
    decoded = decodeURIComponent(String(value || ''));
  } catch {
    return null;
  }
  const parts = decoded.split('~');
  if (parts.length !== 3 || parts[0] !== 'special' || parts[1] !== VR_HOWTO_BUCKET) return null;
  let itemId = '';
  try {
    itemId = decodeURIComponent(parts[2]);
  } catch {
    return null;
  }
  return itemId ? { itemId } : null;
}

async function stripLegacyVrHowToListPlacement(request, env) {
  const response = await phase11Worker.fetch(request, env);
  if (!response.ok) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body?.ok || !Array.isArray(body.areas)) return response;

  const filtered = body.areas.filter(area => String(area?.bucketId || '') !== VR_HOWTO_BUCKET);
  if (filtered.length === body.areas.length) return response;
  body.areas = filtered;
  return jsonLike(response, body);
}

async function handleVrHowToDetail(request, env, url) {
  const cors = corsHeaders(request, env);
  const context = await requireOpenEnglishElevenPlusView(
    request,
    env,
    url.searchParams.get('viewId')
  );
  if (context.error) {
    return json({ error: context.error }, { status: context.status, headers: cors });
  }

  const catalogue = await loadVrHowToCatalogue(env);
  if (!catalogue) {
    return json({ error: 'SPECIAL_AREA_NOT_FOUND' }, { status: 404, headers: cors });
  }

  return json(
    {
      ok: true,
      area: {
        bucketId: VR_HOWTO_BUCKET,
        type: String(catalogue.type || 'vr-howto'),
        title: 'VR How To',
        description: String(catalogue.description || ''),
        passwordProtected: false,
        items: safeItems(catalogue)
      },
      accessSource: 'open-english-11plus-view'
    },
    { status: 200, headers: cors }
  );
}

async function handleVrHowToVideo(request, env, resourceValue, url) {
  const cors = corsHeaders(request, env);
  const parsed = parseVrHowToResourceKey(resourceValue);
  if (!parsed) {
    return json({ error: 'SPECIAL_RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }

  const context = await requireOpenEnglishElevenPlusView(
    request,
    env,
    url.searchParams.get('viewId')
  );
  if (context.error) {
    return json({ error: context.error }, { status: context.status, headers: cors });
  }

  const catalogue = await loadVrHowToCatalogue(env);
  if (!catalogue) {
    return json({ error: 'SPECIAL_RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }

  const items = Array.isArray(catalogue.items) ? catalogue.items : [];
  const item = items.find(candidate => String(candidate?.id || '').trim() === parsed.itemId);
  const embedUrl = screenpalEmbedUrl(item?.video?.screenpal);
  if (!item || item?.type === 'separator' || !embedUrl) {
    return json({ error: 'SPECIAL_RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }

  return json(
    {
      ok: true,
      bucketId: VR_HOWTO_BUCKET,
      itemId: parsed.itemId,
      title: String(item.title || 'VR How To'),
      embedUrl
    },
    { status: 200, headers: cors }
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/v1/student/special-areas') {
      // VR How-To is now a top-level English 11+ destination, not a lesson-list
      // special-area card. Keep all other Phase 10 special areas unchanged.
      return stripLegacyVrHowToListPlacement(request, env);
    }

    if (
      request.method === 'GET' &&
      url.pathname === `/api/v1/student/special-areas/${VR_HOWTO_BUCKET}`
    ) {
      return handleVrHowToDetail(request, env, url);
    }

    const videoMatch = url.pathname.match(
      /^\/api\/v1\/student\/special-resources\/([^/]+)\/video$/
    );
    if (videoMatch && request.method === 'GET') {
      const parsed = parseVrHowToResourceKey(videoMatch[1]);
      if (parsed) return handleVrHowToVideo(request, env, videoMatch[1], url);
    }

    return phase11Worker.fetch(request, env, ctx);
  }
};
