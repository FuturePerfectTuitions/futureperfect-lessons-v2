// Phase 25 compatibility bridge for live Excel/D1 batch naming.
//
// The legacy navigation core recognises historical aliases such as Y5E/Y5E11
// and Y5M/Y5M11. Live owner-supplied batch keys use the established paired
// face-to-face/online shapes such as Y5FE/Y5FM and Y511FE/Y511FM, optionally
// with a numeric suffix. Preserve every exact live batch key and add only
// request-local legacy aliases to the narrow reads consumed by the older
// navigation layer. This module itself performs no KV or D1 mutations.

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function legacyLiveBatchAlias(value) {
  const code = clean(value).toUpperCase();
  const match = code.match(/^Y([2-6])(11)?([FO])([EM])(\d*)$/);
  if (!match) return '';

  const year = Number(match[1]);
  const elevenPlus = match[2] === '11';
  const subject = match[4];

  // English 11+ views exist only for Years 4 and 5. Maths uses the existing
  // legacy navigation rules for whatever live 11+ year is supplied.
  if (subject === 'E' && elevenPlus && year !== 4 && year !== 5) return '';

  return `Y${year}${subject}${elevenPlus ? '11' : ''}`;
}

function legacyEnglishBatchAlias(value) {
  const alias = legacyLiveBatchAlias(value);
  return /E(?:11)?$/.test(alias) ? alias : '';
}

function legacyMathsBatchAlias(value) {
  const alias = legacyLiveBatchAlias(value);
  return /M(?:11)?$/.test(alias) ? alias : '';
}

function withLiveBatchAliases(user) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) return user;
  if (!Array.isArray(user.batches)) return user;

  const original = user.batches.map(value => clean(value)).filter(Boolean);
  const batches = [...original];
  const seen = new Set(original.map(value => value.toUpperCase()));

  for (const value of original) {
    const alias = legacyLiveBatchAlias(value);
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
    const augmented = withLiveBatchAliases(user);
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
    const alias = legacyLiveBatchAlias(row?.source_batch_code);
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

        if (options?.type === 'json') return withLiveBatchAliases(value);
        if (typeof value !== 'string') return value;

        try {
          const user = JSON.parse(value);
          const augmented = withLiveBatchAliases(user);
          return augmented === user ? value : JSON.stringify(augmented);
        } catch {
          return value;
        }
      };
    }
  });
}

function liveBatchCompatEnv(env) {
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
  legacyLiveBatchAlias,
  legacyEnglishBatchAlias,
  legacyMathsBatchAlias,
  withLiveBatchAliases,
  augmentSessionProfileRow,
  augmentLegacyAccessRows,
  isLegacyAccessStateQuery,
  isSessionProfileLoadQuery,
  liveBatchCompatEnv,
  needsCompatibility
};
