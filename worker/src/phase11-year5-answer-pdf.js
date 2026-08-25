const YEAR5_MATHS_VIEW = 'maths-year5';
const TARGET_LESSON_ID = 'Y5M1';
const TARGET_ANSWER_INDEX = 1;

const SHARED_LEVEL2_R2_KEY =
  'maths/level2/Y5M1/homework/answers/L2T1M01 Answer Pack Homework Number and Place Value I.pdf';

const YEAR5_R2_KEY =
  'phase11/view-overrides/maths-year5/Y5M1/homework/answers/Y5T1M01 Answer Pack Homework Number and Place Value I.pdf';

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

function answerR2KeyForView({ viewId, lessonId, answerIndex, defaultR2Key }) {
  const fallback = String(defaultR2Key || '').trim();
  if (
    String(viewId || '').trim() === YEAR5_MATHS_VIEW &&
    String(lessonId || '').trim() === TARGET_LESSON_ID &&
    Number(answerIndex) === TARGET_ANSWER_INDEX &&
    fallback === SHARED_LEVEL2_R2_KEY
  ) {
    return YEAR5_R2_KEY;
  }
  return fallback;
}

function isTargetAnswer({ viewId, lessonId, answerIndex }) {
  return (
    String(viewId || '').trim() === YEAR5_MATHS_VIEW &&
    String(lessonId || '').trim() === TARGET_LESSON_ID &&
    Number(answerIndex) === TARGET_ANSWER_INDEX
  );
}

function bindMethods(target, property) {
  const value = Reflect.get(target, property, target);
  return typeof value === 'function' ? value.bind(target) : value;
}

function withYear5R2Override(env) {
  const sourceR2 = env?.MATERIALS_R2;
  if (!sourceR2) return env;

  const wrappedR2 = new Proxy(sourceR2, {
    get(target, property) {
      if (property === 'head' || property === 'get') {
        return async (key, ...args) => {
          const requested = String(key || '');
          const actual = requested === SHARED_LEVEL2_R2_KEY ? YEAR5_R2_KEY : requested;
          return target[property](actual, ...args);
        };
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

async function prepareYear5AnswerPdfEnv(request, env) {
  const url = new URL(request.url);

  const authorizeMatch = url.pathname.match(
    /^\/api\/v1\/student\/resources\/([^/]+)\/answer\/authorize$/
  );
  if (authorizeMatch && request.method === 'POST') {
    const parsed = parseAnswerResourceKey(authorizeMatch[1]);
    const viewId = String(url.searchParams.get('viewId') || '').trim();
    return parsed && isTargetAnswer({ viewId, ...parsed }) ? withYear5R2Override(env) : env;
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
  if (
    parsed &&
    isTargetAnswer({
      viewId: tokenRow?.view_id,
      lessonId: tokenRow?.lesson_id,
      answerIndex: parsed.answerIndex
    })
  ) {
    runtimeEnv = withYear5R2Override(runtimeEnv);
  }
  return runtimeEnv;
}

export {
  YEAR5_MATHS_VIEW,
  TARGET_LESSON_ID,
  TARGET_ANSWER_INDEX,
  SHARED_LEVEL2_R2_KEY,
  YEAR5_R2_KEY,
  parseAnswerResourceKey,
  answerR2KeyForView,
  isTargetAnswer,
  withYear5R2Override,
  withAnswerTokenRowCache,
  prepareYear5AnswerPdfEnv
};
