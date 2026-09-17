import worker from '../../worker/src/index-admin-tools.js';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const workerName = 'fpt-portal-v2-worker';
if (!accountId || !apiToken) throw new Error('Missing Cloudflare audit credentials');

const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
const headers = { Authorization: `Bearer ${apiToken}` };

async function cfJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) }
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok || body?.success === false) {
    throw new Error(`Cloudflare API failed ${response.status}: ${text.slice(0, 500)}`);
  }
  return body;
}

const settings = await cfJson(`${base}/workers/scripts/${workerName}/settings`);
const binding = name => (settings.result?.bindings || []).find(item => item.name === name) || null;
const studentsId = binding('STUDENTS_KV')?.namespace_id;
const lessonsId = binding('LESSONS_KV')?.namespace_id;
const dbId = binding('DB')?.id || binding('DB')?.database_id;
if (!studentsId || !lessonsId || !dbId) throw new Error('Required production bindings missing');

function kv(namespaceId) {
  return {
    async get(key, options = {}) {
      const encoded = encodeURIComponent(String(key));
      const response = await fetch(`${base}/storage/kv/namespaces/${namespaceId}/values/${encoded}`, { headers });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`KV get failed ${response.status} for ${key}`);
      const text = await response.text();
      if (options?.type === 'json') {
        try { return JSON.parse(text); } catch { return null; }
      }
      return text;
    }
  };
}

async function d1Query(sql, params = []) {
  const body = await cfJson(`${base}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params })
  });
  const result = Array.isArray(body.result) ? body.result[0] : null;
  return result?.results || [];
}

const portalUserIdNorm = 'rei0710';
const fakeNow = new Date();
const fakeSession = {
  token_hash: 'diagnostic-token-hash',
  portal_user_id_norm: portalUserIdNorm,
  created_at: new Date(fakeNow.getTime() - 60_000).toISOString(),
  last_activity_at: fakeNow.toISOString(),
  idle_expires_at: new Date(fakeNow.getTime() + 60 * 60 * 1000).toISOString(),
  revoked_at: null
};

function readOnlyDb() {
  return {
    prepare(sql) {
      const bound = [];
      const statement = {
        bind(...values) {
          bound.splice(0, bound.length, ...values);
          return statement;
        },
        async first(column) {
          const compact = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
          if (compact.includes(' from student_sessions ') && compact.includes(' where token_hash = ?')) {
            return column ? fakeSession[column] : { ...fakeSession };
          }
          const rows = await d1Query(sql, bound);
          const row = rows[0] || null;
          return column && row ? row[column] : row;
        },
        async all() {
          const rows = await d1Query(sql, bound);
          return { results: rows, success: true };
        },
        async run() {
          const compact = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
          if (
            compact.startsWith('update student_sessions ') ||
            compact.startsWith('insert into student_session_profiles ') ||
            compact.startsWith('delete from student_session_profiles ')
          ) {
            return { success: true, meta: { changes: 0, readOnlyDiagnostic: true } };
          }
          throw new Error(`WRITE_BLOCKED_IN_DIAGNOSTIC: ${compact.slice(0, 120)}`);
        }
      };
      return statement;
    }
  };
}

const env = {
  ENVIRONMENT: 'production',
  STUDENT_LOGIN_ENABLED: 'true',
  ALLOWED_ORIGINS: 'https://lessons.futureperfect.education,https://futureperfect.education,https://futureperfecttuitions.github.io',
  STUDENTS_KV: kv(studentsId),
  LESSONS_KV: kv(lessonsId),
  DB: readOnlyDb(),
  MATERIALS_R2: {
    async head(key) {
      return key ? { key, size: 1 } : null;
    },
    async get() {
      throw new Error('R2_GET_NOT_EXPECTED_IN_LESSON_DETAIL_DIAGNOSTIC');
    }
  }
};

const pending = [];
const ctx = {
  waitUntil(promise) { pending.push(Promise.resolve(promise)); },
  passThroughOnException() {}
};

const request = new Request(
  'https://fpt-portal-v2-worker.futureperfectlessons.workers.dev/api/v1/student/lessons/Y4E1?viewId=english-year4-11plus',
  {
    method: 'GET',
    headers: {
      Origin: 'https://lessons.futureperfect.education',
      Cookie: 'fpt_v2_session=diagnostic-token'
    }
  }
);

const response = await worker.fetch(request, env, ctx);
const body = await response.clone().json().catch(() => null);
await Promise.allSettled(pending);

const lesson = body?.lesson || null;
const summary = {
  status: response.status,
  ok: body?.ok ?? false,
  error: body?.error ?? null,
  view: body?.view ? {
    viewId: body.view.viewId,
    presentation: body.view.presentation ?? null,
    lockedPreview: body.view.lockedPreview ?? null,
    source: body.view.source ?? null
  } : null,
  lesson: lesson ? {
    lessonId: lesson.lessonId,
    displayLessonId: lesson.displayLessonId,
    title: lesson.title,
    locked: lesson.locked,
    state: lesson.state,
    accessMode: lesson.accessMode,
    presentation: lesson.presentation ?? null,
    preLessonSheets: Array.isArray(lesson.preLessonSheets)
      ? lesson.preLessonSheets.map(item => ({
          displayName: item?.displayName ?? null,
          resourceKey: item?.resourceKey ?? null,
          available: item?.available ?? null,
          locked: item?.locked ?? null
        }))
      : lesson.preLessonSheets,
    homeworkCount: Array.isArray(lesson.homeworks) ? lesson.homeworks.length : null,
    vrPresent: Boolean(lesson.vr),
    phase11CorePreCount: Array.isArray(lesson.phase11Resources?.corePreLessonPairs)
      ? lesson.phase11Resources.corePreLessonPairs.length
      : null
  } : null
};

console.log('=== EXACT CURRENT-CODE / LIVE-DATA SIMULATION SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));
console.log('Y4E1_SIMULATION_COMPLETE=true');
