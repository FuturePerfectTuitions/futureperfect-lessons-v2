const SESSION_COOKIE = 'fpt_v2_session';

function normalisePortalUserId(value) {
  return String(value || '').trim().toLowerCase();
}

function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

async function sha256Hex(value) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)))
  );
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function passwordFreeProfile(user) {
  if (!user || typeof user !== 'object') return null;
  const clone = structuredClone(user);
  delete clone.p;
  delete clone.answerPassword;
  return clone;
}

function answerSecurityRoute(request) {
  const pathname = new URL(request.url).pathname;
  return (
    /\/answer\/authorize$/.test(pathname) ||
    /^\/api\/v1\/student\/answer-view\//.test(pathname)
  );
}

function namespaceProxy(namespace, { cachedKey = '', cachedValue = null, capture } = {}) {
  return new Proxy(namespace, {
    get(target, prop) {
      if (prop === 'get') {
        return async (key, options) => {
          if (options?.type === 'json' && cachedKey && key === cachedKey && cachedValue) {
            return structuredClone(cachedValue);
          }
          const value = await target.get(key, options);
          if (
            typeof capture === 'function' &&
            options?.type === 'json' &&
            typeof key === 'string' &&
            key.startsWith('user:') &&
            value && typeof value === 'object'
          ) {
            capture(key, value);
          }
          return value;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function envWithStudentsKv(env, studentsKv) {
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'STUDENTS_KV') return studentsKv;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function captureState() {
  return {
    tokenHash: '',
    portalUserIdNorm: '',
    capturedUser: null,
    cached: false,
    bypassedForAnswerSecurity: false
  };
}

async function loadSessionProfile(env, tokenHash) {
  if (!env?.DB || !tokenHash) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT p.portal_user_id_norm, p.user_json
       FROM student_session_profiles p
       JOIN student_sessions s ON s.token_hash = p.token_hash
       WHERE p.token_hash = ?
         AND s.revoked_at IS NULL
         AND s.idle_expires_at > ?`
    )
      .bind(tokenHash, new Date().toISOString())
      .first();
    if (!row?.user_json) return null;
    const user = JSON.parse(String(row.user_json));
    if (!user || typeof user !== 'object') return null;
    return {
      portalUserIdNorm: normalisePortalUserId(row.portal_user_id_norm),
      user
    };
  } catch {
    // Before migration 0007 is applied, or if D1 is temporarily unavailable,
    // fall back to the established direct STUDENTS_KV behaviour.
    return null;
  }
}

async function prepareSessionProfileEnv(request, env) {
  const state = captureState();
  if (!env?.STUDENTS_KV || !request) return { env, state };

  const capture = (key, user) => {
    state.portalUserIdNorm = normalisePortalUserId(key.slice('user:'.length));
    state.capturedUser = passwordFreeProfile(user);
  };

  const url = new URL(request.url);
  const isLogin = url.pathname === '/api/v1/student/auth/login' && request.method === 'POST';
  if (isLogin) {
    return {
      env: envWithStudentsKv(env, namespaceProxy(env.STUDENTS_KV, { capture })),
      state
    };
  }

  // Phase 8 deliberately re-reads the live Answer Pack password when an answer
  // capability is authorised or validated. Do not let the generic session
  // projection hide those security-critical reads.
  if (answerSecurityRoute(request)) {
    state.bypassedForAnswerSecurity = true;
    return { env, state };
  }

  const rawToken = parseCookies(request)[SESSION_COOKIE] || '';
  if (!rawToken) return { env, state };
  state.tokenHash = await sha256Hex(rawToken);

  const cached = await loadSessionProfile(env, state.tokenHash);
  if (cached?.portalUserIdNorm && cached.user) {
    state.portalUserIdNorm = cached.portalUserIdNorm;
    state.cached = true;
    const key = `user:${cached.portalUserIdNorm}`;
    return {
      env: envWithStudentsKv(
        env,
        namespaceProxy(env.STUDENTS_KV, { cachedKey: key, cachedValue: cached.user })
      ),
      state
    };
  }

  // Compatibility hydration for a session created before migration/deployment:
  // allow the first established user lookup through, capture it, then persist a
  // password-free D1 projection after the request succeeds.
  return {
    env: envWithStudentsKv(env, namespaceProxy(env.STUDENTS_KV, { capture })),
    state
  };
}

function sessionTokenFromSetCookie(response) {
  const raw = response?.headers?.get('set-cookie') || '';
  const match = raw.match(/(?:^|,\s*|;\s*)fpt_v2_session=([^;,\s]+)/i);
  return match ? match[1] : '';
}

async function persistSessionProfile(request, response, env, state) {
  if (!state?.capturedUser || !env?.DB || !response || response.status >= 500) return;
  if (state.bypassedForAnswerSecurity) return;

  let tokenHash = state.tokenHash;
  if (!tokenHash) {
    const token = sessionTokenFromSetCookie(response);
    if (!token) return;
    tokenHash = await sha256Hex(token);
  }

  const portalUserIdNorm = normalisePortalUserId(state.portalUserIdNorm);
  if (!portalUserIdNorm || !tokenHash) return;

  const now = new Date().toISOString();
  const payload = JSON.stringify(state.capturedUser);
  try {
    await env.DB.prepare(
      `INSERT INTO student_session_profiles (
         token_hash, portal_user_id_norm, user_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(token_hash) DO UPDATE SET
         portal_user_id_norm = excluded.portal_user_id_norm,
         user_json = excluded.user_json,
         updated_at = excluded.updated_at`
    )
      .bind(tokenHash, portalUserIdNorm, payload, now, now)
      .run();

    // Exactly one active session is allowed. Removing older projections keeps
    // the projection table aligned with that rule and prevents stale reuse.
    await env.DB.prepare(
      `DELETE FROM student_session_profiles
       WHERE portal_user_id_norm = ? AND token_hash <> ?`
    )
      .bind(portalUserIdNorm, tokenHash)
      .run();
  } catch {
    // Projection is an optimisation, never an authentication dependency. If it
    // cannot be persisted, the next request safely uses the authoritative KV.
  }
}

export {
  SESSION_COOKIE,
  answerSecurityRoute,
  passwordFreeProfile,
  prepareSessionProfileEnv,
  persistSessionProfile,
  sha256Hex
};
