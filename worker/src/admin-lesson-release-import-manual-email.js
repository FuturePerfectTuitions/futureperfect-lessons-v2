import { handleAdminLessonReleaseImport as handleBaseImport } from './admin-lesson-release-import.js';
import {
  handleAdminLessonReleaseImport as handleEmailImport,
  normaliseCsvInputRow,
  emailItemFromRow
} from './admin-lesson-release-import-email.js';

const CONFIRM_PATH = '/api/v1/admin/lesson-releases/confirm';

async function readJson(request) {
  try { return await request.clone().json(); } catch { return null; }
}

function requestWithJson(request, body) {
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.delete('content-length');
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body)
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

  // Login and preview continue through the email-aware wrapper so the preview
  // still validates the parent-email fields and shows the intended email action.
  if (url.pathname !== CONFIRM_PATH || request.method !== 'POST') {
    return handleEmailImport(request, env);
  }

  const body = await readJson(request);
  if (!Array.isArray(body?.rows)) return handleEmailImport(request, env);

  // Email delivery is deliberately opt-in. The automatic importer calls confirm
  // without sendEmails:true, so it applies only the Portal entitlement changes.
  // The separate manual Send Parent Emails button calls confirm with sendEmails:true.
  if (body.sendEmails === true) return handleEmailImport(request, env);

  const normalizedRows = body.rows.map(normaliseCsvInputRow);
  const normalizedRequest = requestWithJson(request, { ...body, rows:normalizedRows });
  const baseResponse = await handleBaseImport(normalizedRequest, env);
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
