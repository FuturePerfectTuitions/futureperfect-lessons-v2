import currentBridge from './index-step10-quiz-bridge.js';

const POLICY_VERSION = 'quiz-release-context-v2.0';
const RELEASE_SOURCE = 'portal-live-maths11plus-release-v2';
const clean = value => String(value ?? '').trim();

async function sha(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store'
    }
  });
}

async function authorisedService(request, env) {
  const expected = clean(env?.QUIZ_BRIDGE_SECRET);
  const auth = clean(request.headers.get('Authorization'));
  if (!expected || !auth.startsWith('Bearer ')) return false;
  return (await sha(expected)) === (await sha(auth.slice(7)));
}

function validCodeArray(value, re) {
  return Array.isArray(value) && value.every(raw => re.test(clean(raw).toUpperCase()));
}

/**
 * Owner-authorised Trial rule: every 11+ Trial receives the complete L2 Maths
 * Quiz as a demonstration. Trial demo launch context is server-issued, remains
 * bound to the signed Portal session, and deliberately does not fabricate a
 * canonical D1 batch assignment.
 */
export function trialDemoLaunchStillValid(row, context, now) {
  if (context?.trialDemo !== true) return false;
  if (!clean(row?.portal_session_token_hash)) return false;
  if (context?.portalSessionIssuer !== 'fpt-portal-v2' || context?.portalSessionKind !== 'session') return false;
  const expires = Date.parse(clean(context?.portalSessionExpiresAt));
  const at = Date.parse(now);
  if (!Number.isFinite(expires) || !Number.isFinite(at) || expires <= at) return false;
  if (context?.source !== RELEASE_SOURCE || context?.policyVersion !== POLICY_VERSION) return false;
  if (clean(context?.currentLevel).toUpperCase() !== 'L2') return false;
  if (context?.portalAssignmentId != null && clean(context.portalAssignmentId) !== '') return false;
  const generated = Date.parse(clean(context?.generatedAt));
  if (!Number.isFinite(generated) || generated > at + 60_000) return false;
  if (!validCodeArray(context?.releasedL2LessonCodes, /^L2T\d+M\d+$/i) || context.releasedL2LessonCodes.length === 0) return false;
  if (!validCodeArray(context?.releasedL3LessonCodes, /^L3T\d+M\d+$/i) || context.releasedL3LessonCodes.length !== 0) return false;
  if (!Array.isArray(context?.inheritedLevels) || context.inheritedLevels.length !== 0) return false;
  return true;
}

async function redeemTrialDemo(request, env) {
  if (!(await authorisedService(request, env))) return reply({ error:'UNAUTHORIZED' }, 401);
  const input = await request.clone().json().catch(() => ({}));
  const raw = clean(input.code);
  if (!raw) return currentBridge.fetch(request, env);

  const codeHash = await sha(raw);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT portal_user_id_norm,portal_session_token_hash,release_context_json,expires_at,used_at
     FROM quiz_launch_codes WHERE code_hash=?`
  ).bind(codeHash).first();

  if (!row || row.used_at || String(row.expires_at) <= now) {
    return currentBridge.fetch(request, env);
  }

  let context = {};
  try { context = JSON.parse(row.release_context_json || '{}'); } catch {}
  if (context?.trialDemo !== true) return currentBridge.fetch(request, env);
  if (!trialDemoLaunchStillValid(row, context, now)) return reply({ error:'PORTAL_SESSION_INVALID' }, 401);

  const claim = await env.DB.prepare(
    `UPDATE quiz_launch_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL AND expires_at>?`
  ).bind(now, codeHash, now).run();
  if (Number(claim?.meta?.changes || 0) !== 1) return reply({ error:'LAUNCH_CODE_ALREADY_USED' }, 410);
  return reply({ ok:true, portalUserId:row.portal_user_id_norm, releaseContext:context });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/v1/quiz-bridge/redeem' && request.method === 'POST') {
      return redeemTrialDemo(request, env, ctx);
    }
    return currentBridge.fetch(request, env, ctx);
  }
};
