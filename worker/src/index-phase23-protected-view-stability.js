import currentWorker from './index-phase20-change20-configured-upsell.js';

const PROTECTED_VIEW_STABILITY_VERSION = 'phase23-protected-view-stability-v2';
const RETRYABLE_PROTECTED_VIEW_ERRORS = new Set([
  'ANSWER_VIEW_EXPIRED',
  'ANSWER_VIEW_ALREADY_OPENED'
]);

async function sha256Hex(value) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)))
  );
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function protectedViewRow(env, token) {
  if (!env?.DB || !token) return null;
  const tokenHash = await sha256Hex(token);
  return env.DB.prepare(
    `SELECT token_hash, view_id, lease_expires_at
     FROM answer_view_tokens
     WHERE token_hash = ?`
  )
    .bind(tokenHash)
    .first();
}

async function requestWithProtectedViewContext(request, env, token) {
  const url = new URL(request.url);
  if (url.searchParams.get('viewId')) return request;

  const row = await protectedViewRow(env, token).catch(() => null);
  const viewId = String(row?.view_id || '').trim();
  if (!viewId) return request;

  // The password-authorize request carries viewId, but the follow-up token URL
  // historically did not. Phase 12 uses viewId to recreate batch-aware Maths
  // L1/L2/L3 access. Restore the token's authoritative view_id on this internal
  // request so the protected-answer visibility re-check runs in the same view
  // context in which the password was accepted.
  url.searchParams.set('viewId', viewId);
  return new Request(url.toString(), request);
}

async function reviveProtectedOpen(env, token) {
  if (!env?.DB || !token) return false;
  const tokenHash = await sha256Hex(token);
  const nowIso = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE answer_view_tokens
     SET used_at = NULL,
         content_expires_at = lease_expires_at
     WHERE token_hash = ?
       AND lease_expires_at > ?`
  )
    .bind(tokenHash, nowIso)
    .run();
  return Number(result?.meta?.changes || 0) === 1;
}

async function retryProtectedOpenIfNeeded(request, env, ctx, token, firstResponse) {
  if (firstResponse.status !== 410) return firstResponse;

  const body = await firstResponse.clone().json().catch(() => null);
  if (!RETRYABLE_PROTECTED_VIEW_ERRORS.has(String(body?.error || ''))) {
    return firstResponse;
  }

  const revived = await reviveProtectedOpen(env, token).catch(() => false);
  if (!revived) return firstResponse;
  return currentWorker.fetch(request, env, ctx);
}

function withStabilityMarker(response) {
  const headers = new Headers(response.headers);
  headers.set('x-fpt-protected-view-stability', PROTECTED_VIEW_STABILITY_VERSION);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = request.method === 'GET'
      ? url.pathname.match(/^\/api\/v1\/student\/answer-view\/([^/]+)$/)
      : null;

    if (!match) {
      return currentWorker.fetch(request, env, ctx);
    }

    const token = decodeURIComponent(match[1]);
    const contextualRequest = await requestWithProtectedViewContext(request, env, token);

    if (url.searchParams.get('status') === '1') {
      return withStabilityMarker(await currentWorker.fetch(contextualRequest, env, ctx));
    }

    const firstResponse = await currentWorker.fetch(contextualRequest, env, ctx);
    const response = await retryProtectedOpenIfNeeded(
      contextualRequest,
      env,
      ctx,
      token,
      firstResponse
    );
    return withStabilityMarker(response);
  }
};
