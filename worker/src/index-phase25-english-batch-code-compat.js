import currentWorker from './index-phase24-trial-vr.js';

// Phase 25 compatibility bridge for the live Excel/D1 English batch naming.
//
// The legacy navigation core still recognises English batches in the historical
// Y5E / Y5E11 shape. Live owner-supplied batch keys instead use the established
// Y5FE / Y5OE and Y511FE / Y511OE shapes (with an optional numeric suffix).
// Keep the exact live batch key authoritative and add only a request-local legacy
// alias for the two narrow reads used by that older navigation layer. Nothing is
// written back to KV or D1.

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function legacyEnglishBatchAlias(value) {
  const code = clean(value).toUpperCase();
  const match = code.match(/^Y([2-6])(11)?([FO])E(\d*)$/);
  if (!match) return '';

  const year = Number(match[1]);
  const elevenPlus = match[2] === '11';
  if (elevenPlus && year !== 4 && year !== 5) return '';

  return `Y${year}E${elevenPlus ? '11' : ''}`;
}

function withEnglishBatchAliases(user) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) return user;
  if (!Array.isArray(user.batches)) return user;

  const original = user.batches.map(value => clean(value)).filter(Boolean);
  const batches = [...original];
  const seen = new Set(original.map(value => value.toUpperCase()));

  for (const value of original) {
    const alias = legacyEnglishBatchAlias(value);
    if (!alias || seen.has(alias)) continue;
    seen.add(alias);
    batches.push(alias);
  }

  return batches.length === original.length ? user : { ...user, batches };
}

function augmentSessionProfileRow(row) {
  if (!row?.user_json) return row;
  try {
    const user = JSON.parse(String(row.user_json));
    const augmented = withEnglishBatchAliases(user);
    if (augmented === user) return row;
    return { ...row, user_json: JSON.stringify(augmented) };
  } catch {
    return row;
  }
}

function augmentLegacyAccessRows(result) {
  const rows = Array.isArray(result?.results) ? result.results : null;
  if (!rows) return result;

  const augmented = [];
  for (const row of rows) {
    augmented.push(row);
    const alias = legacyEnglishBatchAlias(row?.source_batch_code);
    if (!alias || alias === clean(row?.source_batch_code).toUpperCase()) continue;
    augmented.push({ ...row, source_batch_code: alias });
  }

  return augmented.length === rows.length ? result : { ...result, results: augmented };
}

function compactSql(sql) {
  return clean(sql).replace(/\s+/g, ' ').toLowerCase();
}

function isLegacyAccessStateQuery(sql) {
  const text = compactSql(sql);
  return text.includes('select lesson_id, core_access, vr_access, source_batch_code') &&
    text.includes('from lesson_entitlements') &&
    text.includes('where portal_user_id_norm = ?');
}

function isSessionProfileLoadQuery(sql) {
  const text = compactSql(sql);
  return text.includes('from student_session_profiles p') &&
    text.includes('join student_sessions s') &&
    text.includes('p.user_json');
}

function wrapStatement(statement, mode) {
  return new Proxy(statement, {
    get(target, prop) {
      if (prop === 'bind') {
        return (...args) => wrapStatement(target.bind(...args), mode);
      }
      if (prop === 'all' && mode === 'access-state') {
        return async (...args) => augmentLegacyAccessRows(await target.all(...args));
      }
      if (prop === 'first' && mode === 'session-profile') {
        return async (...args) => augmentSessionProfileRow(await target.first(...args));
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function compatDb(db) {
  if (!db) return db;
  return new Proxy(db, {
    get(target, prop) {
      if (prop !== 'prepare') {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return sql => {
        const statement = target.prepare(sql);
        if (isLegacyAccessStateQuery(sql)) return wrapStatement(statement, 'access-state');
        if (isSessionProfileLoadQuery(sql)) return wrapStatement(statement, 'session-profile');
        return statement;
      };
    }
  });
}

function compatStudentsKv(namespace) {
  if (!namespace) return namespace;
  return new Proxy(namespace, {
    get(target, prop) {
      if (prop !== 'get') {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (key, options) => {
        const value = await target.get(key, options);
        if (value == null || !norm(key).startsWith('user:')) return value;

        if (options?.type === 'json') return withEnglishBatchAliases(value);
        if (typeof value !== 'string') return value;

        try {
          const user = JSON.parse(value);
          const augmented = withEnglishBatchAliases(user);
          return augmented === user ? value : JSON.stringify(augmented);
        } catch {
          return value;
        }
      };
    }
  });
}

function englishBatchCompatEnv(env) {
  if (!env) return env;
  const studentsKv = compatStudentsKv(env.STUDENTS_KV);
  const db = compatDb(env.DB);

  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'STUDENTS_KV') return studentsKv;
      if (prop === 'DB') return db;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function needsCompatibility(request) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/v1/student/')) return false;
  if (url.pathname === '/api/v1/student/auth/login') return false;
  if (url.pathname === '/api/v1/student/auth/logout') return false;
  return true;
}

export {
  legacyEnglishBatchAlias,
  withEnglishBatchAliases,
  augmentSessionProfileRow,
  augmentLegacyAccessRows,
  isLegacyAccessStateQuery,
  isSessionProfileLoadQuery,
  englishBatchCompatEnv,
  needsCompatibility
};

export default {
  async fetch(request, env, ctx) {
    return currentWorker.fetch(
      request,
      needsCompatibility(request) ? englishBatchCompatEnv(env) : env,
      ctx
    );
  }
};
