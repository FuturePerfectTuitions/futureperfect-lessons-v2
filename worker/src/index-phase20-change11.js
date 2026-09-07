import change10Worker from './index-phase20-change10.js';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

// Phase 19's cross-subject preview currently derives counterpart catalogues only
// from active D1 batch assignments. Full Libraries are a separate access source,
// so a student can legitimately see an enrolled subject/year while the matching
// unenrolled subject preview is absent. These request-local synthetic rows are
// injected ONLY into Phase 19's preview query. They never write D1/KV, never grant
// lesson/resource access, and do not affect Current/Previous membership grouping.
const PHASE19_PREVIEW_QUERY_MARKERS = Object.freeze([
  'SELECT a.batch_key, b.subject, b.school_year, b.stream, b.maths_level',
  'FROM student_batch_assignments a',
  'JOIN batch_definitions b ON b.batch_key = a.batch_key'
]);

const FULL_LIBRARY_PREVIEW_ROWS = Object.freeze({
  MATHS_Y2_FULL: Object.freeze({ batch_key: '__FULLLIB_MATHS_Y2', subject: 'maths', school_year: 2, stream: 'normal', maths_level: null }),
  MATHS_Y3_FULL: Object.freeze({ batch_key: '__FULLLIB_MATHS_Y3', subject: 'maths', school_year: 3, stream: 'normal', maths_level: null }),
  MATHS_Y4_FULL: Object.freeze({ batch_key: '__FULLLIB_MATHS_Y4', subject: 'maths', school_year: 4, stream: 'normal', maths_level: null }),
  MATHS_Y5_FULL: Object.freeze({ batch_key: '__FULLLIB_MATHS_Y5', subject: 'maths', school_year: 5, stream: 'normal', maths_level: null }),
  MATHS_Y6_FULL: Object.freeze({ batch_key: '__FULLLIB_MATHS_Y6', subject: 'maths', school_year: 6, stream: 'normal', maths_level: null }),
  ENGLISH_Y2_FULL: Object.freeze({ batch_key: '__FULLLIB_ENGLISH_Y2', subject: 'english', school_year: 2, stream: 'normal', maths_level: null }),
  ENGLISH_Y3_FULL: Object.freeze({ batch_key: '__FULLLIB_ENGLISH_Y3', subject: 'english', school_year: 3, stream: 'normal', maths_level: null }),
  ENGLISH_Y4_FULL: Object.freeze({ batch_key: '__FULLLIB_ENGLISH_Y4', subject: 'english', school_year: 4, stream: 'normal', maths_level: null }),
  ENGLISH_Y5_FULL: Object.freeze({ batch_key: '__FULLLIB_ENGLISH_Y5', subject: 'english', school_year: 5, stream: 'normal', maths_level: null }),
  ENGLISH_Y6_FULL: Object.freeze({ batch_key: '__FULLLIB_ENGLISH_Y6', subject: 'english', school_year: 6, stream: 'normal', maths_level: null }),
  MATHS_L1_FULL: Object.freeze({ batch_key: '__FULLLIB_MATHS_L1', subject: 'maths', school_year: 4, stream: '11plus', maths_level: 1 }),
  MATHS_L2_FULL: Object.freeze({ batch_key: '__FULLLIB_MATHS_L2', subject: 'maths', school_year: 5, stream: '11plus', maths_level: 2 }),
  MATHS_L3_FULL: Object.freeze({ batch_key: '__FULLLIB_MATHS_L3', subject: 'maths', school_year: 6, stream: '11plus', maths_level: 3 }),
  ENGLISH_Y4_11PLUS_FULL: Object.freeze({ batch_key: '__FULLLIB_ENGLISH_Y4_11PLUS', subject: 'english', school_year: 4, stream: '11plus', maths_level: 1 }),
  ENGLISH_Y5_11PLUS_FULL: Object.freeze({ batch_key: '__FULLLIB_ENGLISH_Y5_11PLUS', subject: 'english', school_year: 5, stream: '11plus', maths_level: 2 })
});

function isPhase19PreviewQuery(sql) {
  const text = String(sql || '');
  return PHASE19_PREVIEW_QUERY_MARKERS.every(marker => text.includes(marker));
}

function syntheticPreviewRows(user) {
  const libraries = Array.isArray(user?.fullLibraries) ? user.fullLibraries : [];
  const rows = [];
  for (const value of libraries) {
    const rule = FULL_LIBRARY_PREVIEW_ROWS[clean(value).toUpperCase()];
    if (rule) rows.push({ ...rule });
  }
  return rows;
}

function rowIdentity(row) {
  return [
    norm(row?.subject),
    Number(row?.school_year || 0),
    norm(row?.stream),
    Number(row?.maths_level || 0)
  ].join('|');
}

function mergePreviewRows(existing, synthetic) {
  const out = Array.isArray(existing) ? existing.map(row => ({ ...row })) : [];
  const identities = new Set(out.map(rowIdentity));
  for (const row of synthetic) {
    const identity = rowIdentity(row);
    if (identities.has(identity)) continue;
    identities.add(identity);
    out.push(row);
  }
  return out;
}

function wrapBoundPreviewStatement(bound, env, portalUserIdNorm) {
  return new Proxy(bound, {
    get(target, prop) {
      if (prop !== 'all') {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (...args) => {
        const result = await target.all(...args);
        if (!portalUserIdNorm || !env?.STUDENTS_KV) return result;
        const user = await env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type: 'json' });
        const synthetic = syntheticPreviewRows(user);
        if (!synthetic.length) return result;
        return { ...result, results: mergePreviewRows(result?.results, synthetic) };
      };
    }
  });
}

function wrapPreviewStatement(statement, env) {
  return new Proxy(statement, {
    get(target, prop) {
      if (prop !== 'bind') {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (...args) => wrapBoundPreviewStatement(target.bind(...args), env, norm(args[0]));
    }
  });
}

function previewAwareDb(env) {
  const source = env?.DB;
  if (!source) return source;
  return new Proxy(source, {
    get(target, prop) {
      if (prop !== 'prepare') {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return sql => {
        const statement = target.prepare(sql);
        return isPhase19PreviewQuery(sql) ? wrapPreviewStatement(statement, env) : statement;
      };
    }
  });
}

function withFullLibrarySubjectPreview(env) {
  if (!env?.DB || !env?.STUDENTS_KV) return env;
  const db = previewAwareDb(env);
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'DB') return db;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

export {
  FULL_LIBRARY_PREVIEW_ROWS,
  isPhase19PreviewQuery,
  syntheticPreviewRows,
  mergePreviewRows
};

export default {
  async fetch(request, env, ctx) {
    return change10Worker.fetch(request, withFullLibrarySubjectPreview(env), ctx);
  }
};
