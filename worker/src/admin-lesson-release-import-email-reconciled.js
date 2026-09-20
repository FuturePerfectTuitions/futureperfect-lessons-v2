import { handleAdminLessonReleaseImport as handleReconciledImport } from './admin-lesson-release-import-reconciled.js';
import {
  normaliseCsvInputRow,
  decoratePreview,
  sendEmailsAfterConfirm
} from './admin-lesson-release-import-email.js';

const PREVIEW_PATH = '/api/v1/admin/lesson-releases/preview';
const CONFIRM_PATH = '/api/v1/admin/lesson-releases/confirm';

async function readJson(request) {
  try { return await request.clone().json(); } catch { return null; }
}

function requestWithJson(request, body) {
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.delete('content-length');
  return new Request(request.url, {
    method:request.method,
    headers,
    body:JSON.stringify(body)
  });
}

function responseLike(response, body) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { status:response.status, headers });
}

export async function handleAdminLessonReleaseImport(request, env) {
  const url = new URL(request.url);
  if (![PREVIEW_PATH, CONFIRM_PATH].includes(url.pathname) || request.method !== 'POST') {
    return handleReconciledImport(request, env);
  }

  const body = await readJson(request);
  if (!Array.isArray(body?.rows)) return handleReconciledImport(request, env);

  const normalizedRows = body.rows.map(normaliseCsvInputRow);
  const normalizedRequest = requestWithJson(request, { ...body, rows:normalizedRows });
  const baseResponse = await handleReconciledImport(normalizedRequest, env);
  const baseBody = await baseResponse.clone().json().catch(() => null);
  if (!baseBody) return baseResponse;

  if (url.pathname === PREVIEW_PATH) {
    return responseLike(baseResponse, decoratePreview(baseBody, normalizedRows, env));
  }

  if (!baseResponse.ok || baseBody.ok !== true) return baseResponse;
  return responseLike(baseResponse, await sendEmailsAfterConfirm(env, normalizedRows, baseBody));
}
