import { sharedMathsAnswerPdfOverride } from './phase11-shared-maths-answer-pdf-overrides.js';

function decodeSegment(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return '';
  }
}

function parseAnswerResourceKey(value) {
  const decoded = decodeSegment(value);
  const parts = decoded.split('~');
  if (parts.length !== 3 || parts[1] !== 'answer') return null;
  const lessonId = decodeSegment(parts[0]);
  const answerIndex = Number(parts[2]);
  if (!lessonId || !Number.isInteger(answerIndex) || answerIndex < 1) return null;
  return { lessonId, answerIndex };
}

function answerOverrideTarget({ viewId, lessonId, answerIndex }) {
  const audited = sharedMathsAnswerPdfOverride(viewId, lessonId, answerIndex);
  if (!audited) return null;
  return {
    viewId: audited.viewId,
    lessonId: audited.lessonId,
    answerIndex: audited.answerIndex,
    yearCode: audited.yearCode,
    levelCode: audited.levelCode,
    sourceR2Key: audited.sourceR2Key,
    sourceSha256: audited.sourceSha256,
    sourceLevelTextCount: audited.sourceLevelTextCount,
    r2Key: audited.overrideR2Key
  };
}

function bindMethods(target, property) {
  const value = Reflect.get(target, property, target);
  return typeof value === 'function' ? value.bind(target) : value;
}

function withAnswerR2Override(env, overrideKey) {
  const sourceR2 = env?.MATERIALS_R2;
  const targetKey = String(overrideKey || '').trim();
  if (!sourceR2 || !targetKey) return env;

  const wrappedR2 = new Proxy(sourceR2, {
    get(target, property) {
      if (property === 'head' || property === 'get') {
        return async (_requestedKey, ...args) => target[property](targetKey, ...args);
      }
      return bindMethods(target, property);
    }
  });

  return new Proxy(env, {
    get(target, property) {
      if (property === 'MATERIALS_R2') return wrappedR2;
      return bindMethods(target, property);
    }
  });
}

function isAnswerTokenSelect(sql) {
  const normalised = String(sql || '').replace(/\s+/g, ' ').trim();
  return (
    /^SELECT\b/i.test(normalised) &&
    /\bFROM answer_view_tokens\b/i.test(normalised) &&
    /\bWHERE token_hash\s*=\s*\?/i.test(normalised)
  );
}

function withAnswerTokenRowCache(env, tokenHash, tokenRow) {
  const sourceDb = env?.DB;
  if (!sourceDb || !tokenHash) return env;

  const wrappedDb = new Proxy(sourceDb, {
    get(target, property) {
      if (property !== 'prepare') return bindMethods(target, property);
      return sql => {
        const statement = target.prepare(sql);
        if (!isAnswerTokenSelect(sql)) return statement;

        return new Proxy(statement, {
          get(statementTarget, statementProperty) {
            if (statementProperty !== 'bind') return bindMethods(statementTarget, statementProperty);
            return (...bindArgs) => {
              const bound = statementTarget.bind(...bindArgs);
              if (String(bindArgs[0] || '') !== String(tokenHash)) return bound;

              return new Proxy(bound, {
                get(boundTarget, boundProperty) {
                  if (boundProperty !== 'first') return bindMethods(boundTarget, boundProperty);
                  return async column => {
                    if (!tokenRow) return null;
                    if (typeof column === 'string' && column) return tokenRow[column] ?? null;
                    return { ...tokenRow };
                  };
                }
              });
            };
          }
        });
      };
    }
  });

  return new Proxy(env, {
    get(target, property) {
      if (property === 'DB') return wrappedDb;
      return bindMethods(target, property);
    }
  });
}

async function sha256Hex(value) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)))
  );
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function prepareSharedMathsAnswerPdfEnv(request, env) {
  const url = new URL(request.url);

  const authorizeMatch = url.pathname.match(
    /^\/api\/v1\/student\/resources\/([^/]+)\/answer\/authorize$/
  );
  if (authorizeMatch && request.method === 'POST') {
    const parsed = parseAnswerResourceKey(authorizeMatch[1]);
    const viewId = String(url.searchParams.get('viewId') || '').trim();
    const target = parsed ? answerOverrideTarget({ viewId, ...parsed }) : null;
    return target ? withAnswerR2Override(env, target.r2Key) : env;
  }

  const answerViewMatch = url.pathname.match(/^\/api\/v1\/student\/answer-view\/([^/]+)$/);
  if (!answerViewMatch || request.method !== 'GET' || !env?.DB) return env;

  const token = decodeSegment(answerViewMatch[1]);
  if (!token) return env;
  const tokenHash = await sha256Hex(token);
  const tokenRow = await env.DB.prepare(
    `SELECT
       token_hash,
       session_token_hash,
       portal_user_id_norm,
       lesson_id,
       resource_key,
       view_id,
       password_fingerprint,
       created_at,
       content_expires_at,
       lease_expires_at,
       used_at
     FROM answer_view_tokens
     WHERE token_hash = ?`
  )
    .bind(tokenHash)
    .first();

  let runtimeEnv = withAnswerTokenRowCache(env, tokenHash, tokenRow || null);
  const parsed = parseAnswerResourceKey(tokenRow?.resource_key || '');
  const target = parsed
    ? answerOverrideTarget({
        viewId: tokenRow?.view_id,
        lessonId: tokenRow?.lesson_id,
        answerIndex: parsed.answerIndex
      })
    : null;
  if (target) runtimeEnv = withAnswerR2Override(runtimeEnv, target.r2Key);
  return runtimeEnv;
}

export {
  parseAnswerResourceKey,
  answerOverrideTarget,
  withAnswerR2Override,
  withAnswerTokenRowCache,
  prepareSharedMathsAnswerPdfEnv
};
