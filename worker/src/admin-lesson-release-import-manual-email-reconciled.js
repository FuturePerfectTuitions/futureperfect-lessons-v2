import { handleAdminLessonReleaseImport as handleReconciledBase } from './admin-lesson-release-import-reconciled.js';
import { handleAdminLessonReleaseImport as handleEmailImport } from './admin-lesson-release-import-email-reconciled.js';
import { normaliseCsvInputRow, emailItemFromRow } from './admin-lesson-release-import-email.js';

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

function emailEligibleCount(rows) {
  return rows
    .map((row, index) => emailItemFromRow(row, index))
    .filter(item => Boolean(item.emailType))
    .length;
}

export async function handleAdminLessonReleaseImport(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== CONFIRM_PATH || request.method !== 'POST') {
    return handleEmailImport(request, env);
  }

  const body = await readJson(request);
  if (!Array.isArray(body?.rows)) return handleEmailImport(request, env);

  // Manual parent-email sends use the same reconciled Portal mutation first;
  // automatic import continues to defer email delivery exactly as before.
  if (body.sendEmails === true) return handleEmailImport(request, env);

  const normalizedRows = body.rows.map(normaliseCsvInputRow);
  const normalizedRequest = requestWithJson(request, { ...body, rows:normalizedRows });
  const baseResponse = await handleReconciledBase(normalizedRequest, env);
  const baseBody = await baseResponse.clone().json().catch(() => null);
  if (!baseBody) return baseResponse;
  if (!baseResponse.ok || baseBody.ok !== true) return baseResponse;

  const emailEligible = emailEligibleCount(normalizedRows);
  return responseLike(baseResponse, {
    ...baseBody,
    emailSendDeferred:true,
    emailResults:[],
    summary:{
      ...(baseBody.summary || {}),
      emailEligible,
      emailsEligible:emailEligible,
      emailsSent:0,
      emailsAlreadySent:0,
      emailsFailed:0
    }
  });
}

export { emailEligibleCount };
