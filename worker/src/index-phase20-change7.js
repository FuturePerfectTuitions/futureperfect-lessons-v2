import phase19Worker from './index-phase19-access.js';

const EXCEL_SYNC_PATH = '/api/v1/admin/excel-entitlements/sync';

const clean = value => String(value ?? '').trim();

function canonicalLessonId(value) {
  const raw = clean(value);
  const match = raw.match(/^Y6MS([1-9]|1[0-9])$/i);
  if (!match) return raw;
  return `Y6M${50 + Number(match[1])}`;
}

async function rewriteExcelSyncRequest(request) {
  let body;
  try {
    body = await request.clone().json();
  } catch {
    return { request, aliasesByRow: new Map() };
  }
  if (!Array.isArray(body?.items)) return { request, aliasesByRow: new Map() };

  const aliasesByRow = new Map();
  const items = body.items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const supplied = clean(item.lessonId);
    const resolved = canonicalLessonId(supplied);
    if (resolved === supplied) return item;
    const rowId = clean(item.syncRowId);
    if (rowId) aliasesByRow.set(rowId, supplied.toUpperCase());
    return { ...item, lessonId: resolved };
  });

  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.delete('content-length');
  return {
    aliasesByRow,
    request: new Request(request.url, {
      method: request.method,
      headers,
      body: JSON.stringify({ ...body, items })
    })
  };
}

async function restoreExcelSyncAliases(response, aliasesByRow) {
  if (!aliasesByRow.size) return response;
  let body;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (!Array.isArray(body?.results)) return response;
  const results = body.results.map(result => {
    const alias = aliasesByRow.get(clean(result?.syncRowId));
    return alias ? { ...result, lessonId: alias } : result;
  });
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.delete('content-length');
  return new Response(JSON.stringify({ ...body, results }), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export { canonicalLessonId };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === EXCEL_SYNC_PATH) {
      const rewritten = await rewriteExcelSyncRequest(request);
      const response = await phase19Worker.fetch(rewritten.request, env, ctx);
      return restoreExcelSyncAliases(response, rewritten.aliasesByRow);
    }
    return phase19Worker.fetch(request, env, ctx);
  }
};
