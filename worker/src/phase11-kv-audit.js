function createKvAudit() {
  return {
    students: { get: 0, getWithMetadata: 0, list: 0 },
    lessons: { get: 0, getWithMetadata: 0, list: 0 }
  };
}

function readTotal(bucket) {
  return Number(bucket.get || 0) + Number(bucket.getWithMetadata || 0) + Number(bucket.list || 0);
}

function countingNamespace(namespace, bucket) {
  return new Proxy(namespace, {
    get(target, prop) {
      if (prop === 'get' || prop === 'getWithMetadata' || prop === 'list') {
        return async (...args) => {
          bucket[prop] += 1;
          return target[prop](...args);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function kvAuditEnv(env, audit) {
  if (!env || !audit) return env;
  const students = env.STUDENTS_KV ? countingNamespace(env.STUDENTS_KV, audit.students) : null;
  const lessons = env.LESSONS_KV ? countingNamespace(env.LESSONS_KV, audit.lessons) : null;
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'STUDENTS_KV' && students) return students;
      if (prop === 'LESSONS_KV' && lessons) return lessons;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function appendExposeHeader(headers, names) {
  const current = String(headers.get('Access-Control-Expose-Headers') || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const merged = [...new Set([...current, ...names])];
  headers.set('Access-Control-Expose-Headers', merged.join(', '));
}

function appendKvAuditHeaders(response, env, audit) {
  if (!response || !audit || String(env?.ENVIRONMENT || 'development') !== 'development') {
    return response;
  }
  const headers = new Headers(response.headers);
  const names = [
    'X-FPT-Students-KV-Read-Ops',
    'X-FPT-Lessons-KV-Read-Ops'
  ];
  headers.set(names[0], String(readTotal(audit.students)));
  headers.set(names[1], String(readTotal(audit.lessons)));
  appendExposeHeader(headers, names);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export {
  appendKvAuditHeaders,
  createKvAudit,
  kvAuditEnv,
  readTotal
};
