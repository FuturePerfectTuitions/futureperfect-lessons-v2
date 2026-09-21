import { handleAdminTrialManager as handleBaseTrialManager, PATHS } from './admin-trial-manager.js';
import { publishTrialPreparedAccess } from './trial-prepared-access-publisher.js';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

async function bodyFromClone(request) {
  if (request.method !== 'POST') return null;
  try { return await request.clone().json(); } catch { return null; }
}

function projectedMutation(pathname) {
  return pathname === PATHS.create || pathname === PATHS.rearm || pathname === PATHS.disable || pathname === PATHS.resetPasswords;
}

function errorResponse(request, env, error) {
  const headers = new Headers({ 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' });
  const origin = request.headers.get('Origin') || '';
  if (origin) {
    const configured = clean(env?.ALLOWED_ORIGINS).split(',').map(v => v.trim()).filter(Boolean);
    if (configured.includes(origin) || origin === 'https://futureperfecttuitions.github.io') {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Vary', 'Origin');
    }
  }
  return new Response(JSON.stringify({ ok:false, error:'TRIAL_PREPARED_ACCESS_PUBLISH_FAILED', detail:clean(error?.message) }), { status:500, headers });
}

export async function handleAdminTrialManager(request, env) {
  const url = new URL(request.url);
  if (!Object.values(PATHS).includes(url.pathname)) return null;
  const body = projectedMutation(url.pathname) ? await bodyFromClone(request) : null;
  const response = await handleBaseTrialManager(request, env);
  if (!response || !projectedMutation(url.pathname) || !response.ok) return response;

  let responseBody = null;
  try { responseBody = await response.clone().json(); } catch {}
  const portalUserId = clean(responseBody?.portalUserId || body?.portalUserId);
  if (!portalUserId) return errorResponse(request, env, new Error('TRIAL_PREPARED_PORTAL_USER_REQUIRED'));

  // A disabled trial must not retain a usable prepared model.  The Student
  // runtime also checks account status, but publishing the withdrawn canonical
  // state closes the content surface immediately and deterministically.
  try {
    const result = await publishTrialPreparedAccess(env, norm(portalUserId));
    const headers = new Headers(response.headers);
    headers.set('x-fpt-trial-prepared-access', result.reused ? 'verified-reused' : 'published');
    return new Response(response.body, { status:response.status, statusText:response.statusText, headers });
  } catch (error) {
    return errorResponse(request, env, error);
  }
}

export { PATHS };
