const PATHS = Object.freeze({
  lesson: '/api/v1/admin/resources/lesson',
  replace: '/api/v1/admin/resources/replace'
});

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function allowedOrigin(origin, env) {
  const configured = clean(env?.ALLOWED_ORIGINS)
    .split(',').map(value => value.trim()).filter(Boolean);
  return !origin || configured.includes(origin);
}

function json(body, status = 200, request = null, env = null) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  const origin = request?.headers?.get('Origin') || '';
  if (origin && allowedOrigin(origin, env)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Headers', 'content-type, authorization');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToText(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return atob(base64);
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))
  );
}

async function timingSafeTextEqual(a, b) {
  const aa = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let index = 0; index < aa.length; index += 1) diff |= aa[index] ^ bb[index];
  return diff === 0;
}

async function sessionAuthorised(request, env) {
  const match = clean(request.headers.get('Authorization')).match(/^Bearer\s+(.+)$/i);
  if (!match || !env?.ADMIN_IMPORT_SESSION_SECRET) return false;
  const parts = match[1].split('.');
  if (parts.length !== 2) return false;
  const expected = await hmac(String(env.ADMIN_IMPORT_SESSION_SECRET), parts[0]);
  if (!(await timingSafeTextEqual(parts[1], expected))) return false;

  try {
    const payload = JSON.parse(base64UrlToText(parts[0]));
    return payload.scope === 'lesson-release-import' &&
      Number(payload.exp) >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function canonicalLessonId(value) {
  const raw = clean(value);
  const match = raw.match(/^Y6MS([1-9]|1[0-9])$/i);
  return match ? `Y6M${50 + Number(match[1])}` : raw;
}

function curriculumCandidatesForDisplayId(value) {
  const id = clean(value).toUpperCase();
  let match = id.match(/^Y([2-6])T\d+E{1,2}\d+$/);
  if (match) return [`ENGLISH_Y${match[1]}`];

  match = id.match(/^L([1-3])T\d+M\d+$/);
  if (match) return [`MATHS_L${match[1]}`];

  match = id.match(/^Y([2-6])T\d+M\d+$/);
  if (!match) return [];
  const year = Number(match[1]);
  if (year === 2 || year === 3) return [`MATHS_Y${year}`];
  if (year === 4) return ['MATHS_L1'];
  if (year === 5) return ['MATHS_L2'];
  return ['MATHS_L3', 'MATHS_Y6_EXTRA'];
}

async function resolveLesson(env, inputLessonId) {
  const supplied = clean(inputLessonId);
  if (!supplied) return { error: 'LESSON_REQUIRED' };

  const directId = canonicalLessonId(supplied);
  const directLesson = await env.LESSONS_KV.get(`lesson:${directId}`, { type: 'json' });
  if (directLesson && clean(directLesson.lessonId) === directId && directLesson.active !== false) {
    return { lessonId: directId, lesson: directLesson };
  }

  const matches = new Map();
  for (const curriculumCode of curriculumCandidatesForDisplayId(supplied)) {
    const curriculum = await env.LESSONS_KV.get(`curriculum:${curriculumCode}`, { type: 'json' });
    const ids = Array.isArray(curriculum?.lessonIds) ? curriculum.lessonIds.map(clean).filter(Boolean) : [];
    for (const lessonId of ids) {
      const lesson = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
      if (!lesson || lesson.active === false) continue;
      const displayIds = Object.values(lesson.displayIds || {}).map(value => norm(value));
      if (displayIds.includes(norm(supplied))) matches.set(clean(lesson.lessonId), lesson);
    }
  }

  if (matches.size === 1) {
    const [[lessonId, lesson]] = matches;
    return { lessonId, lesson };
  }
  if (matches.size > 1) return { error: 'AMBIGUOUS_LESSON_DISPLAY_ID' };
  return { error: 'LESSON_NOT_FOUND' };
}

function isResourceObject(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    clean(value.r2Key) &&
    (clean(value.resourceId) || clean(value.displayName))
  );
}

function resourceKind(path, resource) {
  const text = `${path.join(' ')} ${clean(resource?.displayName)} ${clean(resource?.resourceId)}`.toLowerCase();
  if (text.includes('prelesson') || text.includes('pre lesson')) return text.includes('answer') ? 'PreLesson Answer' : 'PreLesson';
  if (text.includes('cumulative')) return text.includes('answer') ? 'Cumulative Answer' : 'Cumulative Homework';
  if (text.includes('homework')) return text.includes('answer') ? 'Homework Answer' : 'Homework';
  if (text.includes('answer')) return 'Answer';
  if (text.includes('vr')) return 'VR Resource';
  return 'Resource';
}

function enumerateResources(lesson) {
  const resources = [];
  const visit = (value, path = []) => {
    if (isResourceObject(value)) {
      resources.push({
        path,
        pathToken: JSON.stringify(path),
        resourceId: clean(value.resourceId),
        displayName: clean(value.displayName) || clean(value.resourceId) || 'Resource',
        r2Key: clean(value.r2Key),
        kind: resourceKind(path, value)
      });
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, [...path, index]));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'r2Key') continue;
      visit(child, [...path, key]);
    }
  };
  visit(lesson, []);
  return resources.sort((a, b) => a.pathToken.localeCompare(b.pathToken));
}

function parsePathToken(value) {
  try {
    const parsed = JSON.parse(clean(value));
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 30) return null;
    for (const part of parsed) {
      if (typeof part === 'number') {
        if (!Number.isInteger(part) || part < 0 || part > 10000) return null;
      } else if (typeof part === 'string') {
        if (!part || part.length > 120 || ['__proto__', 'prototype', 'constructor'].includes(part)) return null;
      } else {
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

function objectAtPath(root, path) {
  let current = root;
  for (const part of path) {
    if (current == null || typeof current !== 'object') return null;
    if (typeof part === 'number') {
      if (!Array.isArray(current) || part >= current.length) return null;
    } else if (!Object.prototype.hasOwnProperty.call(current, part)) {
      return null;
    }
    current = current[part];
  }
  return current;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function replaceR2KeyAtPath(lesson, path, nextR2Key) {
  const cloned = cloneJson(lesson);
  const target = objectAtPath(cloned, path);
  if (!isResourceObject(target)) throw new Error('RESOURCE_NOT_FOUND');
  target.r2Key = nextR2Key;
  return cloned;
}

function safeFileName(value) {
  const input = clean(value).replace(/\\/g, '/').split('/').pop() || 'replacement.pdf';
  const stem = input.replace(/\.pdf$/i, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._() +&-]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140) || 'replacement';
  return `${stem}.pdf`;
}

function stampForKey(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function uniqueReplacementKey(bucket, oldKey, uploadedName) {
  const slash = oldKey.lastIndexOf('/');
  const directory = slash >= 0 ? oldKey.slice(0, slash) : '';
  const safe = safeFileName(uploadedName);
  const stem = safe.replace(/\.pdf$/i, '');
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const suffix = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 7);
    const fileName = `${stem}__replacement_${stampForKey()}_${suffix}.pdf`;
    const key = directory ? `${directory}/${fileName}` : fileName;
    if (key === oldKey) continue;
    if (!(await bucket.head(key))) return key;
  }
  throw new Error('R2_KEY_COLLISION');
}

function pdfMagicValid(bytes) {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 5) return false;
  const prefix = new TextDecoder().decode(new Uint8Array(bytes, 0, 5));
  return prefix === '%PDF-';
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function handleLesson(request, env) {
  if (!(await sessionAuthorised(request, env))) {
    return json({ ok: false, error: 'UNAUTHORISED' }, 401, request, env);
  }
  if (!env?.LESSONS_KV || !env?.MATERIALS_R2) {
    return json({ ok: false, error: 'RESOURCE_ADMIN_NOT_CONFIGURED' }, 503, request, env);
  }
  const body = await readJson(request);
  const resolved = await resolveLesson(env, body?.lessonId);
  if (resolved.error) return json({ ok: false, error: resolved.error }, 404, request, env);
  const resources = enumerateResources(resolved.lesson);
  return json({
    ok: true,
    lesson: {
      lessonId: resolved.lessonId,
      title: clean(resolved.lesson.title),
      subject: clean(resolved.lesson.subject),
      displayIds: resolved.lesson.displayIds || {}
    },
    resources
  }, 200, request, env);
}

async function handleReplace(request, env) {
  if (!(await sessionAuthorised(request, env))) {
    return json({ ok: false, error: 'UNAUTHORISED' }, 401, request, env);
  }
  if (!env?.LESSONS_KV || !env?.MATERIALS_R2) {
    return json({ ok: false, error: 'RESOURCE_ADMIN_NOT_CONFIGURED' }, 503, request, env);
  }

  let form;
  try { form = await request.formData(); } catch {
    return json({ ok: false, error: 'INVALID_FORM_DATA' }, 400, request, env);
  }

  const lessonInput = clean(form.get('lessonId'));
  const expectedR2Key = clean(form.get('expectedR2Key'));
  const path = parsePathToken(form.get('resourcePath'));
  const file = form.get('file');

  if (!lessonInput || !expectedR2Key || !path || !file || typeof file.arrayBuffer !== 'function') {
    return json({ ok: false, error: 'REPLACEMENT_FIELDS_REQUIRED' }, 400, request, env);
  }

  const resolved = await resolveLesson(env, lessonInput);
  if (resolved.error) return json({ ok: false, error: resolved.error }, 404, request, env);

  const target = objectAtPath(resolved.lesson, path);
  if (!isResourceObject(target)) {
    return json({ ok: false, error: 'RESOURCE_NOT_FOUND' }, 404, request, env);
  }
  const currentR2Key = clean(target.r2Key);
  if (currentR2Key !== expectedR2Key) {
    return json({
      ok: false,
      error: 'RESOURCE_CHANGED',
      message: 'This resource changed after it was loaded. Reload the lesson before replacing it.',
      currentR2Key
    }, 409, request, env);
  }

  const fileName = clean(file.name);
  if (!/\.pdf$/i.test(fileName)) {
    return json({ ok: false, error: 'PDF_REQUIRED' }, 400, request, env);
  }

  const bytes = await file.arrayBuffer();
  if (!pdfMagicValid(bytes)) {
    return json({ ok: false, error: 'INVALID_PDF' }, 400, request, env);
  }

  const inputHash = await sha256Hex(bytes);
  let newR2Key = '';
  try {
    newR2Key = await uniqueReplacementKey(env.MATERIALS_R2, currentR2Key, fileName);
    await env.MATERIALS_R2.put(newR2Key, bytes, {
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: {
        replacementFor: currentR2Key.slice(0, 900),
        lessonId: resolved.lessonId,
        resourceId: clean(target.resourceId).slice(0, 200)
      }
    });

    const readback = await env.MATERIALS_R2.get(newR2Key);
    if (!readback) throw new Error('R2_VERIFY_MISSING');
    const readbackBytes = await readback.arrayBuffer();
    const readbackHash = await sha256Hex(readbackBytes);
    if (readbackHash !== inputHash) throw new Error('R2_VERIFY_HASH_MISMATCH');

    const nextLesson = replaceR2KeyAtPath(resolved.lesson, path, newR2Key);
    await env.LESSONS_KV.put(`lesson:${resolved.lessonId}`, JSON.stringify(nextLesson));

    return json({
      ok: true,
      lessonId: resolved.lessonId,
      title: clean(resolved.lesson.title),
      resourceId: clean(target.resourceId),
      displayName: clean(target.displayName),
      oldR2Key: currentR2Key,
      newR2Key,
      sha256: inputHash,
      oldObjectRetained: true,
      message: 'Replacement published. The previous R2 object was retained for rollback safety.'
    }, 200, request, env);
  } catch (error) {
    if (newR2Key) {
      try { await env.MATERIALS_R2.delete(newR2Key); } catch { /* best-effort cleanup only */ }
    }
    return json({
      ok: false,
      error: clean(error?.message) || 'RESOURCE_REPLACE_FAILED'
    }, 500, request, env);
  }
}

async function handleAdminResourceRequest(request, env) {
  const url = new URL(request.url);
  if (!allowedOrigin(request.headers.get('Origin') || '', env)) {
    return json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403, request, env);
  }
  if (request.method === 'OPTIONS') return json({ ok: true }, 200, request, env);
  if (request.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, request, env);
  if (url.pathname === PATHS.lesson) return handleLesson(request, env);
  if (url.pathname === PATHS.replace) return handleReplace(request, env);
  return json({ ok: false, error: 'NOT_FOUND' }, 404, request, env);
}

export {
  PATHS,
  enumerateResources,
  handleAdminResourceRequest,
  isResourceObject,
  objectAtPath,
  parsePathToken,
  pdfMagicValid,
  replaceR2KeyAtPath,
  resolveLesson,
  safeFileName,
  sessionAuthorised,
  sha256Hex
};
