import {
  PREPARED_CATALOGUE,
  PREPARED_CATALOGUE_SHA256
} from './prepared-catalogue.generated.js';

const BASELINE_SOURCE_SHA = 'e4c7bde7ad9a9402136da5798d7ab690ab30322c';

function json(body, status = 200, cacheControl = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff'
    }
  });
}

function catalogueSummary() {
  const ready = Boolean(
    PREPARED_CATALOGUE &&
    PREPARED_CATALOGUE.kind === 'prepared-catalogue' &&
    Array.isArray(PREPARED_CATALOGUE.navigation) &&
    PREPARED_CATALOGUE_SHA256
  );
  const uniqueLessons = ready ? Object.keys(PREPARED_CATALOGUE.lessonToViews || {}).length : 0;
  return {
    ready,
    sha256: ready ? PREPARED_CATALOGUE_SHA256 : '',
    sourceType: ready ? String(PREPARED_CATALOGUE.source?.type || '') : '',
    sourceRevision: ready ? String(PREPARED_CATALOGUE.source?.revision || '') : '',
    views: ready ? PREPARED_CATALOGUE.navigation.length : 0,
    uniqueLessons
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        ok: true,
        checkpoint: 2,
        runtime: 'student',
        environment: String(env.ENVIRONMENT || 'unknown'),
        deploymentIdentity: String(env.DEPLOYMENT_IDENTITY || ''),
        baselineSourceSha: BASELINE_SOURCE_SHA,
        productionTarget: false,
        preparedCatalogue: catalogueSummary()
      });
    }
    if (request.method === 'GET' && url.pathname === '/read-models/status') {
      return json({ ok: true, checkpoint: 2, catalogue: catalogueSummary() });
    }
    if (request.method === 'GET' && url.pathname === '/read-models/navigation') {
      if (!catalogueSummary().ready) return json({ error: 'PREPARED_CATALOGUE_NOT_READY' }, 503);
      return json({
        ok: true,
        schemaVersion: PREPARED_CATALOGUE.schemaVersion,
        catalogueSha256: PREPARED_CATALOGUE_SHA256,
        navigation: PREPARED_CATALOGUE.navigation
      }, 200, 'public, max-age=60');
    }
    return json({ error: 'NOT_FOUND' }, 404);
  }
};
